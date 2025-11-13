/// <mls shortName="context" project="102021" folder="layer_1_external" enhancement="_blank" groupName="layer_1_external" />

import { userLocalDB } from "./localDB/user.js";    
import { Ctx } from "../common/local.js";
import { RequestBase } from "../global.js"; 

export function createContext(param: RequestBase): Ctx { 

    if (!param.inDeveloped) throw new Error('Not implement api production');

    const ctx: Ctx = {

        io: {
            user: userLocalDB
        }
    }

    return ctx;

}