/// <mls fileReference="_102021_/l2/agentMaterializeSolution/agentMaterializeL1Def.ts" enhancement="_102027_/l2/enhancementAgent"/>

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  toMlsPath,
  getFileContent,
  appendPipelineToFile,
  listDepLayerPaths,
  extractToolCallArgs,
  extractJsonArrayField,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';
import type { PipelineItem, L1LayerFolder } from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';

declare const mls: any;

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentMaterializeL1Def',
    agentProject: 102021,
    agentFolder: 'agentMaterializeSolution',
    agentDescription: 'Add export const pipeline to an existing L1 .defs.ts file',
    visibility: 'private',
    beforePromptStep,
    afterPromptStep,
  };
}

const TOOL_NAME = 'submitL1Pipeline';

interface StepArgs {
  planId: string;
  moduleName: string;
  shortName: string;
  layerFolder: string;
}

// dependsOn is always [] — first version
interface ToolOutput {
  outputPath: string;
  dependsFiles: string[];
}

const toolSchema = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Submit the pipeline item for this L1 .defs.ts file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['outputPath', 'dependsFiles'],
      properties: {
        outputPath: {
          type: 'string',
          description: 'MLS path of the .ts file to be generated, e.g. _102043_/l1/cafeFlow/layer_4_entities/PedidoEntity.ts',
        },
        dependsFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'MLS .d.ts paths the executor needs as context (e.g. _102043_/l1/cafeFlow/layer_4_entities/pedidoEntity.d.ts). Use .d.ts extension only — outputPath stays .ts',
        },
      },
    },
  },
} as const;

// ─── beforePromptStep ─────────────────────────────────────────────────────────

async function beforePromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
  args?: string,
): Promise<mls.msg.AgentIntent[]> {
  if (!args) throw new Error('[agentMaterializeL1Def] missing args');

  const { moduleName, shortName, layerFolder }: StepArgs = JSON.parse(args);
  const project = mls.actualProject || 0;
  const folder = `${moduleName}/${layerFolder}`;

  const content = await getFileContent(project, 1, folder, shortName, '.defs.ts');
  if (!content) throw new Error(`[agentMaterializeL1Def] file not found: ${folder}/${shortName}.defs.ts`);

  // Already processed — skip
  if (content.includes('export const pipeline')) {
    return [mkDone(context, parentStep, step, hookSequential, 'completed', 'already present')];
  }

  // layer_1_external has no deps — deterministic, no LLM needed
  if (layerFolder === 'layer_1_external') {
    const item = buildItem(shortName, layerFolder, toMlsPath(project, 1, folder, shortName, '.ts'), project, 1, folder, [], []);
    const ok = await appendPipelineToFile(project, 1, folder, shortName, [item]);
    return [mkDone(context, parentStep, step, hookSequential, ok ? 'completed' : 'failed', ok ? undefined : 'append failed')];
  }

  // layer_2_controllers — deterministic: usecaseRefs → dependsFiles, rulesApplied → property
  if (layerFolder === 'layer_2_controllers') {
    const refs  = extractJsonArrayField(content, 'usecaseRefs');
    const rules = extractJsonArrayField(content, 'rulesApplied');
    const usecaseDeps = refs.map(ref => toMlsPath(project, 1, `${moduleName}/layer_3_usecases`, ref, '.d.ts'));
    const contractPath = toMlsPath(project, 2, `${moduleName}/web/contracts`, shortName, '.ts');
    const outputPath = lowerFirstFilename(toMlsPath(project, 1, folder, shortName, '.ts'));
    const item = buildItem(shortName, layerFolder, outputPath, project, 1, folder, [...usecaseDeps, contractPath], [], rules);
    const ok = await appendPipelineToFile(project, 1, folder, shortName, [item]);
    return [mkDone(context, parentStep, step, hookSequential, ok ? 'completed' : 'failed', ok ? undefined : 'append failed')];
  }

  // layer_4_entities → needs layer_1_external .ts files
  // layer_3_usecases → needs layer_4_entities .ts files
  // layer_2_controllers (if ever here) → needs layer_3_usecases .ts files
  const depDefsPaths = listDepLayerPaths(project, moduleName, layerFolder as L1LayerFolder);
  const depTsPaths = depDefsPaths.map(defsToTs);

  const intent: mls.msg.AgentIntentPromptReady = {
    type: 'prompt_ready',
    args,
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    hookSequential,
    parentStepId: parentStep.stepId,
    systemPrompt: buildSystemPrompt(layerFolder, depTsPaths),
    humanPrompt: buildHumanPrompt(toMlsPath(project, 1, folder, shortName, '.defs.ts'), layerFolder, content, depTsPaths),
    tools: [toolSchema as unknown as mls.msg.LLMTool],
    toolChoice: { type: 'function', function: { name: TOOL_NAME } },
  };

  return [intent];
}

