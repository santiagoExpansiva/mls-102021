/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbUsecase.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the usecases (layer_2_application/usecases), one per pending operation/workflow. The
// usecase orchestrates domain + repository PORTS (never the concrete adapter, never ctx.data),
// applying rulesApplied and wrapping multi-aggregate writes in one transaction.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, usecaseFileInfo, repositoryPortFileInfo, domainEntityFileInfo,
  dtsRef, layerSkills, readString, readStringArray, lowerFirst, logPrefix, planIdOf,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { usecaseResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbUsecase';
const TOOL_NAME = 'submitUsecases';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the usecases.', batchSchema(usecaseResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate application usecases (orchestrate domain + ports)', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const roots = new Set(scan.aggregates.map(a => a.rootEntity));
  const items = scan.owners.map(o => ({ usecaseId: o.id, ownerKind: o.kind, entity: o.entity, reads: o.reads, writes: o.writes, rulesApplied: o.rulesApplied, ports: [...new Set([o.entity, ...o.reads, ...o.writes])].filter(id => roots.has(id)) }));
  const human = `## Owners -> usecases (with candidate ports = aggregate roots they touch)\n${JSON.stringify(items, null, 2)}\n\nReturn one usecase per owner: functionName, input/output type names, ports used, rulesApplied, transactional flag, steps.`;
  return [createPromptReadyIntent(context, parentStep, hookSequential, (step.prompt || ""), systemPrompt.split('{{toolName}}').join(TOOL_NAME), human, toolSchema, TOOL_NAME)];
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
      const usecaseId = readString(item.usecaseId);
      if (!usecaseId) continue;
      const ports = readStringArray(item.ports);
      const fi = usecaseFileInfo(module, usecaseId);
      const dependsFiles = [
        ...ports.map(p => dtsRef(repositoryPortFileInfo(module, p))),
        ...ports.map(p => dtsRef(domainEntityFileInfo(module, p))),
      ];
      const pipeline = [buildPipelineItem(lowerFirst(usecaseId), 'applicationUsecase', fi, dependsFiles, layerSkills('applicationUsecase.md'), { rulesApplied: readStringArray(item.rulesApplied) })];
      await saveDefs(fi, `${lowerFirst(usecaseId)}Usecase`, buildArtifact('usecase', usecaseId, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} usecase defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-http', 'agentCbHttpController', 'Gerar controllers HTTP (BFF)', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codehigh -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_2_application/usecases). One usecase per owner: it decides WHAT
happens — validations, state transitions, orchestration — using the domain + repository PORTS only
(import the port interface, NEVER the concrete adapter; NEVER ctx.data, except a single transaction
wrapper). Apply rulesApplied. Provide functionName, inputTypeName, outputTypeName, ports, transactional,
steps. Call "{{toolName}}"; result.items = array. No prose.
`;
