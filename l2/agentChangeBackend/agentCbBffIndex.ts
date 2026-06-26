/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbBffIndex.ts" enhancement="_102027_/l2/enhancementAgent"/>

// LLM planning (conditional): when page bffCommands + contracts exist (produced by agentChangeFrontend),
// map them to one http controller per page (+ route keys). If no contract exists yet, skip the LLM and
// continue to domain generation — backend usecases/persistence do not depend on the frontend.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace, parseDefsSource, isRecord, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { bffIndexResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbBffIndex';
const TOOL_NAME = 'submitBffIndex';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the BFF (controller) index.', bffIndexResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Map page bffCommands to http controllers (when contracts exist)', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function readContracts(): Promise<{ pageId: string; commands: string[] }[]> {
  const project = mls.actualProject || 0;
  const pages: { pageId: string; commands: string[] }[] = [];
  for (const file of Object.values(mls.stor.files) as any[]) {
    if (!file || file.project !== project || file.level !== 2 || file.status === 'deleted') continue;
    if (file.extension !== '.defs.ts' || !String(file.folder || '').endsWith('/web/contracts')) continue;
    const parsed = parseDefsSource(String(await file.getContent()));
    const commands = Array.isArray(parsed) ? parsed.filter(isRecord).map((c: any) => String(c.commandName || '')).filter(Boolean) : [];
    pages.push({ pageId: String(file.shortName || ''), commands });
  }
  return pages;
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const pages = await readContracts();
  if (pages.length === 0) {
    console.log(`${logPrefix(agent)} no page contract yet — skipping BFF, going to domain generation`);
    return [
      enqueueNext(context, parentStep, step, 'cb-gen-domain', 'agentCbDomainEntity', 'Gerar entidades de domínio', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'No page contract; BFF skipped.'),
    ];
  }
  const human = `## Page contracts (bffCommands)\n${JSON.stringify(pages, null, 2)}\n\nMap each page to one controller (one handler per command) + route keys {module}.{page}.{command}.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, '', systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-domain', 'agentCbDomainEntity', 'Gerar entidades de domínio', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME}. For each page, define one controller (one handler per bffCommand) and route
keys {module}.{page}.{command}. Each handler returns EXACTLY the page contract Output. Call
"{{toolName}}". No prose.
`;
