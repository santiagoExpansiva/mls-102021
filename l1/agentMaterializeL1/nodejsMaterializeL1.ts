/// <mls fileReference="_102021_/l1/agentMaterializeL1/nodejsMaterializeL1.ts" enhancement="_blank"/>

// Node runner for the L1 materialization (.defs.ts -> .ts). Reuses the pure core (plan, layer order,
// staleness, prompt) and the direct collab-llm client. It is mls-free by construction (l1 tsconfig has
// no mls.d.ts) and reads/writes the repo via fs. Run it with tsx:
//
//   npx tsx nodejsMaterializeL1.ts 102050 cafeFlow --dry-run
//   npx tsx nodejsMaterializeL1.ts 102050 cafeFlow --config ./materializeL1.config.json
//   npx tsx nodejsMaterializeL1.ts --self-test
//
// Flags: --dry-run (assemble prompts, no network), --force (ignore staleness), --only <substr>
//        (filter by item id/type), --config <path>, --out <dir> (dry-run prompt dir), --self-test.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseDefs, orderItems, isStale, layerRank,
  buildSystemPrompt, buildHumanPrompt, applyHeader, DEFAULT_MODEL_TYPE,
  type PipelineItem, type PlannedItem,
} from './core.js';
import { callCollabLlm, parseGenResult, type LlmConfig } from './llmClient.js';

// Resolve this script's folder from argv[1] (CommonJS + ESM/tsx safe; avoids import.meta, which the
// repo's nodenext build emits as CommonJS and forbids).
const HERE = path.dirname(process.argv[1] ? path.resolve(process.argv[1]) : process.cwd());
// mls-base root. Defaults to agentMaterializeL1 -> l1 -> mls-102021 -> <root>, but can be overridden
// (env / --root) so the runner works when executed from a build dir outside the repo.
let ROOT = process.env.MATERIALIZE_L1_ROOT ? path.resolve(process.env.MATERIALIZE_L1_ROOT) : path.resolve(HERE, '../../../');

// ─── _NNNNN_ reference <-> filesystem path ────────────────────────────────────

