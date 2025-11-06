/// <mls shortName="addUser" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { UserRecord } from "../layer_4_entities/user.js";
import { Ctx } from "../common/local.js"; 

export async function addUser(ctx:Ctx, data: UserRecord): Promise<UserRecord> {

    return await ctx.io.user.add(data);

}