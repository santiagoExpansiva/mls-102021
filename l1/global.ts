/// <mls shortName="global" project="102021" folder="" enhancement="_blank" groupName="" />

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

type ActionTypes = 'UserAdd' | 'UserUpd' |  'UserDelById' | 'UserGetList';

//----------REQUEST--------------

export interface RequestUserAdd extends RequestBase {
  action: 'UserAdd',
  params: UserRecord
}

export interface RequestUserUpd extends RequestBase {
  action: 'UserUpd',
  params: UserRecord
}

export interface RequestUserDelById extends RequestBase {
  action: 'UserDelById',
  params: { id: number }
}

export interface RequestUserGetList extends RequestBase {
  action: 'UserGetList',
  params: { filter: string }
}