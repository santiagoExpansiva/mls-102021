/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbHttpController.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the BFF http controllers (layer_1_external/adapters/http). L4 IS THE SOURCE OF TRUTH:
// one controller per l4 owner (operation/workflow), one handler that calls the owner's usecase, and
// the response defaults to the usecase output. The frontend contract is OPTIONAL refinement: when a
// per-page contract exists, it is added to dependsFiles so the materializer shapes the Output to it —
// never a dependency. This step is DETERMINISTIC (binding owner->usecase by id), so handlers are never
// empty; the .ts itself is written by the next step (agentCbMaterialize) from the usecase .d.ts + skill.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, enqueueNext, createUpdateStatusIntent, parseDefsSource, isRecord,
  saveDefs, buildArtifact, buildPipelineItem, httpControllerFileInfo, usecaseFileInfo,
  dtsRef, layerSkills, capitalize, lowerFirst, logPrefix, readCliCommand,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';

const AGENT_NAME = 'agentCbHttpController';

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate BFF http controllers from l4 (usecase-driven; contract optional)', visibility: 'private', beforePromptStep };
}

/** Page ids that already have a frontend contract (optional Output refinement). */
async function contractPageIds(): Promise<Set<string>> {
  const project = mls.actualProject || 0;
  const ids = new Set<string>();
  for (const file of Object.values(mls.stor.files) as any[]) {
    if (!file || file.project !== project || file.level !== 2 || file.status === 'deleted') continue;
    if (file.extension !== '.defs.ts' || !String(file.folder || '').endsWith('/web/contracts')) continue;
    const sn = String(file.shortName || '');
    if (sn) ids.add(sn);
  }
  return ids;
}

type UsecaseFn = { functionName: string; inputTypeName?: string; kind?: string };

/** First `export const … = {…} as const;` — the artifact block (parseDefsSource spans both exports). */
function parseArtifactData(content: string): Record<string, unknown> | undefined {
  const s = content.indexOf('= ');
  const e = content.indexOf(' as const;');
  if (s === -1 || e <= s) return undefined;
  try { const o = JSON.parse(content.slice(s + 2, e)); if (!isRecord(o)) return undefined; return isRecord(o.data) ? o.data : o; } catch { return undefined; }
}

/** Read each generated usecase's EXPORTED functions from its saved defs, keyed by usecaseId. The
 * controller binds to these real names so it never imports a function the usecase did not produce. */
