/// <mls fileReference="_102021_/l2/agentChangeBackend/agentChangeBackend.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Stage 3 backend reconciler — ROOT. v1 is autonomous and create-only: no user prompt. The root
// only kicks off the deterministic l4 statusBackend scan; the scan decides whether there is work and
// builds the rest of the chain. See spec.md + flow.json in this folder.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { createAddStepIntent, createAgentStepPayload } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentChangeBackend',
    agentProject: 102021,
    agentFolder: 'agentChangeBackend',
    agentDescription: 'Stage 3 backend reconciler (v1 autonomous, create-only). Scans l4 statusBackend and generates the 3-layer hexagonal backend.',
    visibility: 'public',
    beforePromptImplicit,
    afterPromptStep,
  };
}

async function beforePromptImplicit(agent: IAgentMeta, context: mls.msg.ExecutionContext, userPrompt: string): Promise<mls.msg.AgentIntent[]> {
  const addMessageAI: mls.msg.AgentIntentAddMessageAI = {
    type: 'add-message-ai',
    request: {
      action: 'addMessageAI',
      agentName: agent.agentName,
      inputAI: [
        { type: 'system', content: systemPrompt },
        { type: 'human', content: userPrompt || 'Run agentChangeBackend v1 autonomous scan.' },
      ],
      taskTitle: 'agentChangeBackend',
      threadId: context.message.threadId,
      userMessage: context.message.content,
      longTermMemory: { taskName: 'agentChangeBackend', flowName: 'agentChangeBackend', version: '1' },
    },
  };
  return [addMessageAI];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  if (!context.task) throw new Error(`[${agent.agentName}] task invalid`);
  const scanStep = createAgentStepPayload('cb-scan', 'agentCbScanCreateOwners', 'Scan l4 (statusBackend = toCreate)', { planId: 'cb-scan' }, [], 'sequential', 'waiting_human_input');
  return [createAddStepIntent(context, step, scanStep)];
}

const systemPrompt = `
<!-- modelType: codehigh -->

Return only:
{ "type": "result", "result": "ok" }

This root agent ignores the model result. It only starts the deterministic l4 statusBackend scan.
`;
