# layer_2.md — generate layer_2_controllers (BFF) from page .defs.ts

**Goal:** transform the `bffCommands` of each page `.defs.ts` (`l2/{module}/{pageId}.defs.ts`)
into BFF handlers + router entries. Layer_2 receives the page request, validates the boundary
input, calls the usecase and shapes the response — nothing else.

## Inputs

1. The page defs: `data.pageDefinition` (pageId, actor, pageInputs[]) and `data.bffCommands[]`:
   `{ commandName, purpose, kind: 'query'|'command'|'mutation', input[], output[],
   readsTables/writesTables (informative), usecaseRefs[], layerContract, rulesApplied[] }`.
2. For each `usecaseRefs` entry: the usecase defs `implementation` block
   (`functionName`, `inputTypeName`, `outputTypeName`, `tsFileRef`) written by the layer_3
   generation (see `layer_3.md`).
3. **The L2 contract file** (`l2/{module}/web/contracts/{pageId}.ts`) — if provided, this is the
   authoritative shape of every command's Input and Output that the frontend expects.

## Output file skeleton

`l1/{module}/layer_2_controllers/{pageId}Controller.ts`:

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_2_controllers/dealDetailController.ts" enhancement="_blank" />
import { ok, AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { advanceDealStage, type AdvanceDealStageInput } from '/_{project}_/l1/{module}/layer_3_usecases/advanceDealStage.js';

export const {module}DealDetailAdvanceStageHandler: BffHandler = async ({ request, ctx }) => {
  const input = request.params as AdvanceDealStageInput;
  if (!input.dealId) throw new AppError('VALIDATION_ERROR', 'dealId is required', 400, { field: 'dealId' });
  const result = await advanceDealStage(ctx, input);
  return ok(result); // mutation: return whole result; for queries unwrap: ok(result.fieldName)
};
```

Plus one router entry per command:
`key: "{moduleName}.{pageId}.{commandName}"`, `handlerName`, `importPath` (the controller `.js`).

## Rules

- One exported `BffHandler` const per bffCommand; naming
  `{moduleName}{PascalCase(pageId)}{PascalCase(commandName)}Handler`.
- **Never add an explicit return type on the async arrow function** — the `BffHandler` type already
  encodes the return type. Adding `: Promise<XxxOutput>` after the parameter list causes a TypeScript
  error. Correct: `async ({ ctx }) => {`; Wrong: `async ({ ctx }): Promise<XxxOutput> => {`.
- **Import the usecase function AND its input/output types from the usecase file** (use the
  defs `implementation` block). NEVER redeclare interfaces that a usecase already exports; declare
  local types only for fields not covered by any usecaseRef.
- Boundary validation only: required fields, basic shape (`VALIDATION_ERROR`, 400). Business rules
  belong to layer_3 — if you are writing an `if` about state/permissions/limits here, it is in the
  wrong layer.
- **Business rules from `rulesApplied`**: each command in the definition may carry a `rulesApplied[]`
  list. When present, read the corresponding rule definitions provided in `## Business Rules` and
  apply them exactly as described — the rule text is the authoritative source of what the handler
  must enforce. Rules that belong at the boundary (e.g. input format constraints, enum validation,
  allowed transition lists) are implemented here; rules that require entity state or persistence
  belong to layer_3 and must be delegated via the usecase call, not re-implemented in layer_2.
- **Never touch tables or entities**: no `ctx.data.*`, no imports from `layer_1_external` or
  `layer_4_entities`. (The phase-2 exception — trivial read with zero rules calling layer_4
  directly — is DISABLED until the planning defs mark the command for it explicitly.)
- **Contract-first response shape**: when the L2 contract file is provided, the value passed to
  `ok()` **must match the contract's Output type** for that command. Import the contract Output
  type and use it as the target shape.
  - Compare the layer_3 output type against the contract Output type field by field.
  - If the shapes already match, pass the result (or unwrapped property) directly.
  - If field names differ (e.g. layer_3 returns `order_id`, contract expects `orderId`; or
    `created_at` vs `createdAt`), build a mapping expression inside the handler to convert
    before calling `ok()`. Example:
    ```ts
    return ok(result.pedidos.map((p) => ({
      orderId: p.order_id,
      status: p.status,
      createdAt: p.created_at,
      shiftId: p.shift_id,
    })));
    ```
  - If the contract Output is an array type (`OutputItem[]`) and layer_3 wraps the data in a
    named property, unwrap and map: `result.propertyName.map(item => ({ ...converted }))`.
- When no contract file is provided, fall back to the previous behaviour: inspect the usecase
  `OutputType`, unwrap named properties for queries, return whole result for commands/mutations.
  - Rule of thumb: `kind: 'query'` → unwrap. `kind: 'command'|'mutation'` → keep whole.
  - Errors propagate as `AppError` (the platform serializes `BffResponse.error`).
- Identifier inputs follow the page defs `pageInputs` contract (routeParam/session sources are
  resolved by the platform shell; the handler reads them from `request.params`).
- Do not call more than one WRITE usecase per handler — composition of writes is a layer_3
  responsibility (create a usecase for it instead).

## Checks before finishing

1. Every bffCommand has handler + router entry; no handler without a command.
2. `grep ctx.data` returns nothing; no layer_4/layer_1 imports.
3. All usecase types are imported, not redeclared.
4. Router keys unique, pattern `{moduleName}.{pageId}.{commandName}`.