// ─── afterPromptStep ──────────────────────────────────────────────────────────

async function afterPromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
): Promise<mls.msg.AgentIntent[]> {
  const { moduleName, shortName, layerFolder }: StepArgs = JSON.parse(step.prompt || '{}');
  const project = mls.actualProject || 0;
  const folder = `${moduleName}/${layerFolder}`;

  const raw = step.interaction?.payload?.[0] as any;
  const out = extractToolCallArgs<ToolOutput>(raw, TOOL_NAME);

  if (!out?.outputPath) {
    return [mkDone(context, parentStep, step, hookSequential, 'failed', 'missing tool output')];
  }

  const defsContent = await getFileContent(project, 1, folder, shortName, '.defs.ts');
  const rules = defsContent ? extractJsonArrayField(defsContent, 'rulesApplied') : [];
  const item = buildItem(shortName, layerFolder, lowerFirstFilename(out.outputPath), project, 1, folder, out.dependsFiles || [], [], rules);
  const ok = await appendPipelineToFile(project, 1, folder, shortName, [item]);

  return [mkDone(context, parentStep, step, hookSequential, ok ? 'completed' : 'failed', ok ? undefined : 'append failed', ok ? 'input_output' : undefined)];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildItem(
  shortName: string,
  layerFolder: string,
  outputPath: string,
  project: number,
  level: number,
  folder: string,
  dependsFiles: string[],
  dependsOn: string[],
  rulesApplied?: string[],
): PipelineItem {
  return {
    id: `${shortName}__${layerFolder}`,
    type: layerFolder,
    outputPath,
    defPath: toMlsPath(project, level, folder, shortName, '.defs.ts'),
    dependsFiles,
    dependsOn,
    ...(rulesApplied && rulesApplied.length > 0 ? { rulesApplied } : {}),
    agent: 'agentMaterializeGen',
  };
}

function mkDone(
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
    parentStepId: parentStep.stepId,
    stepId: step.stepId,
    status,
    traceMsg,
    cleaner,
  };
}

/** _102043_/l1/cafeFlow/layer_4_entities/pedidoEntity.defs.ts → .d.ts */
function defsToTs(mlsPath: string): string {
  return mlsPath.replace(/\.defs\.ts$/, '.d.ts');
}

/** Ensures the filename segment of an MLS path starts with a lowercase letter. */
function lowerFirstFilename(mlsPath: string): string {
  const slash = mlsPath.lastIndexOf('/');
  if (slash < 0) return mlsPath;
  const dir = mlsPath.slice(0, slash + 1);
  const file = mlsPath.slice(slash + 1);
  return dir + file.charAt(0).toLowerCase() + file.slice(1);
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(layerFolder: string, depTsPaths: string[]): string {
  const depLabel: Record<string, string> = {
    layer_4_entities:    'layer_1_external (physical table .ts files)',
    layer_3_usecases:    'layer_4_entities (entity .ts files)',
    layer_2_controllers: 'layer_3_usecases (usecase .ts files)',
  };
  return `<!-- modelType: codeinstruct -->

You analyze a ${layerFolder} .defs.ts planning artifact and determine its pipeline item.

Path format: _<project>_/l<level>/<folder>/<FileName><ext>

You must provide:
- outputPath: the .ts file to be generated (derive from materialization/className metadata in the content)
- dependsFiles: definition paths from ${depLabel[layerFolder] || 'dependency layer'} that the executor needs as context
  - Only include files this artifact actually references or uses
  - Use .d.ts extension for dependsFiles (e.g. _102043_/l1/cafeFlow/layer_4_entities/pedidoEntity.d.ts)
  - outputPath remains .ts — only dependsFiles use .d.ts

Available dependency .d.ts files:
${depTsPaths.length ? depTsPaths.map(p => `  ${p}`).join('\n') : '  (none)'}

dependsOn is always [].

Call ${TOOL_NAME} with the result.`;
}

function buildHumanPrompt(
  defPath: string,
  layerFolder: string,
  content: string,
  depTsPaths: string[],
): string {
  return [
    `## File to process`,
    `Path: ${defPath}`,
    `Layer: ${layerFolder}`,
    ``,
    `## Content`,
    '```typescript',
    content,
    '```',
    ``,
    `## Available dependency .ts files`,
    depTsPaths.length ? depTsPaths.join('\n') : '(none)',
    ``,
    `Determine outputPath (from materialization metadata in the file) and which dependsFiles this artifact needs.`,
  ].join('\n');
}
