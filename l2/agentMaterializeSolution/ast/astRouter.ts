/// <mls fileReference="_102021_/l2/agentMaterializeSolution/ast/astRouter.ts" enhancement="_blank"/>

// ============================================================
// TYPES
// ============================================================

export interface ImportEntry {
  /** 'import type' or 'import' */
  kind: 'type' | 'value';
  /** named imports */
  names: string[];
  /** caminho do módulo */
  from: string;
}

export interface RouteEntry {
  /** chave do Map: 'pizzaria.getCustomer' */
  key: string;
  /** nome do handler: 'customerEditorGetCustomerHandler' */
  handler: string;
}

// ============================================================
// PARSE
// ============================================================

export function parseRouter(source: string): {
  mlsComment: string | null;
  imports: ImportEntry[];
  routes: RouteEntry[];
} {
  return {
    mlsComment: getMlsComment(source),
    imports: getImports(source),
    routes: getRoutes(source),
  };
}

// ============================================================
// MLS COMMENT
// ============================================================

export function getMlsComment(source: string): string | null {
  const match = /^\/\/\/\s*<mls[^>]*\/>/m.exec(source);
  return match ? match[0] : null;
}

// ============================================================
// IMPORTS — leitura
// ============================================================

/**
 * Retorna todos os import { ... } from '...'; do arquivo,
 * com seu intervalo [start, end] no source para que o replace
 * funcione por posição (não por reconstrução da string).
 */
function getImportSpans(source: string): Array<ImportEntry & { start: number; end: number }> {
  const results: Array<ImportEntry & { start: number; end: number }> = [];
  // captura o bloco inteiro: import (type)? { ... } from '...' ;?
  const re = /^(import\s+(?:type\s+)?)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const kind: 'type' | 'value' = m[1].includes('type') ? 'type' : 'value';
    const names = m[2]
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);
    const from = m[3];
    results.push({ kind, names, from, start: m.index, end: m.index + m[0].length });
  }
  return results;
}

export function getImports(source: string): ImportEntry[] {
  return getImportSpans(source).map(({ start: _s, end: _e, ...entry }) => entry);
}

export function hasImport(source: string, from: string): boolean {
  return getImports(source).some(i => i.from === from);
}

// ============================================================
// IMPORTS — escrita
// ============================================================

/**
 * Adiciona um import.
 * - Se já existe um import do mesmo `from`, faz merge dos `names`.
 * - Caso contrário, insere antes da primeira linha `export`.
 */
export function addImport(source: string, imp: ImportEntry): string {
  const spans = getImportSpans(source);
  const existing = spans.find(i => i.from === imp.from);

  if (existing) {
    const newNames = imp.names.filter(n => !existing.names.includes(n));
    if (newNames.length === 0) return source;
    const merged: ImportEntry = { ...existing, names: [...existing.names, ...newNames] };
    // substitui o bloco original pelo novo, usando posição
    return source.slice(0, existing.start) + buildImportLine(merged) + source.slice(existing.end);
  }

  const exportIdx = source.search(/^export\b/m);
  const insertAt = exportIdx === -1 ? source.length : exportIdx;
  return source.slice(0, insertAt) + buildImportLine(imp) + '\n' + source.slice(insertAt);
}

/**
 * Remove o import inteiro cujo `from` bate com o argumento.
 */
export function removeImport(source: string, from: string): string {
  const spans = getImportSpans(source);
  const target = spans.find(i => i.from === from);
  if (!target) return source;
  // remove a linha + o \n que a segue (se houver)
  let end = target.end;
  if (source[end] === '\n') end++;
  return source.slice(0, target.start) + source.slice(end);
}

/**
 * Remove um nome específico de um import.
 * Se for o único nome, remove o import inteiro.
 */
export function removeImportName(source: string, from: string, name: string): string {
  const spans = getImportSpans(source);
  const target = spans.find(i => i.from === from);
  if (!target || !target.names.includes(name)) return source;

  const remaining = target.names.filter(n => n !== name);
  if (remaining.length === 0) return removeImport(source, from);

  const updated: ImportEntry = { ...target, names: remaining };
  return source.slice(0, target.start) + buildImportLine(updated) + source.slice(target.end);
}

// ============================================================
// ROUTES — leitura
// ============================================================

function getRouteSpans(source: string): Array<RouteEntry & { start: number; end: number }> {
  const mapBody = extractMapBodySpan(source);
  if (!mapBody) throw new Error('Could not find Map constructor in source.');

  const re = /\[\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\]/g;
  const results: Array<RouteEntry & { start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mapBody.content)) !== null) {
    results.push({
      key: m[1],
      handler: m[2],
      start: mapBody.start + m.index,
      end: mapBody.start + m.index + m[0].length,
    });
  }
  return results;
}

export function getRoutes(source: string): RouteEntry[] {
  return getRouteSpans(source).map(({ start: _s, end: _e, ...r }) => r);
}

export function hasRoute(source: string, key: string): boolean {
  return getRoutes(source).some(r => r.key === key);
}

// ============================================================
// ROUTES — escrita
// ============================================================

/**
 * Adiciona uma rota ao Map, depois da última entrada existente.
 * Suporta Map vazio: new Map([]) ou new Map<...>([]).
 *
 * @param throwIfExists - se true, lança erro quando a rota já existe. Default: false.
 */
