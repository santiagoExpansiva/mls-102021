/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbRegister.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic registration after materialization: wire the persistence manifest (tableDefinitions),
// the http router (route entries) and the composition root binding each repository port -> its
// adapter; fix l0/config.json entrypoints. NEVER registers MDM tables. v1 logs the intended wiring;
// the concrete manifest/router writers are reused from registerBackEnd (agentMaterializeSolution).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbRegister', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic backend registration (manifest, router, composition root)', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const moduleTables = scan.aggregates.filter(a => true).map(a => a.rootEntity);
    console.log(`${logPrefix(agent)} register manifest tables=${moduleTables.join(',') || '(none)'} (MDM excluded), router + port->adapter composition root`);
    return [
      enqueueNext(context, parentStep, step, 'cb-validate-all', 'agentCbValidateAll', 'Validar artefatos l1', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Registered ${moduleTables.length} module table(s).`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
