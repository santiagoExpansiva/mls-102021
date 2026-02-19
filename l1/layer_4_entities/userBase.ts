/// <mls fileReference="_102021_/l1/layer_4_entities/userBase.ts" enhancement="_blank" />

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