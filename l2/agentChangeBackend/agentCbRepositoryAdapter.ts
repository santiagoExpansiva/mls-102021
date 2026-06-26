/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbRepositoryAdapter.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Generate the repository ADAPTER (layer_1_external/adapters/persistence) implementing the port:
// maps domain <-> row (columns + details JSONB with child collections), resolves MDM via 102034.
// The ONLY place with ctx.data.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, createPromptReadyIntent, createUpdateStatusIntent, enqueueNext,
  extractPlannerOutput, plannerConfig, createPlannerToolSchema, batchSchema, asArray, saveAgentTrace,
  saveDefs, buildArtifact, buildPipelineItem, repositoryAdapterFileInfo, repositoryPortFileInfo,
  persistenceTableFileInfo, domainEntityFileInfo, dtsRef, layerSkills, readString, lowerFirst, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';
import { repositoryAdapterResultSchema } from '/_102021_/l2/agentChangeBackend/cbSchemas.js';

const AGENT_NAME = 'agentCbRepositoryAdapter';
const TOOL_NAME = 'submitRepositoryAdapters';
const toolSchema = createPlannerToolSchema(TOOL_NAME, 'Submit the repository adapters.', batchSchema(repositoryAdapterResultSchema));

export function createAgent(): IAgentAsync {
  return { agentName: AGENT_NAME, agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Generate repository adapters (port impl, ctx.data)', visibility: 'private', beforePromptStep, afterPromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const scan = await readBackendScan(['toCreate', 'inProgress']);
  const items = scan.aggregates.map(a => ({ entityId: a.rootEntity, embeddedMembers: a.embeddedMembers, mdmRefs: a.mdmRefs }));
  const human = `## Aggregates (root + embedded + mdm refs)\n${JSON.stringify(items, null, 2)}\n\nReturn one adapter per aggregate implementing I{Entity}Repository: map domain <-> row (columns + details JSONB), resolve mdmRefs via 102034. ctx.data ONLY here.`;
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
      const entityId = readString(item.entityId);
      if (!entityId) continue;
      const fi = repositoryAdapterFileInfo(module, entityId);
      const dependsFiles = [
        dtsRef(repositoryPortFileInfo(module, entityId)),
        dtsRef(persistenceTableFileInfo(module, entityId)),
        dtsRef(domainEntityFileInfo(module, entityId)),
      ];
      const pipeline = [buildPipelineItem(`${lowerFirst(entityId)}RepositoryAdapter`, 'repositoryAdapter', fi, dependsFiles, layerSkills('layer_4.md'))];
      await saveDefs(fi, `${lowerFirst(entityId)}RepositoryAdapter`, buildArtifact('repositoryAdapter', `${entityId}RepositoryAdapter`, module, AGENT_NAME, item), pipeline);
      saved++;
    }
    console.log(`${logPrefix(agent)} saved ${saved} repository adapter defs`);
    if (out.status === 'failed') { status = 'failed'; trace = 'model returned failed'; }
  } catch (error) {
    status = 'failed';
    trace = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix(agent)} ${trace}`);
  }
  await saveAgentTrace(context, AGENT_NAME, step);
  const intents: mls.msg.AgentIntent[] = [];
  if (status === 'completed') intents.push(enqueueNext(context, parentStep, step, 'cb-gen-usecase', 'agentCbUsecase', 'Gerar usecases', {}));
  intents.push(createUpdateStatusIntent(context, parentStep, step, hookSequential, status, trace));
  return intents;
}

const systemPrompt = `
<!-- modelType: codepro -->
<!-- x-tool-strict: true -->

You are ${AGENT_NAME} (hexagonal layer_1_external/adapters/persistence). For each aggregate produce the
adapter implementing I{Entity}Repository: map the domain aggregate <-> table row (real columns +
details JSONB holding non-indexed fields and child collections), resolve mdmRefs through the shared
102034 MDM runtime (NO local MDM table). ctx.data is allowed ONLY here. Call "{{toolName}}"; result.items
= array. No prose.
`;
