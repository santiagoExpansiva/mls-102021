/// <mls shortName="user" project="102021" folder="layer_1_external/indexedDB" enhancement="_blank" groupName="layer_1_external/indexedDB" />

import { UserBase } from "../../layer_4_entities/userBase.js";
import { UserRecord } from "../../layer_4_entities/user.js";   
import { STORE_NAME_USER, openDB } from "./indexedDB.js";       

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

    private async saveUserRecord(data: UserRecord): Promise<UserRecord> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME_USER, "readwrite");
        const store = tx.objectStore(STORE_NAME_USER);

        data.version = Date.now().toString();

        return new Promise((resolve, reject) => {
            let request: IDBRequest<IDBValidKey>;

            if (!data.id) {
                request = store.add(data);
            } else {
                request = store.put(data);
            }

            request.onsuccess = (event) => {
                const newId = (event.target as IDBRequest<IDBValidKey>).result;
                if (!data.id) {
                    data.id = newId as any;
                }
            };

            tx.oncomplete = () => resolve(data);
            tx.onerror = () => reject(tx.error);
        });
    }

    private async getAllUserRecord(): Promise<UserRecord[]> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME_USER, "readonly");
        const request = tx.objectStore(STORE_NAME_USER).getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result as UserRecord[]);
            request.onerror = () => reject(request.error);
        });
    }

    private async deleteUserRecord(id: number): Promise<boolean> {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME_USER, "readwrite");
        tx.objectStore(STORE_NAME_USER).delete(id);

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    

}

export const userIndexedDB = new User();