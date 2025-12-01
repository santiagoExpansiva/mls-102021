/// <mls shortName="local" project="102021" folder="common" enhancement="_blank" groupName="common" />

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