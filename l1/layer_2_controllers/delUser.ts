/// <mls fileReference="_102021_/l1/layer_2_controllers/delUser.ts" enhancement="_blank" />

import * as layer3 from "../layer_3_use_cases/delUser.js";
import { Ctx } from "../common/local.js";
import { ResponseBase } from "../global.js"; 

export async function delUser(ctx: Ctx, data: Record<string, any> | undefined): Promise<ResponseBase> {

    const ret: ResponseBase = {
        statusCode: 200,
        ok: true,
        data: undefined,
        error: undefined
    }

    try {

        if (!data || !data.id) throw new Error('[layer2DeleteUser]:Into in id');
        ret.data = await layer3.delUser(ctx, data.id);
        return ret;

    } catch (e: any) {
        
        ret.statusCode = 500;
        ret.ok = false;
        ret.error = e.message;
        return ret;
    }

}