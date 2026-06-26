/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbAggregateIndex.ts" enhancement="_102027_/l2/enhancementAgent"/>

// LLM planning: derive aggregate boundaries from ontology kind + relationships (core -> table/root;
// supporting under a core -> embedded in details JSONB; event -> own table; mdm -> no table, read via
// 102034). A deterministic baseline is provided as context; the model refines it.


import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace, asArray, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { aggregateIndexResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbAggregateIndex';
const TOOL_NAME = 'submitAggregateIndex';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the aggregate index for the module.', aggregateIndexResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Derive aggregate boundaries from kind + relationships', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const reduced = {
    entities: scan.entities.map(e => ({ entityId: e.entityId, kind: e.kind, ownership: e.ownership })),
    relationships: scan.relationships,
    baselineAggregates: scan.aggregates,
  };
  const human = `## Module(s): ${scan.moduleNames.join(', ')}\n\n## Ontology + relationships (data only)\n${JSON.stringify(reduced, null, 2)}\n\nReturn the refined aggregate index.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ""), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    const aggregates = asArray((out.result as any).aggregates);
    console.log(`${logPrefix(agent)} aggregates=${aggregates.length}`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-persistence-index', 'agentCbPersistenceIndex', 'Planejar persistência (JSONB)', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} for the collab.codes agentChangeBackend flow (Stage 3, hexagonal backend).
Group the ontology entities into AGGREGATES using kind + relationships:
- kind "core" -> aggregate root (own table).
- kind "supporting" in a oneToMany/oneToOne under a core, not queried on its own -> embeddedMembers of that root (folded into its details JSONB, no own table).
- kind "event" -> events[] (own append-only table).
- kind "mdm" -> mdmRefs[] (NO local table; read via 102034).
Use canonical entityIds only. Call "{{toolName}}" with status/result/questions/trace. No prose.
`;
