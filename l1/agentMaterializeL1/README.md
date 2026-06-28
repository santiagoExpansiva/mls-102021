# agentMaterializeL1 — Node runner

Materializes the L1 backend (`.defs.ts` → `.ts`) outside the studio. Pure logic lives in `core.ts`
(mls-free / fs-free, reusable by the future studio agent); this folder adds the fs + LLM HTTP adapters.

## Files

- `core.ts` — pure: parse `.defs.ts`, hexagonal layer order, staleness, prompt + `submitGeneratedTs` tool.
- `llmClient.ts` — calls collab-llm directly (`POST {baseUrl}/v1/chat/completions`, OpenAI-compatible,
  forced tool call, `x-tool-strict`). Avoids CORS; collab-messages has no external port.
- `nodejsMaterializeL1.ts` — CLI: scan a module, plan by layer, check staleness, assemble prompts, call
  the LLM, write the `.ts`.

## Configure

Copy the sample and fill it (this real file is git-ignored — never commit the token):

```
cp materializeL1.config.sample.json materializeL1.config.json
```

- `baseUrl` — production collab-llm: `https://llm.collab.codes` (local dev would be `http://localhost:3050`).
- `token` — a Bearer token production accepts: the same `hook.collabtoken` the prod collab-messages uses,
  or a `cak_…` API key from collab-admin. Do not paste it into any committed file.
- `orgId` — your prod org slug (used with JWT tokens; a `cak_` API key already carries its org).
- `modelTypeOverride` — optional: a model alias that exists in prod (e.g. `codepro`, `codehigh`); leave
  empty to use the per-file default (`codeinstruct2`).

> Note: run this on your Mac — `llm.collab.codes` is not reachable from the Cowork sandbox.

## Run

From `mls-base` (script in package.json), args go after the script name:

```
pnpm materialize 102050 cafeFlow --dry-run            # plan + prompts, no network
pnpm materialize 102050 cafeFlow --only menuItem       # generate one aggregate slice
pnpm materialize 102050 cafeFlow --only menuItem --check  # generate, then tsc the module
pnpm materialize 102050 cafeFlow --force              # regenerate all
pnpm materialize -- --self-test                       # parser/contract check, no network
```

Or directly from this folder with tsx: `npx tsx nodejsMaterializeL1.ts 102050 cafeFlow --only menuItem --check`.

Flags: `--dry-run` (assemble prompts, no LLM), `--force` (ignore staleness), `--only <substr>` (filter
by item id/type), `--check` (run `tsc` on the generated module afterwards), `--config <path>`,
`--root <path>`, `--out <dir>` (dry-run prompt dir, defaults to the OS temp dir).

## Model

The model is always the config's `modelTypeOverride` (sent to collab-llm as the `model` alias, e.g.
`codehigh`); when left empty it falls back to the per-file default. Set it once in
`materializeL1.config.json`.

## Trace

Every real run writes `mls-<project>/l1/trace/runNN.txt` (auto-incrementing) with, per item, the model,
status, collab-llm `usage` (provider/model/cost/attempts/tool_strict) and — on failure — the raw
response body. Use it to see exactly what came back. (You may want to git-ignore `l1/trace/`.)

Layer order (respects every `dependsFiles` edge): domain → ports → table → adapter → usecases →
controllers. A file is regenerated only when its `.ts` is missing or older than its `.defs.ts`.
