# Skill: persistence manifest (`l1/<module>/persistence.ts`)

How to author a module's persistence manifest for the collab.codes runtime.
Use this when a module declares a `persistenceModules` entry in `config.json`.

## What it is

Each backend module can declare a **persistence manifest**: a file that lists the
tables/repositories the module owns. The platform persistence registry (in
`mls-102034`) reads these manifests at runtime to:

- bootstrap the PostgreSQL schema (create tables, indexes, hypertables, views),
- resolve DynamoDB table names per environment,
- feed the monitor (Postgres / DynamoDB / Architecture screens).

## Where it lives and how it is wired

- File: `mls-<id>/l1/<moduleId>/persistence.ts` (e.g. `mls-102043/l1/cafeFlow/persistence.ts`).
- It is referenced from the project `config.json`:

```json
"persistenceModules": [
  { "moduleId": "cafeFlow", "persistenceEntrypoint": "./_102043_/l1/cafeFlow/persistence.js" }
]
```

- At runtime the registry does `import(persistenceEntrypoint)` and expects the
  exports below. The `.js` path resolves to the built file under
  `dist/local/_<id>_/...`, so the `.ts` MUST exist and compile.

## Required export (the contract)

The module must export **one** of:

- `export const tableDefinitions: TableDefinition[]` — a static array, or
- `export function getTableDefinitions(): TableDefinition[] | Promise<TableDefinition[]>`.

If neither is exported, the registry throws `PERSISTENCE_MANIFEST_INVALID` (500).

**A module with no tables must still export an empty array:**

```ts
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
export const tableDefinitions: TableDefinition[] = [];
```

> Failure mode to avoid: if `config.json` lists a `persistenceModules` entry but
> the `persistence.ts` file is missing, the runtime fails with
> `Cannot find module '.../persistence.js'` and the monitor data screens return 500.
> Either create the manifest (even empty) or remove the entry from `config.json`.

## `TableDefinition` fields

Type: `/_102034_/l1/server/layer_1_external/persistence/contracts.js`.

| Field | Type | Notes |
|-------|------|-------|
| `moduleId` | string | the owning module (e.g. `cafeFlow`) |
| `tableName` | string | physical table name (snake_case) |
| `repositoryName?` | string | logical name; defaults to `tableName` |
| `tableNameByEnv?` | partial record of env → name | per-env override (development/staging/production) |
| `purpose` | `mdm` \| `cadastro` \| `transacao` \| `controle` \| `fila` \| `cache` | classification |
| `description` | string | shown in the monitor |
| `backupHot` | boolean | hot backup to Dynamo |
| `storageProfile` | `postgres` \| `postgresHotBackup` \| `dynamoOnly` \| `dynamoWithPostgresIndex` | where it lives |
| `writeMode` | `sync` \| `writeBehind` | write strategy |
| `columns` | `TableColumnDefinition[]` | see below |
| `primaryKey` | string[] | column names |
| `indexes?` | `TableIndexDefinition[]` | name + columns (+ `unique`) |
| `postgres?` | `{ unlogged?: boolean }` | Postgres-specific options |
| `timescale?` | `{ hypertable: { timeColumn, chunkTimeInterval? } }` | TimescaleDB hypertable |
| `dynamo?` | `DynamoTableConfig` | required when using Dynamo |
| `retentionDays?` | number | retention window |
| `version` | number | bump when the shape changes |

`TableColumnDefinition`: `{ name, postgresType, nullable?, defaultSql?, description? }`.

`DynamoTableConfig`: `{ tableName? | tableNameByEnv?, partitionKey, sortKey?, ttlField? }`.

## Example

```ts
/// <mls fileReference="_102043_/l1/cafeFlow/persistence.ts" enhancement="_blank" />
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const tableDefinitions: TableDefinition[] = [
  {
    moduleId: 'cafeFlow',
    repositoryName: 'orders',
    tableName: 'cafe_flow_orders',
    purpose: 'transacao',
    description: 'Cafe Flow point-of-sale orders.',
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns: [
      { name: 'id', postgresType: 'TEXT' },
      { name: 'total', postgresType: 'NUMERIC(12,2)' },
      { name: 'created_at', postgresType: 'TIMESTAMPTZ', defaultSql: 'NOW()' },
    ],
    primaryKey: ['id'],
    indexes: [
      { name: 'idx_cafe_flow_orders_created_at', columns: ['created_at'] },
    ],
    version: 1,
  },
];
```

## Rules / checklist

- Always export `tableDefinitions` (or `getTableDefinitions`), even if empty.
- `moduleId` must match the module; `tableName` snake_case and unique per database.
- Provide a `dynamo` block whenever `storageProfile` uses Dynamo.
- Keep the import as a `import type` (no runtime dependency on the platform).
- All code comments in English.
- Bump `version` when columns/keys change.
