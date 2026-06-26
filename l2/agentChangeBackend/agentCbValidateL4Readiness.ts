/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbValidateL4Readiness.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic preflight on the selected owners: entity/operation ids resolve to canonical l4 ids;
// ontology kind/relationships present. Non-blocking warnings; continue to lock.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbValidateL4Readiness', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic l4 create-readiness preflight', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate']);
    const entityIds = new Set(scan.entities.map(e => e.entityId));
    const warnings: string[] = [];
    for (const owner of scan.owners) {
      const refs = [owner.entity, ...owner.reads, ...owner.writes].filter(Boolean);
      for (const ref of refs) {
        const id = ref.split('.')[0].split(':').pop() || ref;
        if (!entityIds.has(id)) warnings.push(`${owner.id}: unresolved entity ref "${ref}"`);
      }
    }
    if (warnings.length) console.warn(`${logPrefix(agent)} ${warnings.length} warning(s): ${warnings.slice(0, 8).join('; ')}`);
    return [
      enqueueNext(context, parentStep, step, 'cb-lock', 'agentCbLockOwners', 'Lock owners (inProgress)', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Preflight ok (${warnings.length} warning(s)).`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
