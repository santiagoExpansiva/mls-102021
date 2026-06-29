/// <mls fileReference="_102021_/l1/cbMaterializeCli/llmClient.ts" enhancement="_blank"/>

// Node HTTP client that calls collab-llm DIRECTLY (avoids CORS; reuses the same Bearer token
// collab-messages uses). Mirrors collab-messages callProxyLLM: POST {baseUrl}/v1/chat/completions
// (OpenAI-compatible) with a forced tool call (tool_choice) and x-tool-strict, then reads the tool
// arguments back out of choices[0].message.tool_calls[0].function.arguments.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { GEN_TOOL, GEN_TOOL_NAME, type GenResult } from '../../l2/agentChangeBackend/cbMaterializeCore.js';

export interface LlmConfig {
  baseUrl: string;          // e.g. http://localhost:3050 (collab-llm.baseUrl in appconfig.json)
  token: string;            // Bearer: the cak_ API key collab-messages uses (hook.collabtoken)
  orgId?: string;           // X-Org-Id (default "collab")
  userId?: string;          // X-User-Id (default "agentMaterializeL1")
  agentName?: string;       // X-Agent-Name
  toolStrict?: boolean;     // x-tool-strict header (schema-validate tool args)
  timeoutMs?: number;       // request timeout (default 200000)
  temperature?: number;     // default 0
  maxTokens?: number;       // default 8000
}

interface HttpResponse { ok: boolean; status: number; statusText: string; text: string; }

function postJson(endpoint: string, headers: Record<string, string>, payload: unknown, timeoutMs: number): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const body = JSON.stringify(payload);
    const impl = url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : null;
    if (!impl) { reject(new Error(`Unsupported collab-llm protocol: ${url.protocol}`)); return; }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void): void => { if (settled) return; settled = true; if (timer) clearTimeout(timer); fn(); };

    const req = impl(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        finish(() => resolve({ ok: status >= 200 && status < 300, status, statusText: res.statusMessage ?? '', text: Buffer.concat(chunks).toString('utf8') }));
      });
      res.on('aborted', () => finish(() => reject(new Error('collab-llm response aborted'))));
      res.on('error', (e) => finish(() => reject(e)));
    });
    req.on('error', (e) => finish(() => reject(e)));
    timer = setTimeout(() => { req.destroy(); finish(() => reject(new Error(`collab-llm request timed out after ${timeoutMs}ms`))); }, timeoutMs);
    req.write(body);
    req.end();
  });
}

// Pull the GenResult ({code}) out of an OpenAI chat-completions response (forced tool call). Exported
// so it can be unit-tested against a canned response without any network.
export function parseGenResult(responseText: string, toolName = GEN_TOOL_NAME): GenResult {
  let body: any;
  try { body = JSON.parse(responseText); } catch { throw new Error('collab-llm response is not JSON'); }
  const toolCalls = body?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    const content = body?.choices?.[0]?.message?.content;
    throw new Error(`collab-llm returned no tool_calls${typeof content === 'string' ? ` (content: ${content.slice(0, 200)})` : ''}`);
  }
  const call = toolCalls.find((t: any) => t?.function?.name === toolName) ?? toolCalls[0];
  const rawArgs = call?.function?.arguments;
  const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  if (!args || typeof args.code !== 'string' || !args.code.trim()) throw new Error('tool arguments missing a non-empty "code"');
  return { code: args.code };
}

export interface LlmCallInput { model: string; system: string; human: string; }

// Rich result so the runner can trace both success and failure (raw body + collab-llm usage). HTTP and
// parse errors are returned (ok:false), not thrown — only config errors throw.
export interface LlmResult {
  ok: boolean;
  code?: string;
  raw: string;                       // full collab-llm response body
  usage?: Record<string, unknown>;   // collab-llm trace: provider, model, alias, cost, attempts, tool_strict…
  httpStatus: number;
  error?: string;
}

export async function callCollabLlm(cfg: LlmConfig, input: LlmCallInput): Promise<LlmResult> {
  if (!cfg.baseUrl) throw new Error('collab-llm baseUrl is not configured');
  if (!cfg.token) throw new Error('collab-llm token is not configured');
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.token}`,
    'X-Title': 'agentMaterializeL1',
    'X-Collab-Origin': 'agentMaterializeL1',
    'X-User-Id': cfg.userId || 'agentMaterializeL1',
    'X-Org-Id': cfg.orgId || 'collab',
    ...(cfg.agentName ? { 'X-Agent-Name': cfg.agentName } : {}),
    ...(cfg.toolStrict ? { 'x-tool-strict': 'true' } : {}),
  };

  const payload = {
    model: input.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.human },
    ],
    stream: false,
    temperature: cfg.temperature ?? 0,
    max_tokens: cfg.maxTokens ?? 32000,
    tools: [GEN_TOOL],
    tool_choice: { type: 'function', function: { name: GEN_TOOL_NAME } },
  };

  const res = await postJson(endpoint, headers, payload, cfg.timeoutMs ?? 200000);
  let usage: Record<string, unknown> | undefined;
  try { usage = (JSON.parse(res.text) as { usage?: Record<string, unknown> }).usage; } catch { /* keep undefined */ }

  if (!res.ok) {
    return { ok: false, raw: res.text, usage, httpStatus: res.status, error: `${res.status} ${res.statusText}` };
  }
  try {
    const gen = parseGenResult(res.text);
    return { ok: true, code: gen.code, raw: res.text, usage, httpStatus: res.status };
  } catch (e) {
    return { ok: false, raw: res.text, usage, httpStatus: res.status, error: e instanceof Error ? e.message : String(e) };
  }
}
