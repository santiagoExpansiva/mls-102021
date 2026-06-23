/// <mls fileReference="_102021_/l2/agentMaterializeSolution/agentMaterializeMock.ts" enhancement="_102027_/l2/enhancementAgent"/>

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  scanL1DefsFiles,
  getContentByMlsPath,
  saveGeneratedTs,
  extractToolCallArgs,
  toMlsPath,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';

declare const mls: any;

// Stores args between beforePromptImplicit and afterPromptStep (step.prompt is not reliable for implicit flow)
const _implicitArgs = new Map<string, MockStepArgs>();

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentMaterializeMock',
    agentProject: 102021,
    agentFolder: 'agentMaterializeSolution',
    agentDescription: 'Generate layer_1_external/mock.ts with SeedDefinition[] from module table definitions',
    visibility: 'public',
    beforePromptImplicit,
    beforePromptStep,
    afterPromptStep,
  };
}

// ─── Args ─────────────────────────────────────────────────────────────────────

export interface MockStepArgs {
  project: number;
  moduleName: string;
}

// ─── Tool schema ──────────────────────────────────────────────────────────────

const TOOL_NAME = 'submitGeneratedTs';

interface ToolOutput {
  code: string;
}

const toolSchema = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Submit the complete generated mock.ts file content.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: {
        code: {
          type: 'string',
          description: 'Complete TypeScript file content. Must start with the /// <mls fileReference="..."> header.',
        },
      },
    },
  },
} as const;

// ─── beforePromptImplicit ─────────────────────────────────────────────────────
// Bootstrap step: scans files, confirms count, then afterPromptStep creates
// the real gen step (which uses beforePromptStep + tools).

async function beforePromptImplicit(
  agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  _userPrompt: string,
): Promise<mls.msg.AgentIntent[]> {
  const extracted = extractArgsFromPrompt(_userPrompt);
  const project = typeof extracted.project === 'number' ? extracted.project : (mls.actualProject as number) || 0;
  const moduleName = extracted.moduleName ?? '';

  if (!moduleName) {
    throw new Error('[agentMaterializeMock] moduleName not found. Send: @@MaterializeMock {"project":102043,"moduleName":"yourModule"}');
  }

  const fileCount = countInputFiles(project, moduleName);

  _implicitArgs.set(context.message.threadId, { project, moduleName });

  const addMessageAI: mls.msg.AgentIntentAddMessageAI = {
    type: 'add-message-ai',
    request: {
      action: 'addMessageAI',
      agentName: agent.agentName,
      inputAI: [
        { type: 'system', content: BOOTSTRAP_SYSTEM },
        { type: 'human', content: buildBootstrapPrompt(project, moduleName, fileCount) },
      ],
      taskTitle: 'generate-mock',
      threadId: context.message.threadId,
      userMessage: JSON.stringify({ project, moduleName } satisfies MockStepArgs),
    },
  };

  return [addMessageAI];
}

// ─── beforePromptStep ─────────────────────────────────────────────────────────
// Real gen step: loads all .defs.ts and sends to LLM with forced tool call.

async function beforePromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  _step: mls.msg.AIAgentStep,
  hookSequential: number,
  args?: string,
): Promise<mls.msg.AgentIntent[]> {
  if (!args) throw new Error('[agentMaterializeMock] missing args');

  const { project, moduleName }: MockStepArgs = JSON.parse(args);
  const outputPath = toMlsPath(project, 1, `${moduleName}/layer_1_external`, 'mock', '.ts');
  const sections = await collectDefsSections(project, moduleName);

  const intent: mls.msg.AgentIntentPromptReady = {
    type: 'prompt_ready',
    args,
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    hookSequential,
    parentStepId: parentStep.stepId,
    systemPrompt: buildSystemPrompt(outputPath),
    humanPrompt: buildHumanPrompt(sections, outputPath),
    tools: [toolSchema as unknown as mls.msg.LLMTool],
    toolChoice: { type: 'function', function: { name: TOOL_NAME } },
  };

  return [intent];
}

// ─── afterPromptStep ──────────────────────────────────────────────────────────
// Handles two cases:
//   1. Tool call response (from beforePromptStep) → save the generated code
//   2. Flexible/text response (from beforePromptImplicit) → create the gen step

