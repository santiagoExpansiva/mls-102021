/// <mls fileReference="_102021_/l1/layer_3_use_cases/listAudit.ts" enhancement="_blank" />

import { AuditRecord } from "../layer_4_entities/audit.js";
import { Ctx } from "../common/local.js";

export async function listAudit(ctx:Ctx): Promise<AuditRecord[]> {

    return await ctx.io.local.audit.list(); 

}