export function addRoute(
  source: string,
  key: string,
  handler: string,
  throwIfExists = false,
): string {
  if (hasRoute(source, key)) {
    if (throwIfExists) throw new Error(`Route "${key}" already exists.`);
    return source;
  }

  const mapBody = extractMapBodySpan(source);
  if (!mapBody) throw new Error('Could not find Map constructor in source.');

  const spans = getRouteSpans(source);
  const newEntry = `['${key}', ${handler}]`;

  if (spans.length === 0) {
    // Map vazio — substitui [] por [\n    entry,\n  ]
    const replacement = `[\n    ${newEntry},\n  ]`;
    return source.slice(0, mapBody.start) + replacement + source.slice(mapBody.end);
  }

  const last = spans[spans.length - 1];
  let insertAt = last.end;
  const hasTrailingComma = source[insertAt] === ',';
  if (hasTrailingComma) insertAt++;

  const prefix = hasTrailingComma ? '' : ',';
  return source.slice(0, insertAt) + `${prefix}\n    ${newEntry},` + source.slice(insertAt);
}

/**
 * Remove uma rota do Map pela chave.
 */
export function removeRoute(source: string, key: string): string {
  const spans = getRouteSpans(source);
  const target = spans.find(r => r.key === key);
  if (!target) throw new Error(`Route "${key}" not found.`);

  const all = spans;
  const idx = all.indexOf(target);
  const isLast = idx === all.length - 1;

  let start = target.start;
  let end = target.end;

  if (isLast && idx > 0) {
    // remove também a vírgula ANTES dessa rota (que ficaria pendurada)
    let prev = start - 1;
    while (prev >= 0 && /[ \t]/.test(source[prev])) prev--;
    if (source[prev] === ',') start = prev; // inclui a vírgula anterior
    // remove o \n e espaços antes da rota
    while (start > 0 && /[ \t\n]/.test(source[start - 1])) start--;
  } else {
    // remove a vírgula e o \n que seguem (linha inteira)
    if (source[end] === ',') end++;
    if (source[end] === '\n') end++;
  }

  return source.slice(0, start) + source.slice(end);
}

/**
 * Troca o handler de uma rota existente (substituição por posição).
 */
export function updateRoute(source: string, key: string, newHandler: string): string {
  const spans = getRouteSpans(source);
  const target = spans.find(r => r.key === key);
  if (!target) throw new Error(`Route "${key}" not found.`);

  // reconstrói apenas a entrada do Map
  const original = source.slice(target.start, target.end);
  const updated = original.replace(
    /(['"]\s*,\s*)[A-Za-z_$][\w$]*/,
    `$1${newHandler}`
  );
  return source.slice(0, target.start) + updated + source.slice(target.end);
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

interface Span { content: string; start: number; end: number }

function extractMapBodySpan(source: string): Span | null {
  const match = /new\s+Map(?:<[^>]*>)?\s*\(\s*\[/.exec(source);
  if (!match) return null;
  const start = match.index + match[0].length - 1; // posição do [
  const content = balancedSlice(source, start, '[', ']');
  return { content, start, end: start + content.length };
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
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === open) depth++;
    if (ch === close) { if (--depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('Unbalanced block.');
}

// ============================================================
// AUXILIAR FUNCTIONS
// ============================================================

type RouteHandlerPair = [routeKey: string, handlerName: string];

function routeToHandlerName(routeKey: string, pageName: string): string {
  const parts = routeKey.replace(pageName, '').split('.');
  // first part stays camelCase (pageName), each subsequent part gets first letter uppercased
  return pageName + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('') + 'Handler';
}

export function extractRouteHandlers(definition: { pages: any[] }, moduleName: string): RouteHandlerPair[] {
  const page = definition.pages[0];
  const pageName: string = page.pageName;
  const seen = new Set<string>();
  const result: RouteHandlerPair[] = [];

  const add = (routeKey: string) => {
    if (seen.has(routeKey)) return;
    seen.add(routeKey);
    result.push([routeKey, routeToHandlerName(routeKey, pageName)]);
  }

  // 1. Read routines — from dataShape.sourceRoutine across all organisms
  for (const section of (page.sections ?? []) as any[]) {
    for (const organism of (section.organisms ?? []) as any[]) {
      const routine: string | undefined = organism.dataShape?.sourceRoutine;
      if (routine && routine.startsWith(moduleName)) add(routine);
      /*const emits: any[] = organism.emits || [];
      emits.forEach((emit) => {
        if (emit && emit.event.startsWith(moduleName)) add(emit.event);
      });*/
    }
  }

  /*// 2. Write/action routines — from actionStates, skip UI-only state values
  const skipSuffixes = new Set(['idle', 'loading', 'success', 'error']);
  for (const actionState of (page.actionStates ?? []) as any[]) {
    const stateKey: string = actionState.stateKey ?? '';
    const parts = stateKey.split('.');
    const suffix = parts[parts.length - 1] ?? '';
    if (!suffix || skipSuffixes.has(suffix)) continue;
    add(`${moduleName}.${pageName}.${suffix}`);
  }*/

  return result;
}

// ============================================================
// USE CASE
// ============================================================

/*

test('add rota + import em cadeia', () => {
  let out = addImport(SRC, {
    kind: 'value',
    names: ['customerEditorDeleteHandler'],
    from: '/_102035_/l1/pizzaria/layer_2_controller/customerEditor.js',
  });
  out = addRoute(out, 'pizzaria.deleteItem', 'customerEditorDeleteHandler');
 
  contains(out, 'customerEditorDeleteHandler');
  contains(out, "'pizzaria.deleteItem'");
  eq(getRoutes(out).length, 5);
  eq(getImports(out).find(i => i.from.includes('customerEditor'))?.names.includes('customerEditorDeleteHandler'), true);
});
 
test('remove rota + import em cadeia', () => {
  let out = removeRoute(SRC, 'pizzaria.seedMockData');
  out = removeImportName(
    out,
    '/_102035_/l1/pizzaria/layer_2_controller/customerEditor.js',
    'customerEditorLoadHandler'
  );

*/