async function afterPromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
): Promise<mls.msg.AgentIntent[]> {
  const raw = step.interaction?.payload?.[0] as any;

  // Case 1: tool call → save generated code
  const out = extractToolCallArgs<ToolOutput>(raw, TOOL_NAME);
  if (out?.code) {
    const { project, moduleName } = resolveArgs(step.prompt);
    const outputPath = toMlsPath(project, 1, `${moduleName}/layer_1_external`, 'mock', '.ts');

    const header = `/// <mls fileReference="${outputPath}" enhancement="_blank"/>`;
    const code = out.code.trimStart().startsWith('///') ? out.code : `${header}\n\n${out.code}`;

    const ok = await saveGeneratedTs(project, 1, `${moduleName}/layer_1_external`, 'mock', code);
    return [mkStatus(context, parentStep, step, hookSequential,
      ok ? 'completed' : 'failed',
      ok ? undefined : 'saveGeneratedTs failed',
      ok ? 'input_output' : undefined,
    )];
  }

  // Case 2: bootstrap response → create the real gen step
  if (raw?.type === 'result') {
    _implicitArgs.delete(context.message.threadId);
    return [mkStatus(context, parentStep, step, hookSequential, 'failed', String(raw.result))];
  }

  const stored = _implicitArgs.get(context.message.threadId);
  _implicitArgs.delete(context.message.threadId);

  const fallback = resolveArgs(step.prompt);
  const project = stored?.project ?? fallback.project;
  const moduleName = stored?.moduleName ?? fallback.moduleName;

  if (!moduleName) {
    return [mkStatus(context, parentStep, step, hookSequential, 'failed', 'could not resolve moduleName')];
  }

  const genArgs = JSON.stringify({ project, moduleName } satisfies MockStepArgs);
  const planId = `mock-gen-${moduleName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;

  const addStep: mls.msg.AgentIntentAddStep = {
    type: 'add-step',
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    parentStepId: step.stepId,
    step: {
      type: 'agent',
      stepId: 0,
      interaction: null,
      stepTitle: `Generate mock: ${moduleName}`,
      status: 'waiting_human_input',
      nextSteps: [],
      agentName: 'agentMaterializeMock',
      prompt: genArgs,
      rags: [],
      planning: { planId, dependsOn: [], executionMode: 'parallel_static', executionHost: 'client' },
    } as any,
  };

  return [addStep];
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function scanL1LayerFiles(project: number, moduleName: string, layer: string): Array<{ mlsPath: string; shortName: string }> {
  const result: Array<{ mlsPath: string; shortName: string }> = [];
  const folder = `${moduleName}/${layer}`;
  try {
    for (const f of Object.values(mls.stor.files as Record<string, any>)) {
      if (f.project !== project) continue;
      if (f.level !== 1) continue;
      if (f.folder !== folder) continue;
      if (f.extension !== '.ts') continue;
      if (f.status === 'deleted') continue;
      result.push({ shortName: f.shortName, mlsPath: toMlsPath(project, 1, folder, f.shortName, '.ts') });
    }
  } catch {}
  return result;
}

function countInputFiles(project: number, moduleName: string): number {
  const defs = scanL1DefsFiles(project, moduleName);
  const layerFiles = scanL1LayerFiles(project, moduleName, 'layer_1_external');
  return defs.length + layerFiles.length;
}

async function collectDefsSections(project: number, moduleName: string): Promise<string[]> {
  const sections: string[] = [];

  // Format B: .defs.ts files
  const defs = scanL1DefsFiles(project, moduleName);
  for (const d of defs) {
    const content = await getContentByMlsPath(d.mlsPath);
    if (content) sections.push(`### ${d.mlsPath}\n\`\`\`typescript\n${content}\n\`\`\``);
  }

  // Format A: persistence.ts + individual table files in layer_1_external
  const l1Files = scanL1LayerFiles(project, moduleName, 'layer_1_external');
  for (const f of l1Files) {
    if (f.shortName === 'mock') continue;
    const content = await getContentByMlsPath(f.mlsPath);
    if (content) sections.push(`### ${f.mlsPath}\n\`\`\`typescript\n${content}\n\`\`\``);
  }

  if (!sections.length) throw new Error(`[agentMaterializeMock] no layer_1 files found for project=${project} module=${moduleName}`);
  return sections;
}

function extractArgsFromPrompt(prompt: string): Partial<MockStepArgs> {
  const trimmed = prompt.trim();
  // Extract JSON block from the prompt (handles "@@Cmd {...}" prefix format)
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {}
  }
  // Fallback: plain module name
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed)) return { moduleName: trimmed };
  return {};
}

