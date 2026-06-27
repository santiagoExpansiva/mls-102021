/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbHttpController.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the BFF http controllers (layer_1_external/adapters/http). Two modes:
//  - CONTRACT mode: when per-page frontend contracts exist, one controller per page returning EXACTLY
//    the contract Output.
//  - L4 mode (Option P): when no contract exists yet, derive one controller per operation directly
//    from l4 (output = the usecase output). Lets backend and frontend be generated independently.
// Each handler validates boundary input, calls the usecase, and shapes the response. No ctx.data.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  createPromptReadyIntent, createUpdateStatusIntent, enqueueNext, parseDefsSource, isRecord,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  readBackendScan, saveDefs, buildArtifact, buildPipelineItem, httpControllerFileInfo, usecaseFileInfo,
  dtsRef, layerSkills, readString, lowerFirst, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { httpControllerResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbHttpController';
const TOOL_NAME = 'submitHttpControllers';
const REGISTER = '_102021_/l2/agentMaterializeSolution/registerBackEnd.ts?registerController';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the BFF http controllers.', batchSchema(httpControllerResultSchema));

interface PageContract { pageId: string; commands: string[]; usecaseRefs: string[] }

async function readContracts(): Promise<PageContract[]> {
  const project = mls.actualProject || 0;
  const pages: PageContract[] = [];
  for (const file of Object.values(mls.stor.files) as any[]) {
    if (!file || file.project !== project || file.level !== 2 || file.status === 'deleted') continue;
    if (file.extension !== '.defs.ts' || !String(file.folder || '').endsWith('/web/contracts')) continue;
    const parsed = parseDefsSource(String(await file.getContent()));
    const cmds = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    pages.push({
      pageId: String(file.shortName || ''),
      commands: cmds.map((c: any) => String(c.commandName || '')).filter(Boolean),
      usecaseRefs: [...new Set(cmds.flatMap((c: any) => Array.isArray(c.usecaseRefs) ? c.usecaseRefs.map(String) : []))],
    });
  }
  return pages;
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const contracts = await readContracts();
  let human: string;
  if (contracts.length > 0) {
    // CONTRACT mode — exact page Output.
    human = `## Mode: contract (frontend contracts present)\n## Page contracts\n${JSON.stringify(contracts, null, 2)}\n\nReturn one controller per page (one handler per command, route key {module}.{page}.{command}); the handler returns EXACTLY the contract Output.`;
  } else {
    // L4 mode (Option P) — derive one controller per operation from l4; Output = usecase output.
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const endpoints = scan.owners.map(o => ({ pageId: o.id, command: o.id, usecaseRef: o.id, kind: o.opKind || (o.kind === 'workflow' ? 'command' : 'command'), entity: o.entity }));
    if (endpoints.length === 0) {
      console.log(`${logPrefix(agent)} no contract and no operations — skipping controllers`);
      return [
        enqueueNext(context, parentStep, step, 'cb-register', 'agentCbRegister', 'Registrar backend', {}),
        createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'Nothing to expose.'),
      ];
    }
    human = `## Mode: l4 (no frontend contract — derive from operations)\n## Operations -> endpoints (one controller per operation; Output = the usecase output)\n${JSON.stringify(endpoints, null, 2)}\n\nFor each operation return one controller (pageId = operationId) with one handler (command = operationId) calling the usecase (usecaseRef = operationId); route key {module}.{operationId}.{operationId}.`;
  }
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ''), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  let status: mls.msg.AIStepStatus = 'completed';
  let trace: string | undefined;
  try {
    const payload = step.interaction?.payload?.[0];
    if (!payload) throw new Error('missing payload');
    const out = extractPlannerOutput(payload, plannerConfig(TOOL_NAME));
    const scan = await readBackendScan(['toCreate', 'inProgress']);
    const module = scan.moduleNames[0] || 'unknown';
    const contractPages = new Set((await readContracts()).map(p => p.pageId));
    let saved = 0;
    for (const item of asArray((out.result as any).items)) {
      const pageId = readString(item.pageId);
      if (!pageId) continue;
      const fi = httpControllerFileInfo(module, pageId);
      const handlers = asArray(item.handlers);
      const usecaseRefs = [...new Set(handlers.map((h: any) => readString(h.usecaseRef)).filter(Boolean))];
      const dependsFiles = usecaseRefs.map(u => dtsRef(usecaseFileInfo(module, u)));
      if (contractPages.has(pageId)) dependsFiles.push(`_${mls.actualProject || 0}_/l2/${module}/web/contracts/${pageId}.ts`);
      const pipeline = [buildPipelineItem(lowerFirst(pageId), 'httpController', fi, dependsFiles, layerSkills('httpController.md'), { afterSaveBackEnd: REGISTER })];
      await saveDefs(fi, `${lowerFirst(pageId)}Controller`, buildArtifact('httpController', pageId, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} controller defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-register', 'agentCbRegister', 'Registrar backend', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate BFF http controllers (contract mode or derived from l4)', visibility: 'private', beforePromptStep, afterPromptStep };
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_1_external/adapters/http). For each page/operation produce ONE
controller: one handler per command (name {module}{Page}{Command}Handler), each validating boundary
input, calling the usecase, and shaping the response. In contract mode return EXACTLY the contract
Output; in l4 mode the Output is the usecase output. Route key {module}.{page}.{command}. No ctx.data,
no persistence import. Call "{{toolName}}"; result.items = array. No prose.
`;
