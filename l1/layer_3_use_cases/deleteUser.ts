/// <mls shortName="deleteUser" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { Ctx } from "../common/local.js";

export async function deleteUser(ctx:Ctx, id: number): Promise<boolean | null> {
    
    return await ctx.io.user.del(id);

}