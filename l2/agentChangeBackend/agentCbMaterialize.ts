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
    const allStale = entries.filter(e => entryIsStale(project, e.defRef, e.item.outputPath));
    // Materialize ONE layer per dispatch. The runtime's addParallelArgs forces a parallel parent to
    // in_progress and enqueues its children the moment the add-step is applied, so a `dependsOn`
    // between two parallel steps created together is NOT a real barrier — every layer would start at
    // once (the observed cb-mat-controllers running while cb-mat-usecases was still 13/18). Instead we
    // spawn ONLY the innermost stale layer now, then a SEQUENTIAL continue-dispatcher that waits
    // (waiting_dependency) on that layer's planId and re-runs this dispatch after the layer TRULY
    // finishes — the same proven barrier as cb-usecase-fanout -> cb-gen-http. dispatch is idempotent:
    // the just-materialized .ts stop being stale, so the next call spawns the next layer, and finally
    // cb-register when nothing is stale.
    // minRank: the continue-dispatcher advances STRICTLY forward (rank+1) so a layer that a worker
    // failed to materialize is never re-spawned under the same planId (a duplicate cb-mat-L{rank});
    // its incompleteness is caught by cb-validate-all instead.
    let minRank = 0;
    try { const p = JSON.parse(String(step.prompt || '{}')); if (p && typeof p.minRank === 'number') minRank = p.minRank; } catch { /* default 0 */ }
    const byRank = new Map<number, DefsEntry[]>();
    for (const e of allStale) {
      const r = layerRank(e.item.type);
      if (r < minRank) continue;
      let bucket = byRank.get(r);
      if (!bucket) { bucket = []; byRank.set(r, bucket); }
      bucket.push(e);
    }
    if (byRank.size === 0) {
      // No more layers to materialize from minRank up -> register.
      return [
        createAddStepIntent(context, parentStep, createAgentStepPayload('cb-register', 'agentCbRegister', 'Registrar backend', { planId: 'cb-register' }, [], 'sequential', 'waiting_dependency')),
        createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `nothing stale to materialize (from L${minRank})`),
      ];
    }
    const ranksSorted = [...byRank.keys()].sort((a, b) => a - b);
    const remainingLayers = ranksSorted.length;
    const rank = ranksSorted[0];
    const bucket = byRank.get(rank)!;
    const planId = `cb-mat-L${rank}`;
    const refs = bucket.map(e => e.defRef);
    // Content-based progress label (clearer than "Materializar L0/L1"): name the artifacts in this layer.
    const label = layerLabel([...new Set(bucket.map(e => e.item.type))]);
    const intents: mls.msg.AgentIntent[] = [
      // Current layer starts now (its inner layers are already materialized -> no dependsOn needed).
      createParallelStepIntent(context, parentStep, planId, AGENT_NAME, `Materializar ${label} {{completed}}/{{total}}, falhas {{failed}}`, refs, [], 10),
    ];
    if (remainingLayers > 1) {
      // More layers to go: a continue-dispatcher runs ONLY after this layer completes (real barrier),
      // then re-dispatches (minRank = rank+1) to spawn the next outer stale layer. Title names the NEXT
      // layer's content (not a generic "próxima camada") so the step list stays readable.
      const nextRank = ranksSorted[1];
      const nextLabel = layerLabel([...new Set(byRank.get(nextRank)!.map(e => e.item.type))]);
      intents.push(createAddStepIntent(context, parentStep, createAgentStepPayload(`cb-mat-after-L${rank}`, AGENT_NAME, `Materializar ${nextLabel}`, { planId: 'cb-materialize', minRank: rank + 1 }, [planId], 'sequential', 'waiting_dependency')));
    } else {
      // Last stale layer: register runs after it materializes.
      intents.push(createAddStepIntent(context, parentStep, createAgentStepPayload('cb-register', 'agentCbRegister', 'Registrar backend', { planId: 'cb-register' }, [planId], 'sequential', 'waiting_dependency')));
    }
    intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `materializing ${label} (${refs.length} file(s)); ${remainingLayers - 1} layer(s) after`));
    return intents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${msg}`);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', msg)];
  }
}

// Human, content-based name for a materialization layer's progress title (replaces "L0/L1/…").
const ARTIFACT_LABEL: Record<string, string> = {
  domainEntity: 'entidades de domínio',
  repositoryPort: 'ports',
  persistenceTable: 'tabelas',
  repositoryAdapter: 'adapters',
  applicationUsecase: 'usecases',
  httpController: 'controllers',
};
function layerLabel(types: string[]): string {
  const names = types.map(t => ARTIFACT_LABEL[t] || t);
  return names.length ? names.join(' + ') : 'artefatos';
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
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  // No enqueueNext: cb-register was queued by the dispatcher with a join dependsOn on the last layer.
  return [createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace)];
}
