/// <mls fileReference="_102021_/l2/agentMaterializeSolution/ast/astPersistence.ts" enhancement="_blank"/>

// Target file format:
//
//   import { stockMovementTableDef } from '/_102043_/l1/cafeFlow/layer_1_external/stockMovement.js';
//   import { stockItemTableDef } from '/_102043_/l1/cafeFlow/layer_1_external/stockItem.js';
//
//   export const tableDefinitions: TableDefinition[] = [
//     stockMovementTableDef,
//     stockItemTableDef,
//   ];

// ============================================================
// TYPES
// ============================================================

export interface ImportEntry {
  kind: 'type' | 'value';
  names: string[];
  from: string;
}

// ============================================================
// PARSE
// ============================================================

export function parsePersistence(source: string): {
  imports: ImportEntry[];
  tableDefVarNames: string[];
} {
  return {
    imports: getImports(source),
    tableDefVarNames: getTableDefs(source),
  };
}

// ============================================================
// IMPORTS — read
// ============================================================

function getImportSpans(source: string): Array<ImportEntry & { start: number; end: number }> {
  const results: Array<ImportEntry & { start: number; end: number }> = [];
  const re = /^(import\s+(?:type\s+)?)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const kind: 'type' | 'value' = m[1].includes('type') ? 'type' : 'value';
    const names = m[2].split(',').map(n => n.trim()).filter(Boolean);
    results.push({ kind, names, from: m[3], start: m.index, end: m.index + m[0].length });
  }
  return results;
}

export function getImports(source: string): ImportEntry[] {
  return getImportSpans(source).map(({ start: _s, end: _e, ...e }) => e);
}

export function hasImport(source: string, from: string): boolean {
  return getImports(source).some(i => i.from === from);
}

// ============================================================
// IMPORTS — write
// ============================================================

function addImportInternal(source: string, imp: ImportEntry): string {
  const spans = getImportSpans(source);
  const existing = spans.find(i => i.from === imp.from);

  if (existing) {
    const newNames = imp.names.filter(n => !existing.names.includes(n));
    if (!newNames.length) return source;
    const merged: ImportEntry = { ...existing, names: [...existing.names, ...newNames] };
    return source.slice(0, existing.start) + buildImportLine(merged) + source.slice(existing.end);
  }

  const exportIdx = source.search(/^export\b/m);
  const insertAt = exportIdx === -1 ? source.length : exportIdx;
  return source.slice(0, insertAt) + buildImportLine(imp) + '\n' + source.slice(insertAt);
}

function removeImportInternal(source: string, from: string): string {
  const spans = getImportSpans(source);
  const target = spans.find(i => i.from === from);
  if (!target) return source;
  let end = target.end;
  if (source[end] === '\n') end++;
  return source.slice(0, target.start) + source.slice(end);
}

// ============================================================
// TABLE DEFS ARRAY — read
// ============================================================

