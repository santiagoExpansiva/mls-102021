/// <mls shortName="aiIntegrationHub" project="102021" enhancement="_blank" />

import { createThread, addMessage, getUserId} from "/_102025_/l2/collabMessagesHelper.js";
import { getThreadByName } from '/_102025_/l2/collabMessagesIndexedDB.js';

export async function addOrUpdateEndPoint(action: string, intent: string, interfaceRequest: string, interfaceResponse: string, mock: string | undefined) {

    let thread = await getThreadByName('agentEndPoint');
    if (!thread) {
        thread = await createThread('agentEndPoint', [], 'company');
    }

    if (!thread) throw new Error('[aiIntegrationHub]: Not found thread');

    const prompt = JSON.stringify({
        name: action,
        intent: intent,
        responseInterfaces: interfaceRequest,
        requestInterfaces: interfaceResponse,

    });


    const context = await addMessage(thread.threadId, `@@agentEndpoint ${prompt}`);
    await pollRec(context); 
    return context;

}

async function pollRec(ctx: mls.msg.ExecutionContext | undefined): Promise<void> {

    if (!ctx || !ctx.task) throw new Error('[aiIntegrationHub]:Not found context');

    let task = ctx.task;//await getTaskIO(ctx);

    if (!task) throw new Error('[aiIntegrationHub]:Not found task');

    if (task.status === 'failed' || task.status === 'done') {
        if (task.status === 'failed') throw new Error('Erro in task');
        return;
    } else {
        await sleep(500);
        return pollRec(ctx);
    }
}

async function getTaskIO(ctx: mls.msg.ExecutionContext) {

    if (!ctx || !ctx.task) throw new Error('[aiIntegrationHub-getTaskNew]:Not found context');

    const userId = getUserId();

    if (!userId) throw new Error('[aiIntegrationHub-getTaskNew]:Not found userId');

    const taskData = await mls.api.msgGetTaskUpdate(
        {
            taskId: ctx.task.PK,
            messageId: `${ctx.task.messageid_created}`,
            userId: userId
        }
    );

    return taskData ? taskData.task : undefined;
} 

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}