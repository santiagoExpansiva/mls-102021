/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbPersistenceIndex.ts" enhancement="_102027_/l2/enhancementAgent"/>

// LLM planning: per aggregate/event table, apply the JSONB model — pick the few indexed columns (PK,
// queried FKs, status/lifecycle, ordering/filter timestamps); push everything else + child
// collections into details JSONB. MDM produces NO table. A deterministic baseline is provided.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, planTableColumns, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace, asArray, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { persistenceIndexResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbPersistenceIndex';
const TOOL_NAME = 'submitPersistenceIndex';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the persistence (JSONB) index.', persistenceIndexResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Plan indexed columns vs details JSONB per table', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const entityIds = new Set(scan.entities.map(e => e.entityId));
  const byId = new Map(scan.entities.map(e => [e.entityId, e]));
  const baseline = scan.aggregates.map(agg => {
    const root = byId.get(agg.rootEntity);
    const plan = planTableColumns(root?.fields || [], entityIds);
    return { tableId: agg.rootEntity, rootEntity: agg.rootEntity, ownership: root?.ownership || 'moduleOwned', indexedColumns: plan.indexed, detailsFields: plan.details, childCollections: agg.embeddedMembers };
  });
  const events = scan.events.filter(ev => ev.persisted).map(ev => ({ tableId: ev.entityId, rootEntity: ev.entityId, owner: ev.ownerEntity, ownership: byId.get(ev.entityId)?.ownership || 'moduleOwned', appendOnly: true, purpose: ev.purpose, retentionDays: ev.retentionDays, fields: (ev.fields || []).map((f: any) => f.fieldId) }));
  const human = `## Aggregates baseline (indexed columns vs details JSONB)\n${JSON.stringify(baseline, null, 2)}\n\n## Event tables (append-only; telemetry/audit, with retention)\n${JSON.stringify(events, null, 2)}\n\nRefine indexed columns; everything not indexed goes to details. Event tables index the owner FK + ordering timestamp. MDM entities and reaction events produce NO table.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ""), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
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
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-usecase-index', 'agentCbUsecaseIndex', 'Planejar usecases', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace, status === 'completed' ? 'input_output' : undefined));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal backend, JSONB-first persistence).
For each aggregate/event table choose REAL columns ONLY for fields that need an index: PK, queried
FKs, status/lifecycle, ordering/filter timestamps. Everything else + supporting child collections go
into a single details JSONB column. MDM entities produce NO table. Use snake_case-able fieldIds as
given (camelCase ok here; the table generator maps to snake_case). Call "{{toolName}}". No prose.
`;
