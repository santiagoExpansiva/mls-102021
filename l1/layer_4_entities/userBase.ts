/// <mls shortName="userBase" project="102021" folder="layer_4_entities" enhancement="_blank" groupName="layer_4_entities" />

import { UserRecord, UserIndexRecord } from "./user.js";    

export interface UserBase { 
    upd: (param: UserRecord) => Promise<UserRecord>;
    add: (param: UserRecord) => Promise<UserRecord>;
    del: (id: number) => Promise<boolean>;
    list: () => Promise<UserRecord[]>;
    
}

export interface UserIndexBase { 
    upd: (param: UserIndexRecord) => Promise<UserIndexRecord>;
    add: (param: UserIndexRecord) => Promise<UserIndexRecord>;
    del: (id: number) => Promise<boolean>;
    list: (param:string) => Promise<UserIndexRecord[]>;
    
}