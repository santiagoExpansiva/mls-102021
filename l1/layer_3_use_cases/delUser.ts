/// <mls shortName="delUser" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { Ctx } from "../common/local.js";
import { AuditRecord } from "../layer_4_entities/audit.js";

export async function delUser(ctx: Ctx, id: number): Promise<boolean | null> {


    const result = await ctx.io.local.user.del(id);


    const audit: AuditRecord = {
        user:  "system",
        date: new Date().toISOString(),
        action: "delete",
        origin: "User",
        description: result
            ? `User deleted: ${id}`
            : `Attempt to delete user: ${id}`
    };

    ctx.io.local.audit.add(audit);

    return result;
}