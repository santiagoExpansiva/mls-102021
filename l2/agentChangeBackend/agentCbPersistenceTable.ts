/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbPersistenceTable.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the TableDefinition per core/event table (layer_1_external/adapters/persistence), derived
// from the domain entity + the JSONB plan: indexed columns out, the rest + child collections in
// details JSONB. MDM/horizontal entities produce NO table.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, planTableColumns, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, persistenceTableFileInfo, domainEntityFileInfo, dtsRef,
  layerSkills, readString, lowerFirst, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { persistenceTableResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbPersistenceTable';
const TOOL_NAME = 'submitPersistenceTables';
const REGISTER = '_102021_/l2/agentMaterializeSolution/registerBackEnd.ts?registerLayer1';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the table definitions.', batchSchema(persistenceTableResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate TableDefinition (indexed columns + details JSONB)', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const entityIds = new Set(scan.entities.map(e => e.entityId));
  const byId = new Map(scan.entities.map(e => [e.entityId, e]));
  const tables = scan.aggregates.map(agg => {
    const plan = planTableColumns(byId.get(agg.rootEntity)?.fields || [], entityIds);
    return { tableId: agg.rootEntity, indexed: plan.indexed, detailsFields: plan.details, childCollections: agg.embeddedMembers };
  });
  const human = `## Tables to derive (indexed columns vs details JSONB)\n${JSON.stringify(tables, null, 2)}\n\nReturn one TableDefinition per table: snake_case tableName/columns; only indexed columns are real, the rest live in a details JSONB column (detailsColumn.enabled=true, childCollections listed).`;
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
      const tableId = readString(item.tableId);
      if (!tableId) continue;
      const fi = persistenceTableFileInfo(module, tableId);
      const dependsFiles = [dtsRef(domainEntityFileInfo(module, tableId))];
      const pipeline = [buildPipelineItem(lowerFirst(tableId), 'persistenceTable', fi, dependsFiles, layerSkills('persistenceTable.md'), { afterSaveBackEnd: REGISTER })];
      await saveDefs(fi, `${lowerFirst(tableId)}TableDefinition`, buildArtifact('table', tableId, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} table defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-adapter', 'agentCbRepositoryAdapter', 'Gerar adapters de persistência', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace, status === 'completed' ? 'input_output' : undefined));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_1_external/adapters/persistence). Derive one TableDefinition
per table: snake_case tableName and columns; ONLY indexed fields are real columns (PK, queried FKs,
status, ordering timestamps); everything else + child collections go into a details JSONB column
(detailsColumn.enabled=true). primaryKey + indexes. Call "{{toolName}}"; result.items = array. No prose.
`;
