/// <mls fileReference="_102021_/l2/agentChangeBackend/agentChangeBackend.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Stage 3 backend reconciler — ROOT, with a small CLI. v1 is autonomous and create-only.
// The root LLM is SKIPPED (AgentIntentAddMessageAI.skipRootLLM) — bootstrap is deterministic.
// Usage (type after the agent mention):
//   /rebuild all   reset statusBackend of ALL owners -> toCreate, then regenerate defs AND materialize
//                  the .ts (files overwritten in place by saveDefs — no manual delete needed)
//   /rebuild defs  reset ALL owners -> toCreate and regenerate the .defs.ts ONLY (NO .ts materialization)
//   /run           generate for pending owners (statusBackend = toCreate | inProgress), no reset
//   (empty mention) same as /run: scan l4 for toCreate owners and materialize the stale/missing .ts
//   /help          print help (a result step) and stop
// See spec.md + flow.json in this folder.

import { IAgentAsync, IAgentMeta } from '/_102027_/l2/aiAgentBase.js';
import {
  readBackendScan, setOwnerStatusBackend, createAgentStepPayload, createUpdateStatusIntent, logPrefix,
} from '/_102021_/l2/agentChangeBackend/cbShared.js';

const ALL_STATUSES = ['toCreate', 'toUpdate', 'toRemove', 'inProgress', 'done'];

type CbCommandKind = 'rebuild-all' | 'rebuild-defs' | 'run' | 'help';

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

/** Parse the user prompt into a CLI command. Lenient: mention stripped, keyword matched anywhere.
 * Empty (bare @@changeBackend) is the autonomous default -> 'run' (scan toCreate + materialize stale). */
function parseCommand(raw: string | undefined): CbCommandKind {
  const t = normalizePrompt(raw);
  if (!t) return 'run';
  if (/\brebuild\b/.test(t)) return /\bdefs\b/.test(t) ? 'rebuild-defs' : 'rebuild-all';
  if (/\brun\b/.test(t)) return 'run';
  return 'help';
}

function normalizePrompt(raw: string | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/@@?[a-z0-9_]*changebackend\s*/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function beforePromptImplicit(agent: IAgentMeta, context: mls.msg.ExecutionContext, userPrompt: string): Promise<mls.msg.AgentIntent[]> {
  const raw = userPrompt || context.message.content || '';
  const cmd = parseCommand(raw);
  console.log(`${logPrefix(agent)} entry userPrompt="${userPrompt}" content="${context.message.content}" -> cmd=${cmd}`);

  // The root agent step is created WITHOUT calling the model (skipRootLLM); the chain is added below.
  const addMessageAI: mls.msg.AgentIntentAddMessageAI = {
    type: 'add-message-ai',
    skipRootLLM: true,
    request: {
      action: 'addMessageAI',
      agentName: agent.agentName,
      inputAI: [
        { type: 'system', content: 'agentChangeBackend deterministic bootstrap. The root LLM is skipped by AgentIntentAddMessageAI.skipRootLLM.' },
        { type: 'human', content: normalizePrompt(raw) || 'agentChangeBackend' },
      ],
      taskTitle: 'agentChangeBackend',
      threadId: context.message.threadId,
      userMessage: context.message.content,
      longTermMemory: { taskName: 'agentChangeBackend', flowName: 'agentChangeBackend', version: '1', cliCommand: cmd },
    },
  };

  if (cmd === 'help') {
    return [addMessageAI, createBootstrapAddStepIntent(context, createHelpStep())];
  }

  if (cmd === 'rebuild-all' || cmd === 'rebuild-defs') {
    let reset = 0;
    try {
      const scan = await readBackendScan(ALL_STATUSES);
      for (const owner of scan.owners) {
        if (await setOwnerStatusBackend(owner, 'toCreate')) reset++;
      }
      console.log(`${logPrefix(agent)} ${cmd} — reset ${reset} owner(s) -> toCreate`);
    } catch (e) {
      console.error(`${logPrefix(agent)} ${cmd} reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const scanStep = createAgentStepPayload('cb-scan', 'agentCbScanCreateOwners', 'Scan l4 (statusBackend = toCreate)', { planId: 'cb-scan' }, [], 'sequential', 'waiting_human_input');
  return [addMessageAI, createBootstrapAddStepIntent(context, scanStep)];
}

async function afterPromptStep(agent: IAgentMeta, context: mls.msg.ExecutionContext, parentStep: mls.msg.AIAgentStep, step: mls.msg.AIAgentStep, hookSequential: number): Promise<mls.msg.AgentIntent[]> {
  if (!context.task) throw new Error(`[${agent.agentName}] task invalid`);
  return [createUpdateStatusIntent(context, parentStep, step, hookSequential, 'completed', 'Root bootstrap completed (no model).')];
}

/** Add a step under the root (stepId 1), created by the skipRootLLM bootstrap above. */
function createBootstrapAddStepIntent(context: mls.msg.ExecutionContext, step: mls.msg.AIPayload): mls.msg.AgentIntentAddStep {
  return {
    type: 'add-step',
    messageId: '',
    threadId: context.message.threadId,
    taskId: '',
    parentStepId: 1,
    step,
  };
}

function createHelpStep(): mls.msg.AIPayload {
  return {
    type: 'result',
    stepId: 0,
    status: 'completed',
    interaction: null,
    nextSteps: [],
    stepTitle: 'Help',
    result: HELP,
    planning: { planId: 'help', dependsOn: [], executionMode: 'sequential', executionHost: 'client' },
  } as any;
}

const HELP = `agentChangeBackend — CLI

Uso: @@changeBackend <comando>

Comandos:
- /rebuild all  : reseta statusBackend de TODOS os owners para toCreate e regenera o backend — defs E materialização dos .ts (arquivos sobrescritos in place; sem deletar).
- /rebuild defs : reseta TODOS os owners para toCreate e regenera SOMENTE os .defs.ts (NÃO materializa os .ts).
- /run          : gera os owners pendentes (statusBackend = toCreate | inProgress) sem resetar; materializa os .ts faltando/desatualizados.
- (sem comando) : igual ao /run — varre o l4 por owners toCreate e materializa os .ts antigos/ausentes.
- /help         : mostra esta ajuda.

Qualquer outro comando (texto não reconhecido) mostra esta ajuda.`;
