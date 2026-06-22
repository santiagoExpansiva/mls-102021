/// <mls fileReference="_102021_/l2/agentMaterializeSolution/agentMaterializeL1.ts" enhancement="_102027_/l2/enhancementAgent"/>

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readProjectJson,
  scanL1DefsWithPipeline,
  getFileModified,
  toMlsPath,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';
import type {
  GenStepArgs,
  L1FileType,
  PipelineItem,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';

declare const mls: any;

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentMaterializeL1',
    agentProject: 102021,
    agentFolder: 'agentMaterializeSolution',
    agentDescription: 'Generate L1 .ts files from .defs.ts pipeline definitions',
    visibility: 'public',
    beforePromptImplicit,
    afterPromptStep,
  };
}

interface Candidate {
  folder: string;
  shortName: string;
  pipeline: PipelineItem[];
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
    throw new Error('[agentMaterializeL1] l5/project.json not found or empty');
  }

  const summaries = [];
  for (const mod of projectJson.modules) {
    const candidates = await findCandidates(project, mod.moduleName);
    const byType = groupByType(candidates, mod.moduleName);
    summaries.push({
      moduleName: mod.moduleName,
      layer1: byType.layer1.length,
      layer4: byType.layer4.length,
      layer3: byType.layer3.length,
      layer2: byType.layer2.length,
    });
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
      taskTitle: 'materialize-l1',
      threadId: context.message.threadId,
      userMessage: context.message.content,
      longTermMemory: { taskName: 'materialize-l1', flowName: 'materialize-l1' },
    },
  };

  return [addMessageAI];
}

// ─── After LLM confirms — create all generation steps ────────────────────────

async function afterPromptStep(
  _agent: IAgentMeta,
  context: mls.msg.ExecutionContext,
  _parentStep: mls.msg.AIAgentStep,
  step: mls.msg.AIAgentStep,
  hookSequential: number,
): Promise<mls.msg.AgentIntent[]> {
  try {
    const payload = step.interaction?.payload?.[0] as any;
    if (!payload) throw new Error('[agentMaterializeL1] missing payload');

    if (payload.type === 'result') {
      return [mkFail(context, _parentStep, step, hookSequential, String(payload.result))];
    }
    if (payload.type !== 'flexible') {
      return [mkFail(context, _parentStep, step, hookSequential, 'scan failed')];
    }
    if (payload.result?.status === 'nothing') {
      return [mkComplete(context, _parentStep, step, hookSequential, 'nothing to generate')];
    }
    if (payload.result?.status === 'failed') {
      return [mkFail(context, _parentStep, step, hookSequential, payload.result?.notes?.join('; ') || 'scan failed')];
    }

    const project = mls.actualProject || 0;
    const projectJson = await readProjectJson();
    if (!projectJson) throw new Error('[agentMaterializeL1] project.json unavailable');

    const intents: mls.msg.AgentIntentAddStep[] = [];

    for (const mod of projectJson.modules) {
      const { moduleName } = mod;
      const candidates = await findCandidates(project, moduleName);
      const byType = groupByType(candidates, moduleName);

      // Pre-compute planId arrays — used as group barriers
      const layer1PlanIds = byType.layer1.map(c => makePlanId(moduleName, c.shortName, 'layer1'));
      const layer4PlanIds = byType.layer4.map(c => makePlanId(moduleName, c.shortName, 'layer4'));
      const layer3PlanIds = byType.layer3.map(c => makePlanId(moduleName, c.shortName, 'layer3'));

      // Group 1: layer_1_external — start immediately
      for (const c of byType.layer1) {
        const planId = makePlanId(moduleName, c.shortName, 'layer1');
        const defPath = toMlsPath(project, 1, c.folder, c.shortName, '.defs.ts');
        const args: GenStepArgs = { planId, defPath };
        intents.push(mkStep(context, step, planId, `Gen layer1: ${moduleName}/${c.shortName}`, c.pipeline[0].agent, args, []));
      }

      // Group 2: layer_4_entities — wait for ALL layer1
      const dep4 = layer1PlanIds.length > 0 ? layer1PlanIds : [];
      for (const c of byType.layer4) {
        const planId = makePlanId(moduleName, c.shortName, 'layer4');
        const defPath = toMlsPath(project, 1, c.folder, c.shortName, '.defs.ts');
        const args: GenStepArgs = { planId, defPath };
        intents.push(mkStep(context, step, planId, `Gen layer4: ${moduleName}/${c.shortName}`, c.pipeline[0].agent, args, dep4));
      }

      // Group 3: layer_3_usecases — wait for ALL layer4 (fallback layer1)
      const dep3 = layer4PlanIds.length > 0 ? layer4PlanIds : layer1PlanIds;
      for (const c of byType.layer3) {
        const planId = makePlanId(moduleName, c.shortName, 'layer3');
        const defPath = toMlsPath(project, 1, c.folder, c.shortName, '.defs.ts');
        const args: GenStepArgs = { planId, defPath };
        intents.push(mkStep(context, step, planId, `Gen layer3: ${moduleName}/${c.shortName}`, c.pipeline[0].agent, args, dep3));
      }

      // Group 4: layer_2_controllers — wait for ALL layer3 (fallback layer4)
      const dep2 = layer3PlanIds.length > 0 ? layer3PlanIds : layer4PlanIds;
      for (const c of byType.layer2) {
        const planId = makePlanId(moduleName, c.shortName, 'layer2');
        const defPath = toMlsPath(project, 1, c.folder, c.shortName, '.defs.ts');
        const args: GenStepArgs = { planId, defPath };
        intents.push(mkStep(context, step, planId, `Gen layer2: ${moduleName}/${c.shortName}`, c.pipeline[0].agent, args, dep2));
      }
    }

    if (!intents.length) return [mkComplete(context, _parentStep, step, hookSequential, 'nothing to generate')];
    return intents;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [mkFail(context, _parentStep, step, hookSequential, msg)];
  }
}

