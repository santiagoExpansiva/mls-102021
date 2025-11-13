/// <mls shortName="user" project="102021" folder="layer_1_external/localDB" enhancement="_blank" groupName="layer_1_external/localDB" />

import { UserBase } from "../../layer_4_entities/userBase.js";
import { UserRecord } from "../../layer_4_entities/user.js";       

class User implements UserBase {

    //-----------METHODS-----------

    public async upd(param: UserRecord): Promise<UserRecord> { 
        return await this.saveUserRecord(param);
    }

    public async add(param: UserRecord): Promise<UserRecord> {
        return await this.saveUserRecord(param);
    }

    public async del(id: number): Promise<boolean> {
        return await this.deleteUserRecord(id);
    }

    public async list(): Promise<UserRecord[]> {
        return await this.getAllUserRecord();
    }

    //-----------IMPLEMENTS------------

    private getTable():UserRecord[] {
        return (window as any).table && (window as any).table.users ? (window as any).table.users : [];
    }

    private setTable(array:UserRecord[]) {
        if ((window as any).table) (window as any).table.users = array;
        else (window as any).table = {users: array}
    }

    private async saveUserRecord(data: UserRecord): Promise<UserRecord> {

        const store = this.getTable();

        data.version = Date.now().toString();

        return new Promise((resolve, reject) => {

            if (!data.id) { store.push(data); }
            else {
                const index = store.findIndex((i: UserRecord) => i.id === data.id);
                if (store[index]) store[index] = data;
            }

            this.setTable(store);
            resolve(data);
        });
    }

    private async getAllUserRecord(): Promise<UserRecord[]> {

        const store = this.getTable();

        return new Promise((resolve, reject) => { resolve(store as UserRecord[]); });
    }

    private async deleteUserRecord(id: number): Promise<boolean> {
        const store = this.getTable();

        const index = store.findIndex((i: UserRecord) => i.id === id);

        if (store[index]) store.splice(index, 1);
        
        this.setTable(store);
        return new Promise((resolve, reject) => { resolve(true); });
    }

    

}

export const userLocalDB = new User();