/// <mls fileReference="_102021_/l1/layer_2_controllers/uppUser.ts" enhancement="_blank" />

import * as layer3 from "../layer_3_use_cases/uppUser.js";
import { UserRecord } from "../layer_4_entities/user.js"; 
import { Ctx } from "../common/local.js";
import { ResponseBase } from "../global.js"; 

export async function uppUser(ctx: Ctx, data: Record<string, any> | undefined): Promise<ResponseBase> {

    const ret: ResponseBase = {
        statusCode: 200,
        ok: true,
        data: undefined,
        error: undefined
    }

    try {

        if (!data) throw new Error('[layer2UpdateUser]:Into the data');
        ret.data = await layer3.uppUser(ctx, data as UserRecord);
        return ret;

    } catch (e: any) {

        ret.ok = false;
        ret.statusCode = 500;
        ret.error = e.message;
        return ret;
    }

}