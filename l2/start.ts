/// <mls shortName="start" project="102021" enhancement="_blank" />

import { getProjectConfig } from './_100554_libCommom';
import { build, InfoBuild } from './_102021_buildServer';

let iframes: Record<string, IServer> = {};
export let servers: Record<string, IServer> = {};
export let listItens: IListItem[] = [];
let div = document.createElement('div') as HTMLElement;
let body = document.querySelector('body') as HTMLElement;

export async function start(project: number, startServers: 'all' | 'none' | string = 'none') {

    const m = await getProjectConfig(project);
    const array: IListItem[] = [];

    if (!m) throw new Error('[start]: Not found project module');

    if (m.modules) {
        m.modules.forEach((s: any, index: number) => {
            if (!s.pathServer) return;
            array.push({
                name: s.name || 'S' + (index + 1),
                server: s.pathServer || 'null',
                icon: s.icon
            })
        })
    }
    listItens = array;
    div.style.display = 'none';
    body.appendChild(div);
    loadIframes(startServers);
}

async function loadIframes(startServers: 'all' | 'none' | string) {


    for await (let info of listItens) {
        createServer(info,  startServers === 'all' || startServers === info.name)

    }

}

function createServer(info: IListItem,  start: boolean): void {

    if (iframes[info.server]) return

    const server: IServer = {
        icon: info.icon,
        name: info.name,
        server: info.server,
        iframe: document.createElement('iframe') as HTMLIFrameElement,
        status: 'off'

    }


    server.iframe.src = '/_100554_servicePreviewL1';
    server.iframe.onload = () => {
        try {
            setHtml(server);
            if (start) onServer(server);

        } catch (e) {
            server.status = 'off';
        }

    };

    server.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframes[info.server] = server;

    servers = {};
    Object.keys(iframes).forEach((key: string) => {
        const f = listItens.find((i: IListItem) => i.server === key);
        if (f) servers[f.name] = iframes[key];
    });

    (top as any).previewL1 = servers;
    div.appendChild(server.iframe);

}

export async function setHtml(server: IServer) {

    if (!server.iframe.contentDocument) return;

    const path = mls.l2.getPath(server.server);

    let txt = `
    <collab-console-l1-100554 file="${server.server}"></collab-console-l1-100554>
    <style>
        html{
            height:100%;
        }
        body{
            height: calc(100% - 34px);
        }
    </style>`;

    server.iframe.contentDocument.body.innerHTML = txt;

    const info: InfoBuild = {
        project: path.project,
        shortName: path.shortName,
        folder: path.folder,
    }

    const bundle = await build(info);

    mountJSImporMap(server.iframe);
    mountJSBundle(bundle, server.iframe);
}

function mountJSImporMap(ifr: HTMLIFrameElement): void {

    try {
        if (!ifr.contentDocument) return;

        const importsMap = [
            '"lit": "https://cdn.jsdelivr.net/gh/lit/dist@3/all/lit-all.min.js"',
            '"lit/decorators.js": "https://cdn.jsdelivr.net/npm/lit@3.0.0/decorators/+esm"'];

        const js = '{"imports": { ' + importsMap.join(',\n') + '} }';
        const script = document.createElement('script');
        script.type = 'importmap';
        script.textContent = js;
        ifr.contentDocument.head.appendChild(script);

    } catch (e: any) {
        console.info('Error mountJSImporMap: ' + e.message);
        return;
    }

}

function mountJSBundle(jsCode: string, ifr: HTMLIFrameElement) {
    try {
        if (!ifr.contentDocument) return;

        const script = document.createElement('script');
        script.type = "module";
        script.textContent = jsCode;

        ifr.contentDocument.body.appendChild(script);

        const scriptBase = document.createElement('script');
        scriptBase.type = "module";
        scriptBase.src = "/_100554_collabConsoleL1";

        ifr.contentDocument.body.appendChild(scriptBase);



    } catch (e: any) {
        console.info('Error mountJSBundle: ' + e.message);
    }
}

export function onServer(server: IServer) {

    if (!server.iframe.contentWindow) return;

    server.iframe.contentWindow.onmessage = async (e) => {

        const data = e.data;
        console.info('message', data);
        const res: ResponseMsgBase = {
            type: "fetch-response",
            id: data.id,
            body: '',
            status: 200,
            headers: { "Content-Type": "application/json" }
        }

        if (data.type === "fetch-request") {

            const method = 'exec'; // data.url.split('/').filter(Boolean).join('_');
            if (server.iframe && (server.iframe.contentWindow as any)[method]) {

                const exec = (server.iframe.contentWindow as any)[method];
                const strJson = data.options && data.options.body ? data.options.body : '{}';
                const resposta = await exec(JSON.parse(strJson));
                res.body = JSON.stringify(resposta)

                if (window.preview.iframe && window.preview.iframe.contentWindow)
                    window.preview.iframe.contentWindow.postMessage(res, "*" as any);

            }
        }

    };

}

export function restartServer(server: IServer) {
    
    const item = listItens.find((i, index) => i.server === server.server);
    if (iframes[server.server]) {
        iframes[server.server].iframe.remove();
        delete iframes[server.server];
    }

    if (item) createServer(item, true);

}

export function offServer(server: IServer) {

    if (!iframes[server.server]) return;
    const i = iframes[server.server].iframe;
    if (!i.contentWindow) return;

    i.contentWindow.onmessage = () => undefined;

}

interface ResponseMsgBase {
    type: "fetch-response",
    id: string,
    body: string,
    status: number,
    headers: any

}

interface IListItem {
    name: string,
    server: string,
    icon: string | undefined
}

export interface IServer {
    icon:string | undefined,
    name: string,
    server: string,
    iframe: HTMLIFrameElement,
    status: 'on' | 'off' | 'restarting'
}