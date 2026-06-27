# Skill: httpController → `layer_1_external/adapters/http/controllers/{name}.ts`

Generate the BFF handler(s) — driving HTTP adapter. Each handler validates the boundary input, calls
the usecase, and shapes the response. NO `ctx.data`, NO persistence/domain-internals import. When a
per-page frontend contract exists, the response must match its Output exactly; when it does not
(l4-only generation), the Output defaults to the usecase output. Export one `BffHandler` per command.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_1_external/adapters/http/controllers/createOrder.ts" enhancement="_blank"/>
import { ok, AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createOrder, type CreateOrderInput } from '/_{project}_/l1/{module}/layer_2_application/usecases/createOrder.js';

export const {module}CreateOrderHandler: BffHandler = async ({ request, ctx }) => {
  const input = request.params as CreateOrderInput;
  if (!input || !input.dailyShiftId) {
    throw new AppError('VALIDATION_ERROR', 'dailyShiftId is required', 400, { field: 'dailyShiftId' });
  }
  if (!input.orderType) {
    throw new AppError('VALIDATION_ERROR', 'orderType is required', 400, { field: 'orderType' });
  }
  const result = await createOrder(ctx, input);
  return ok(result.order);
};
```

## Rules

- One exported `BffHandler` const per command, named `{module}{Pascal(command)}Handler`. NEVER add an
  explicit return type after the arrow (`BffHandler` already encodes it).
- Read input from `request.params` (cast to the usecase Input); boundary validation only (required
  fields, basic shape) → `AppError('VALIDATION_ERROR', …, 400)`. Business rules belong to the usecase.
- Import the usecase function + its Input/Output types; call it; wrap the result in `ok(...)`.
- `kind: 'query'` → return the queried data (unwrap the named output property); `command`/`mutation` →
  return the whole result. When a contract Output is provided, map field names to match it exactly.
- NO `ctx.data`, NO imports from `adapters/persistence` or the domain internals.
- Route key per command is `{module}.{page}.{command}` (registered separately in the router).
