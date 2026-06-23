/// <mls fileReference="_102021_/l2/agentMaterializeSolution/registerBackEnd.ts" enhancement="_blank"/>

import {
  getFileContent,
  saveGeneratedTs,
  parseMlsPath,
  toMlsPath,
} from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';
import type { AfterSaveCtx } from '/_102027_/l2/agentMaterializeSolution/artifactsMaterialize.js';
import {
  addImport,
  addRoute,
} from '/_102021_/l2/agentMaterializeSolution/ast/astRouter.js';
import {
  addTableDef,
  extractTableDefVarName,
} from '/_102021_/l2/agentMaterializeSolution/ast/astPersistence.js';

// ─── File-level mutex ─────────────────────────────────────────────────────────

const fileLocks = new Map<string, Promise<void>>();

function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(res => { release = res; });
  fileLocks.set(path, current);
  return prev.then(() => fn()).finally(() => release());
}

// ─── Controller registration ──────────────────────────────────────────────────

interface RouterEntry {
  routeKey: string;
  handlerName: string;
  importPath: string;
}

function extractRouterEntries(source: string): RouterEntry[] {
  const results: RouterEntry[] = [];
  const re = /'([^']+)'\s*:\s*\{\s*handlerName\s*:\s*'([^']+)'\s*,\s*importPath\s*:\s*'([^']+)'\s*,?\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    results.push({ routeKey: m[1], handlerName: m[2], importPath: m[3] });
  }
  return results;
}

export async function registerController(ctx: AfterSaveCtx): Promise<void> {
  const entries = extractRouterEntries(ctx.code);
  if (!entries.length) return;

  const routerPath = toMlsPath(ctx.project, 1, `${ctx.moduleName}/layer_2_controllers`, 'router', '.ts');

  return withLock(routerPath, async () => {
    const routerSource = await getFileContent(ctx.project, 1, `${ctx.moduleName}/layer_2_controllers`, 'router', '.ts');
    if (!routerSource) return;

    let updated = routerSource;
    for (const { routeKey, handlerName, importPath } of entries) {
      updated = addImport(updated, { kind: 'value', names: [handlerName], from: importPath });
      updated = addRoute(updated, routeKey, handlerName);
    }

    if (updated === routerSource) return;
    const p = parseMlsPath(routerPath);
    if (p) await saveGeneratedTs(p.project, p.level, p.folder, p.shortName, updated);
  });
}

// ─── Layer1 (persistence) registration ───────────────────────────────────────

export async function registerLayer1(ctx: AfterSaveCtx): Promise<void> {
  const varName = extractTableDefVarName(ctx.code);
  if (!varName) return;

  const importPath = '/' + ctx.outputPath.replace(/\.ts$/, '.js');
  const persistencePath = toMlsPath(ctx.project, 1, `${ctx.moduleName}/layer_1_external`, 'persistence', '.ts');

  return withLock(persistencePath, async () => {
    const persistenceSource = await getFileContent(ctx.project, 1, `${ctx.moduleName}/layer_1_external`, 'persistence', '.ts');
    if (!persistenceSource) return;

    const updated = addTableDef(persistenceSource, varName, importPath);
    if (updated === persistenceSource) return;

    const p = parseMlsPath(persistencePath);
    if (p) await saveGeneratedTs(p.project, p.level, p.folder, p.shortName, updated);
  });
}
