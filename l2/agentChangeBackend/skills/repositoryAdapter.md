# Skill: repositoryAdapter → `layer_1_external/adapters/persistence/{entity}RepositoryAdapter.ts`

Generate the repository ADAPTER implementing the port. This is the ONLY file allowed to use
`ctx.data`. It maps the domain aggregate <-> table row: indexed fields become columns; everything
else + embedded child collections are serialized into the `details` JSONB column. Export a factory
`create{Entity}RepositoryAdapter(ctx): I{Entity}Repository`. MDM reads go through `ctx.data.mdm*`
(never a local table).

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_1_external/adapters/persistence/orderRepositoryAdapter.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IOrderRepository, OrderListFilter } from '/_{project}_/l1/{module}/layer_2_application/ports/orderRepository.js';
import type { Order, OrderItem } from '/_{project}_/l1/{module}/layer_3_domain/entities/order.js';

interface OrderRow {
  order_id: string; daily_shift_id: string; table_id: string | null; kitchen_ticket_id: string | null;
  order_type: string; status: string; created_at: string; details: string | null;
}
interface OrderDetails {
  totalAmount: number; notes: string | null; customerName: string | null; customerPhone: string | null;
  numberOfGuests: number | null; closedAt: string | null; cancelledAt: string | null;
  cancellationReason: string | null; updatedAt: string; items: OrderItem[];
}

function toRow(order: Order): OrderRow {
  const details: OrderDetails = {
    totalAmount: order.totalAmount, notes: order.notes, customerName: order.customerName,
    customerPhone: order.customerPhone, numberOfGuests: order.numberOfGuests, closedAt: order.closedAt,
    cancelledAt: order.cancelledAt, cancellationReason: order.cancellationReason, updatedAt: order.updatedAt,
    items: order.items,
  };
  return {
    order_id: order.orderId, daily_shift_id: order.dailyShiftId, table_id: order.tableId,
    kitchen_ticket_id: order.kitchenTicketId, order_type: order.orderType, status: order.status,
    created_at: order.createdAt, details: JSON.stringify(details),
  };
}
function parseDetails(row: OrderRow): OrderDetails {
  try { return JSON.parse(row.details ?? '{}') as OrderDetails; }
  catch { return { totalAmount: 0, notes: null, customerName: null, customerPhone: null, numberOfGuests: null, closedAt: null, cancelledAt: null, cancellationReason: null, updatedAt: row.created_at, items: [] }; }
}
function toDomain(row: OrderRow): Order {
  const d = parseDetails(row);
  return {
    orderId: row.order_id, dailyShiftId: row.daily_shift_id, tableId: row.table_id,
    kitchenTicketId: row.kitchen_ticket_id, orderType: row.order_type as Order['orderType'],
    status: row.status as Order['status'], totalAmount: d.totalAmount, notes: d.notes,
    customerName: d.customerName, customerPhone: d.customerPhone, numberOfGuests: d.numberOfGuests,
    closedAt: d.closedAt, cancelledAt: d.cancelledAt, cancellationReason: d.cancellationReason,
    items: d.items ?? [], createdAt: row.created_at, updatedAt: d.updatedAt,
  };
}

export function createOrderRepositoryAdapter(ctx: RequestContext): IOrderRepository {
  const getTable = () => ctx.data.moduleData.getTable<OrderRow>('orders');
  return {
    async getById(orderId) {
      const row = await (await getTable()).findOne({ where: { order_id: orderId } });
      if (!row) throw new AppError('NOT_FOUND', `Order ${orderId} not found`, 404, { orderId });
      return toDomain(row);
    },
    async findById(orderId) {
      const row = await (await getTable()).findOne({ where: { order_id: orderId } });
      return row ? toDomain(row) : null;
    },
    async list(filter?: OrderListFilter) {
      const where: Partial<OrderRow> = {};
      if (filter?.dailyShiftId) where.daily_shift_id = filter.dailyShiftId;
      if (filter?.status) where.status = filter.status;
      if (filter?.tableId) where.table_id = filter.tableId;
      const rows = await (await getTable()).findMany({ where, orderBy: { field: 'created_at', direction: 'desc' } });
      return rows.map(toDomain);
    },
    async save(order) {
      const repo = await getTable();
      const existing = await repo.findOne({ where: { order_id: order.orderId } });
      if (existing) await repo.update({ where: { order_id: order.orderId }, patch: toRow(order) });
      else await repo.insert({ record: toRow(order) });
      return order;
    },
  };
}
```

## Rules

- Define a `{Entity}Row` (snake_case columns matching the TableDefinition) and a `{Entity}Details`
  (the JSONB payload: non-indexed fields + embedded collections). `toRow`/`toDomain`/`parseDetails`
  convert between them; `details` is `JSON.stringify` on write, safe-parse on read.
- The factory closes over `ctx`; methods take NO `ctx`. `getTable<{Entity}Row>('{table_name}')`.
- `orderBy` is always `{ field: '<column>', direction: 'asc'|'desc' }`. `getById` throws `NOT_FOUND`.
- MDM-backed reads: resolve via `ctx.data.mdmEntityIndex` / `ctx.data.mdmDocument`; never a local table.
- Multi-table writes (e.g. + event/metric) wrap in `ctx.data.runInTransaction(async (tx) => { ... })`.
- Append-only EVENT adapters (`data.appendOnlyEvent === true`): implement the event port over its table —
  `append(record)` does a single `insert({ record: toRow(record) })` (NEVER `update`/`delete`), and the
  read finders use `findMany` with the owner FK and `orderBy` the timestamp. Same `{Event}Row`/`toRow`/
  `toDomain` mapping (non-indexed fields in `details`).
