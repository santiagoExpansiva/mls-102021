/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbUsecase.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the usecases (layer_2_application/usecases), ONE per pending operation/workflow. To keep
// each LLM response small (the per-usecase defs carry explicit functions[] input/output), this agent
// fans out: a DISPATCHER step (deterministic, no LLM) creates one WORKER step per owner — the runtime
// runs them in parallel (configured 5 slots) — plus the controller step that JOINS on all workers
// (dependsOn). Each WORKER does one LLM call and saves one usecase .defs.ts. Same agent, two modes,
// selected by whether the step args carry an ownerId.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, createAgentStepPayload, createAddStepIntent,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, usecaseFileInfo, repositoryPortFileInfo, domainEntityFileInfo,
  dtsRef, layerSkills, readString, readStringArray, lowerFirst, logPrefix,
  type CbScan, type CbOwner,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { usecaseResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbUsecase';
const TOOL_NAME = 'submitUsecase';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the usecase.', usecaseResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate application usecases (one parallel worker per owner; controller joins)', visibility: 'private', beforePromptStep, afterPromptStep };
}

function parseArgs(prompt: string | undefined): { planId?: string; ownerId?: string } {
  try { return JSON.parse(prompt || '{}'); } catch { return {}; }
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// Shared maps derived from the scan (aggregate roots, mdm ids, embedded child -> parent root).
function deriveMaps(scan: CbScan) {
  const roots = new Set(scan.aggregates.map(a => a.rootEntity));
  const mdmIds = new Set(scan.entities.filter(e => e.kind === 'mdm').map(e => e.entityId)); // master data: read by id, no port
  const childToRoot = new Map<string, string>();
  for (const a of scan.aggregates) for (const m of a.embeddedMembers) childToRoot.set(m, a.rootEntity);
  const byId = new Map(scan.entities.map(e => [e.entityId, e]));
  return { roots, mdmIds, childToRoot, byId };
}

// The single-owner item sent to the LLM (explicit ports/mdmRefs + entity fields to shape input/output).
function buildOwnerItem(o: CbOwner, maps: ReturnType<typeof deriveMaps>) {
  const { roots, mdmIds, childToRoot, byId } = maps;
  const fieldsOf = (id: string) => (byId.get(id)?.fields || []).map((f: any) => ({ fieldId: f.fieldId, type: f.type, required: f.required, ...(f.enum ? { enum: f.enum } : {}) }));
  const rawRefs = [...new Set([o.entity, ...o.reads, ...o.writes].filter(Boolean))];           // keep children + mdm for fields
  const portRefs = [...new Set(rawRefs.map(id => childToRoot.get(id) ?? id))];                  // children -> parent root
  return {
    usecaseId: o.id,
    ownerKind: o.kind,
    opKind: o.opKind,
    entity: o.entity,
    parentAggregate: childToRoot.get(o.entity) ?? o.entity,
    reads: o.reads,
    writes: o.writes,
    rulesApplied: o.rulesApplied,
    ports: portRefs.filter(id => roots.has(id) && !mdmIds.has(id)),
    mdmRefs: rawRefs.filter(id => mdmIds.has(id)),
    entityFields: Object.fromEntries(rawRefs.map(id => [id, fieldsOf(id)])),
  };
}

// ── beforePromptStep: dispatch (fan-out) or worker (one usecase) ───────────────

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const args = parseArgs(step.prompt);
  return args.ownerId
    ? worker(agent, context, parentStep, step, hookSequential, args.ownerId)
    : dispatch(agent, context, parentStep, step, hookSequential);
}

// DISPATCHER (deterministic, no LLM): one worker step per owner (parallel) + the controller JOIN.
async function dispatch(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const intents: mls.msg.AgentIntent[] = [];
    const workerPlanIds: string[] = [];
    for (const o of scan.owners) {
      const planId = `cb-uc-${safeId(o.id)}`;
      workerPlanIds.push(planId);
      const wstep = createAgentStepPayload(planId, AGENT_NAME, `Gerar usecase: ${o.id}`, { planId, ownerId: o.id }, [], 'parallel_static', 'waiting_human_input');
      intents.push(createAddStepIntent(context, parentStep, wstep));
    }
    // Controller joins on ALL usecase workers (runs only after every usecase .defs.ts exists).
    const cstep = createAgentStepPayload('cb-gen-http', 'agentCbHttpController', 'Gerar controllers HTTP (BFF)', { planId: 'cb-gen-http' }, workerPlanIds, 'parallel_static', 'waiting_dependency');
    intents.push(createAddStepIntent(context, parentStep, cstep));
    console.log(`${logPrefix(agent)} fan-out ${workerPlanIds.length} usecase worker(s)`);
    intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `fan-out ${workerPlanIds.length} usecase(s)`));
    return intents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${msg}`);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', msg)];
  }
}

// WORKER: build the prompt for ONE owner and ask the model for that single usecase.
async function worker(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, ownerId: string): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const owner = scan.owners.find(o => o.id === ownerId);
  if (!owner) return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', `owner not found: ${ownerId}`)];
  const item = buildOwnerItem(owner, deriveMaps(scan));
  const human = `## Owner -> usecase (entity fields included so you can declare explicit input/output)\n${JSON.stringify(item, null, 2)}\n\nReturn ONE usecase with functions[] — each function has explicit input[] and output[] FIELDS (camelCase, derived from entityFields + opKind). A usecase MAY expose several functions with different IO.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ''), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

