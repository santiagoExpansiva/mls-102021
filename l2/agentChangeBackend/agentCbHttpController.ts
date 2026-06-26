/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbHttpController.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the BFF http controllers (layer_1_external/adapters/http), one per page, when page
// contracts exist. Each handler validates boundary input, calls the usecase, and shapes the response
// to EXACTLY the per-page contract Output. If no contract exists, skip to registration.

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
  const pages = await readContracts();
  if (pages.length === 0) {
    console.log(`${logPrefix(agent)} no page contract — skipping BFF controllers`);
    return [
      enqueueNext(context, parentStep, step, 'cb-register', 'agentCbRegister', 'Registrar backend', {}),
      createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'No contract; controllers skipped.'),
    ];
  }
  const human = `## Page contracts\n${JSON.stringify(pages, null, 2)}\n\nReturn one controller per page (one handler per command, route key {module}.{page}.{command}); the handler returns EXACTLY the contract Output.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, '', systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
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
    let saved = 0;
    for (const item of asArray((out.result as any).items)) {
      const pageId = readString(item.pageId);
      if (!pageId) continue;
      const fi = httpControllerFileInfo(module, pageId);
      const handlers = asArray(item.handlers);
      const usecaseRefs = [...new Set(handlers.map((h: any) => readString(h.usecaseRef)).filter(Boolean))];
      const contractRef = `_${mls.actualProject || 0}_/l2/${module}/web/contracts/${pageId}.ts`;
      const dependsFiles = [...usecaseRefs.map(u => dtsRef(usecaseFileInfo(module, u))), contractRef];
      const pipeline = [buildPipelineItem(lowerFirst(pageId), 'httpController', fi, dependsFiles, layerSkills('layer_2.md'), { afterSaveBackEnd: REGISTER })];
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
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate BFF http controllers (return exactly the page contract)', visibility: 'private', beforePromptStep, afterPromptStep };
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_1_external/adapters/http). For each page produce ONE controller:
one handler per bffCommand (name {module}{Page}{Command}Handler), each validating boundary input,
calling the usecase, and shaping the response to EXACTLY the contract Output (nothing more/less). Route
key {module}.{page}.{command}. No ctx.data, no persistence import. Call "{{toolName}}"; result.items =
array. No prose.
`;
