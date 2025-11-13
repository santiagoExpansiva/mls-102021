/// <mls shortName="agentEndpointLayer4EntityBase" project="102021" enhancement="_blank" />

import { IAgent, svg_agent } from './_100554_aiAgentBase';
import { getPromptByHtml } from './_100554_aiPrompts';
import {
    getNextInProgressStepByAgentName,
    notifyTaskChange,
    notifyThreadChange,
    updateStepStatus,
} from "./_100554_aiAgentHelper";

import {
    startNewAiTask,
    executeNextStep,
} from "./_100554_aiAgentOrchestration";

import { addFile } from './_102021_agentEndpointHelper'

const agentName = "agentEndpointLayer4EntityBase";
const project = 102021;

export function createAgent(): IAgent {
    return {
        agentName,
        avatar_url: svg_agent,
        agentDescription: "Agent agentEndpointLayer4EntityBase, for create entity base",
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
    let prompt = context.message.content.replace('@@agentEndpointLayer4EntityBase', '').trim();
    const inputs: any = await getPrompts(prompt);
    await startNewAiTask(agentName, taskTitle, context.message.content, context.message.threadId, context.message.senderId, inputs, context, _afterPrompt);
    return;
}

const _afterPrompt = async (context: mls.msg.ExecutionContext): Promise<void> => {
    if (!context || !context.message || !context.task) throw new Error("Invalid context");
    const step: mls.msg.AIAgentStep | null = getNextInProgressStepByAgentName(context.task, agentName);
    if (!step) throw new Error(`[${agentName}] afterPrompt: No in progress interaction found.`);
    context = await updateStepStatus(context, step.stepId, "completed");

    await addFile(context);
    notifyTaskChange(context);
    await executeNextStep(context);
}

async function getPrompts(userPrompt: string): Promise<mls.msg.IAMessageInputType[]> {

    const info = JSON.parse(userPrompt || '{}');

    const dataForReplace = {
        userPrompt,
        source: await getEntityBase(info.entity),
    }

    const prompts = await getPromptByHtml({ project, shortName: agentName, folder: '', data: dataForReplace })
    return prompts;
}



async function getEntityBase(shortName: string) {

    const key = mls.stor.getKeyToFiles(mls.actualProject || 0, 1, lowercaseFirstLetter(shortName), 'layer_4_entities', '.ts');

    if (!mls.stor.files[key]) return '';

    const txt = await mls.stor.files[key].getContent() as string;

    return txt;

}

export function lowercaseFirstLetter(text: string): string {
    if (!text) {
        return text;
    }

    return text.charAt(0).toLowerCase() + text.slice(1) + 'Base';
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