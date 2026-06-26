/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbDomainEntity.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the PURE domain entities (layer_3_domain/entities) + embedded value-objects, one per
// aggregate root, from the ontology fields. Writes pipeline-complete .defs.ts (self-sufficient for
// agentMaterializeGen). v1 processes the whole layer in one LLM call (array result).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, domainEntityFileInfo, layerSkills, readString, lowerFirst, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { domainEntityResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbDomainEntity';
const TOOL_NAME = 'submitDomainEntities';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the pure domain entities (one per aggregate root).', batchSchema(domainEntityResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate pure domain entities + value-objects', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const byId = new Map(scan.entities.map(e => [e.entityId, e]));
  const items = scan.aggregates.map(agg => ({
    aggregateId: agg.aggregateId,
    root: { entityId: agg.rootEntity, fields: byId.get(agg.rootEntity)?.fields || [] },
    embeddedMembers: agg.embeddedMembers.map(id => ({ entityId: id, fields: byId.get(id)?.fields || [] })),
  }));
  const human = `## Aggregates (root + embedded members, with ontology fields)\n${JSON.stringify(items, null, 2)}\n\nReturn one pure domain entity per aggregate root; embedded members become valueObjects (collection=true for oneToMany).`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, planIdOf(step), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
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
      const fi = domainEntityFileInfo(module, entityId);
      const pipeline = [buildPipelineItem(lowerFirst(entityId), 'domainEntity', fi, [], layerSkills('layer_4.md'))];
      await saveDefs(fi, `${lowerFirst(entityId)}DomainEntity`, buildArtifact('domainEntity', entityId, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} domain entity defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-port', 'agentCbRepositoryPort', 'Gerar ports de repositório', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_3_domain). For each aggregate root produce a PURE domain
entity: entityId (PascalCase, from the ontology id — NEVER the PT title), title, fields (camelCase,
from the ontology), statusEnum, invariants (business rules the entity must hold), and valueObjects
for embedded supporting members (collection=true for oneToMany). No persistence, no ctx.data, no SQL.
Call "{{toolName}}" with status/result/questions/trace and result.items = the array. No prose.
`;
