/// <mls fileReference="_102021_/l2/agentChangeBackend/cbMaterializeIo.ts" enhancement="_blank"/>

// Platform I/O glue for the in-studio materializer (agentCbMaterialize), vendored into agentChangeBackend
// so it does not depend on agentMaterializeSolution (being removed). Pure mls.stor / libStor access; the
// pure prompt/parse/order logic lives in cbMaterializeCore.ts (shared with the Node CLI).

import { createStorFile } from '/_102027_/l2/libStor.js';
import type { PipelineItem } from '/_102021_/l2/agentChangeBackend/cbMaterializeCore.js';

// L1 layer folders that may hold a .defs.ts with a pipeline (hexagonal: only layer_1_external in v1,
// but keep the full set so the scan is robust if defs land in other layers).
const L1_LAYERS = ['layer_1_external', 'layer_2_application', 'layer_3_domain', 'layer_4_entities', 'layer_3_usecases', 'layer_2_controllers'];

export interface ParsedMlsPath {
  project: number;
  level: number;
  folder: string;
  shortName: string;
  extension: string;
}

/** Extract the `pipeline` array from a .defs.ts content string. */
export function parsePipelineFromContent(content: string): PipelineItem[] | null {
  try {
    const match = content.match(/export\s+const\s+pipeline\s*=\s*([\s\S]*?)\s+as\s+const\s*;/u);
    if (!match) return null;
    return JSON.parse(match[1]) as PipelineItem[];
  } catch {
    return null;
  }
}

/** Scan every l1 .defs.ts (with a pipeline) of a module. */
export async function scanL1DefsWithPipeline(
  project: number,
  moduleName: string,
): Promise<Array<{ folder: string; shortName: string; pipeline: PipelineItem[] }>> {
  const result: Array<{ folder: string; shortName: string; pipeline: PipelineItem[] }> = [];
  try {
    const prefix = `${moduleName}/`;
    for (const f of Object.values(mls.stor.files as Record<string, any>)) {
      if (f.project !== project) continue;
      if (f.level !== 1) continue;
      const folder = String(f.folder || '');
      if (!folder.startsWith(prefix)) continue;
      if (!L1_LAYERS.some((layer) => folder === `${moduleName}/${layer}` || folder.startsWith(`${moduleName}/${layer}/`))) continue;
      if (f.extension !== '.defs.ts') continue;
      if (f.status === 'deleted') continue;
      if (f.shortName === 'module' || f.shortName === 'index') continue;
      const content = String(await f.getContent());
      const pipeline = parsePipelineFromContent(content);
      if (!pipeline || pipeline.length === 0) continue;
      result.push({ folder, shortName: f.shortName as string, pipeline });
    }
  } catch (err) {
    console.warn('[cbMaterializeIo] scanL1DefsWithPipeline failed', err);
  }
  return result;
}

/** updatedAt (ms) of a file, MAX_SAFE_INTEGER when new/changed without a timestamp, else null. */
export function getFileModified(
  project: number,
  level: number,
  folder: string,
  shortName: string,
  extension: string,
): number | null {
  try {
    const key = mls.stor.getKeyToFile({ project, level, folder, shortName, extension });
    const file = (mls.stor.files as Record<string, mls.stor.IFileInfo>)[key];
    if (!file || file.status === 'deleted') return null;
    if (file.updatedAt) return Date.parse(file.updatedAt);
    const status = (file as any).status as string;
    return (status === 'new' || status === 'changed') ? Number.MAX_SAFE_INTEGER : null;
  } catch {
    return null;
  }
}

/** Read any file by its full MLS path string. */
export async function getContentByMlsPath(mlsPath: string): Promise<string | null> {
  try {
    const info = mls.stor.convertFileReferenceToFile(mlsPath);
    const key = mls.stor.getKeyToFile(info);
    const file = (mls.stor.files as Record<string, any>)[key];
    if (!file || file.status === 'deleted') return null;
    return String(await file.getContent());
  } catch {
    return null;
  }
}

