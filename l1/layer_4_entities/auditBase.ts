/// <mls fileReference="_102021_/l1/layer_4_entities/auditBase.ts" enhancement="_blank" />

import { AuditRecord } from "./audit.js";    

export interface AuditBase { 
    add: (param: AuditRecord) => Promise<AuditRecord>;
    list: () => Promise<AuditRecord[]>;
}