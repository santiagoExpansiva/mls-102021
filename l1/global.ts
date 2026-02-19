/// <mls fileReference="_102021_/l1/global.ts" enhancement="_blank" />

import { UserRecord } from "./layer_4_entities/user.js";

//--------------MODEL BASE---------------

export * from "./layer_4_entities/user.js";


//-------------REQUEST BASE--------------
export interface RequestBase{
    action: ActionTypes,
    params?: Record<string, any>,
    version: string,
    inDeveloped: boolean,
    
}

export interface ResponseBase{
    statusCode: number,
    ok: boolean,
    data?: any,
    error?:string
}

type ActionTypes = 'addUser' | 'uppUser' |  'delUser' | 'listUser' | 'listAudit';

//----------REQUEST--------------

export interface RequestUserAdd extends RequestBase {
  action: 'addUser',
  params: UserRecord
}

export interface RequestUserUpd extends RequestBase {
  action: 'uppUser',
  params: UserRecord
}

export interface RequestUserDelById extends RequestBase {
  action: 'delUser',
  params: { id: number }
}

export interface RequestUserGetList extends RequestBase {
  action: 'listUser',
  params: { filter: string }
}

export interface RequestAuditList extends RequestBase {
  action: 'listAudit',
  params:  { filter: string }
}