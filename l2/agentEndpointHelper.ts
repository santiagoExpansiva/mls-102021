/// <mls shortName="agentEndpointHelper" project="102021" enhancement="_blank" />

import {
    getNextPendentStep,
    updateStepStatus,
} from "./_100554_aiAgentHelper";

import { createStorFile, IReqCreateStorFile } from './_100554_collabLibStor';
import { createModel } from './_100554_collabLibModel'

export async function addFile(context: mls.msg.ExecutionContext, updStatus: boolean = false) {

    if (!context || !context.task) throw new Error('Not found context to create files');
    const step = getNextPendentStep(context.task);

    if (!step || step.type !== 'flexible') throw new Error('Invalid step in create files');

    const content = (step as any).content ? (step as any).content : step.result;

    if (!content || !content.source || content.source.trim() === 'undefined') return;

    const prj = mls.actualProject || 0;

    const info = mls.l2.getPath(`_${prj}_${content.nameFile}`);

    const keys = mls.stor.getKeyToFiles(info.project, 1, info.shortName, info.folder, '.ts');

    if (mls.stor.files[keys]) {

        const m = await createModel(mls.stor.files[keys], false, false);
        if (m) m.model.setValue(content.source);
        
    } else {

        const req: IReqCreateStorFile = {
            shortName: info.shortName,
            project: info.project,
            folder: info.folder,
            level: 1,
            source: content.source,
            extension: '.ts',
            status: 'new',
        }

        await createStorFile(req, true, false, false);


    }

    if (updStatus) context = await updateStepStatus(context, step.stepId, "completed");

}