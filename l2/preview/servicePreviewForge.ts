/// <mls fileReference="_102021_/l2/preview/servicePreviewForge.ts" enhancement="_102027_/l2/enhancementLit"/>

import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

declare const mls: any;

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

@customElement('service-preview-forge-102021')
export class ServicePreviewForge102021 extends LitElement {

  @state() private running = false;
  @state() private building = false;
  @state() private logs: LogEntry[] = [];

  private iframe: HTMLIFrameElement | null = null;
  private esbuild: any;

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  disconnectedCallback() {
    super.disconnectedCallback();
    this.doStop();
  }

  // ── UI handlers ───────────────────────────────────────────────────────────────

  private async handleToggle() {
    if (this.running) this.doStop();
    else await this.doStart();
  }

  private handleClearLogs() {
    this.logs = [];
  }

  // ── Start / Stop ─────────────────────────────────────────────────────────────

  private async doStart() {
    this.building = true;
    this.addLog('info', 'Building L1 bundle...');
    try {
      await this.ensureEsbuild();
      const bundle = await this.buildBundle();
      if (!bundle) {
        this.addLog('error', 'Build failed — check logs above');
        return;
      }
      this.addLog('info', `Bundle ready (${(bundle.length / 1024).toFixed(1)} kB) — mounting iframe`);
      this.mountIframe(bundle);
      this.running = true;
    } catch (e: any) {
      this.addLog('error', `Start error: ${e.message}`);
    } finally {
      this.building = false;
    }
  }

  private doStop() {
    if (this.iframe) {
      (this.iframe.contentWindow as any).onmessage = null;
      this.iframe.remove();
      this.iframe = null;
    }
    const reg = (top as any).previewL1 as Record<string, any> | undefined;
    if (reg) delete reg[`forge_${mls.actualProject}`];
    this.running = false;
    this.addLog('info', 'Server stopped');
  }

  // ── esbuild ───────────────────────────────────────────────────────────────────

  private async ensureEsbuild() {
    if (this.esbuild) return;
    if ((mls as any).esbuild) { this.esbuild = (mls as any).esbuild; return; }
    if ((mls as any).esbuildInLoad) {
      await new Promise<void>(res => {
        const t = setInterval(() => { if ((mls as any).esbuild) { clearInterval(t); res(); } }, 100);
      });
      this.esbuild = (mls as any).esbuild;
      return;
    }
    this.addLog('info', 'Loading esbuild-wasm...');
    (mls as any).esbuildInLoad = true;
    const mod = await import('https://unpkg.com/esbuild-wasm@0.14.54/esm/browser.min.js');
    await (mod as any).initialize({ wasmURL: 'https://unpkg.com/esbuild-wasm@0.14.54/esbuild.wasm' });
    this.esbuild = mod;
    (mls as any).esbuild = mod;
    (mls as any).esbuildInLoad = false;
    this.addLog('info', 'esbuild ready');
  }

  // ── Bundle ────────────────────────────────────────────────────────────────────

  private async buildBundle(): Promise<string | null> {
    const project = mls.actualProject as number;
    const routerPaths = this.discoverRouters(project);
    if (!routerPaths.length) {
      this.addLog('warn', 'No layer_2_controllers/router.ts found in project');
      return null;
    }
    this.addLog('info', `Routers found: ${routerPaths.map(p => p.split('/')[0]).join(', ')}`);

    const virtualFiles = await this.getVirtualFiles(project);
    const entry = this.buildEntry(routerPaths);

    try {
      const result = await this.esbuild.build({
        stdin: { contents: entry, sourcefile: 'forge-entry.ts', resolveDir: '/' },
        bundle: true,
        write: false,
        format: 'esm',
        loader: { '.ts': 'ts' },
        plugins: [this.makeVfsPlugin(virtualFiles)],
      });
      if (result.errors?.length) {
        result.errors.forEach((e: any) => this.addLog('error', `Build: ${e.text}`));
        return null;
      }
      result.warnings?.forEach((w: any) => this.addLog('warn', `Build: ${w.text}`));
      return result.outputFiles?.[0]?.text ?? null;
    } catch (e: any) {
      this.addLog('error', `esbuild threw: ${e.message}`);
      return null;
    }
  }