// ── afterPromptStep (worker only): save the one usecase .defs.ts ───────────────

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    const result = out.result as any;
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const module = scan.moduleNames[0] || 'unknown';
    const { roots, mdmIds, childToRoot } = deriveMaps(scan);
    const usecaseId = readString(result?.usecaseId) || parseArgs(step.prompt).ownerId || '';
    if (!usecaseId) throw new Error('missing usecaseId');

    // Final ports = model's ports ∪ deterministic ports (owner entity+writes, children -> parent root),
    // with mdm removed (master data is read by id via 102034, not through a port).
    const owner = scan.owners.find(o => o.id === usecaseId);
    const ownerRefs = owner ? [owner.entity, ...owner.reads, ...owner.writes].filter(Boolean) : [];
    const detPorts = [...new Set(ownerRefs.map(id => childToRoot.get(id) ?? id))].filter(id => roots.has(id) && !mdmIds.has(id));
    const ports = [...new Set([...readStringArray(result?.ports), ...detPorts])].filter(id => !mdmIds.has(id));
    result.ports = ports;
    result.mdmRefs = [...new Set(ownerRefs.filter(id => mdmIds.has(id)))];

    const fi = usecaseFileInfo(module, usecaseId);
    const dependsFiles = [
      ...ports.map(p => dtsRef(repositoryPortFileInfo(module, p))),
      ...ports.map(p => dtsRef(domainEntityFileInfo(module, p))),
    ];
    const pipeline = [buildPipelineItem(lowerFirst(usecaseId), 'applicationUsecase', fi, dependsFiles, layerSkills('applicationUsecase.md'), { rulesApplied: readStringArray(result?.rulesApplied) })];
    await saveDefs(fi, `${lowerFirst(usecaseId)}Usecase`, buildArtifact('usecase', usecaseId, module, AGENT_NAME, result), pipeline);
    console.log(`${logPrefix(agent)} saved usecase ${usecaseId} (ports=${ports.join(',') || '-'} mdmRefs=${(result.mdmRefs as string[]).join(',') || '-'})`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  // No enqueueNext here: the controller step was already queued by the dispatcher with a join dependsOn.
  return [createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace)];
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_2_application/usecases). Generate ONE usecase for the given owner:
it decides WHAT happens — validations, state transitions, orchestration — using the domain + repository
PORTS only (import the port interface, NEVER the concrete adapter; NEVER ctx.data, except a single
transaction wrapper). Apply rulesApplied.

ports must NOT be empty: use exactly the provided "ports" (already the parent aggregate roots). When the
owner's "entity" is a child embedded in a parent aggregate (its parent is "parentAggregate", different
from "entity"), the operation works through the PARENT port — load the parent, mutate the embedded child
in its collection, save the parent. NEVER invent a child repository. "steps" are guidance, not a
contract: the contract is input/output/ports.

Entities in "mdmRefs" are master data in the shared 102034 store: there is NO port for them — reference
them BY ID (the id is an input field) and read by id via ctx.data.mdmDocument.get({ mdmId }). Never put
an mdmRef in ports and never resolveRepository it.

Return functions[] (usually ONE, named from the operationId; MAY be several with different IO). Each
function declares EXPLICIT fields:
- input[]: { name, type, required, ofEntity? } — the fields the command receives (camelCase). For a
  "create" derive from the entity's writable fields (minus server-generated ids/timestamps); for
  "query"/"view" the filter fields; for "update" id + changed fields.
- output[]: { name, type, ofEntity? } — what the function returns (camelCase). For mutations usually
  the affected aggregate id(s) + status; for queries the projected entity fields.
- inputTypeName/outputTypeName (PascalCase), ports[], rulesApplied[], transactional, steps[].
Top-level: usecaseId, ports (union), rulesApplied. Types: uuid|string|text->string, money|number->
number, boolean, date|datetime->string, {Entity} ref->string. Call "{{toolName}}" with the single
usecase (status/result). No prose.
`;
