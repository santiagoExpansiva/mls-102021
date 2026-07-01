# Skill: httpController → `layer_1_external/adapters/http/controllers/{name}.ts`

Generate the BFF handler(s) — driving HTTP adapter. **L4 is the source of truth**: generate exactly
one `BffHandler` per entry in `data.handlers` (each has `command`, `usecaseRef`, `kind` and usually
`inputTypeName`); import the usecase FUNCTION named EXACTLY by `usecaseRef` (it was read from the
generated usecase, so the export is guaranteed to exist — never invent a different name) and its input
type by `inputTypeName` when present (otherwise `{Capitalize(command)}Input`); call it and return its
output. The frontend contract is OPTIONAL refinement:
if `data.outputSource === 'contract'` (and the contract `.ts` is in dependsFiles), map the response to
the contract Output exactly; otherwise the Output is the usecase output. Each handler validates the
boundary input only. NO `ctx.data`, NO persistence/domain-internals import.

## Golden example (compiles)

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_1_external/adapters/http/controllers/createOrder.ts" enhancement="_blank"/>
import { ok, AppError, type BffHandler, type ControllerRoute } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
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

// Self-describing routes — the runtime discovers them by importing this controller (no router file).
export const routes: ControllerRoute[] = [
  { key: '{module}.createOrder.createOrder', handler: {module}CreateOrderHandler },
];
```

## Rules

- Import line is ALWAYS `import { ok, AppError, type BffHandler, type ControllerRoute } from '/_102034_/l1/server/layer_2_controllers/contracts.js';`
  — include `AppError` even for `kind: 'query'` handlers (they still do boundary validation and throw it).
- When mapping to a frontend contract (`outputSource === 'contract'`), import its types with the FULL
  aliased path INCLUDING the leading slash: `import type { ... } from '/_{project}_/l2/{module}/web/contracts/{page}.js';`
  — the leading `/` is required by the path alias; NEVER emit `_{project}_/l2/...` without it.
- One exported `BffHandler` const per command, named `{module}{Pascal(command)}Handler`. NEVER add an
  explicit return type after the arrow (`BffHandler` already encodes it).
- Read input from `request.params` (cast to the usecase Input); boundary validation only (required
  fields, basic shape) → `AppError('VALIDATION_ERROR', …, 400)`. Business rules belong to the usecase.
- Import the usecase function named by `usecaseRef` + its Input type (`inputTypeName` when given); call
  it; wrap the result in `ok(...)`. The imported name MUST match `usecaseRef` exactly — do not rename it
  to the command or the page.
- `kind: 'query'` → return the queried data (unwrap the named output property); `command`/`mutation` →
  return the whole result. When a contract Output is provided, map field names to match it exactly.
- NO `ctx.data`, NO imports from `adapters/persistence` or the domain internals.
- ALWAYS export `const routes: ControllerRoute[]` with one entry per `data.routes[]`: `{ key, handler }`,
  where `key` is the route key from the defs (`{module}.{page}.{command}`) and `handler` is the exported
  handler const. The runtime discovers routes from this export — there is NO generated router file.
