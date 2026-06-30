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

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  try {
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const module = scan.moduleNames[0] || 'unknown';
    const contracts = await contractPageIds();
    let saved = 0;
    for (const owner of scan.owners) {
      const ownerId = owner.id;
      if (!ownerId) continue;
      const routePageId = owner.pageId || ownerId;
      const commandName = owner.commandName || ownerId;
      const routeKey = owner.bffName || `${module}.${routePageId}.${commandName}`;
      const handlerName = `${module}${capitalize(ownerId)}Handler`;
      const kind = owner.opKind || (owner.kind === 'workflow' ? 'command' : 'command');
      const data = {
        pageId: routePageId,
        controllerName: `${capitalize(ownerId)}Controller`,
        ownerKind: owner.kind,            // operation | workflow (l4 owner)
        outputSource: contracts.has(routePageId) ? 'contract' : 'usecase',
        handlers: [
          { handlerName, command: commandName, usecaseRef: ownerId, kind },
        ],
        routes: [
          { key: routeKey, handlerName },
        ],
      };
      const fi = httpControllerFileInfo(module, ownerId);
      const dependsFiles = [dtsRef(usecaseFileInfo(module, ownerId))];
      if (contracts.has(routePageId)) dependsFiles.push(`_${mls.actualProject || 0}_/l2/${module}/web/contracts/${routePageId}.ts`);
      const pipeline = [buildPipelineItem(lowerFirst(ownerId), 'httpController', fi, dependsFiles, layerSkills('httpController.md'))];
      await saveDefs(fi, `${lowerFirst(ownerId)}Controller`, buildArtifact('httpController', ownerId, module, AGENT_NAME, data), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} controller defs (l4-driven; ${contracts.size} contract(s) for refinement)`);
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
