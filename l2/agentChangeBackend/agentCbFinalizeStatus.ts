/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbFinalizeStatus.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic: set statusBackend = done for the owners processed in this run (statusFrontend
// untouched). Then continue to the final summary.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, setOwnerStatusBackend, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbFinalizeStatus', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic statusBackend inProgress -> done', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['inProgress']);
    let done = 0;
    for (const owner of scan.owners) {
      if (await setOwnerStatusBackend(owner, 'done')) done++;
    }
    console.log(`${logPrefix(agent)} statusBackend done for ${done}/${scan.owners.length} owner(s)`);
    return [
      enqueueNext(context, parentStep, step, 'cb-final-summary', 'agentCbFinalSummary', 'Resumo do run', { ownersDone: done }),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Marked ${done} owner(s) done.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
