/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbScanCreateOwners.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic l4 scan: select owners (operations/workflows) with statusBackend = toCreate.
// No work -> finish (no file/status writes). Work -> continue to validate.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbScanCreateOwners', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic l4 statusBackend=toCreate scan', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    // toCreate is the trigger; inProgress is treated as resumable (a previous run locked but did not
    // finish) so the reconciler is idempotent and never gets stuck after a partial run.
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    console.log(`${logPrefix(agent)} project=${scan.project} modules=${scan.moduleNames.join(',') || '(none)'} owners=${scan.owners.length} aggregates=${scan.aggregates.length}`);
    if (scan.owners.length === 0) {
      return [
        enqueueNext(context, parentStep, step, 'cb-final-summary', 'agentCbFinalSummary', 'Resumo (sem trabalho)', { noWork: true }),
        createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'No owner with statusBackend = toCreate.'),
      ];
    }
    return [
      enqueueNext(context, parentStep, step, 'cb-validate-readiness', 'agentCbValidateL4Readiness', 'Preflight l4', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Selected ${scan.owners.length} owner(s).`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} failed: ${message}`);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
