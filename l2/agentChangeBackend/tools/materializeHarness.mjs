// materializeHarness.mjs — simulate the .defs.ts -> .ts materialization pipeline OUTSIDE the runtime.
//
// Pure Node (no mls.*). Reads a target .defs.ts, extracts its `data` block and `export const pipeline`,
// resolves the pipeline item's `dependsFiles` (.d.ts -> .ts fallback) and `skills` (.md) from disk
// (translating _NNNNN_/... -> mls-NNNNN/...), and writes the EXACT system+human prompt that
// agentMaterializeGen would build — so you can paste it into an LLM (or wire an API call) and get the
// .ts, then tsc it. Also copies the resolved context files for inspection.
//
// Usage:
//   node materializeHarness.mjs <defsPath | _NNNNN_/l1/.../x.defs.ts> [outDir]
// Example:
//   node materializeHarness.mjs _102050_/l1/cafeFlow/layer_3_domain/entities/order.defs.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tools -> agentChangeBackend -> l2 -> mls-102021 -> <mls-base root>
const ROOT = path.resolve(HERE, '../../../../');

function mlsToFs(ref) {
  // _102050_/l1/x  ->  <root>/mls-102050/l1/x   ;  _102034_.d.ts -> <root>/mls-102034.d.ts (often absent)
  const slash = ref.replace(/^_(\d+)_\//, 'mls-$1/');
  const dot = slash.replace(/^_(\d+)_\.d\.ts$/, 'mls-$1.d.ts');
  return path.join(ROOT, dot);
}

function readIfExists(absPath) {
  try { return fs.readFileSync(absPath, 'utf8'); } catch { return null; }
}

// Resolve a dependsFile: prefer the .d.ts, fall back to the generated .ts sibling.
function readDepends(ref) {
  const direct = readIfExists(mlsToFs(ref));
  if (direct != null) return { ref, found: true, content: direct };
  if (ref.endsWith('.d.ts')) {
    const tsRef = ref.replace(/\.d\.ts$/, '.ts');
    const ts = readIfExists(mlsToFs(tsRef));
    if (ts != null) return { ref: tsRef, found: true, content: ts };
  }
  return { ref, found: false, content: '' };
}

function extractConstObject(src, name) {
  const marker = `export const ${name}`;
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const eq = src.indexOf('=', at);
  // First non-space char after '=' is the value's opening bracket ('[' or '{').
  let open = eq + 1;
  while (open < src.length && /\s/.test(src[open])) open++;
  const openCh = src[open];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, i = open, inStr = false, strCh = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === strCh) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) { i++; break; } }
  }
  const body = src.slice(open, i);
  try { return JSON.parse(body); } catch (e) { return { __parseError: String(e), __raw: body.slice(0, 200) }; }
}

function firstExportName(src) {
  const m = src.match(/export const\s+([A-Za-z0-9_$]+)\s*=/);
  return m ? m[1] : null;
}

// ── system/human prompt (mirrors agentMaterializeGen.buildSystemPrompt/buildHumanPrompt) ──
function buildSystemPrompt(skillSections, outputPath) {
  const skills = skillSections.length ? skillSections.join('\n\n---\n\n') : '<!-- no skill loaded -->';
  return `<!-- modelType: codeinstruct2 -->

You generate a TypeScript file based on a definition and context files.

Target file: ${outputPath}

The file must start with:
/// <mls fileReference="${outputPath}" enhancement="_blank"/>

Follow the instructions in the skill(s) below exactly.
Use the context files (dependsFiles) as reference for types, imports and logic.

---

${skills}`;
}

function buildHumanPrompt(definition, contextSections, outputPath) {
  const lines = ['## Definition', '', '```json', JSON.stringify(definition, null, 2), '```', ''];
  if (contextSections.length) {
    lines.push('## Context files (dependsFiles)', '');
    for (const c of contextSections) lines.push(c, '');
  }
  lines.push(`## Output`, '', `Generate ONLY the TypeScript for: ${outputPath}`);
  return lines.join('\n');
}

function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node materializeHarness.mjs <defsPath|_NNNNN_/...defs.ts> [outDir]'); process.exit(1); }
  const defsAbs = arg.startsWith('_') ? mlsToFs(arg) : path.resolve(process.cwd(), arg);
  const src = readIfExists(defsAbs);
  if (src == null) { console.error(`defs not found: ${defsAbs}`); process.exit(1); }

  const exportName = firstExportName(src);
  const data = exportName ? extractConstObject(src, exportName) : null;
  const pipelineArr = extractConstObject(src, 'pipeline');
  const item = Array.isArray(pipelineArr) ? pipelineArr[0] : null;
  if (!item) { console.error('no pipeline item found in defs'); process.exit(1); }

  const skillSections = [];
  const skillReport = [];
  for (const s of item.skills || []) {
    const r = readDepends(s);
    skillReport.push(`${r.found ? 'OK ' : 'MISS'} ${s}`);
    if (r.found) skillSections.push(`<!-- skill: ${s} -->\n${r.content}`);
  }
  const contextSections = [];
  const depReport = [];
  for (const d of item.dependsFiles || []) {
    const r = readDepends(d);
    depReport.push(`${r.found ? 'OK ' : 'MISS'} ${d}`);
    if (r.found) contextSections.push(`### ${r.ref}\n\`\`\`ts\n${r.content}\n\`\`\``);
  }

  const systemPrompt = buildSystemPrompt(skillSections, item.outputPath);
  const humanPrompt = buildHumanPrompt(data?.data ?? data, contextSections, item.outputPath);

  const outDir = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : path.join(ROOT, '.cbHarness', path.basename(item.outputPath).replace(/\W+/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'system.md'), systemPrompt);
  fs.writeFileSync(path.join(outDir, 'human.md'), humanPrompt);
  fs.writeFileSync(path.join(outDir, 'prompt.md'), `# SYSTEM\n\n${systemPrompt}\n\n# HUMAN\n\n${humanPrompt}\n`);

  console.log(`defs:       ${arg}`);
  console.log(`type:       ${item.type}`);
  console.log(`outputPath: ${item.outputPath}`);
  console.log(`agent:      ${item.agent}`);
  console.log(`skills:     ${skillReport.join(' | ') || '(none)'}`);
  console.log(`deps:       ${depReport.join(' | ') || '(none)'}`);
  console.log(`written:    ${outDir}/{system.md,human.md,prompt.md}`);
}

main();
