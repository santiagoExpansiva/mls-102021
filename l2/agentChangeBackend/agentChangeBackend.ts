/// <mls fileReference="_102021_/l2/agentChangeBackend/agentChangeBackend.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Stage 3 backend reconciler — ROOT, with a small CLI. v1 is autonomous and create-only.
// Usage (type after the agent mention):
//   /rebuild all   reset statusBackend of ALL owners -> toCreate, then regenerate (files overwritten
//                  in place by saveDefs — no manual delete needed)
//   /run           generate for pending owners (statusBackend = toCreate | inProgress), no reset
//   /help | other  print help and stop (CLI style)
// See spec.md + flow.json in this folder.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, setOwnerStatusBackend, createAddStepIntent, createAgentStepPayload, createUpdateStatusIntent, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';

const ALL_STATUSES = ['toCreate', 'toUpdate', 'toRemove', 'inProgress', 'done'];

type CbCommandKind = 'rebuild' | 'run' | 'help';

export function createAgent(): IAgentAsync {
  return {
    agentName: 'agentChangeBackend',
    agentProject: 102021,
    agentFolder: 'agentChangeBackend',
    agentDescription: 'Stage 3 backend reconciler (v1, hexagonal). CLI: /rebuild all | /run | /help.',
    visibility: 'public',
    beforePromptImplicit,
    afterPromptStep,
  };
}

/** Parse the user prompt into a CLI command. Lenient: the agent mention is stripped and the keyword
 * is matched anywhere (with or without a leading slash), so small formatting differences still work. */
function parseCommand(raw: string | undefined): CbCommandKind {
  let t = String(raw || '').toLowerCase();
  t = t.replace(/@@?[a-z0-9_]*changebackend/g, ' ').trim();   // drop @@changeBackend / @@agentChangeBackend
  if (/\brebuild\b/.test(t)) return 'rebuild';
  if (/\brun\b/.test(t)) return 'run';
  return 'help';
}

async function beforePromptImplicit(agent: IAgentMeta, context: mls.msg.ExecutionContext, userPrompt: string): Promise<mls.msg.AgentIntent[]> {
  const raw = userPrompt || context.message.content || '';
  const cmd = parseCommand(raw);
  // Diagnostic: confirm what actually arrived and how it was parsed (check the console).
  console.log(`${logPrefix(agent)} entry userPrompt="${userPrompt}" content="${context.message.content}" -> cmd=${cmd}`);
  let human: string;

  if (cmd === 'rebuild') {
    let reset = 0;
    try {
      const scan = await readBackendScan(ALL_STATUSES);
      for (const owner of scan.owners) {
        if (await setOwnerStatusBackend(owner, 'toCreate')) reset++;
      }
      console.log(`${logPrefix(agent)} /rebuild — reset ${reset} owner(s) -> toCreate`);
    } catch (e) {
      console.error(`${logPrefix(agent)} /rebuild reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    human = `**/rebuild all** — ${reset} owner(s) reset to \`statusBackend = toCreate\`. Regenerating the whole backend (files are overwritten in place). Acompanhe os steps abaixo.`;
  } else if (cmd === 'run') {
    human = `**/run** — generating the backend for pending owners (\`statusBackend = toCreate | inProgress\`). Acompanhe os steps abaixo.`;
  } else {
    human = HELP;
  }

  const addMessageAI: mls.msg.AgentIntentAddMessageAI = {
    type: 'add-message-ai',
    request: {
      action: 'addMessageAI',
      agentName: agent.agentName,
      inputAI: [
        { type: 'system', content: ECHO_SYSTEM },
        { type: 'human', content: human },
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
  const cmd = parseCommand(context.message.content);
  if (cmd === 'help') {
    // CLI help shown by the echo above — finish without starting the flow.
    return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'help')];
  }
  const scanStep = createAgentStepPayload('cb-scan', 'agentCbScanCreateOwners', 'Scan l4 (statusBackend = toCreate)', { planId: 'cb-scan' }, [], 'sequential', 'waiting_human_input');
  return [createAddStepIntent(context, step, scanStep)];
}

const ECHO_SYSTEM = `
<!-- modelType: codeawsfast -->

You are a CLI front-end. Output the user-turn text EXACTLY as given (verbatim, same Markdown), with no
additions, no commentary, no tool calls.
`;

const HELP = `**agentChangeBackend — CLI**

Usage: \`@@changeBackend <command>\`

Commands:
- \`/rebuild all\` — reset \`statusBackend\` of ALL owners (done / inProgress / …) back to \`toCreate\`, then regenerate the whole backend. Files are **overwritten in place** (no manual delete needed).
- \`/run\` — generate for pending owners (\`statusBackend = toCreate | inProgress\`) **without** resetting.
- \`/help\` — show this help.

Anything else shows this help.`;
