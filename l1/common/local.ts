/// <mls shortName="local" project="102021" folder="common" enhancement="_blank" groupName="common" />

import { UserBase } from "../layer_4_entities/userBase.js"; 

export interface Ctx {

    io: {
        user: UserBase
    }

} 