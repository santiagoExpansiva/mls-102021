/// <mls fileReference="_102021_/l1/layer_1_external/localDB/audit.ts" enhancement="_blank" />

import { AuditBase } from "../../layer_4_entities/auditBase.js";
import { AuditRecord } from "../../layer_4_entities/audit.js";

class Audit implements AuditBase {

    //-----------METHODS-----------

    public async add(param: AuditRecord): Promise<AuditRecord> {
        return await this.saveAuditRecord(param);
    }

    public async list(): Promise<AuditRecord[]> {
        return await this.getAllAuditRecord();
    }

    //-----------IMPLEMENTS------------

    private getTable(): AuditRecord[] {
        return (window as any).table && (window as any).table.audit ? (window as any).table.audit : [];
    }

    private setTable(array: AuditRecord[]) {
        if ((window as any).table) (window as any).table.audit = array;
        else (window as any).table = { audit: array }
    }

    private async saveAuditRecord(data: AuditRecord): Promise<AuditRecord> {

        const store = this.getTable();

        data.id = this.getNextId(store);

        return new Promise((resolve, reject) => {
            store.push(data);
            this.setTable(store);
            resolve(data);
        });
    }

    private async getAllAuditRecord(): Promise<AuditRecord[]> {

        const store = this.getTable();

        return new Promise((resolve, reject) => { resolve(store as AuditRecord[]); });
    }

    private getNextId(arr:AuditRecord[]) {
        if (!arr || arr.length === 0) return 1; // se o array estiver vazio, começa do 1

        const lastId = Math.max(...arr.map(item => item.id || 0));
        return lastId + 1;
    }


}

export const auditLocalDB = new Audit();