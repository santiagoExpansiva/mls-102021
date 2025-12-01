/// <mls shortName="user" project="102021" folder="layer_1_external/dynamoDB" enhancement="_blank" groupName="layer_1_external/dynamoDB" />

import { UserIndexRecord } from "../../layer_4_entities/user.js";       

class User  {

    //-----------METHODS-----------

    public async upd(param: UserIndexRecord): Promise<UserIndexRecord> { 
        return await this.saveUserIndexRecord(param);
    }

    public async add(param: UserIndexRecord): Promise<UserIndexRecord> {
        return await this.saveUserIndexRecord(param);
    }

    public async del(id: number): Promise<boolean> {
        return await this.deleteUserIndexRecord(id);
    }

    public async list(param:string): Promise<UserIndexRecord[]> {
        return await this.getAllUserIndexRecord(param);
    }

    //-----------IMPLEMENTS------------

    private getTable():UserIndexRecord[] {
        return (window as any).table && (window as any).table.usersDynamo ? (window as any).table.usersDynamo : [];
    }

    private setTable(array:UserIndexRecord[]) {
        if ((window as any).table) (window as any).table.usersDynamo = array;
        else (window as any).table = {usersDynamo: array}
    }

    private async saveUserIndexRecord(data: UserIndexRecord): Promise<UserIndexRecord> {

        const store = this.getTable();

        return new Promise((resolve, reject) => {

            if (!data.id) {
                data.id = this.getNextId(store);
                store.push(data);
            }
            else {
                const index = store.findIndex((i: UserIndexRecord) => i.id === data.id);
                if (store[index]) store[index] = data;
                else store.push(data);
            }

            this.setTable(store);
            resolve(data);
        });
    }

    private async getAllUserIndexRecord(param:string): Promise<UserIndexRecord[]> {

        const store = this.getTable();
        const ret: UserIndexRecord[] = [];

        store.forEach((s) => {
            if (s.fullText.toLocaleLowerCase().indexOf(param.toLocaleLowerCase()) >= 0) ret.push(s);
        })

        return new Promise((resolve, reject) => { resolve(ret as UserIndexRecord[]); });
    }

    private async deleteUserIndexRecord(id: number): Promise<boolean> {
        const store = this.getTable();

        const index = store.findIndex((i: UserIndexRecord) => i.id === id);

        if (store[index]) store.splice(index, 1);
        
        this.setTable(store);
        return new Promise((resolve, reject) => { resolve(true); });
    }

    private getNextId(arr:UserIndexRecord[]) {
        if (!arr || arr.length === 0) return 1; // se o array estiver vazio, começa do 1

        const lastId = Math.max(...arr.map(item => item.id || 0));
        return lastId + 1;
    }

}

export const userDynamoDB = new User();