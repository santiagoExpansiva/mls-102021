# Hexagonal backend — architecture (base skill, read first)

Generate ONE TypeScript file for a client module under `l1/{module}` following the **hexagonal
(ports & adapters)** model. The `.defs.ts` you receive is the single source of truth for WHAT to
generate; this skill is HOW. Output only the `.ts` for the given `outputPath`, starting with the
`/// <mls fileReference="..." enhancement="_blank"/>` header.

## Layers and dependency direction (inward only)

```
layer_1_external/adapters/   http (controllers=BFF), persistence (TableDefinition + repository adapters), queues/webhooks/cron/plugins
layer_2_application/         usecases, ports (interfaces), services, dto, commands, queries
layer_3_domain/             entities, value-objects, domain-services, rules, events  (PURE)
```

- `layer_3_domain` imports NOTHING external (no platform, no `ctx`, no SQL).
- `layer_2_application` imports the domain and defines **ports**; usecases resolve concrete
  repositories from the platform registry (never import an adapter).
- `layer_1_external` (adapters) imports application + domain. **`ctx.data` is allowed ONLY inside
  `adapters/persistence`.** HTTP controllers never touch `ctx.data` or persistence.

## Platform runtime contracts (project 102034 — the only allowed platform imports)

```ts
import { ok, AppError, type BffHandler, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { registerRepository, resolveRepository } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
// RequestContext: { data: IDataRuntime; log; clock: { nowIso() }; idGenerator: { newId() }; requestMeta? }
// ctx.data.moduleData.getTable<TRow>(name): Promise<ITableRepository<TRow>>
//   ITableRepository: findOne({where}), findMany({where?, orderBy?:{field,direction}, limit?}),
//                     findManyByValues({field,values,limit?}), insert({record}), update({where,patch}), delete({where})
// ctx.data.runInTransaction(async (tx) => { ... })  // tx is an IDataRuntime
// MDM (read-only): ctx.data.mdmEntityIndex, ctx.data.mdmDocument  (master data lives in 102034)
```

## Port ↔ adapter wiring (dependency inversion)

- The usecase depends on the port interface `I{Entity}Repository` and gets the concrete adapter with
  `resolveRepository<I{Entity}Repository>(ctx, '{Entity}')`. It NEVER imports the adapter.
- The adapter is a factory `create{Entity}RepositoryAdapter(ctx): I{Entity}Repository` (methods close
  over `ctx`). The composition root (`adapters/persistence/repositories.ts`) registers it with
  `registerRepository('{Entity}', create{Entity}RepositoryAdapter)`.

## Hard rules

- **Naming is deterministic from the ontology `entityId`/`operationId`** (PascalCase entity, camelCase
  ids). NEVER translate to the PT title (no `pedidoEntity` for `Order`).
- **`ctx.data` ONLY in `adapters/persistence`.** Domain and application must not reference it.
- **MDM/horizontal entities have NO local table.** Read MDM via the shared 102034 runtime.
- **JSONB-first persistence**: only indexed fields are real columns; everything else + child
  collections go in a single `details` JSONB column (the adapter serializes/parses it).
- Ids via `ctx.idGenerator.newId()`; timestamps via `ctx.clock.nowIso()`.
- `AppError(code, message, httpStatus, details?)`: `VALIDATION_ERROR` 400, `NOT_FOUND` 404,
  `CONFLICT` 409. Generate only what the `.defs.ts` declares.
