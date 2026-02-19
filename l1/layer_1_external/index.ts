/// <mls fileReference="_102021_/l1/layer_1_external/index.ts" enhancement="_blank" />

import { RequestBase, ResponseBase } from "../global.js";
import { createContext } from "./context.js";   
import { exec as execRoutes } from "../layer_2_controllers/routes.js";   

export async function exec(param: RequestBase): Promise<ResponseBase> { 

    const ctx = createContext(param);
    return execRoutes(ctx, param);
    
    
}

export function teste() {
    console.info('a2');
}