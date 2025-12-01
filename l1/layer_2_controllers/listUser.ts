/// <mls shortName="listUser" project="102021" folder="layer_2_controllers" enhancement="_blank" groupName="layer_2_controllers" />

import * as layer3 from "../layer_3_use_cases/listUser.js";
import { Ctx } from "../common/local.js";
import { ResponseBase } from "../global.js"; 

export async function listUser(ctx: Ctx, data: Record<string, any> | undefined): Promise<ResponseBase> {

    const ret: ResponseBase = {
        statusCode: 200,
        ok: true,
        data: undefined,
        error: undefined
    }

    try {
    
        if (!data) throw new Error('listUser');
        ret.data = await layer3.listUser(ctx, data.filter || '');
        return ret;

    } catch (e: any) {

        ret.ok = false;
        ret.statusCode = 500;
        ret.error = e.message;
        return ret;
    }

}