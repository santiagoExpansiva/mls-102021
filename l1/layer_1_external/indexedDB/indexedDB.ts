/// <mls shortName="indexedDB" project="102021" folder="layer_1_external/indexedDB" enhancement="_blank" groupName="layer_1_external/indexedDB" />

export const DB_NAME = "exampleDatabase";
export const VERSION = 1;
export const STORE_NAME_USER = "User_data";

export async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {

        const request = indexedDB.open(DB_NAME, VERSION);

        request.onupgradeneeded = (event) => {
            migrationUser(event, request);
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function migrationUser(event: IDBVersionChangeEvent, request: IDBOpenDBRequest) {

    const oldVersion = event.oldVersion;
    const newVersion = event.newVersion;
    const db = request.result;

    let store: IDBObjectStore;

    if (!db.objectStoreNames.contains(STORE_NAME_USER)) {
        store = db.createObjectStore(STORE_NAME_USER, { keyPath: "id", autoIncrement: true });
    } else {
        store = request.transaction!.objectStore(STORE_NAME_USER);
    }

    if (oldVersion != 1) {
        // exemplo: corrigir estrutura ou adicionar campos novos nos registros existentes

    }

}