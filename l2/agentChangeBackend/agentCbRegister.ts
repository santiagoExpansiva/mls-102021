/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbRegister.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Deterministic registration after materialization. Routes and table definitions are discovered at
// RUNTIME by the 102034 host: config `backendControllers` -> each controller's exported `routes`,
// and `persistenceModules[].tableDefsDir` -> the exported TableDefinition adapters. So NO router or
// persistence index file is generated here, and the materialize template owns the config discovery
// fields. This step's remaining deterministic job is the composition root (binding each repository
// port -> its adapter) and gating to validateAll. NEVER registers MDM tables (those belong to 102034).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { readBackendScan, enqueueNext, createUpdateStatusIntent, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbRegister', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Deterministic backend registration (composition root; routes/tables discovered at runtime)', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const moduleTables = scan.aggregates.filter(a => true).map(a => a.rootEntity);
    console.log(`${logPrefix(agent)} runtime-discovered tables=${moduleTables.join(',') || '(none)'} (MDM excluded); routes via controllers' exported routes; composition root port->adapter`);
    return [
      enqueueNext(context, parentStep, step, 'cb-validate-all', 'agentCbValidateAll', 'Validar artefatos l1', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', `Registered ${moduleTables.length} module table(s).`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'failed', message)];
  }
}