  private discoverRouters(project: number): string[] {
    return (Object.values(mls.stor.files) as any[])
      .filter(f => f?.project === project && f?.level === 1 && f?.shortName === 'router' && f?.extension === '.ts')
      .map(f => f.folder ? `${f.folder}/${f.shortName}` : f.shortName);
  }

  private buildEntry(routerPaths: string[]): string {
    const imports = routerPaths
      .map((p, i) => `import * as _r${i} from './${p}.js';`)
      .join('\n');

    const merge = routerPaths
      .map((_p, i) => `
  { const fn = Object.values(_r${i}).find((v: any) => typeof v === 'function');
    if (fn) try { (fn as any)().forEach((h: any, k: string) => allRoutes.set(k, h)); } catch(e) {} }`)
      .join('');

    return `
${imports}

const allRoutes = new Map<string, Function>();
${merge}

const _sendLog = (level: string, ...args: any[]) => {
  try { parent.postMessage({ type: 'forge-log', level, msg: args.map(String).join(' ') }, '*'); } catch {}
};
const _cl = console.log.bind(console);
const _cw = console.warn.bind(console);
const _ce = console.error.bind(console);
(console as any).log   = (...a: any[]) => { _cl(...a);  _sendLog('info',  ...a); };
(console as any).warn  = (...a: any[]) => { _cw(...a);  _sendLog('warn',  ...a); };
(console as any).error = (...a: any[]) => { _ce(...a);  _sendLog('error', ...a); };

_sendLog('info', '[forge] routes registered: ' + allRoutes.size + ' — [' + [...allRoutes.keys()].join(', ') + ']');

(window as any).exec = async function(body: any) {
  const route: string = typeof body === 'string' ? body : (body.route ?? '');
  const params: any   = body.params ?? body;
  const handler = allRoutes.get(route);
  if (!handler) {
    _sendLog('warn', '[forge] 404 route:', route);
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found: ' + route } };
  }
  try {
    const data = await (handler as any)(params);
    _sendLog('info', '[forge] 200', route);
    return { ok: true, data };
  } catch(e: any) {
    _sendLog('error', '[forge] 500', route, e?.message);
    return { ok: false, error: { code: 'HANDLER_ERROR', message: e?.message ?? String(e) } };
  }
};
`;
  }

