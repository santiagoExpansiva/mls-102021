/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbValidateAll.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Non-blocking barrier: read the SAVED l1 .defs.ts files and report coverage/integrity (each owner
// produced its artifacts; no MDM/horizontal table emitted). Then continue to finalize.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, isRecord, readStringArray, lowerFirst, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

// Parse the FIRST `export const ... = {...} as const;` (the artifact). NB: parseDefsSource in cbShared
// uses the LAST ` as const;`, which on an l1 defs (artifact + pipeline) would span both exports and
// fail; here we need only the artifact's data block.
function parseArtifact(content: string): Record<string, unknown> | undefined {
  const s = content.indexOf('= ');
  const e = content.indexOf(' as const;');
  if (s === -1 || e <= s) return undefined;
  try { const o = JSON.parse(content.slice(s + 2, e)); return isRecord(o) ? o : undefined; } catch { return undefined; }
}

// Module-local l1 imports of a generated .ts: `from '/_<project>_/l1/<folder>/<name>.js'`. Returns the
// tsSet key (`${folder}::${shortName}`) so the caller can check the target was actually generated.
// Cross-project imports (e.g. /_102034_/ platform) and non-l1 imports are ignored on purpose.
function collectL1Imports(content: string, project: number): { key: string; target: string }[] {
  const out: { key: string; target: string }[] = [];
  const re = /from\s+['"]\/_(\d+)_\/l1\/([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (Number(m[1]) !== project) continue;
    const path = m[2].replace(/\.(?:d\.ts|ts|js)$/u, '');
    const lastSlash = path.lastIndexOf('/');
    const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const shortName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    out.push({ key: `${folder}::${shortName.toLowerCase()}`, target: `_${project}_/l1/${path}` });
  }
  return out;
}

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbValidateAll', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic non-blocking l1 coverage/integrity report', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const project = mls.actualProject || 0;
    let l1Defs = 0;
    let mdmTableViolations = 0;
    const mdmIds = new Set(scan.entities.filter(e => e.kind === 'mdm').map(e => e.entityId.toLowerCase()));
    const portDefs = new Set<string>();    // lowercased shortNames present in layer_2_application/ports
    const domainDefs = new Set<string>();  // lowercased shortNames present in layer_3_domain/entities
    const usecases: { id: string; ports: string[] }[] = [];
    const usecaseFnNames = new Map<string, Set<string>>(); // usecaseId (lc) -> exported function names
    const controllers: { id: string; refs: string[] }[] = []; // handler usecaseRefs per controller
    const tsSet = new Set<string>();       // `${folder}::${shortName}` of MATERIALIZED .ts outputs
    const defsFiles: { folder: string; shortName: string }[] = []; // each .defs.ts (to require a .ts sibling)
    const importReqs: { from: string; key: string; target: string }[] = []; // module-local l1 imports to resolve
    for (const file of Object.values(mls.stor.files) as any[]) {
      if (!file || file.project !== project || file.level !== 1 || file.status === 'deleted') continue;
      const folder0 = String(file.folder || '');
      const shortName0 = String(file.shortName || '');
      // Collect materialized .ts outputs (not the .defs.ts / .d.ts) for the completeness check, and
      // record their module-local l1 imports for the cross-file resolution check below.
      if (file.extension === '.ts' && !shortName0.endsWith('.defs') && !shortName0.endsWith('.d')) {
        tsSet.add(`${folder0}::${shortName0.toLowerCase()}`);
        for (const req of collectL1Imports(String(await file.getContent()), project)) {
          importReqs.push({ from: `${folder0}/${shortName0}`, key: req.key, target: req.target });
        }
        continue;
      }
      if (file.extension !== '.defs.ts') continue;
      l1Defs++;
      const folder = folder0;
      const shortName = shortName0.toLowerCase();
      defsFiles.push({ folder, shortName });
      if (folder.includes('/adapters/persistence') && mdmIds.has(shortName)) mdmTableViolations++;
      if (folder.endsWith('/layer_2_application/ports')) portDefs.add(shortName);
      else if (folder.endsWith('/layer_3_domain/entities')) domainDefs.add(shortName);
      else if (folder.endsWith('/layer_2_application/usecases')) {
        const artifact = parseArtifact(String(await file.getContent()));
        const data = artifact && isRecord(artifact.data) ? artifact.data : undefined;
        usecases.push({ id: shortName, ports: data ? readStringArray(data.ports) : [] });
        const fns = data && Array.isArray((data as any).functions) ? (data as any).functions : [];
        usecaseFnNames.set(shortName, new Set<string>(fns.map((f: any) => String(f?.functionName || '')).filter(Boolean)));
      } else if (folder.endsWith('/adapters/http/controllers')) {
        const artifact = parseArtifact(String(await file.getContent()));
        const data = artifact && isRecord(artifact.data) ? artifact.data : undefined;
        const handlers = data && Array.isArray((data as any).handlers) ? (data as any).handlers : [];
        controllers.push({ id: shortName, refs: handlers.map((h: any) => String(h?.usecaseRef || '')).filter(Boolean) });
      }
    }

    // INTEGRITY: every port a usecase references must have a port .defs.ts AND a domain entity .defs.ts.
    // Catches the "usecase imports a module that was never generated" class of errors before tsc.
    const missing: string[] = [];
    for (const uc of usecases) {
      for (const p of uc.ports) {
        if (mdmIds.has(p.toLowerCase())) continue;   // mdm = master data read by id via 102034; no local port/entity
        const portSn = `${lowerFirst(p)}Repository`.toLowerCase();
        const domSn = lowerFirst(p).toLowerCase();
        if (!portDefs.has(portSn)) missing.push(`usecase ${uc.id} -> missing port ${lowerFirst(p)}Repository`);
        if (!domainDefs.has(domSn)) missing.push(`usecase ${uc.id} -> missing entity ${lowerFirst(p)}`);
      }
    }

    // COHERENCE (item 3): every controller handler must reference a function the usecase actually
    // exports. Catches the "controller imports an export the usecase never produced" break (orderFlow).
    for (const c of controllers) {
      const fns = usecaseFnNames.get(c.id);
      for (const ref of c.refs) {
        if (!fns) { missing.push(`controller ${c.id} -> usecase defs not found`); break; }
        if (!fns.has(ref)) missing.push(`controller ${c.id} -> usecase export '${ref}' not found (has: ${[...fns].join(', ') || 'none'})`);
      }
    }

    // COMPLETENESS (items 4 & 6): every .defs.ts must have its materialized .ts sibling. This is the
    // project-level barrier the per-file Monaco compile cannot see — it stops finalize from marking the
    // owners done while any .ts is still missing (the "finalize before materialization finished" gap).
    for (const d of defsFiles) {
      if (!tsSet.has(`${d.folder}::${d.shortName}`)) missing.push(`materialization incomplete -> ${d.folder}/${d.shortName}.ts not generated from its .defs.ts`);
    }

    // CROSS-FILE IMPORTS: every module-local l1 import in a generated .ts must resolve to a generated
    // .ts. Root guard for hallucinated modules (e.g. importing layer_3_domain/rules/* — rules live
    // inside the entity, that folder is never generated). Catches it deterministically before the VM build.
    for (const req of importReqs) {
      if (!tsSet.has(req.key)) missing.push(`import unresolved -> ${req.from}.ts imports '${req.target}' which was not generated`);
    }
    const warnings = mdmTableViolations > 0 ? [`${mdmTableViolations} MDM table artifact(s) found in persistence (should be 0)`] : [];

    if (missing.length) {
      const trace = `INTEGRITY FAILED: ${missing.length} missing-defs reference(s): ${[...new Set(missing)].slice(0, 30).join('; ')}`;
      console.error(`${logPrefix(agent)} ${trace}`);
      return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', trace)];
    }
    // Record the warning details on the step log too (not just the count), so they are visible in the trace.
    const okTrace = warnings.length
      ? `l1 defs=${l1Defs}; ${warnings.length} warning(s): ${warnings.slice(0, 12).join('; ')}`
      : `l1 defs=${l1Defs}; 0 warnings.`;
    return [
      enqueueNext(context, parentStep, step, 'cb-finalize', 'agentCbFinalizeStatus', 'Finalizar statusBackend', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', okTrace),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
