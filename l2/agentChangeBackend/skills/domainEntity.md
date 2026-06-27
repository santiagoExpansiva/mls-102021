# Skill: domainEntity → `layer_3_domain/entities/{entity}.ts`

Generate the **PURE** domain aggregate from the entity `.defs.ts` (`data.entityId`, `data.fields`,
`data.valueObjects`, `data.invariants`, `data.statusEnum`). No imports of platform/`ctx`/SQL. Fields
are camelCase; the aggregate root carries embedded `supporting` members as a typed collection
(e.g. `items: OrderItem[]`). Status/lifecycle become string-literal union types. Invariants are pure
functions/maps. Record types are exported here and reused by ports/application — never redeclared.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_3_domain/entities/order.ts" enhancement="_blank"/>

export type OrderType = 'mesa' | 'takeout';
export type OrderStatus = 'draft' | 'sentToKitchen' | 'inPreparation' | 'ready' | 'served' | 'closed' | 'cancelled';
export type OrderItemStatus = 'new' | 'sentToKitchen' | 'inPreparation' | 'ready' | 'served' | 'cancelled';

export interface OrderItem {
  id: string;
  menuItemId: string;
  kitchenTicketId: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  observations: string | null;
  status: OrderItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  orderId: string;
  dailyShiftId: string;
  tableId: string | null;
  kitchenTicketId: string | null;
  orderType: OrderType;
  status: OrderStatus;
  totalAmount: number;
  notes: string | null;
  customerName: string | null;
  customerPhone: string | null;
  numberOfGuests: number | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['sentToKitchen', 'cancelled'],
  sentToKitchen: ['inPreparation', 'cancelled'],
  inPreparation: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: ['closed'],
  closed: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
export function orderRequiresItem(order: Pick<Order, 'items'>): boolean {
  return order.items.length > 0;
}
export function recomputeOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.totalPrice, 0);
}
```

## Rules

- Map ontology field types: `uuid|string|text` → `string`; `money|number` → `number`; `boolean` →
  `boolean`; `date|datetime` → `string` (ISO); an entity reference (`{Entity}` / `{entity}Id`) →
  `string`. Optional (`required:false`) fields are `T | null`.
- Embed each `supporting` member as `{member}s: {Member}[]` (oneToMany) or `{member}: {Member} | null`
  (oneToOne). Export the member interface too.
- Provide the invariants from `data.invariants` as pure helpers (status transitions, `requiresItem`,
  totals). No I/O, no `ctx`, no imports.