function getArraySpan(source: string): { content: string; start: number; end: number } | null {
  const re = /export\s+const\s+tableDefinitions[^=]*=\s*\[/;
  const match = re.exec(source);
  if (!match) return null;
  const start = match.index + match[0].length - 1; // position of [
  const content = balancedSlice(source, start, '[', ']');
  return { content, start, end: start + content.length };
}

function getTableDefSpans(source: string): Array<{ varName: string; start: number; end: number }> {
  const block = getArraySpan(source);
  if (!block) return [];

  // inner content between [ and ]
  const inner = block.content.slice(1, -1);
  const re = /\b([A-Za-z_$][\w$]*)\b/g;
  const results: Array<{ varName: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    results.push({
      varName: m[1],
      start: block.start + 1 + m.index,
      end: block.start + 1 + m.index + m[0].length,
    });
  }
  return results;
}

export function getTableDefs(source: string): string[] {
  return getTableDefSpans(source).map(e => e.varName);
}

export function hasTableDef(source: string, varName: string): boolean {
  return getTableDefs(source).includes(varName);
}

// ============================================================
// TABLE DEFS ARRAY — write
// ============================================================

export function addTableDef(
  source: string,
  varName: string,
  importPath: string,
  throwIfExists = false,
): string {
  if (hasTableDef(source, varName)) {
    if (throwIfExists) throw new Error(`TableDef "${varName}" already exists.`);
    return source;
  }

  // 1. add import
  let updated = addImportInternal(source, { kind: 'value', names: [varName], from: importPath });

  // 2. add to array
  const block = getArraySpan(updated);
  if (!block) throw new Error('Could not find tableDefinitions array in source.');

  const spans = getTableDefSpans(updated);

  if (spans.length === 0) {
    const replacement = `[\n  ${varName},\n]`;
    return updated.slice(0, block.start) + replacement + updated.slice(block.end);
  }

  const last = spans[spans.length - 1];
  let insertAt = last.end;
  const hasTrailingComma = updated[insertAt] === ',';
  if (hasTrailingComma) insertAt++;

  const prefix = hasTrailingComma ? '' : ',';
  return updated.slice(0, insertAt) + `${prefix}\n  ${varName},` + updated.slice(insertAt);
}

export function removeTableDef(
  source: string,
  varName: string,
  importPath: string,
): string {
  let updated = source;

  // 1. remove from array
  const spans = getTableDefSpans(updated);
  const target = spans.find(e => e.varName === varName);
  if (target) {
    const idx = spans.indexOf(target);
    const isLast = idx === spans.length - 1;

    let start = target.start;
    let end = target.end;

    if (isLast && idx > 0) {
      let prev = start - 1;
      while (prev >= 0 && /[ \t]/.test(updated[prev])) prev--;
      if (updated[prev] === ',') start = prev;
      while (start > 0 && /[ \t\n]/.test(updated[start - 1])) start--;
    } else {
      if (updated[end] === ',') end++;
      if (updated[end] === '\n') end++;
    }

    updated = updated.slice(0, start) + updated.slice(end);
  }

  // 2. remove import
  updated = removeImportInternal(updated, importPath);

  return updated;
}

// ============================================================
// EXTRACT varName from generated layer_1 source
// ============================================================

export function extractTableDefVarName(source: string): string | null {
  const m = /export\s+const\s+(\w+)\s*:\s*TableDefinition\s*=/.exec(source);
  return m ? m[1] : null;
}

// ============================================================
// INTERNAL — helpers
// ============================================================

function buildImportLine(imp: ImportEntry): string {
  const keyword = imp.kind === 'type' ? 'import type' : 'import';
  const inline = `${keyword} { ${imp.names.join(', ')} } from '${imp.from}';`;
  if (inline.length <= 80) return inline;
  const names = imp.names.map(n => `  ${n},`).join('\n');
  return `${keyword} {\n${names}\n} from '${imp.from}';`;
}

function balancedSlice(source: string, start: number, open: string, close: string): string {
  let depth = 0;
  let inStr = false;
  let strCh = '';
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
    if (ch === open) depth++;
    if (ch === close) { if (--depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Unbalanced block starting at ${start}.`);
}


// ============================================================
// USE CASE
// ============================================================

/*

test('add tableDef', () => {
  let out = addTableDef(SRC, 'stockMovementTableDef', '/_102043_/l1/cafeFlow/layer_1_external/stockMovement.js');
  contains(out, 'stockMovementTableDef');
  contains(out, "from '/_102043_/l1/cafeFlow/layer_1_external/stockMovement.js'");
  eq(getTableDefs(out).length, 2);
});

test('remove tableDef', () => {
  let out = removeTableDef(SRC, 'stockItemTableDef', '/_102043_/l1/cafeFlow/layer_1_external/stockItem.js');
  eq(getTableDefs(out).length, 0);
  eq(hasImport(out, '/_102043_/l1/cafeFlow/layer_1_external/stockItem.js'), false);
});

*/
