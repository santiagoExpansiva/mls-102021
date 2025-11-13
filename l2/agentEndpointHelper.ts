/// <mls shortName="agentEndpointHelper" project="102021" enhancement="_blank" />

import {
    getNextPendentStep,
    updateStepStatus,
} from "./_100554_aiAgentHelper";

export async function addFile(context: mls.msg.ExecutionContext) {

    if (!context || !context.task) throw new Error('Not found context to create files');
    const step = getNextPendentStep(context.task);

    if (!step || step.type !== 'flexible') throw new Error('Invalid step in create files');

    const content = (step as any).content ? (step as any).content : step.result;

    if (!content || !content.source || content.source.trim() === 'undefined') return;

    const prj = mls.actualProject || 0;

    const info = mls.l2.getPath(`_${prj}_${content.nameFile}`);

    console.info('----------------------------------------------');
    console.info(content.source);
    console.info('----------------------------------------------');

    const keys = mls.stor.getKeyToFiles(info.project, 1, info.shortName, info.folder, '.ts');
    if (mls.stor.files[keys]) {
        console.info('atualizar');
    } else {
        console.info('criar')
    }

    context = await updateStepStatus(context, step.stepId, "completed");


}