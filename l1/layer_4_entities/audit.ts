/// <mls shortName="audit" project="102021" folder="layer_4_entities" enhancement="_blank" groupName="layer_4_entities" />

export interface AuditRecord {
    id?:number,
    user: string,
    date: string,
    action: 'add' | 'update' | 'delete',
    origin: string,
    description: string,
}