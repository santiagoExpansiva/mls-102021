/// <mls shortName="deleteUser" project="102021" folder="layer_2_controllers" enhancement="_blank" groupName="layer_2_controllers" />

import * as layer3 from "../layer_3_use_cases/deleteUser.js";
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
        ret.data = await layer3.deleteUser(ctx, data.id);
        return ret;

    } catch (e: any) {
        
        ret.statusCode = 500;
        ret.ok = false;
        ret.error = e.message;
        return ret;
    }

}