/// <mls shortName="liveServer" project="102021" enhancement="_100554_enhancementLit" />

import { html, repeat, unsafeHTML } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { CollabLitElement } from './_100554_collabLitElement';
import { servers,  onServer, offServer, restartServer, IServer} from './_102021_start';

@customElement('live-server-102021')
export class ServicePreviewL1ListServer extends CollabLitElement {

    
    @state() listItens: IServer[] = [];
    @query("#viewServer") viewServer: HTMLElement | undefined;
    
    constructor() {
        super();
        this.init();
    }

    //--------COMPONENT----------

    render() {
        return html`
        <div class="wrap">
            ${this.renderHeader()}
            ${this.renderList()}
        </div>
        <div id="modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="modal" role="document">
                <button class="btn close" id="closeModal" aria-label="Fechar" @click=${this.handleCloseView}>Close</button>
                <h3 id="modalTitle">Server Details</h3>
                <p id="modalBody">Server information...</p>
                <div id="viewServer">
                </div>
            </div>
        </div>
        `;
    }

    renderHeader() {
        return html`
        <header>
            <div>
                <h1>Servers</h1>
                <p class="lead">List of servers with status and quick actions (Power On/Off, Restart, View)</p>
            </div>
        </header>
        `
    }

    renderList() {
        return html`
        <main>
            <div class="list" id="serverList" aria-live="polite">
                ${repeat(this.listItens, ((key: IServer) => key.server) as any, ((k: IServer, index: any) => { return this.renderItem(k, index) }) as any)}
            </div>
        </main>
        `
    }

    renderItem(item: IServer, idx: number) { 
        const n = item.icon ? unsafeHTML(item.icon) : `SV${idx + 1}`;
        let clsBadge = '';
        let textBadge = '';
        let disabled = false;
        let attr = '';

        if (item.status === 'on') {
            clsBadge = 'badge--on';
            textBadge = ' On'
            disabled = false;
            attr = '';
        }else if (item.status === 'off') { 

            clsBadge = 'badge--off';
            textBadge = ' Off';
            disabled = true;
            attr = 'aria-disabled';

        } else if (item.status === 'restarting') {

            clsBadge = 'badge--restart';
            textBadge = '<span class="spinner" aria-hidden="true"></span> Restarting';
            disabled = true;
            attr = 'aria-disabled';
        }



        return html`
        <div class="server" data-status="off" data-path="${item.server}">
            <div class="server-main">
                <div class="thumb">${n}</div>
                <div class="meta">
                    <div class="name">${item.name}</div>
                    <div class="desc">File: ${item.server}</div>
                </div>
            </div>

            <div class="status">
                <div class="badge ${clsBadge}">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/></svg>
                    ${textBadge}
                </div>

                <div class="controls">
                    <button class="btn btn--primary btn-power" title="Desligar/ligar" @click=${this.handleClickPower}>
                        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 8.5a7 7 0 1013 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                        Power
                    </button>

                    <button class="btn btn--danger btn-restart" title="Restart"  @click=${this.handleClickRestart} ?disabled=${disabled} ${attr}>
                        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 12a9 9 0 11-9-9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Restart
                    </button>

                    <button class="btn btn--primary btn-view" title="Visualizar" @click=${this.handleClickView} >
                        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                        View
                    </button>
                </div>
            </div>
        </div>
        `
    }

    //---------IMPLEMENTS-------------


    private async init() {

        this.listItens = Object.values(servers);

    }

    private handleClickPower(ev: MouseEvent) {

        const btn = (ev.target as HTMLElement).closest('button');
        if (!btn) return;
        const server = btn.closest('.server') as HTMLElement;
        if (!server) return;
        const path = server.getAttribute('data-path') as string;
        if (!path) return;

        const current = server.getAttribute('data-status');
        if (current === 'on') {
            server.setAttribute('data-status', 'off');
        } else {
            server.setAttribute('data-status', 'on');
        }

        this.refreshRow(path, server);

    }

    private handleClickRestart(ev: MouseEvent) {

        const btn = (ev.target as HTMLElement).closest('button');
        if (!btn) return;
        const server = btn.closest('.server') as HTMLElement;
        if (!server) return;
        const path = server.getAttribute('data-path') as string;
        if (!path) return;

        if (server.getAttribute('data-status') !== 'on') return;

        server.setAttribute('data-status', 'restarting');
        this.refreshRow(path, server);


    }

    private handleClickView(ev: MouseEvent) {

        const btn = (ev.target as HTMLElement).closest('button');
        if (!btn) return;
        const server = btn.closest('.server') as HTMLElement;
        if (!server) return;
        const path = server.getAttribute('data-path') as string;
        if (!path) return;

        const modal = this.querySelector('#modal') as HTMLElement;
        if (!modal) return;

        if (!this.viewServer) return;

        const item = this.listItens.find((i) => i.server === path);
        if (!item) return;

        this.viewServer.innerHTML = '';
        this.viewServer.appendChild(item.iframe);

        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');


    }

    private handleCloseView(ev: MouseEvent) {

        const btn = (ev.target as HTMLElement).closest('button');
        if (!btn) return;
        const modal = btn.closest('#modal') as HTMLElement;
        if (!modal) return;

        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');


    }

    private refreshRow(path: string, row: HTMLElement) {
        const status = row.getAttribute('data-status');
        
        const item = this.listItens.find((i) => i.server === path);
        if (!item) return;

        if (status === 'on') {
            
            onServer(item);

        } else if (status === 'off') {

            
            offServer(item);

        } else if (status === 'restarting') {

            
            restartServer(item);
        }

    }

    

}