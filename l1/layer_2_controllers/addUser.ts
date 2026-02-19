/// <mls fileReference="_102021_/l1/layer_2_controllers/addUser.ts" enhancement="_blank" />

import * as layer3 from "../layer_3_use_cases/addUser.js";
import { UserRecord } from "../layer_4_entities/user.js";
import { Ctx } from "../common/local.js";
import { ResponseBase } from "../global.js"; 

export async function addUser(ctx: Ctx, data: Record<string, any> | undefined): Promise<ResponseBase> {

    const ret: ResponseBase = {
        statusCode: 200,
        ok: true,
        data: undefined,
        error: undefined
    }

    try {

        if (!data) throw new Error('[layer2AddUser]:Into the data');
        ret.data = await layer3.addUser(ctx, data as UserRecord);
        return ret;

    } catch (e: any) {
        
        ret.statusCode = 400;
        ret.ok = false;
        ret.error = e.message;
        return ret;
    }

}