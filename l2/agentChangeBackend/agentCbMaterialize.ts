/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbMaterialize.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Materialize the generated .defs.ts -> .ts INSIDE the flow (after cb-gen-http), sharing the SAME pure
// core (cbMaterializeCore.ts) used by the Node CLI (l1/cbMaterializeCli/nodejsMaterializeL1.ts) — only
// the transport (prompt_ready vs HTTP) and storage (saveGeneratedTs vs fs) differ. Runs PARALLEL PER LAYER:
// the DISPATCHER groups the stale items by core.layerRank and emits ONE parallel_dynamic step per layer
// (domain -> port/table -> adapter/usecase -> controller), each depending on the previous layer's
// planId so an outer layer never materializes before the inner .ts it imports exists; cb-register joins
// on the last layer. Each WORKER (same agent, reached with its defRef in hook.args) does one LLM call
// and saves one .ts. The CLI remains usable offline; this is the in-studio equivalent.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  scanL1DefsWithPipeline, getContentByMlsPath, getFileModified, saveGeneratedTs, parseMlsPath,
  extractToolCallArgs,
} from '/_102021_/l2/agentChangeBackend/cbMaterializeIo.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, createAgentStepPayload,
  createAddStepIntent, createParallelStepIntent, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import {
  parseDefs, layerRank, isStale, buildSystemPrompt, buildHumanPrompt, applyHeader,
  expandContextRef, GEN_TOOL, GEN_TOOL_NAME, DEFAULT_MODEL_TYPE, type PipelineItem,
} from '/_102021_/l2/agentChangeBackend/cbMaterializeCore.js';

const AGENT_NAME = 'agentCbMaterialize';

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Materialize .defs.ts -> .ts (parallel per layer; shares the CLI core)', visibility: 'private', beforePromptStep, afterPromptStep };
}

// A WORKER invocation carries its defRef in hook.args (or step.prompt on later hooks) — a bare mls path,
// never starting with '{'. The DISPATCHER step carries a JSON prompt ({planId:...}). Resolve args first.
function workerDefRef(args: string | undefined, step: mls.msg.AIAgentStep): string {
  const a = (args ?? '').trim();
  if (a && !a.startsWith('{')) return a;
  const p = String((step as { prompt?: string })?.prompt ?? '').trim();
  return p && !p.startsWith('{') ? p : '';
}

interface DefsEntry { defRef: string; item: PipelineItem; }

// Scan every l1 .defs.ts of the (single) module and pair it with its pipeline item + defs mls path.
async function scanEntries(): Promise<DefsEntry[]> {
  const project = mls.actualProject || 0;
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const moduleName = scan.moduleNames[0] || 'unknown';
  const files = await scanL1DefsWithPipeline(project, moduleName);
  const entries: DefsEntry[] = [];
  for (const f of files) {
    const item = f.pipeline[0];
    if (item && item.outputPath) entries.push({ defRef: `_${project}_/l1/${f.folder}/${f.shortName}.defs.ts`, item });
  }
  return entries;
}

// Output is stale when missing or when the .defs.ts is newer than the generated .ts (same rule as the CLI).
function entryIsStale(project: number, defRef: string, outputPath: string): boolean {
  const d = parseMlsPath(defRef);
  const o = parseMlsPath(outputPath);
  const defsMs = d ? getFileModified(d.project, d.level, d.folder, d.shortName, '.defs.ts') : null;
  const tsMs = o ? getFileModified(o.project, o.level, o.folder, o.shortName, '.ts') : null;
  return isStale(defsMs, tsMs);
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, args?: string): Promise<mls.msg.AgentIntent[]> {
  const defRef = workerDefRef(args, step);
  return defRef
    ? worker(agent, context, parentStep, step, hookSequential, defRef)
    : dispatch(agent, context, parentStep, step, hookSequential);
}

