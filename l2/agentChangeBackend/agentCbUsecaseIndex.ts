/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbUsecaseIndex.ts" enhancement="_102027_/l2/enhancementAgent"/>

// LLM planning: map each pending operation/workflow to a usecase + the repository ports it needs
// (reads/writes -> aggregates). One usecase per owner.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace, asArray, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { usecaseIndexResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbUsecaseIndex';
const TOOL_NAME = 'submitUsecaseIndex';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the usecase index.', usecaseIndexResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Map operations/workflows to usecases + ports', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  // Only operations become usecases/commands; workflows are orchestration, not backend owners.
  const owners = scan.owners.filter(o => o.kind === 'operation').map(o => ({ ownerId: o.id, kind: o.kind, entity: o.entity, reads: o.reads, writes: o.writes, rulesApplied: o.rulesApplied }));
  const aggregates = scan.aggregates.map(a => ({ aggregateId: a.aggregateId, rootEntity: a.rootEntity }));
  const human = `## Pending owners (statusBackend != done)\n${JSON.stringify(owners, null, 2)}\n\n## Aggregates (port targets)\n${JSON.stringify(aggregates, null, 2)}\n\nOne usecase per owner; ports = the aggregates it reads/writes.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ""), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    console.log(`${logPrefix(agent)} usecases=${asArray((out.result as any).usecases).length}`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-bff-index', 'agentCbBffIndex', 'Planejar BFF (controllers)', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace, status === 'completed' ? 'input_output' : undefined));
  return intents;
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME}. Map each pending operation/workflow to exactly one usecase: usecaseId
(camelCase, from the operationId), ownerId, ports (the aggregate ids it reads/writes via repository
ports), rulesApplied. Call "{{toolName}}". No prose.
`;
