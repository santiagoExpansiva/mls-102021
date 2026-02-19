/// <mls fileReference="_102021_/l1/layer_4_entities/user.ts" enhancement="_blank" />

export interface UserRecord {
  id?: number,
  details: UserDetails,
  version?: string
}

export interface UserDetails {
  name: string,
  password: string,
  cpf:string,
}

export interface UserIndexRecord{
  fullText: string,
  id: number,
}