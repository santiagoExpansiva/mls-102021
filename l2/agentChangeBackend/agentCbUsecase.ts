/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbUsecase.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the usecases (layer_2_application/usecases), ONE per pending operation/workflow. To keep
// each LLM response small (the per-usecase defs carry explicit functions[] input/output), this agent
// fans out via the runtime's parallel_dynamic/progress: a DISPATCHER step (deterministic, no LLM)
// emits ONE parallel step whose args queue = the owner ids (createParallelStepIntent, maxParallel 5).
// The runtime runs the workers in a pool of 5 slots and DISCARDS each child's payload as it finishes
// (the task stays small), instead of keeping N persistent steps. Each WORKER (same agent, reached with
// its ownerId in hook.args) does one LLM call and saves one usecase .defs.ts. The controller step JOINS
// on the single parallel parent (dependsOn its planId).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, createAgentStepPayload,
  createAddStepIntent, createParallelStepIntent,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, usecaseFileInfo, repositoryPortFileInfo, domainEntityFileInfo,
  dtsRef, layerSkills, readString, readStringArray, lowerFirst, logPrefix,
  type CbScan, type CbOwner,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { usecaseResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbUsecase';
const TOOL_NAME = 'submitUsecase';
const FANOUT_PLAN_ID = 'cb-usecase-fanout';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the usecase.', usecaseResultSchema);

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate application usecases (parallel_dynamic worker per owner; controller joins)', visibility: 'private', beforePromptStep, afterPromptStep };
}

// The owner id of a WORKER invocation arrives in hook.args (a bare id); the DISPATCHER step carries a
// JSON prompt ({planId:...}) and no bare id. Resolve from args first, then step.prompt as a fallback.
function workerOwnerId(args: string | undefined, step: mls.msg.AIAgentStep): string {
  const a = (args ?? '').trim();
  if (a && !a.startsWith('{')) return a;
  const p = String((step as { prompt?: string })?.prompt ?? '').trim();
  return p && !p.startsWith('{') ? p : '';
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

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, args?: string): Promise<mls.msg.AgentIntent[]> {
  const ownerId = workerOwnerId(args, step);
  return ownerId
    ? worker(agent, context, parentStep, step, hookSequential, ownerId)
    : dispatch(agent, context, parentStep, step, hookSequential);
}

// DISPATCHER (deterministic, no LLM): ONE parallel_dynamic step whose args queue is the owner ids
// (runtime pool of 5, payloads discarded as each finishes) + the controller JOIN on that parent.
async function dispatch(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const ownerIds = scan.owners.map(o => o.id).filter(Boolean);
    if (!ownerIds.length) {
      return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'no owners to generate')];
    }
    const intents: mls.msg.AgentIntent[] = [
      createParallelStepIntent(context, parentStep, FANOUT_PLAN_ID, AGENT_NAME, 'Gerar usecases (paralelo)', ownerIds, [], 5),
    ];
    // Controller joins on the single parallel parent (runs after every worker finished).
    const cstep = createAgentStepPayload('cb-gen-http', 'agentCbHttpController', 'Gerar controllers HTTP (BFF)', { planId: 'cb-gen-http' }, [FANOUT_PLAN_ID], 'sequential', 'waiting_dependency');
    intents.push(createAddStepIntent(context, parentStep, cstep));
    console.log(`${logPrefix(agent)} parallel fan-out: ${ownerIds.length} usecase(s)`);
    intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `fan-out ${ownerIds.length} usecase(s) (parallel_dynamic)`));
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
  // prompt_ready args MUST equal the parallel child's queued hook args (the ownerId) so the runtime
  // (continueBeforePrompt → findBeforePromptStep by parentStepId+args) matches it. step.prompt is not
  // yet set to the arg on the first beforePromptStep of a parallel child.
  return [createPromptReadyIntent(context, parentStep, hookSequential, ownerId, systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

// ── afterPromptStep (worker only): save the one usecase .defs.ts ───────────────

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, args?: string): Promise<mls.msg.AgentIntent[]> {
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
    const usecaseId = readString(result?.usecaseId) || workerOwnerId(args, step);
    if (!usecaseId) throw new Error('missing usecaseId');

    // Final ports = model's ports ∪ deterministic ports (owner entity+writes, children -> parent root),
    // with mdm removed (master data is read by id via 102034, not through a port).
    const owner = scan.owners.find(o => o.id === usecaseId);
    const ownerRefs = owner ? [owner.entity, ...owner.reads, ...owner.writes].filter(Boolean) : [];
    const detPorts = [...new Set(ownerRefs.map(id => childToRoot.get(id) ?? id))].filter(id => roots.has(id) && !mdmIds.has(id));
    // Trust only REAL aggregate roots: the model sometimes invents port names ("dailyShiftPort",
    // "recipePort", "productionTicket"). Keep model ports only if they are real roots, union with the
    // deterministic ones (derived from the owner's entities, children resolved to their parent).
    const ports = [...new Set([...readStringArray(result?.ports), ...detPorts])].filter(id => roots.has(id) && !mdmIds.has(id));
    result.ports = ports;
    result.mdmRefs = [...new Set(ownerRefs.filter(id => mdmIds.has(id)))];
    for (const fn of Array.isArray(result?.functions) ? result.functions : []) {
      fn.ports = readStringArray(fn?.ports).filter((id: string) => ports.includes(id)); // drop invented ports
    }

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
