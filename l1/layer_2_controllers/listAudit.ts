/// <mls shortName="listAudit" project="102021" folder="layer_2_controllers" enhancement="_blank" groupName="layer_2_controllers" />

import * as layer3 from "../layer_3_use_cases/listAudit.js";
import { Ctx } from "../common/local.js";
import { ResponseBase } from "../global.js"; 

export async function listAudit(ctx: Ctx, data: Record<string, any> | undefined): Promise<ResponseBase> {

    const ret: ResponseBase = {
        statusCode: 200,
        ok: true,
        data: undefined,
        error: undefined
    }

    try {

        ret.data = await layer3.listAudit(ctx);
        return ret;

    } catch (e: any) {

        ret.ok = false;
        ret.statusCode = 500;
        ret.error = e.message;
        return ret;
    }

}