/// <mls shortName="agentEndpoint" project="102021" enhancement="_blank" />

import { IAgent, svg_agent } from '/_100554_/l2/aiAgentBase.js';
import { getPromptByHtml } from '/_100554_/l2/aiPrompts.js';
import {
    getNextInProgressStepByAgentName,
    notifyTaskChange,
    notifyThreadChange,
    updateStepStatus,
    getNextPendentStep,
    appendLongTermMemory
} from "/_100554_/l2/aiAgentHelper.js";

import {
    startNewAiTask,
    executeNextStep,
    addNewStep
} from "/_100554_/l2/aiAgentOrchestration.js";


const agentName = "agentEndpoint";
const project = 102021;

export function createAgent(): IAgent {
    return {
        agentName,
        avatar_url: svg_agent,
        agentDescription: "Agent Endpoint, for decide instructions",
        visibility: "private",
        async beforePrompt(context: mls.msg.ExecutionContext): Promise<void> {
            return _beforePrompt(context);
        },
        async afterPrompt(context: mls.msg.ExecutionContext): Promise<void> {
            return _afterPrompt(context);
        },
        async installBot(context: mls.msg.ExecutionContext): Promise<boolean> {
            throw new Error('Not implement');
        },
        async beforeBot(context: mls.msg.ExecutionContext, msg: string, toolsBeforeSendMessage: mls.bots.ToolsBeforeSendMessage[]): Promise<Record<string, any>> {
            throw new Error('Not implement');
        },
        async afterBot(context: mls.msg.ExecutionContext, output: mls.msg.BotOutput): Promise<string> {
            throw new Error('Not implement');

        }
    };
}

const _beforePrompt = async (context: mls.msg.ExecutionContext): Promise<void> => {
    const taskTitle = "Planning...";
    if (!context || !context.message) throw new Error("Invalid context");
    if (context.task) throw new Error("this agent cannot execute with anothers agentes")
    let prompt = context.message.content.replace('@@agentEndpoint', '').trim();
    const inputs: any = await getPrompts(prompt);
    await startNewAiTask(agentName, taskTitle, context.message.content, context.message.threadId, context.message.senderId, inputs, context, _afterPrompt);
    return;
}

const _afterPrompt = async (context: mls.msg.ExecutionContext): Promise<void> => {
    if (!context || !context.message || !context.task) throw new Error("Invalid context");
    const step: mls.msg.AIAgentStep | null = getNextInProgressStepByAgentName(context.task, agentName);
    if (!step) throw new Error(`[${agentName}] afterPrompt: No in progress interaction found.`);
    
    await nextStep(context);
    context = await updateStepStatus(context, step.stepId, "completed");

}

async function nextStep(context: mls.msg.ExecutionContext) {
    if (!context.task) throw new Error(`[${agentName}]: nextStep not found task`);
    const step = getNextPendentStep(context.task) as mls.msg.AIPayload | null;

    if (!step || step.type !== 'flexible' || !step.result) throw new Error(`[${agentName}]: ` + 'Invalid step in update defs, type: "' + step?.type + '"');

    if (typeof step.result === 'string' || !step.result.info) return;

    await appendLongTermMemory(context, {"info": JSON.stringify(step.result.info)});

    const newStep: mls.msg.AIPayload = {
        agentName: 'agentEndpointLayer4Entity',
        prompt: JSON.stringify(step.result.info),
        status: 'pending',
        stepId: step.stepId + 1,
        interaction: null,
        nextSteps: null,
        rags: null,
        type: 'agent'
    }

    await addNewStep(context, step.stepId, [newStep]);

}

async function getPrompts(userPrompt:string): Promise<mls.msg.IAMessageInputType[]> {

    const dataForReplace = {
        userPrompt,
        context: await getRoutes(),
    }

    const prompts = await getPromptByHtml({ project, shortName: agentName, folder: '', data: dataForReplace })
    return prompts;
}

async function getRoutes() {

    const key = mls.stor.getKeyToFiles(mls.actualProject || 0, 1, 'routes', 'layer_2_controllers', '.defs.ts');

    if (!mls.stor.files[key]) return '[]';

    const txt = await mls.stor.files[key].getContent() as string;

    return txt;

}
