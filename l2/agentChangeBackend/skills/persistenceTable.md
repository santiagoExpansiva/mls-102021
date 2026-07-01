# Skill: persistenceTable → `layer_1_external/adapters/persistence/{table}.ts`

Generate the `TableDefinition` for an aggregate root (or `event` entity) from the table `.defs.ts`.
JSONB-first: real columns ONLY for indexed fields (PK, queried FKs, status/lifecycle, ordering
timestamp); EVERYTHING else + the embedded child collections go into one `details` JSONB column. Use
`data.indexedColumns`/`data.detailsFields`/`data.childCollections` when present. MDM/horizontal
entities produce NO table.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_1_external/adapters/persistence/order.ts" enhancement="_blank"/>
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export const orderTableDef: TableDefinition = {
  moduleId: '{module}',
  repositoryName: '{module}Order',
  tableName: 'orders',
  purpose: 'transacao',
  description: 'Pedidos. Itens e campos não indexados em details (JSONB).',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'order_id', postgresType: 'UUID' },
    { name: 'daily_shift_id', postgresType: 'UUID' },
    { name: 'table_id', postgresType: 'UUID', nullable: true },
    { name: 'kitchen_ticket_id', postgresType: 'UUID', nullable: true },
    { name: 'order_type', postgresType: 'TEXT' },
    { name: 'status', postgresType: 'TEXT' },
    { name: 'created_at', postgresType: 'TIMESTAMPTZ', defaultSql: 'NOW()' },
    { name: 'details', postgresType: 'JSONB', nullable: true },
  ],
  primaryKey: ['order_id'],
  indexes: [
    { name: 'idx_orders_daily_shift_id', columns: ['daily_shift_id'] },
    { name: 'idx_orders_status', columns: ['status'] },
    { name: 'idx_orders_table_id', columns: ['table_id'] },
    { name: 'idx_orders_created_at', columns: ['created_at'] },
  ],
  version: 1,
};
```

## Rules

- `tableName` and column `name` are snake_case; export const is `{tableId}TableDef`.
- `purpose`: `transacao` (aggregate) | `controle` (metric) | `cadastro`. `storageProfile: 'postgres'`,
  `writeMode: 'sync'`, `backupHot: false` unless the defs says otherwise.
- ALWAYS include a `details` column `{ name: 'details', postgresType: 'JSONB', nullable: true }` when
  the aggregate has non-indexed fields or embedded collections.
- One index per queryable column (FKs, status, ordering timestamp). `version: 1` for new tables.
- `event` entities (`data.appendOnly === true`): append-only table. Set `purpose: 'controle'`, index the
  owner FK and the ordering timestamp, and when `data.retentionDays` is present add `retentionDays: <n>`
  to the `TableDefinition` (the platform applies the TTL); omit it for a permanent audit trail. Same
  JSONB rule — non-indexed fields go to `details`. MDM: emit NOTHING.
