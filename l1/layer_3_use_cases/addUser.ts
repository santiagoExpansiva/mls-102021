/// <mls fileReference="_102021_/l1/layer_3_use_cases/addUser.ts" enhancement="_blank" />

import { UserRecord } from "../layer_4_entities/user.js";
import { AuditRecord } from "../layer_4_entities/audit.js"; 
import { Ctx } from "../common/local.js"; 

export async function addUser(ctx:Ctx, data: UserRecord): Promise<UserRecord> {

    const reg =  await ctx.io.local.user.add(data);

    const regIndex = await ctx.io.dynamoDb.user.add({id:reg.id as number, fullText: `${reg.details.name}|${reg.details.cpf}` })
    
    const audit: AuditRecord = {
        user:  "system",  
        date: new Date().toISOString(),
        action: "add",
        origin: "User",
        description: `User create: ${reg.id }`
    };

    // 3. Salva o registro de auditoria
    ctx.io.local.audit.add(audit);

    return reg;

}