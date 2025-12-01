/// <mls shortName="uppUser" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { AuditRecord } from "../layer_4_entities/audit.js";
import { UserRecord } from "../layer_4_entities/user.js";
import { Ctx } from "../common/local.js";


export async function uppUser(ctx: Ctx, data: UserRecord): Promise<UserRecord> {

    const list = await ctx.io.local.user.list();
    const before = list.find((f) => f.id === data.id);

    const updated = await ctx.io.local.user.upd(data);

    let changes: Record<string, any> = {};

    if (before) {
        const oldDetails:any = before.details || {};
        const newDetails:any = data.details || {};

        for (const key of Object.keys(newDetails)) {
            if (oldDetails[key] !== newDetails[key]) {
                changes[key] = oldDetails[key];
            }
        }
    }

    const description = before
        ? `Updated user ${data.id}.: ${JSON.stringify(changes)}`
        : `Attempt to update user ${data.id}, but there was no previous record.`;


    const audit: AuditRecord = {
        user: "system",
        date: new Date().toISOString(),
        action: "update",
        origin: "User",
        description
    };


    ctx.io.local.audit.add(audit);

    return updated;
}