async function readUsecaseFunctions(): Promise<Map<string, UsecaseFn[]>> {
  const project = mls.actualProject || 0;
  const map = new Map<string, UsecaseFn[]>();
  for (const file of Object.values(mls.stor.files) as any[]) {
    if (!file || file.project !== project || file.level !== 1 || file.status === 'deleted') continue;
    if (file.extension !== '.defs.ts' || !String(file.folder || '').endsWith('/layer_2_application/usecases')) continue;
    const data = parseArtifactData(String(await file.getContent()));
    if (!data) continue;
    const usecaseId = String((data as any).usecaseId || file.shortName || '');
    const fns = Array.isArray((data as any).functions) ? (data as any).functions : [];
    const parsed: UsecaseFn[] = fns
      .map((f: any) => ({ functionName: String(f?.functionName || ''), inputTypeName: f?.inputTypeName ? String(f.inputTypeName) : undefined, kind: f?.kind ? String(f.kind) : undefined }))
      .filter((f: UsecaseFn) => !!f.functionName);
    if (usecaseId && parsed.length) map.set(usecaseId, parsed);
  }
  return map;
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const module = scan.moduleNames[0] || 'unknown';
    const contracts = await contractPageIds();
    const usecaseFns = await readUsecaseFunctions();
    let saved = 0;
    for (const owner of scan.owners) {
      const ownerId = owner.id;
      if (!ownerId) continue;
      // Only OPERATIONS are BFF command owners. Workflows are pure orchestration — no controller/command.
      if (owner.kind !== 'operation') continue;
      const routePageId = owner.pageId || ownerId;
      const outputSource = contracts.has(routePageId) ? 'contract' : 'usecase';
      // COHERENCE (item 3): bind handlers to the usecase's REAL exported functions read from the
      // generated defs — never an assumed name. This prevents the controller from importing a function
      // the usecase never produced (the orderFlow-class break). Fallback to the ownerId only if the defs
      // are missing/unparsed.
      const fns = usecaseFns.get(ownerId) || [];
      const handlers: { handlerName: string; command: string; usecaseRef: string; inputTypeName?: string; kind: string }[] = [];
      const routes: { key: string; handlerName: string }[] = [];
      if (fns.length > 1) {
        // A usecase exposing several functions -> one command/route per function (1:1 function<->command).
        for (const fn of fns) {
          const handlerName = `${module}${capitalize(fn.functionName)}Handler`;
          handlers.push({ handlerName, command: fn.functionName, usecaseRef: fn.functionName, inputTypeName: fn.inputTypeName, kind: fn.kind || owner.opKind || 'command' });
          routes.push({ key: `${module}.${routePageId}.${fn.functionName}`, handlerName });
        }
        // L4 is the source of truth for the BFF contract: the canonical bffName route MUST
        // also exist (the l2 contract calls it). Emit a dispatcher handler that selects the
        // usecase function from the provided params (see httpController.md, kind 'dispatcher').
        const canonicalKey = owner.bffName || `${module}.${routePageId}.${owner.commandName || ownerId}`;
        if (!routes.some(r => r.key === canonicalKey)) {
          const dispatcherName = `${module}${capitalize(owner.commandName || ownerId)}Handler`;
          handlers.push({ handlerName: dispatcherName, command: owner.commandName || ownerId, usecaseRef: fns.map(f => f.functionName).join(' | '), kind: 'dispatcher' });
          routes.push({ key: canonicalKey, handlerName: dispatcherName });
        }
      } else {
        const fn = fns[0];
        const handlerName = `${module}${capitalize(ownerId)}Handler`;
        const routeKey = owner.bffName || `${module}.${routePageId}.${owner.commandName || ownerId}`;
        handlers.push({ handlerName, command: owner.commandName || ownerId, usecaseRef: fn?.functionName || ownerId, inputTypeName: fn?.inputTypeName, kind: fn?.kind || owner.opKind || 'command' });
        routes.push({ key: routeKey, handlerName });
      }
      const data = {
        pageId: routePageId,
        controllerName: `${capitalize(ownerId)}Controller`,
        ownerKind: owner.kind,            // operation (workflows are skipped)
        outputSource,
        handlers,
        routes,
      };
      const fi = httpControllerFileInfo(module, ownerId);
      const dependsFiles = [dtsRef(usecaseFileInfo(module, ownerId))];
      if (contracts.has(routePageId)) dependsFiles.push(`_${mls.actualProject || 0}_/l2/${module}/web/contracts/${routePageId}.ts`);
      const pipeline = [buildPipelineItem(lowerFirst(ownerId), 'httpController', fi, dependsFiles, layerSkills('httpController.md'))];
      await saveDefs(fi, `${lowerFirst(ownerId)}Controller`, buildArtifact('httpController', ownerId, module, AGENT_NAME, data), pipeline);
      saved++;
    }
    // /rebuild defs stops at the .defs.ts (no .ts materialization): skip cb-materialize, go to cb-register.
    const defsOnly = readCliCommand(context) === 'rebuild-defs';
    const next = defsOnly
      ? enqueueNext(context, parentStep, step, 'cb-register', 'agentCbRegister', 'Registrar backend', {})
      : enqueueNext(context, parentStep, step, 'cb-materialize', 'agentCbMaterialize', 'Materializar .defs.ts -> .ts', {});
    return [
      next,
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Generated ${saved} controller(s) from l4${defsOnly ? ' (defs-only: .ts skipped)' : ''}.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${message}`);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
