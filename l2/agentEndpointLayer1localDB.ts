/// <mls shortName="agentEndpointLayer1localDB" project="102021" enhancement="_blank" />

import { IAgent, svg_agent } from './_100554_aiAgentBase';
import { getPromptByHtml } from './_100554_aiPrompts';
import {
    getNextInProgressStepByAgentName,
    notifyTaskChange,
    notifyThreadChange,
    updateStepStatus,
    getNextPendentStep,
    getNextPendingStepByAgentName
} from "./_100554_aiAgentHelper";

import {
    startNewAiTask,
    startNewInteractionInAiTask,
    executeNextStep,
    addNewStep
} from "./_100554_aiAgentOrchestration";

import { addFile } from './_102021_agentEndpointHelper'

const agentName = "agentEndpointLayer1localDB";
const project = 102021;

export function createAgent(): IAgent {
    return {
        agentName,
        avatar_url: svg_agent,
        agentDescription: "Agent agentEndpointLayer1localDB, for create use case",
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
    if (!context.task) {
        let prompt = context.message.content.replace('@@agentEndpointLayer1localDB', '').trim();
        const inputs: any = await getPrompts(prompt);
        await startNewAiTask(agentName, taskTitle, context.message.content, context.message.threadId, context.message.senderId, inputs, context, _afterPrompt);
        return;
    }

    const pageMemory = context.task?.iaCompressed?.longMemory as any;
    if (!pageMemory || !pageMemory.info) throw new Error(`[${agentName}]: Not found page memory `);

    const step: mls.msg.AIAgentStep | null = getNextPendingStepByAgentName(context.task, agentName);
    if (!step) throw new Error(`[${agentName}] beforePrompt: No pending step found for this agent.`);

    context = await updateStepStatus(context, step.stepId, "in_progress");
    const data = pageMemory.info;
    const inputs = await getPrompts(data);
    await startNewInteractionInAiTask(agentName, taskTitle, inputs, context, _afterPrompt, step.stepId);
}

const _afterPrompt = async (context: mls.msg.ExecutionContext): Promise<void> => {
    if (!context || !context.message || !context.task) throw new Error("Invalid context");
    const step: mls.msg.AIAgentStep | null = getNextInProgressStepByAgentName(context.task, agentName);
    if (!step) throw new Error(`[${agentName}] afterPrompt: No in progress interaction found.`);
    context = await updateStepStatus(context, step.stepId, "completed");

    await addFile(context);
    notifyTaskChange(context);
    await nextStep(context);
}

async function nextStep(context: mls.msg.ExecutionContext) {
    if (!context.task) throw new Error(`[${agentName}]: nextStep not found task`);
    const step = getNextPendentStep(context.task) as mls.msg.AIPayload | null;

    if (!step || step.type !== 'flexible' || !step.result) throw new Error(`[${agentName}]: ` + 'Invalid step in update defs, type: "' + step?.type + '"');


    const newStep: mls.msg.AIPayload = {
        agentName: 'agentEndpointLayer1Context',
        prompt: 'ok',
        status: 'pending',
        stepId: step.stepId + 1,
        interaction: null,
        nextSteps: null,
        rags: null,
        type: 'agent'
    }

    await addNewStep(context, step.stepId, [newStep]);

}

async function getPrompts(userPrompt: string): Promise<mls.msg.IAMessageInputType[]> {

    const info = JSON.parse(userPrompt || '{}');

    const dataForReplace = {
        userPrompt,
        source: await getEntity(info.entity),
    }

    const prompts = await getPromptByHtml({ project, shortName: agentName, folder: '', data: dataForReplace })
    return prompts;
}


async function getEntity(shortName: string) {

    const key = mls.stor.getKeyToFiles(mls.actualProject || 0, 1, lowercaseFirstLetter(shortName), 'layer_1_external/localDB', '.ts');

    if (!mls.stor.files[key]) return '';

    const txt = await mls.stor.files[key].getContent() as string;

    return txt;

}

export function lowercaseFirstLetter(text: string): string {
    if (!text) {
        return text;
    }

    return text.charAt(0).toLowerCase() + text.slice(1);
}

//------TESTE------

/*

{
    "endpoint": "addProduct",
    "description": "Adiciona um novo produto ao sistema",
    "entity": "Product",
    "file": "layer_2_controllers/addProduct"
}

{
    "endpoint": "addUser",
    "description": "Adiciona um novo usuário ao sistema, verificando se a senha tem pelo menos 6 caracteres",
    "entity": "User",
    "file": "layer_2_controllers/addUser"
}


 */
