/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbLockOwners.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic: set statusBackend = inProgress for the validated toCreate owners (the only status
// mutation before successful completion). Then continue to the aggregate index (LLM planning).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, setOwnerStatusBackend, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbLockOwners', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic statusBackend toCreate -> inProgress lock', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate']);
    let locked = 0;
    for (const owner of scan.owners) {
      if (await setOwnerStatusBackend(owner, 'inProgress')) locked++;
    }
    console.log(`${logPrefix(agent)} locked ${locked}/${scan.owners.length} owner(s) -> inProgress`);
    return [
      enqueueNext(context, parentStep, step, 'cb-aggregate-index', 'agentCbAggregateIndex', 'Planejar agregados', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Locked ${locked} owner(s).`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
