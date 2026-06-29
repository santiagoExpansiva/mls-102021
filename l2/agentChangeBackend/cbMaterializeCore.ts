/// <mls fileReference="_102021_/l2/agentChangeBackend/cbMaterializeCore.ts" enhancement="_blank"/>

// Pure materialization core for L1 (.defs.ts -> .ts). NO mls.*, NO fs, NO dom: only ES2022 + the
// MaterializeEnv port. It is shared logic between the Node runner (nodejsMaterializeL1.ts, fs + LLM
// HTTP) and the future studio agent (l2, mls.* + steps). Keeping it pure is what lets the same plan,
// ordering, staleness rule and prompt assembly run in both environments.

// ─── Types ──────────────────────────────────────────────────────────────────

// One pipeline entry carried inside each .defs.ts (see agentChangeBackend cbShared.buildPipelineItem).
export interface PipelineItem {
  id: string;
  type: string;                 // domainEntity | repositoryPort | persistenceTable | repositoryAdapter | applicationUsecase | httpController
  outputPath: string;           // _NNNNN_/l1/.../x.ts
  defPath?: string;             // _NNNNN_/l1/.../x.defs.ts
  dependsFiles?: string[];      // .d.ts of inner callee layers (context for the prompt)
  dependsOn?: string[];         // explicit cross-item ids (usually empty; layer rank drives order)
  skills?: string[];            // .md skill(s) + _102034_.d.ts (prompt context)
  rulesApplied?: string[];
  agent?: string;
}

// Parsed .defs.ts: the artifact data block (export const xDefs = {... data:{...}}) plus its pipeline item.
export interface ParsedDefs {
  dataExportName: string | null;
  artifact: Record<string, unknown> | null;   // the full export const object
  data: unknown;                               // artifact.data ?? artifact (what the prompt receives)
  item: PipelineItem | null;
}

// A planned unit of work: the item + whether it must be (re)generated and its layer rank.
export interface PlannedItem {
  item: PipelineItem;
  rank: number;
  stale: boolean;
  reason: string;               // why it is/ isn't stale (for logs)
}

// The injected environment (the port). Both the Node fs adapter and the studio mls.* adapter implement it.
export interface MaterializeEnv {
  readRef(ref: string): Promise<string | null>;     // read a _NNNNN_/... reference (any extension)
  modifiedMs(ref: string): Promise<number | null>;   // mtime in ms, or null when absent
}

// What the LLM must return (the submitGeneratedTs tool). Same shape the studio gen agent uses.
export interface GenResult { code: string; }

// ─── Layer order (hexagonal) ─────────────────────────────────────────────────

// Topological rank by layer. Lower runs first. Respects every dependsFiles edge AND the requested
// grouping "persistence -> usecases -> controllers": domain feeds everything; ports feed adapters and
// usecases; the table is part of persistence; the adapter closes persistence; usecases then controllers.
//   domain(0) -> port(1) -> table(2) -> adapter(3) -> usecase(4) -> controller(5)
const LAYER_RANK: Record<string, number> = {
  domainEntity: 0,
  repositoryPort: 1,
  persistenceTable: 2,
  repositoryAdapter: 3,
  applicationUsecase: 4,
  httpController: 5,
};

export function layerRank(type: string): number {
  // Unknown types run last so a new layer never silently jumps ahead of its dependencies.
  return type in LAYER_RANK ? LAYER_RANK[type] : 99;
}

// Stable order: by layer rank, then by id (deterministic across runs).
export function orderItems(items: PipelineItem[]): PipelineItem[] {
  return [...items].sort((a, b) => layerRank(a.type) - layerRank(b.type) || a.id.localeCompare(b.id));
}

// ─── Staleness ───────────────────────────────────────────────────────────────

// Regenerate when the output is missing, or the .defs.ts is newer than the generated .ts. Pure: the
// caller supplies the timestamps (fs mtime in Node, file.updatedAt in the studio).
export function isStale(defsMs: number | null, tsMs: number | null): boolean {
  if (tsMs == null) return true;          // output not generated yet
  if (defsMs == null) return false;       // no defs timestamp -> assume up to date
  return defsMs > tsMs;                   // defs changed after the last generation
}

// ─── .defs.ts parsing (no eval; balanced-bracket slice + JSON.parse) ──────────

// Extract `export const <name> = <value>` where value starts with '{' or '['. Returns the parsed JSON
// value (the artifact data and the pipeline are plain JSON literals by construction).
function extractConstObject(src: string, name: string): unknown {
  const marker = `export const ${name}`;
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const eq = src.indexOf('=', at);
  if (eq < 0) return null;
  let open = eq + 1;
  while (open < src.length && /\s/.test(src[open])) open++;
  const openCh = src[open];
  const closeCh = openCh === '[' ? ']' : openCh === '{' ? '}' : '';
  if (!closeCh) return null;
  let depth = 0, i = open, inStr = false, strCh = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) { i++; break; } }
  }
  // Strip a trailing `as const` the source may carry after the literal.
  const body = src.slice(open, i);
  try { return JSON.parse(body); } catch { return null; }
}

