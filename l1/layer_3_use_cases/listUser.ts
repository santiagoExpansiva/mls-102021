/// <mls fileReference="_102021_/l1/layer_3_use_cases/listUser.ts" enhancement="_blank" />

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