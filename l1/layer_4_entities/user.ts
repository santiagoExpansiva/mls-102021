/// <mls shortName="user" project="102021" folder="layer_4_entities" enhancement="_blank" groupName="layer_4_entities" />

export interface UserRecord {
  id?: number,
  details: UserDetails,
  version?: string
}

export interface UserDetails { 
    name: string,
    password: string
}