/// <mls shortName="listAudit" project="102021" folder="layer_3_use_cases" enhancement="_blank" groupName="layer_3_use_cases" />

import { AuditRecord } from "../layer_4_entities/audit.js";
import { Ctx } from "../common/local.js";

export async function listAudit(ctx:Ctx): Promise<AuditRecord[]> {

    return await ctx.io.local.audit.list(); 

}