/// <mls shortName="userBase" project="102021" folder="layer_4_entities" enhancement="_blank" groupName="layer_4_entities" />

import { UserRecord } from "./user.js";    

export interface UserBase { 
    upd: (param: UserRecord) => Promise<UserRecord>;
    add: (param: UserRecord) => Promise<UserRecord>;
    del: (id: number) => Promise<boolean>;
    list: () => Promise<UserRecord[]>;
    
}