/** Parse a MLS path like `_102050_/l1/cafeFlow/layer_1_external/adapters/persistence/order.ts`. */
export function parseMlsPath(mlsPath: string): ParsedMlsPath | null {
  const match = mlsPath.match(/^_(\d+)_\/l(\d+)\/(.+)$/u);
  if (!match) return null;
  const project = parseInt(match[1], 10);
  const level = parseInt(match[2], 10);
  const rest = match[3];
  const lastSlash = rest.lastIndexOf('/');
  const folder = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
  const filename = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  let shortName: string, extension: string;
  if (filename.endsWith('.defs.ts')) { shortName = filename.slice(0, -'.defs.ts'.length); extension = '.defs.ts'; }
  else if (filename.endsWith('.d.ts')) { shortName = filename.slice(0, -'.d.ts'.length); extension = '.d.ts'; }
  else { const dot = filename.lastIndexOf('.'); shortName = dot >= 0 ? filename.slice(0, dot) : filename; extension = dot >= 0 ? filename.slice(dot) : ''; }
  return { project, level, folder, shortName, extension };
}

async function compileGeneratedTs(project: number, level: number, folder: string, shortName: string): Promise<void> {
  try {
    const editorKey = mls.editor.getKeyModel(project, shortName, folder, level);
    let modelBase = mls.editor.models[editorKey];
    if (!modelBase) modelBase = await mls.editor.addModels(project, shortName, folder, level) as mls.editor.IModels;
    const modelTs = modelBase?.ts as mls.editor.IModelTS;
    if (!modelTs) return;
    if (modelTs.compilerResults) modelTs.compilerResults.modelNeedCompile = true;
    await mls.l2.typescript.compileAndPostProcess(modelTs, true, true);
    mls.editor.forceModelUpdate(modelTs.model);
  } catch (err) {
    console.warn('[cbMaterializeIo] compileGeneratedTs failed', err);
  }
}

/** Save (create or overwrite) a generated .ts file and force a recompile. */
export async function saveGeneratedTs(
  project: number,
  level: number,
  folder: string,
  shortName: string,
  content: string,
): Promise<boolean> {
  try {
    const fileInfo = { project, level, folder, shortName, extension: '.ts' };
    const key = mls.stor.getKeyToFile(fileInfo);
    let file = (mls.stor.files as Record<string, any>)[key] as mls.stor.IFileInfo;
    if (!file) {
      file = await createStorFile({ ...fileInfo, source: content }, false, false, false);
    } else {
      const model = await file.getOrCreateModel();
      if (model) model.model.setValue(content);
    }
    // Bump updatedAt so the freshly materialized .ts is newer than its .defs.ts (keeps isStale correct
    // across runs); libStor.createStorFile / setContent do not set it.
    file.updatedAt = new Date().toISOString();
    await mls.stor.localStor.setContent(file, { contentType: 'string', content });
    if (!shortName.endsWith('.defs')) await compileGeneratedTs(project, level, folder, shortName);
    return true;
  } catch (err) {
    console.warn('[cbMaterializeIo] saveGeneratedTs failed', err);
    return false;
  }
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Pull the arguments of a named tool call out of the model payload (several shapes supported). */
export function extractToolCallArgs<T>(raw: unknown, toolName: string): T | null {
  const v = parseMaybeJson(raw);
  if (!isRecord(v)) return null;
  if (v.toolName === toolName) {
    const args = parseMaybeJson(v.arguments);
    return isRecord(args) ? (args as unknown as T) : null;
  }
  if (v.type === 'flexible' && v.result !== undefined) {
    const result = parseMaybeJson(v.result);
    if (isRecord(result) && result.toolName === toolName) {
      const args = parseMaybeJson(result.arguments);
      return isRecord(args) ? (args as unknown as T) : null;
    }
  }
  if (Array.isArray(v.tool_calls)) {
    const call = (v.tool_calls as unknown[]).find(
      (item) => isRecord(item) && isRecord((item as any).function) && (item as any).function.name === toolName,
    );
    if (isRecord(call)) {
      const args = parseMaybeJson((call as any).function.arguments);
      return isRecord(args) ? (args as unknown as T) : null;
    }
  }
  return null;
}
