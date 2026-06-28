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
    for (const file of Object.values(mls.stor.files) as any[]) {
      if (!file || file.project !== project || file.level !== 1 || file.status === 'deleted') continue;
      if (file.extension !== '.defs.ts') continue;
      l1Defs++;
      const folder = String(file.folder || '');
      const shortName = String(file.shortName || '').toLowerCase();
      if (folder.includes('/adapters/persistence') && mdmIds.has(shortName)) mdmTableViolations++;
      if (folder.endsWith('/layer_2_application/ports')) portDefs.add(shortName);
      else if (folder.endsWith('/layer_3_domain/entities')) domainDefs.add(shortName);
      else if (folder.endsWith('/layer_2_application/usecases')) {
        const artifact = parseArtifact(String(await file.getContent()));
        const data = artifact && isRecord(artifact.data) ? artifact.data : undefined;
        usecases.push({ id: shortName, ports: data ? readStringArray(data.ports) : [] });
      }
    }

    // INTEGRITY: every port a usecase references must have a port .defs.ts AND a domain entity .defs.ts.
    // Catches the "usecase imports a module that was never generated" class of errors before tsc.
    const missing: string[] = [];
    for (const uc of usecases) {
      for (const p of uc.ports) {
        const portSn = `${lowerFirst(p)}Repository`.toLowerCase();
        const domSn = lowerFirst(p).toLowerCase();
        if (!portDefs.has(portSn)) missing.push(`usecase ${uc.id} -> missing port ${lowerFirst(p)}Repository`);
        if (!domainDefs.has(domSn)) missing.push(`usecase ${uc.id} -> missing entity ${lowerFirst(p)}`);
      }
    }
    const warnings = mdmTableViolations > 0 ? [`${mdmTableViolations} MDM table artifact(s) found in persistence (should be 0)`] : [];
    console.log(`${logPrefix(agent)} l1Defs=${l1Defs} owners=${scan.owners.length} missing=${missing.length} warnings=${warnings.length}`);

    if (missing.length) {
      const trace = `INTEGRITY FAILED: ${missing.length} missing-defs reference(s): ${[...new Set(missing)].slice(0, 30).join('; ')}`;
      console.error(`${logPrefix(agent)} ${trace}`);
      return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', trace)];
    }
    return [
      enqueueNext(context, parentStep, step, 'cb-finalize', 'agentCbFinalizeStatus', 'Finalizar statusBackend', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `l1 defs=${l1Defs}; warnings=${warnings.length}.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