function firstExportName(src: string): string | null {
  // Skip the `pipeline` export; the artifact data export is the other top-level const.
  const re = /export const\s+([A-Za-z0-9_$]+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) { if (m[1] !== 'pipeline') return m[1]; }
  return null;
}

export function parseDefs(src: string): ParsedDefs {
  const dataExportName = firstExportName(src);
  const artifact = (dataExportName ? extractConstObject(src, dataExportName) : null) as Record<string, unknown> | null;
  const pipelineArr = extractConstObject(src, 'pipeline');
  const item = Array.isArray(pipelineArr) && pipelineArr.length ? (pipelineArr[0] as PipelineItem) : null;
  const data = artifact && typeof artifact === 'object' && 'data' in artifact ? (artifact as any).data : artifact;
  return { dataExportName, artifact, data, item };
}

// ─── Prompt assembly (mirrors the studio gen agent) ──────────────────────────

export const GEN_TOOL_NAME = 'submitGeneratedTs';

// Plain OpenAI tool (NOT the planner envelope): the gen agent returns the file content directly.
export const GEN_TOOL = {
  type: 'function',
  function: {
    name: GEN_TOOL_NAME,
    description: 'Submit the complete generated TypeScript file content.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: {
        code: { type: 'string', description: 'Complete TypeScript file content. Must start with the /// <mls fileReference="..."> header.' },
      },
    },
  },
} as const;

export const DEFAULT_MODEL_TYPE = 'codeinstruct2';

// Read `<!-- modelType: X -->` from a system prompt (the collab-llm `model` alias the studio sends).
export function parseModelType(systemPrompt: string): string | null {
  const m = systemPrompt.match(/<!--\s*modelType:\s*([A-Za-z0-9_-]+)\s*-->/);
  return m ? m[1] : null;
}

export function buildSystemPrompt(skillSections: string[], outputPath: string, modelType: string): string {
  const skills = skillSections.length ? skillSections.join('\n\n---\n\n') : '<!-- no skill loaded -->';
  return `<!-- modelType: ${modelType} -->
<!-- x-tool-strict: true -->

You generate a TypeScript file based on a definition and context files.

Target file: ${outputPath}

The file must start with:
/// <mls fileReference="${outputPath}" enhancement="_blank"/>

Follow the instructions in the skill(s) below exactly.
Use the context files (dependsFiles) as reference for types, imports and logic.
Return ONLY the file via the ${GEN_TOOL_NAME} tool.

---

${skills}`;
}

export function buildHumanPrompt(data: unknown, contextSections: string[], outputPath: string): string {
  const lines = ['## Definition', '', '```json', JSON.stringify(data, null, 2), '```', ''];
  if (contextSections.length) {
    lines.push('## Context files (dependsFiles)', '');
    for (const c of contextSections) lines.push(c, '');
  }
  lines.push('## Output', '', `Generate ONLY the TypeScript for: ${outputPath}`, `Call ${GEN_TOOL_NAME} with the complete code.`);
  return lines.join('\n');
}

// Ensure the generated file carries the mls header (the studio gen prepends it when missing).
export function applyHeader(outputPath: string, code: string): string {
  const header = `/// <mls fileReference="${outputPath}" enhancement="_blank"/>`;
  const trimmed = code.trimStart();
  return trimmed.startsWith('///') ? code : `${header}\n\n${code}`;
}

// ─── dependsFiles/skill ref expansion (shared by the Node CLI and the in-studio agent) ─────────────

// `_102034_.d.ts` (the shared runtime contracts) has no aggregated d.ts; expand the alias to the real
// 102034 source files so every prompt carries RequestContext, IDataRuntime/getTable, TableDefinition,
// AppError/ok and the repository registry — the types adapters/usecases/controllers compile against.
export const CONTRACTS_102034: readonly string[] = [
  '_102034_/l1/server/layer_2_controllers/contracts.ts',
  '_102034_/l1/server/layer_1_external/data/runtime.ts',
  '_102034_/l1/server/layer_1_external/persistence/contracts.ts',
  '_102034_/l1/server/layer_2_application/repositoryRegistry.ts',
];

// Map a single context ref to the real file ref(s) to read. Pure (ref -> refs); the caller does the I/O.
export function expandContextRef(ref: string): string[] {
  return ref === '_102034_.d.ts' ? [...CONTRACTS_102034] : [ref];
}
