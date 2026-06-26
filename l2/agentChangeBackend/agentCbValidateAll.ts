/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbValidateAll.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Non-blocking barrier: read the SAVED l1 .defs.ts files and report coverage/integrity (each owner
// produced its artifacts; no MDM/horizontal table emitted). Then continue to finalize.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, isRecord, parseDefsSource, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

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
    for (const file of Object.values(mls.stor.files) as any[]) {
      if (!file || file.project !== project || file.level !== 1 || file.status === 'deleted') continue;
      if (file.extension !== '.defs.ts') continue;
      l1Defs++;
      const folder = String(file.folder || '');
      const shortName = String(file.shortName || '').toLowerCase();
      if (folder.includes('/adapters/persistence') && mdmIds.has(shortName)) mdmTableViolations++;
    }
    const warnings = mdmTableViolations > 0 ? [`${mdmTableViolations} MDM table artifact(s) found in persistence (should be 0)`] : [];
    console.log(`${logPrefix(agent)} l1Defs=${l1Defs} owners=${scan.owners.length} warnings=${warnings.length}`);
    return [
      enqueueNext(context, parentStep, step, 'cb-finalize', 'agentCbFinalizeStatus', 'Finalizar statusBackend', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `l1 defs=${l1Defs}; warnings=${warnings.length}.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