// DISPATCHER (deterministic, no LLM): one parallel_dynamic step per layer, chained by dependsOn so the
// runtime materializes inner layers before outer ones; cb-register joins the last layer.
async function dispatch(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const project = mls.actualProject || 0;
    const entries = await scanEntries();
    const stale = entries.filter(e => entryIsStale(project, e.defRef, e.item.outputPath));
    if (!stale.length) {
      return [
        createAddStepIntent(context, parentStep, createAgentStepPayload('cb-register', 'agentCbRegister', 'Registrar backend', { planId: 'cb-register' }, [], 'sequential', 'waiting_dependency')),
        createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'nothing stale to materialize'),
      ];
    }
    // Group by layer rank and process layers in ascending order (inner-first).
    const byRank = new Map<number, DefsEntry[]>();
    for (const e of stale) {
      const r = layerRank(e.item.type);
      let bucket = byRank.get(r);
      if (!bucket) { bucket = []; byRank.set(r, bucket); }
      bucket.push(e);
    }
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const intents: mls.msg.AgentIntent[] = [];
    let prevPlan = '';
    for (const rank of ranks) {
      const planId = `cb-mat-L${rank}`;
      const refs = byRank.get(rank)!.map(e => e.defRef);
      intents.push(createParallelStepIntent(context, parentStep, planId, AGENT_NAME, `Materializar L${rank} {{completed}}/{{total}}, falhas {{failed}}`, refs, prevPlan ? [prevPlan] : [], 5));
      prevPlan = planId;
    }
    // cb-register runs after the last (outermost) layer finished materializing.
    intents.push(createAddStepIntent(context, parentStep, createAgentStepPayload('cb-register', 'agentCbRegister', 'Registrar backend', { planId: 'cb-register' }, [prevPlan], 'sequential', 'waiting_dependency')));
    console.log(`${logPrefix(agent)} materialize fan-out: ${stale.length} file(s) across ${ranks.length} layer(s) [${ranks.join(',')}]`);
    intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `materialize ${stale.length} file(s) in ${ranks.length} layer(s)`));
    return intents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${msg}`);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', msg)];
  }
}

// Read a context/skill ref, falling back from .d.ts to its generated .ts sibling (mirrors the CLI).
async function readContextRef(ref: string): Promise<string | null> {
  const direct = await getContentByMlsPath(ref);
  if (direct != null) return direct;
  if (ref.endsWith('.d.ts')) return getContentByMlsPath(ref.replace(/\.d\.ts$/u, '.ts'));
  return null;
}

// WORKER: assemble the prompt for ONE defs file with the shared core and ask the model for the .ts.
async function worker(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, defRef: string): Promise<mls.msg.AgentIntent[]> {
  const content = await getContentByMlsPath(defRef);
  if (!content) return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', `defs not found: ${defRef}`)];
  const parsed = parseDefs(content);
  if (!parsed.item || !parsed.item.outputPath) return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', `no pipeline item in ${defRef}`)];

  const skillSections: string[] = [];
  for (const s of parsed.item.skills ?? []) {
    for (const real of expandContextRef(s)) {
      const c = await getContentByMlsPath(real);
      if (c != null) skillSections.push(`<!-- skill: ${real} -->\n${c}`);
    }
  }
  const contextSections: string[] = [];
  for (const d of parsed.item.dependsFiles ?? []) {
    for (const real of expandContextRef(d)) {
      const c = await readContextRef(real);
      if (c != null) contextSections.push(`### ${real}\n\`\`\`ts\n${c}\n\`\`\``);
    }
  }
  const system = buildSystemPrompt(skillSections, parsed.item.outputPath, DEFAULT_MODEL_TYPE);
  const human = buildHumanPrompt(parsed.data, contextSections, parsed.item.outputPath);
  // prompt_ready args MUST equal the parallel child's queued hook args (the defRef) so the runtime
  // (continueBeforePrompt -> findBeforePromptStep by parentStepId+args) matches it.
  return [createPromptReadyIntent(context, parentStep, hookSequential, defRef, system, human, GEN_TOOL as unknown as mls.msg.LLMTool, GEN_TOOL_NAME)];
}

// afterPromptStep (worker only): take the generated code from the tool call and save the .ts.
async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number, args?: string): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const defRef = workerDefRef(args, step);
    if (!defRef) throw new Error('worker afterPrompt without defRef');
    const content = await getContentByMlsPath(defRef);
    const item = content ? parseDefs(content).item : null;
    if (!item || !item.outputPath) throw new Error(`no pipeline item in ${defRef}`);

    const payload = step.interaction?.payload?.[0];
    const out = extractToolCallArgs<{ code?: string }>(payload, GEN_TOOL_NAME);
    if (!out?.code) throw new Error('missing generated code');

    const code = applyHeader(item.outputPath, out.code);
    const p = parseMlsPath(item.outputPath);
    if (!p) throw new Error(`invalid outputPath: ${item.outputPath}`);
    const ok = await saveGeneratedTs(p.project, p.level, p.folder, p.shortName, code);
    if (!ok) throw new Error('saveGeneratedTs failed');
    console.log(`${logPrefix(agent)} materialized ${item.outputPath} (${code.length}b)`);
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  // No enqueueNext: cb-register was queued by the dispatcher with a join dependsOn on the last layer.
  return [createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace)];
}
