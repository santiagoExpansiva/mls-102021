# Skill: applicationUsecase → `layer_2_application/usecases/{usecase}.ts`

Generate the usecase: it decides WHAT happens (validations, state transitions, orchestration). It
imports the DOMAIN and the repository PORT type, resolves the concrete adapter via
`resolveRepository`, applies the rules, and NEVER touches `ctx.data` (except the single
`ctx.data.runInTransaction` wrapper for multi-aggregate writes). Export the function + its Input/Output
types (the controller imports these). Use `data.functionName`, `data.ports`, `data.rulesApplied`,
`data.steps` from the defs.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_2_application/usecases/createOrder.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { resolveRepository } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';
import type { IOrderRepository } from '/_{project}_/l1/{module}/layer_2_application/ports/orderRepository.js';
import type { Order, OrderItem, OrderType } from '/_{project}_/l1/{module}/layer_3_domain/entities/order.js';
import { orderRequiresItem, recomputeOrderTotal } from '/_{project}_/l1/{module}/layer_3_domain/entities/order.js';

export interface CreateOrderItemInput { menuItemId: string; quantity: number; unitPrice: number; observations?: string; }
export interface CreateOrderInput { dailyShiftId: string; orderType: OrderType; tableId?: string; customerName?: string; items: CreateOrderItemInput[]; }
export interface CreateOrderOutput { order: Order; }

export async function createOrder(ctx: RequestContext, input: CreateOrderInput): Promise<CreateOrderOutput> {
  const orders = resolveRepository<IOrderRepository>(ctx, 'Order');
  const now = ctx.clock.nowIso();

  const items: OrderItem[] = (input.items ?? []).map((it) => ({
    id: ctx.idGenerator.newId(), menuItemId: it.menuItemId, kitchenTicketId: null,
    quantity: it.quantity, unitPrice: it.unitPrice, totalPrice: it.unitPrice * it.quantity,
    observations: it.observations ?? null, status: 'new', createdAt: now, updatedAt: now,
  }));

  const order: Order = {
    orderId: ctx.idGenerator.newId(), dailyShiftId: input.dailyShiftId, tableId: input.tableId ?? null,
    kitchenTicketId: null, orderType: input.orderType, status: 'draft', totalAmount: recomputeOrderTotal(items),
    notes: null, customerName: input.customerName ?? null, customerPhone: null, numberOfGuests: null,
    closedAt: null, cancelledAt: null, cancellationReason: null, items, createdAt: now, updatedAt: now,
  };

  if (!orderRequiresItem(order)) {
    throw new AppError('VALIDATION_ERROR', 'orderRequiresItem: o pedido precisa de ao menos um item.', 400, { ruleId: 'orderRequiresItem' });
  }

  const saved = await orders.save(order);
  return { order: saved };
}
```

## Rules

- Generate ONE exported `async function` per entry in `data.functions` (a usecase may export SEVERAL),
  signature `(ctx: RequestContext, input: {inputTypeName}): Promise<{outputTypeName}>`.
- Build the `{inputTypeName}` / `{outputTypeName}` interfaces from the function's EXPLICIT
  `data.functions[].input[]` / `output[]` fields (name + type, `?` when `required:false`) — do NOT
  invent fields. Export both interfaces (the controller imports them).
- Resolve every repository with `resolveRepository<I{Entity}Repository>(ctx, '{Entity}')`. NEVER import
  an adapter. Import record/union types and invariants from the domain entity.
- Apply `rulesApplied`: validate via domain invariants; throw `AppError('VALIDATION_ERROR'|'CONFLICT', …)`.
- Lifecycle: read current state, check the domain transition (e.g. `canTransition*`), then `save`.
- Multi-aggregate writes go inside one `ctx.data.runInTransaction(async (tx) => { ... })` — this is the
  ONLY `ctx.data` allowed here; pass `tx` only to repository calls if the adapter supports it.
- Ids via `ctx.idGenerator.newId()`, timestamps via `ctx.clock.nowIso()`.

## Child-entity operations (embedded members)

An operation may target a CHILD entity that is embedded in a parent aggregate (it lives in the parent's
collection, stored in `details` JSONB — e.g. `OrderItem` inside `Order`). There is **no child
repository**. The defs gives you the parent in `data.ports` / `data.functions[].ports`. Pattern:

1. resolve the PARENT port (`resolveRepository<I{Parent}Repository>(ctx, '{Parent}')`);
2. load the parent aggregate (the input carries the parent id, e.g. `orderId`, plus the child id);
3. find and mutate the child inside the parent's collection;
4. `save(parent)`.

Never call a method like `findByOrderItemId` on the parent port and never import a child port — those do
not exist. If you need the parent id to locate the child, it is part of the function input.

## `steps` are guidance, not a contract

`data.steps` (and `data.functions[].steps`) are hints about intent. The CONTRACT you must satisfy is
`functions[].input` / `output` / `ports`. Do not invent repository methods or fields to satisfy a step
literally — implement the step using the declared input/output and the imported port + domain.
