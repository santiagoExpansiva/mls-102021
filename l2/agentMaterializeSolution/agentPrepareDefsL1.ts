/// <mls fileReference="_102021_/l2/agentMaterializeSolution/agentPrepareDefsL1.ts" enhancement="_102027_/l2/enhancementAgent"/>

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readProjectJson,
  scanL1DefsFiles,
  getContentByMlsPath,
  parsePipelineFromContent,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';
import { buildRouterTs, buildPersistenceTs } from '/_102020_/l2/agentMaterializeSolution/templateMaterialize.js';
import { createStorFile, IReqCreateStorFile } from '/_102027_/l2/libStor.js';

declare const mls: any;

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentPrepareDefsL1',
    agentProject: 102021,
    agentFolder: 'agentMaterializeSolution',
    agentDescription: 'Add pipeline exports to L1 .defs.ts files for all modules',
    visibility: 'public',
    beforePromptImplicit,
    afterPromptStep,
  };
}

// ─── Step arg types ────────────────────────────────────────────────────────────

export interface L1StepArgs {
  planId: string;
  moduleName: string;
  shortName: string;
  layerFolder: string;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function beforePromptImplicit(
  agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  _userPrompt: string,
): Promise<mls.msg.AgentIntent[]> {
  const project = mls.actualProject || 0;
  const projectJson = await readProjectJson();

  if (!projectJson?.modules?.length) {
    throw new Error(`[agentPrepareDefsL1] l5/project.json not found or empty in project ${project}`);
  }

  const summaries = projectJson.modules.map(mod => {
    const l1 = scanL1DefsFiles(project, mod.moduleName);
    return {
      moduleName: mod.moduleName,
      l1Count: l1.length,
      l1Files: l1.map(f => `${f.folder.split('/').pop()}/${f.shortName}`),
    };
  });

  for (const moduleName of projectJson.modules.map(m => m.moduleName)) {
    await ensureSingletons(project, moduleName);
  }

  const addMessageAI: mls.msg.AgentIntentAddMessageAI = {
    type: 'add-message-ai',
    request: {
      action: 'addMessageAI',
      agentName: agent.agentName,
      inputAI: [
        { type: 'system', content: systemPrompt },
        { type: 'human', content: buildHumanPrompt(summaries) },
      ],
      taskTitle: 'materialize-l1-defs',
      threadId: context.message.threadId,
      userMessage: context.message.content,
      longTermMemory: { taskName: 'materialize-l1-defs', flowName: 'materialize-l1-defs' },
    },
  };

  return [addMessageAI];
}

// ─── After LLM confirms — create all child steps ──────────────────────────────

async function afterPromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  _parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
): Promise<mls.msg.AgentIntent[]> {
  try {
    const payload = step.interaction?.payload?.[0] as any;
    if (!payload) throw new Error('[agentPrepareDefsL1] missing payload');

    if (payload.type === 'result') {
      return [mkFail(context, _parentStep, step, hookSequential, String(payload.result))];
    }
    if (payload.type !== 'flexible' || payload.result?.status === 'failed') {
      const msg = payload.result?.notes?.join('; ') || 'bootstrap failed';
      return [mkFail(context, _parentStep, step, hookSequential, msg)];
    }

    const project = mls.actualProject || 0;
    const projectJson = await readProjectJson();
    if (!projectJson) throw new Error('[agentPrepareDefsL1] project.json unavailable');

    const intents: mls.msg.AgentIntentAddStep[] = [];

    for (const mod of projectJson.modules) {
      const { moduleName } = mod;

      for (const file of scanL1DefsFiles(project, moduleName)) {
        const content = await getContentByMlsPath(file.mlsPath);
        if (content && parsePipelineFromContent(content)?.length) continue;
        const layerFolder = file.folder.split('/').pop() || '';
        const planId = `mat-l1-${safe(moduleName)}-${safe(file.shortName)}-${safe(layerFolder)}`;
        const args: L1StepArgs = { planId, moduleName, shortName: file.shortName, layerFolder };
        intents.push(mkStep(context, step, planId, `L1 pipeline: ${moduleName}/${layerFolder}/${file.shortName}`, 'agentMaterializeL1Def', args));
      }
    }

    if (!intents.length) return [mkComplete(context, _parentStep, step, hookSequential, 'nothing to process')];
    return intents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [mkFail(context, _parentStep, step, hookSequential, msg)];
  }
}

// ─── Builders ─────────────────────────────────────────────────────────────────

function mkStep(
  context: mls.msg.ExecutionContext,
  rootStep: mls.msg.AIAgentStep,
  planId: string,
  title: string,
  agentName: string,
  args: L1StepArgs,
): mls.msg.AgentIntentAddStep {
  return {
    type: 'add-step',
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    parentStepId: rootStep.stepId,
    step: {
      type: 'agent',
      stepId: 0,
      interaction: null,
      stepTitle: title,
      status: 'waiting_human_input',
      nextSteps: [],
      agentName,
      prompt: JSON.stringify(args),
      rags: [],
      planning: { planId, dependsOn: [], executionMode: 'parallel_static', executionHost: 'client' },
    } as any,
  };
}

function mkFail(
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
  traceMsg: string,
): mls.msg.AgentIntentUpdateStatus {
  return {
    type: 'update-status',
    hookSequential,
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    parentStepId: parentStep?.stepId ?? step.stepId,
    stepId: step.stepId,
    status: 'failed',
    traceMsg,
  };
}

function mkComplete(
  context: mls.msg.ExecutionContext,
  parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
  traceMsg?: string,
): mls.msg.AgentIntentUpdateStatus {
  return {
    type: 'update-status',
    hookSequential,
    messageId: context.message.orderAt,
    threadId: context.message.threadId,
    taskId: context.task?.PK || '',
    parentStepId: parentStep?.stepId ?? step.stepId,
    stepId: step.stepId,
    status: 'completed',
    traceMsg,
  };
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// ─── Ensure singletons ────────────────────────────────────────────────────────

async function ensureFile(ref: string, src: string): Promise<void> {
  const info = mls.stor.convertFileReferenceToFile(ref);
  const key = mls.stor.getKeyToFile(info);
  if (mls.stor.files[key]) return;
  const param: IReqCreateStorFile = { ...info, source: src };
  const file = await createStorFile(param, true, true, true);
  await mls.stor.localStor.setContent(file, { contentType: 'string', content: src });
}

async function ensureSingletons(project: number, moduleName: string): Promise<void> {
  await ensureFile(`_${project}_/l1/${moduleName}/layer_2_controllers/router.ts`,   buildRouterTs(project, moduleName));
  await ensureFile(`_${project}_/l1/${moduleName}/layer_1_external/persistence.ts`, buildPersistenceTs(project, moduleName));
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const systemPrompt = `<!-- modelType: codepro -->

You initialize the "materialize L1 defs" task.

You receive a scan of L1 .defs.ts files found in a project and confirm the scan is valid.

If valid, return:
{"type":"flexible","result":{"status":"ok","notes":[]}}

If invalid (no modules, no files), return:
{"type":"result","result":"Short error message"}

Return valid JSON only — no markdown, no prose outside the JSON.`;

function buildHumanPrompt(
  summaries: Array<{ moduleName: string; l1Count: number; l1Files: string[] }>,
): string {
  const lines = ['# L1 Defs Scan', ''];
  for (const s of summaries) {
    lines.push(`## Module: ${s.moduleName}`);
    lines.push(`L1 files (${s.l1Count}): ${s.l1Files.join(', ') || '(none)'}`);
    lines.push('');
  }
  lines.push('Confirm the scan and return your response.');
  return lines.join('\n');
}
