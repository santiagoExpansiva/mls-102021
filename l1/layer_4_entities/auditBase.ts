/// <mls shortName="auditBase" project="102021" folder="layer_4_entities" enhancement="_blank" groupName="layer_4_entities" />

import { AuditRecord } from "./audit.js";    

export interface AuditBase { 
    add: (param: AuditRecord) => Promise<AuditRecord>;
    list: () => Promise<AuditRecord[]>;
}