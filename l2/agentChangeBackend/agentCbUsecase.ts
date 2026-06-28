/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbUsecase.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the usecases (layer_2_application/usecases), one per pending operation/workflow. The
// usecase orchestrates domain + repository PORTS (never the concrete adapter, never ctx.data),
// applying rulesApplied and wrapping multi-aggregate writes in one transaction.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, usecaseFileInfo, repositoryPortFileInfo, domainEntityFileInfo,
  dtsRef, layerSkills, readString, readStringArray, lowerFirst, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { usecaseResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbUsecase';
const TOOL_NAME = 'submitUsecases';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the usecases.', batchSchema(usecaseResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate application usecases (orchestrate domain + ports)', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const roots = new Set(scan.aggregates.map(a => a.rootEntity));
  // Embedded child -> its parent aggregate root. An operation on a child entity (e.g. OrderItem inside
  // Order) uses the PARENT's repository port; there is no child port.
  const childToRoot = new Map<string, string>();
  for (const a of scan.aggregates) for (const m of a.embeddedMembers) childToRoot.set(m, a.rootEntity);
  const byId = new Map(scan.entities.map(e => [e.entityId, e]));
  const fieldsOf = (id: string) => (byId.get(id)?.fields || []).map((f: any) => ({ fieldId: f.fieldId, type: f.type, required: f.required, ...(f.enum ? { enum: f.enum } : {}) }));
  const items = scan.owners.map(o => {
    const rawRefs = [...new Set([o.entity, ...o.reads, ...o.writes].filter(Boolean))];   // for input/output FIELDS (keep children)
    const portRefs = [...new Set(rawRefs.map(id => childToRoot.get(id) ?? id))];          // for ports (children -> parent root)
    return {
      usecaseId: o.id,
      ownerKind: o.kind,
      opKind: o.opKind,            // create|update|query|view|... (helps shape input/output)
      entity: o.entity,            // may be a child entity (its fields are in entityFields)
      parentAggregate: childToRoot.get(o.entity) ?? o.entity,
      reads: o.reads,
      writes: o.writes,
      rulesApplied: o.rulesApplied,
      ports: portRefs.filter(id => roots.has(id)),
      entityFields: Object.fromEntries(rawRefs.map(id => [id, fieldsOf(id)])), // source for input/output fields (incl. child)
    };
  });
  const human = `## Owners -> usecases (entity fields included so you can declare explicit input/output)\n${JSON.stringify(items, null, 2)}\n\nReturn one usecase per owner with functions[] — each function has explicit input[] and output[] FIELDS (camelCase, derived from entityFields + opKind). A usecase may expose SEVERAL functions with different input/output.`;
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
    const roots = new Set(scan.aggregates.map(a => a.rootEntity));
    const childToRoot = new Map<string, string>();
    for (const a of scan.aggregates) for (const m of a.embeddedMembers) childToRoot.set(m, a.rootEntity);
    const ownerById = new Map(scan.owners.map(o => [o.id, o]));
    let saved = 0;
    for (const item of asArray((out.result as any).items)) {
      const usecaseId = readString(item.usecaseId);
      if (!usecaseId) continue;
      // Final ports = union of the model's ports with the deterministic ones (operation entity+writes,
      // children resolved to their parent root). Guarantees non-empty, correct ports in the saved defs.
      const owner = ownerById.get(usecaseId);
      const detPorts = owner
        ? [...new Set([owner.entity, ...owner.reads, ...owner.writes].filter(Boolean).map(id => childToRoot.get(id) ?? id))].filter(id => roots.has(id))
        : [];
      const ports = [...new Set([...readStringArray(item.ports), ...detPorts])];
      (item as any).ports = ports;
      const fi = usecaseFileInfo(module, usecaseId);
      const dependsFiles = [
        ...ports.map(p => dtsRef(repositoryPortFileInfo(module, p))),
        ...ports.map(p => dtsRef(domainEntityFileInfo(module, p))),
      ];
      const pipeline = [buildPipelineItem(lowerFirst(usecaseId), 'applicationUsecase', fi, dependsFiles, layerSkills('applicationUsecase.md'), { rulesApplied: readStringArray(item.rulesApplied) })];
      await saveDefs(fi, `${lowerFirst(usecaseId)}Usecase`, buildArtifact('usecase', usecaseId, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} usecase defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-http', 'agentCbHttpController', 'Gerar controllers HTTP (BFF)', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_2_application/usecases). One usecase per owner: it decides WHAT
happens — validations, state transitions, orchestration — using the domain + repository PORTS only
(import the port interface, NEVER the concrete adapter; NEVER ctx.data, except a single transaction
wrapper). Apply rulesApplied.

ports must NOT be empty: use exactly the provided "ports" (already the parent aggregate roots). When the
owner's "entity" is a child embedded in a parent aggregate (its parent is "parentAggregate", different
from "entity"), the operation works through the PARENT port — load the parent, mutate the embedded child
in its collection, save the parent. NEVER invent a child repository. "steps" are guidance, not a
contract: the contract is input/output/ports.

For each usecase return functions[] (usually ONE, named from the operationId; MAY be several with
different IO). Each function declares EXPLICIT fields:
- input[]: { name, type, required, ofEntity? } — the fields the command receives (camelCase). For a
  "create" derive from the entity's writable fields (minus server-generated ids/timestamps); for
  "query"/"view" the filter fields; for "update" id + changed fields.
- output[]: { name, type, ofEntity? } — what the function returns (camelCase). For mutations usually
  the affected aggregate id(s) + status; for queries the projected entity fields.
- inputTypeName/outputTypeName (PascalCase), ports[], rulesApplied[], transactional, steps[].
Top-level: usecaseId, ports (union), rulesApplied. Types: uuid|string|text->string, money|number->
number, boolean, date|datetime->string, {Entity} ref->string. Call "{{toolName}}"; result.items =
array. No prose.
`;