  private async getVirtualFiles(project: number): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const f of Object.values(mls.stor.files) as any[]) {
      if (!f || f.project !== project || f.level !== 1 || f.extension !== '.ts') continue;
      const key = ((f.folder ? `${f.folder}/${f.shortName}` : f.shortName) + '.js').toLowerCase();
      if (!out[key]) out[key] = (await f.getContent()) as string ?? '';
    }
    return out;
  }

  private makeVfsPlugin(files: Record<string, string>) {
    const warn = (m: string) => this.addLog('warn', m);
    return {
      name: 'forge-vfs',
      setup(build: any) {
        build.onResolve({ filter: /^[./]/ }, (args: any) => {
          const base = 'file://' + (args.importer || '/');
          let resolved = new URL(args.path, base).pathname;
          if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) resolved += '.js';
          return { path: resolved, namespace: 'vfs' };
        });
        build.onLoad({ filter: /\.(ts|js)$/, namespace: 'vfs' }, (args: any) => {
          const key = args.path.replace(/^\/+/, '').toLowerCase();
          const src = files[key];
          if (!src) { warn(`[vfs] stub: ${key}`); return { contents: '// stub', loader: 'ts' }; }
          return { contents: src, loader: 'ts' };
        });
      }
    };
  }

  // ── Iframe ────────────────────────────────────────────────────────────────────

  private mountIframe(bundle: string) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.style.display = 'none';
    (this.renderRoot as ShadowRoot).appendChild(iframe);
    this.iframe = iframe;

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><body><script type="module">${bundle}<\/script></body></html>`);
    doc.close();

    // Register in the global previewL1 registry that servicePreviewView looks up
    if (!(top as any).previewL1) (top as any).previewL1 = {};
    (top as any).previewL1[`forge_${mls.actualProject}`] = { iframe };
    this.addLog('info', `Registered as previewL1.forge_${mls.actualProject}`);

    iframe.contentWindow!.onmessage = async (e: MessageEvent) => {
      const data = e.data;

      // Logs forwarded from the iframe bundle
      if (data?.type === 'forge-log') {
        this.addLog(data.level ?? 'info', data.msg ?? '');
        return;
      }

      if (data?.type !== 'fetch-request') return;

      const res = {
        type: 'fetch-response',
        id: data.id,
        body: '',
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      };

      const execFn = (iframe.contentWindow as any)?.exec;
      if (!execFn) {
        res.body = JSON.stringify({ ok: false, error: { code: 'NOT_READY', message: 'exec not mounted yet' } });
        res.status = 503;
      } else {
        try {
          const params = data.options?.body ? JSON.parse(data.options.body) : {};
          const result = await execFn(params);
          res.body = JSON.stringify(result);
        } catch (e: any) {
          res.body = JSON.stringify({ ok: false, error: { code: 'EXEC_ERROR', message: e.message } });
          res.status = 500;
        }
      }

      const previewWin = (window as any).preview?.iframe?.contentWindow;
      if (previewWin) previewWin.postMessage(res, '*');
    };
  }

  // ── Logs ─────────────────────────────────────────────────────────────────────

  private addLog(level: 'info' | 'warn' | 'error', msg: string) {
    const time = new Date().toTimeString().slice(0, 8);
    this.logs = [...this.logs.slice(-299), { time, level, msg }];
    // auto-scroll
    this.updateComplete.then(() => {
      const el = this.renderRoot.querySelector('.forge__console');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="forge">
        <header class="forge__header">
          <div class="forge__title">
            <span class="forge__dot forge__dot--${this.running ? 'on' : 'off'}"></span>
            <span>L1 Forge &mdash; project ${mls?.actualProject ?? '?'}</span>
          </div>
          <div class="forge__controls">
            <button
              class="forge__btn forge__btn--${this.running ? 'stop' : 'start'}"
              ?disabled=${this.building}
              @click=${this.handleToggle}
            >${this.building ? '⏳ Building…' : this.running ? '⏹ Stop' : '▶ Start'}</button>
            <button class="forge__btn forge__btn--ghost" @click=${this.handleClearLogs}>Clear</button>
          </div>
        </header>
        <div class="forge__console">
          ${repeat(this.logs, (_l, i) => i, l => html`
            <div class="forge__line forge__line--${l.level}">
              <span class="forge__time">${l.time}</span>
              <span class="forge__msg">${l.msg}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  static styles = css`
    :host { display: block; font-family: 'Consolas', 'Menlo', monospace; font-size: 12px; }

    .forge {
      display: flex; flex-direction: column; height: 100%;
      background: #1e1e1e; color: #ccc; border-radius: 6px; overflow: hidden;
    }
    .forge__header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; background: #252526; border-bottom: 1px solid #333; flex-shrink: 0;
    }
    .forge__title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #e0e0e0; }
    .forge__dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .forge__dot--on  { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
    .forge__dot--off { background: #555; }

    .forge__controls { display: flex; gap: 6px; }
    .forge__btn {
      border: none; border-radius: 4px; padding: 4px 12px;
      cursor: pointer; font-size: 12px; font-family: inherit;
    }
    .forge__btn--start { background: #2d7d32; color: #fff; }
    .forge__btn--stop  { background: #b71c1c; color: #fff; }
    .forge__btn--ghost { background: #3a3a3a; color: #aaa; }
    .forge__btn:disabled { opacity: .4; cursor: default; }

    .forge__console {
      flex: 1; overflow-y: auto; padding: 8px 10px;
      display: flex; flex-direction: column; gap: 1px;
    }
    .forge__line { display: flex; gap: 10px; line-height: 1.6; }
    .forge__time { color: #555; flex-shrink: 0; user-select: none; }
    .forge__line--info  .forge__msg { color: #9cdcfe; }
    .forge__line--warn  .forge__msg { color: #ce9178; }
    .forge__line--error .forge__msg { color: #f48771; }
  `;
}
