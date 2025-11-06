/// <mls shortName="index" project="102021" folder="layer_1_external" enhancement="_blank" groupName="layer_1_external" />

import { RequestBase, ResponseBase } from "../global.js";
import { createContext } from "./context.js";   
import { exec as execRoutes } from "../layer_2_controllers/routes.js";   

export async function exec(param: RequestBase): Promise<ResponseBase> { 

    const ctx = createContext(param);
    return execRoutes(ctx, param);
    
    
}