# Skill: repositoryPort → `layer_2_application/ports/{entity}Repository.ts`

Generate the repository **PORT** interface for the aggregate. Typed purely in DOMAIN terms (import the
domain types; no rows, no SQL, no `ctx`). Methods do NOT take `ctx` — the adapter is bound to `ctx` at
construction. Provide read/finders + `save(aggregate)`. Use the methods from `data.methods` when
present; otherwise the standard set below.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_2_application/ports/orderRepository.ts" enhancement="_blank"/>
import type { Order, OrderStatus } from '/_{project}_/l1/{module}/layer_3_domain/entities/order.js';

export interface OrderListFilter {
  dailyShiftId?: string;
  status?: OrderStatus;
  tableId?: string;
}

export interface IOrderRepository {
  getById(orderId: string): Promise<Order>;       // throws NOT_FOUND
  findById(orderId: string): Promise<Order | null>;
  list(filter?: OrderListFilter): Promise<Order[]>;
  save(order: Order): Promise<Order>;             // upsert the whole aggregate
}
```

## Rules

- Interface name `I{Entity}Repository`; import the aggregate + needed unions from the domain entity.
- `save` persists the whole aggregate (root + embedded members) — no per-child methods.
- A `{Entity}ListFilter` carries only indexed/queryable fields (PK, FKs, status). No filtering by
  fields that live in `details` JSONB.
- No platform imports, no `ctx`, no SQL types.
