/// <mls fileReference="_102021_/l1/layer_2_controllers/routes.ts" enhancement="_blank" />

import { RequestBase, ResponseBase } from "../global.js";
import { Ctx } from "../common/local.js"; 
import { addUser } from "./addUser.js";
import { uppUser } from "./uppUser.js"; 
import { delUser } from "./delUser.js"; 
import { listUser } from "./listUser.js"; 
import { listAudit } from "./listAudit.js"; 

export async function exec(ctx:Ctx ,param: RequestBase): Promise<ResponseBase> { 

    if (!param || !param.action) {
        return {
            statusCode: 400,
            ok: false,
            error: "Uninformed action"
        } 
    }

    const args = param.params || undefined; 

    console.info('executou server: 7' + param.action)

    switch (param.action) { 

        case ('addUser'): return await addUser(ctx, args);
        case ('uppUser'): return await uppUser(ctx, args);
        case ('delUser'): return await delUser(ctx, args);
        case ('listUser'): return await listUser(ctx, args);
        case ('listAudit'): return await listAudit(ctx, args);

        default: return {
            statusCode: 400,
            ok: false,
            error: "Uninformed action"
        }
    }

}