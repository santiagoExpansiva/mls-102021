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

- One exported `async function {functionName}(ctx: RequestContext, input: {Input}): Promise<{Output}>`
  per command; export the `{Input}`/`{Output}` interfaces (the controller imports them).
- Resolve every repository with `resolveRepository<I{Entity}Repository>(ctx, '{Entity}')`. NEVER import
  an adapter. Import record/union types and invariants from the domain entity.
- Apply `rulesApplied`: validate via domain invariants; throw `AppError('VALIDATION_ERROR'|'CONFLICT', …)`.
- Lifecycle: read current state, check the domain transition (e.g. `canTransition*`), then `save`.
- Multi-aggregate writes go inside one `ctx.data.runInTransaction(async (tx) => { ... })` — this is the
  ONLY `ctx.data` allowed here; pass `tx` only to repository calls if the adapter supports it.
- Ids via `ctx.idGenerator.newId()`, timestamps via `ctx.clock.nowIso()`.
