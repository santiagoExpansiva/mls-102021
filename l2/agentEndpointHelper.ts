/// <mls fileReference="_102021_/l2/agentEndpointHelper.ts" enhancement="_blank" />

import {
    getNextPendentStep,
    updateStepStatus,
} from "/_100554_/l2/aiAgentHelper.js";

import { createStorFile, IReqCreateStorFile } from '/_102027_/l2/libStor.js';
import { createModel } from '/_102027_/l2/libModel.js'
import { getPath } from '/_102027_/l2/utils.js'

export async function addFile(context: mls.msg.ExecutionContext, updStatus: boolean = false) {

    if (!context || !context.task) throw new Error('Not found context to create files');
    const step = getNextPendentStep(context.task);

    if (!step || step.type !== 'flexible') throw new Error('Invalid step in create files');

    const content = (step as any).content ? (step as any).content : step.result;

    if (!content || !content.source || content.source.trim() === 'undefined') return;

    const prj = mls.actualProject || 0;

    const info = getPath(`_${prj}_${content.nameFile}`);
    if (!info) throw new Error('[]Not found path:' + `_${prj}_${content.nameFile}`);

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