// ─── Candidate detection ──────────────────────────────────────────────────────

async function findCandidates(project: number, moduleName: string): Promise<Candidate[]> {
  const all = await scanL1DefsWithPipeline(project, moduleName);
  return all.filter(({ folder, shortName }) => {
    const defMod = getFileModified(project, 1, folder, shortName, '.defs.ts');
    const tsMod  = getFileModified(project, 1, folder, shortName, '.ts');
    if (tsMod === null) return true;
    if (defMod === null) return false;
    return defMod > tsMod;
  });
}

function groupByType(
  candidates: Candidate[],
  moduleName: string,
): Record<L1FileType, Candidate[]> {
  const result: Record<L1FileType, Candidate[]> = { layer1: [], layer4: [], layer3: [], layer2: [], rulesApplied: [] };
  for (const c of candidates) {
    const ft = detectFileType(c.folder, moduleName);
    if (ft) result[ft].push(c);
  }
  return result;
}

// ─── File type detection ──────────────────────────────────────────────────────

function detectFileType(folder: string, moduleName: string): L1FileType | null {
  const rel = folder.slice(moduleName.length + 1); // strip "cafeFlow/"
  if (rel === 'layer_1_external')    return 'layer1';
  if (rel === 'layer_4_entities')    return 'layer4';
  if (rel === 'layer_3_usecases')    return 'layer3';
  if (rel === 'layer_2_controllers') return 'layer2';
  return null;
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

function makePlanId(moduleName: string, shortName: string, ft: L1FileType): string {
  return `gen-l1-${safe(moduleName)}-${safe(shortName)}-${ft}`;
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// ─── Builders ─────────────────────────────────────────────────────────────────

function mkStep(
  context: mls.msg.ExecutionContext,
  rootStep: mls.msg.AIAgentStep,
  planId: string,
  title: string,
  agentName: string,
  args: GenStepArgs,
  dependsOn: string[],
): mls.msg.AgentIntentAddStep {
  const status: mls.msg.AIStepStatus = dependsOn.length > 0 ? 'waiting_dependency' : 'waiting_human_input';
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
      status,
      nextSteps: [],
      agentName,
      prompt: JSON.stringify(args),
      rags: [],
      planning: { planId, dependsOn, executionMode: 'parallel_static', executionHost: 'client' },
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

// ─── Prompts ──────────────────────────────────────────────────────────────────

const systemPrompt = `<!-- modelType: codepro -->

You confirm the L1 generation scan.

If files were found, return:
{"type":"flexible","result":{"status":"ok","notes":[]}}

If nothing to generate, return:
{"type":"flexible","result":{"status":"nothing"}}

Return valid JSON only.`;

function buildHumanPrompt(
  summaries: Array<{ moduleName: string; layer1: number; layer4: number; layer3: number; layer2: number }>,
): string {
  const lines = ['# L1 Generation Scan', ''];
  for (const s of summaries) {
    lines.push(`## Module: ${s.moduleName}`);
    lines.push(`  layer_1_external: ${s.layer1}, layer_4_entities: ${s.layer4}, layer_3_usecases: ${s.layer3}, layer_2_controllers: ${s.layer2}`);
  }
  const total = summaries.reduce((n, s) => n + s.layer1 + s.layer4 + s.layer3 + s.layer2, 0);
  lines.push('', `Total: ${total} file(s) to generate.`);
  lines.push('Confirm and return your response.');
  return lines.join('\n');
}