function resolveArgs(stepPrompt: string | undefined): MockStepArgs {
  const extracted = extractArgsFromPrompt(stepPrompt || '');
  return {
    project: typeof extracted.project === 'number' ? extracted.project : (mls.actualProject as number) || 0,
    moduleName: typeof extracted.moduleName === 'string' ? extracted.moduleName : '',
  };
}

function mkStatus(
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
  status: mls.msg.AIStepStatus,
  traceMsg?: string,
  cleaner?: 'input' | 'input_output',
): mls.msg.AgentIntentUpdateStatus {
  return {
    type: 'update-status',
    hookSequential,
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    parentStepId: parentStep?.stepId ?? step.stepId,
    stepId: step.stepId,
    status,
    traceMsg,
    cleaner,
  };
}

// ─── Bootstrap prompts ────────────────────────────────────────────────────────

const BOOTSTRAP_SYSTEM = `<!-- modelType: codepro -->
You confirm a mock generation scan.
If files were found, return: {"type":"flexible","result":{"status":"ok"}}
If no files, return: {"type":"result","result":"No layer_1 files found"}
Return valid JSON only.`;

function buildBootstrapPrompt(project: number, moduleName: string, fileCount: number): string {
  return [
    `## Mock generation scan`,
    ``,
    `Project: ${project}`,
    `Module: ${moduleName}`,
    `Layer_1 files found: ${fileCount}`,
    ``,
    `Confirm and return your response.`,
  ].join('\n');
}

// ─── Generation prompts ───────────────────────────────────────────────────────

function buildSystemPrompt(outputPath: string): string {
  return `<!-- modelType: codeinstruct -->

You generate a \`mock.ts\` file for a module's \`layer_1_external\`.

The file exports \`seedDefinitions: SeedDefinition[]\` — an ordered array of tables with seed records used to populate the database on first deploy.

Target file: ${outputPath}

---

## Input

You receive the module's \`persistence.ts\` and individual table definition files from \`layer_1_external\`.

Each table definition file exports a \`TableDefinition\` with:
- \`tableName\`: the actual postgres table name (snake_case)
- \`columns[]\`: array of \`{ name, postgresType, nullable }\`
- \`primaryKey[]\`: string[]

The \`persistence.ts\` exports \`tableDefinitions: TableDefinition[]\` listing all tables in the module.

You may also receive \`.defs.ts\` files — use them only for domain context (status enums, field names).

---

## Output structure

\`\`\`typescript
/// <mls fileReference="${outputPath}" enhancement="_blank"/>
import type { SeedDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const seedDefinitions: SeedDefinition[] = [
  {
    tableName: 'table_name',
    records: [
      { col1: 'value1', col2: 'value2' },
      { col1: 'value3', col2: 'value4' },
    ],
  },
  // ... one entry per table, ordered by FK dependency
];
\`\`\`

---

## FK ordering rule

The array order IS the insertion order. A table that references another via FK must come AFTER the referenced table.
Analyze FK relationships from column names (e.g. \`shift_id\` references \`shifts\`, \`order_id\` references \`orders\`).
Tables with no FK dependencies come first.

---

## Sample data rules

Generate **2 records** per table with realistic domain values. Use different values between the two records.

| postgresType | Rule |
|---|---|
| UUID | Use format \`xxxxxxxx-0000-0000-0000-xxxxxxxxxxxx\` — define named constants at the top of the file for reuse across tables. Example: \`const SHIFT_1 = '11111111-0000-0000-0000-000000000001'\` |
| TEXT | Meaningful short string relevant to the domain |
| INTEGER / NUMERIC | Different reasonable integers |
| BOOLEAN | \`true\` for record 1, \`false\` for record 2 |
| TIMESTAMPTZ / TIMESTAMP | ISO strings: \`"2026-06-19T08:00:00Z"\` |
| JSONB | \`null\` if nullable, otherwise a minimal relevant object |

UUID FK columns (e.g. \`shift_id\`, \`order_id\`) must reference the UUID constant of the corresponding parent record.

---

## Output rules

- First line MUST be: \`/// <mls fileReference="${outputPath}" enhancement="_blank"/>\`
- Import: \`import type { SeedDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';\`
- Export only \`seedDefinitions\`
- UUID seed constants defined at the top, before \`seedDefinitions\`
- No \`USE_MOCK\`, no \`mockStore\`, no repository factory functions
- No inline comments
- 2-space indentation`;
}

function buildHumanPrompt(sections: string[], outputPath: string): string {
  return [
    '## Layer_1 table definition files',
    '',
    ...sections,
    '',
    `Generate the file \`${outputPath}\` and call ${TOOL_NAME} with the complete code.`,
  ].join('\n');
}
