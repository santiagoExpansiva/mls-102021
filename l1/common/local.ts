/// <mls fileReference="_102021_/l1/common/local.ts" enhancement="_blank" />

import { UserBase , UserIndexBase} from "../layer_4_entities/userBase.js"; 
import { AuditBase } from "../layer_4_entities/auditBase.js"; 

export interface Ctx {

    io: {
        local: {
            user: UserBase,
            audit: AuditBase
        },
        dynamoDb: {
            user:UserIndexBase
        }
    }

} 