function mlsToFs(ref: string): string {
  if (/^_(\d+)_\.d\.ts$/.test(ref)) return path.join(ROOT, ref.replace(/^_(\d+)_\.d\.ts$/, 'mls-$1.d.ts'));
  return path.join(ROOT, ref.replace(/^_(\d+)_\//, 'mls-$1/'));
}

// `_102034_.d.ts` (the shared runtime contracts) has no aggregated d.ts on disk. Expand it to the real
// 102034 source files so every prompt carries RequestContext, IDataRuntime/getTable, TableDefinition,
// AppError/ok and the repository registry — the types the adapters/usecases/controllers compile against.
const CONTRACTS_102034 = [
  '_102034_/l1/server/layer_2_controllers/contracts.ts',
  '_102034_/l1/server/layer_1_external/data/runtime.ts',
  '_102034_/l1/server/layer_1_external/persistence/contracts.ts',
  '_102034_/l1/server/layer_2_application/repositoryRegistry.ts',
];

function expandRef(ref: string): string[] {
  return ref === '_102034_.d.ts' ? CONTRACTS_102034 : [ref];
}

function readIfExists(abs: string): string | null {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
}

function mtimeMs(abs: string): number | null {
  try { return fs.statSync(abs).mtimeMs; } catch { return null; }
}

// Read a context/skill ref, falling back from .d.ts to its generated .ts sibling.
function readContext(ref: string): { ref: string; found: boolean; content: string } {
  const direct = readIfExists(mlsToFs(ref));
  if (direct != null) return { ref, found: true, content: direct };
  if (ref.endsWith('.d.ts')) {
    const tsRef = ref.replace(/\.d\.ts$/, '.ts');
    const ts = readIfExists(mlsToFs(tsRef));
    if (ts != null) return { ref: tsRef, found: true, content: ts };
  }
  return { ref, found: false, content: '' };
}

// ─── Scan + plan ──────────────────────────────────────────────────────────────

interface ScannedDefs { defRef: string; defAbs: string; item: PipelineItem; data: unknown; }

function scanModule(project: number, moduleName: string): ScannedDefs[] {
  const moduleDir = path.join(ROOT, `mls-${project}`, 'l1', moduleName);
  let files: string[] = [];
  try { files = fs.readdirSync(moduleDir, { recursive: true }) as string[]; } catch {
    throw new Error(`module dir not found: ${moduleDir}`);
  }
  const out: ScannedDefs[] = [];
  for (const rel of files) {
    if (!rel.endsWith('.defs.ts')) continue;
    const defAbs = path.join(moduleDir, rel);
    const src = readIfExists(defAbs);
    if (src == null) continue;
    const parsed = parseDefs(src);
    if (!parsed.item) continue;
    const defRef = `_${project}_/l1/${moduleName}/${rel.split(path.sep).join('/')}`;
    out.push({ defRef, defAbs, item: parsed.item, data: parsed.data });
  }
  return out;
}

function plan(scanned: ScannedDefs[], force: boolean): PlannedItem[] {
  const ordered = orderItems(scanned.map((s) => s.item));
  const byOut = new Map(scanned.map((s) => [s.item.outputPath, s]));
  return ordered.map((item) => {
    const s = byOut.get(item.outputPath)!;
    const defsMs = mtimeMs(s.defAbs);
    const tsMs = mtimeMs(mlsToFs(item.outputPath));
    const stale = force || isStale(defsMs, tsMs);
    const reason = force ? 'forced' : tsMs == null ? 'output missing' : stale ? 'defs newer than ts' : 'up to date';
    return { item, rank: layerRank(item.type), stale, reason };
  });
}

// ─── Prompt assembly for one item ─────────────────────────────────────────────

function assemble(item: PipelineItem, data: unknown, modelType: string): { system: string; human: string; skillReport: string[]; depReport: string[] } {
  const skillSections: string[] = [];
  const skillReport: string[] = [];
  for (const s of item.skills ?? []) {
    for (const real of expandRef(s)) {
      const r = readContext(real);
      skillReport.push(`${r.found ? 'OK ' : 'MISS'} ${real}`);
      if (r.found) skillSections.push(`<!-- skill: ${real} -->\n${r.content}`);
    }
  }
  const contextSections: string[] = [];
  const depReport: string[] = [];
  for (const d of item.dependsFiles ?? []) {
    const r = readContext(d);
    depReport.push(`${r.found ? 'OK ' : 'MISS'} ${d}`);
    if (r.found) contextSections.push(`### ${r.ref}\n\`\`\`ts\n${r.content}\n\`\`\``);
  }
  const system = buildSystemPrompt(skillSections, item.outputPath, modelType);
  const human = buildHumanPrompt(data, contextSections, item.outputPath);
  return { system, human, skillReport, depReport };
}

// ─── Config ────────────────────────────────────────────────────────────────────

function loadConfig(explicitPath: string | undefined): LlmConfig {
  const p = explicitPath || process.env.MATERIALIZE_L1_CONFIG || path.join(HERE, 'materializeL1.config.json');
  const raw = readIfExists(p);
  if (raw == null) throw new Error(`config not found: ${p} (copy materializeL1.config.sample.json and fill baseUrl + token)`);
  let cfg: LlmConfig;
  try { cfg = JSON.parse(raw); } catch { throw new Error(`config is not valid JSON: ${p}`); }
  if (!cfg.baseUrl || !cfg.token) throw new Error(`config must set baseUrl and token: ${p}`);
  return cfg;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface Args { project?: number; moduleName?: string; dryRun: boolean; force: boolean; only?: string; config?: string; out?: string; root?: string; check: boolean; selfTest: boolean; }

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, force: false, check: false, selfTest: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--force') a.force = true;
    else if (t === '--self-test') a.selfTest = true;
    else if (t === '--check') a.check = true;
    else if (t === '--only') a.only = argv[++i];
    else if (t === '--config') a.config = argv[++i];
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--root') a.root = argv[++i];
    else positional.push(t);
  }
  if (positional[0]) a.project = Number(positional[0]);
  if (positional[1]) a.moduleName = positional[1];
  return a;
}

// Self-test of the OpenAI tool-call parser — no network, validates the LLM-response contract.
function selfTest(): void {
  const canned = JSON.stringify({
    id: 'chatcmpl-x', object: 'chat.completion',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'submitGeneratedTs', arguments: JSON.stringify({ code: 'export const ok = 1;' }) } },
    ] } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const r = parseGenResult(canned);
  if (r.code !== 'export const ok = 1;') throw new Error('self-test FAILED: code mismatch');
  // header applied when missing
  const withHeader = applyHeader('_102050_/l1/x/y.ts', r.code);
  if (!withHeader.startsWith('/// <mls')) throw new Error('self-test FAILED: header not applied');
  console.log('self-test OK: parseGenResult + applyHeader');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) { selfTest(); return; }
  if (args.root) ROOT = path.resolve(args.root);
  if (!args.project || !args.moduleName) {
    console.error('usage: nodejsMaterializeL1 <project> <module> [--dry-run] [--force] [--only <substr>] [--config <path>] [--out <dir>]');
    process.exit(1);
  }

  const scanned = scanModule(args.project, args.moduleName);
  if (!scanned.length) { console.error(`no .defs.ts found for ${args.project}/${args.moduleName}`); process.exit(1); }

  let planned = plan(scanned, args.force);
  if (args.only) planned = planned.filter((p) => p.item.id.includes(args.only!) || p.item.type.includes(args.only!));
  const dataByOut = new Map(scanned.map((s) => [s.item.outputPath, s.data]));

  const todo = planned.filter((p) => p.stale);
  console.log(`module ${args.project}/${args.moduleName} | ${planned.length} items | mode ${args.dryRun ? 'dry-run' : 'call'}${args.force ? ' (force)' : ''}`);
  console.log(`to generate: ${todo.length}  (skip ${planned.length - todo.length})`);

  if (!todo.length) {
    console.log('nothing to generate (all up to date).');
    if (args.check && args.project && args.moduleName) runCheck(args.project, args.moduleName);
    return;
  }

  const cfg = args.dryRun ? null : loadConfig(args.config);
  const outDir = args.out || path.join(os.tmpdir(), 'materializeL1-prompts');

  // Always use the model from the config (modelTypeOverride); fall back to the per-file default only
  // when the config leaves it empty. This is sent as the collab-llm `model` alias (e.g. "codehigh").
  const modelType = parseModelTypeFromConfig(cfg) || DEFAULT_MODEL_TYPE;

  // One trace file per run, with the raw collab-llm response + usage for every item (real calls only).
  const tracePath = !args.dryRun && cfg ? nextTracePath(args.project) : null;
  if (tracePath) {
    fs.writeFileSync(tracePath, [
      '# materializeL1 run',
      `time:   ${new Date().toISOString()}`,
      `module: ${args.project}/${args.moduleName}`,
      `only:   ${args.only ?? '(all)'}    force: ${args.force}`,
      `model:  ${modelType}`,
      `items:  ${todo.length}`,
      '', '',
    ].join('\n'));
    console.log(`trace -> ${tracePath}`);
  }

  const failures: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const n = `${i + 1}/${todo.length}`;
    const base = path.basename(p.item.outputPath);
    const data = dataByOut.get(p.item.outputPath);
    const { system, human, skillReport, depReport } = assemble(p.item, data, modelType);
    const miss = [...skillReport, ...depReport].filter((s) => s.startsWith('MISS'));

    if (args.dryRun || !cfg) {
      const dir = path.join(outDir, p.item.id.replace(/\W+/g, '_'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'system.md'), system);
      fs.writeFileSync(path.join(dir, 'human.md'), human);
      console.log(`[${n}] ${base}  -> prompt`);
      continue;
    }

    process.stdout.write(`[${n}] ${base} ... `);
    const r = await callCollabLlm(cfg, { model: modelType, system, human });
    const code = r.ok && r.code ? applyHeader(p.item.outputPath, r.code) : '';

    if (tracePath) {
      const sec = [
        `=== ${new Date().toISOString()} | ${p.item.id} (${p.item.type}) ===`,
        `output: ${p.item.outputPath}`,
        `model:  ${modelType}    status: ${r.ok ? 'ok' : `error(${r.httpStatus})`}`,
        r.ok ? `bytes:  ${code.length}` : `error:  ${r.error ?? 'unknown'}`,
        `skills: ${skillReport.join(' | ') || '(none)'}`,
        `deps:   ${depReport.join(' | ') || '(none)'}`,
        `usage:  ${r.usage ? JSON.stringify(r.usage) : '(none)'}`,
      ];
      if (!r.ok) sec.push('--- raw (capped) ---', r.raw.slice(0, TRACE_RAW_CAP));
      sec.push('', '');
      fs.appendFileSync(tracePath, sec.join('\n'));
    }

    if (!r.ok || !code) {
      console.log(`FAIL: ${r.error ?? 'no code'}`);
      failures.push(p.item.id);
      continue;
    }
    const outAbs = mlsToFs(p.item.outputPath);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, code);
    console.log(`ok ${code.length}b${miss.length ? `  (ctx MISS: ${miss.length})` : ''}`);
  }
  const okCount = todo.length - failures.length;
  console.log(`\ndone: ${okCount}/${todo.length} file(s) ${args.dryRun ? 'prepared' : 'generated'}.`);
  if (tracePath) console.log(`trace: ${tracePath}`);
  if (failures.length) { console.log(`FAILURES (${failures.length}): ${failures.join(', ')}`); process.exitCode = 1; }
  if (args.check && args.project && args.moduleName) {
    if (!runCheck(args.project, args.moduleName)) process.exitCode = 2;
  }
}

