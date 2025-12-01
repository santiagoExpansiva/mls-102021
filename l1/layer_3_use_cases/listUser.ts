/// <mls shortName="listUser" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { UserRecord } from "../layer_4_entities/user.js";
import { Ctx } from "../common/local.js";

export async function listUser(ctx:Ctx, param:string): Promise<UserRecord[]> {

    const filterRegs = await ctx.io.dynamoDb.user.list(param);
    const regs = await ctx.io.local.user.list();
    const ids:number[] = [];

    filterRegs.forEach((f) => ids.push(f.id));
    const ret = regs.filter((reg) => ids.includes(reg.id || 0));
    console.info(ret);
    return ret;

}