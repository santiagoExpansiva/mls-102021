/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbRepositoryPort.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the repository PORT interfaces (layer_2_application/ports), one per aggregate. The usecase
// depends on the port (interface), never on the concrete adapter — dependency inversion.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, repositoryPortFileInfo, domainEntityFileInfo, dtsRef,
  layerSkills, readString, lowerFirst, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { repositoryPortResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbRepositoryPort';
const TOOL_NAME = 'submitRepositoryPorts';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the repository port interfaces.', batchSchema(repositoryPortResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate repository port interfaces', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const items = scan.aggregates.map(a => ({ entityId: a.rootEntity, embeddedMembers: a.embeddedMembers }));
  // Append-only event ports: append(record) + read finders (listByOwnerId, listByPeriod). NO update/delete.
  const eventItems = scan.events.filter(ev => ev.persisted).map(ev => ({ entityId: ev.entityId, appendOnlyEvent: true, owner: ev.ownerEntity }));
  const human = `## Aggregates\n${JSON.stringify(items, null, 2)}\n\n## Append-only event ports\n${JSON.stringify(eventItems, null, 2)}\n\nReturn one repository port (I{Entity}Repository) per aggregate AND per event. Aggregate ports use getById/list/save/domain finders. Event ports are append-only: an append(record) method plus read finders (e.g. listByOwnerId, listByPeriod) — never update or delete. Typed in domain terms.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ""), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const module = scan.moduleNames[0] || 'unknown';
    let saved = 0;
    for (const item of asArray((out.result as any).items)) {
      const entityId = readString(item.entityId);
      if (!entityId) continue;
      const fi = repositoryPortFileInfo(module, entityId);
      const dependsFiles = [dtsRef(domainEntityFileInfo(module, entityId))];
      const pipeline = [buildPipelineItem(`${lowerFirst(entityId)}Repository`, 'repositoryPort', fi, dependsFiles, layerSkills('repositoryPort.md'))];
      await saveDefs(fi, `${lowerFirst(entityId)}RepositoryPort`, buildArtifact('repositoryPort', `${entityId}Repository`, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-table', 'agentCbPersistenceTable', 'Gerar tabelas (persistência)', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace, status === 'completed' ? 'input_output' : undefined));
  return intents;
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_2_application/ports). For each aggregate produce the repository
port interface I{Entity}Repository with methods (getById, list(filter), save(aggregate), domain
finders), typed in DOMAIN terms (no SQL, no rows). Call "{{toolName}}"; result.items = array. No prose.
`;