// ─── Trace (collab-llm responses per run) ────────────────────────────────────

const TRACE_RAW_CAP = 40000; // cap the raw body kept per item so the file stays readable

// Next free mls-<project>/l1/trace/runNN.txt (auto-incrementing, zero-padded).
function nextTracePath(project: number): string {
  const dir = path.join(ROOT, `mls-${project}`, 'l1', 'trace');
  fs.mkdirSync(dir, { recursive: true });
  let n = 1;
  try {
    const used = fs.readdirSync(dir)
      .map((f) => /^run(\d+)\.txt$/.exec(f))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) => Number(m[1]));
    if (used.length) n = Math.max(...used) + 1;
  } catch { /* ignore */ }
  return path.join(dir, `run${String(n).padStart(2, '0')}.txt`);
}

// Typecheck only the generated module with tsc (scoped tsconfig that extends tsconfig.backend.json so
// the /_NNNNN_/ path aliases + node types resolve). Returns true when tsc passes.
function runCheck(project: number, moduleName: string): boolean {
  const tmp = path.join(os.tmpdir(), `matL1-tsconfig-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    extends: path.join(ROOT, 'tsconfig.backend.json'),
    compilerOptions: { noEmit: true, typeRoots: [path.join(ROOT, 'node_modules', '@types')] },
    include: [path.join(ROOT, `mls-${project}`, 'l1', moduleName, '**', '*.ts')],
  }));
  const localTsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
  const bin = fs.existsSync(localTsc) ? localTsc : 'npx';
  const binArgs = bin === 'npx' ? ['tsc', '-p', tmp] : ['-p', tmp];
  console.log(`\nchecking ${project}/${moduleName} with tsc...`);
  try {
    execFileSync(bin, binArgs, { cwd: ROOT, stdio: 'inherit' });
    console.log('tsc: OK');
    return true;
  } catch {
    console.log('tsc: errors (see above)');
    return false;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// modelType override comes from the config (optional). Kept tiny + separate for clarity.
function parseModelTypeFromConfig(cfg: LlmConfig | null): string | null {
  const v = (cfg as unknown as { modelTypeOverride?: string })?.modelTypeOverride;
  return v && v.trim() ? v.trim() : null;
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : String(e)); process.exit(1); });
