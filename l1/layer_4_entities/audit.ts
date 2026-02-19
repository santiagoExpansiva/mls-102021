/// <mls fileReference="_102021_/l1/layer_4_entities/audit.ts" enhancement="_blank" />

export interface AuditRecord {
    id?:number,
    user: string,
    date: string,
    action: 'add' | 'update' | 'delete',
    origin: string,
    description: string,
}