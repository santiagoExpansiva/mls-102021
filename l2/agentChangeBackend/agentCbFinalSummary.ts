/// <mls fileReference="_102021_/l2/agentChangeBackend/agentCbFinalSummary.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Terminal step: concise run summary and task completion. Deterministic (no LLM) — handles both the
// no-work path (scan found nothing) and the normal path (owners marked done).

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import { createUpdateStatusIntent, isRecord, parseMaybeJson, logPrefix } from '/_102021_/l2/agentChangeBackend/cbShared.js';

export function createAgent(): IAgentAsync {
  return { agentName: 'agentCbFinalSummary', agentProject: 102021, agentFolder: 'agentChangeBackend', agentDescription: 'Terminal run summary + task completion', visibility: 'private', beforePromptStep };
}

async function beforePromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  const args = isRecord(parseMaybeJson(step.prompt)) ? (parseMaybeJson(step.prompt) as Record<string, unknown>) : {};
  const summary = args.noWork ? 'agentChangeBackend: nothing to create (no statusBackend = toCreate).' : `agentChangeBackend: run complete. owners done = ${args.ownersDone ?? 0}.`;
  return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', summary)];
}
