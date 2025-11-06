/// <mls shortName="routes" project="102021" folder="layer_2_controllers" enhancement="_blank" groupName="layer_2_controllers" />

import { RequestBase, ResponseBase } from "../global.js";
import { Ctx } from "../common/local.js"; 
import { addUser } from "./addUser.js";
import { updateUser } from "./updateUser.js"; 
import { delUser } from "./deleteUser.js"; 
import { getListUser } from "./getListUser.js"; 

export async function exec(ctx:Ctx ,param: RequestBase): Promise<ResponseBase> { 

    if (!param || !param.action) {
        return {
            statusCode: 400,
            ok: false,
            error: "Uninformed action"
        } 
    }

    const args = param.params || undefined; 

    console.info('executou server:' + param.action)

    switch (param.action) { 

        case ('UserAdd'): return await addUser(ctx, args);
        case ('UserUpd'): return await updateUser(ctx, args);
        case ('UserDelById'): return await delUser(ctx, args);
        case ('UserGetList'): return await getListUser(ctx, args);

        default: return {
            statusCode: 400,
            ok: false,
            error: "Uninformed action"
        }
    }

}