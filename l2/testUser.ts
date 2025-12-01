/// <mls shortName="testUser" project="102021" enhancement="_100554_enhancementLit" />


import { html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { StateLitElement } from '_100554_/l2/stateLitElement';
import { UserRecord } from "_102021_/l1/global"; 


const pendingRequests: Record<string, any> = {};

export class Test {

    constructor() {
        this.open();
        this.listen();
    }

    private channel?: BroadcastChannel;
    private mode: 'develpoment' | 'production' = 'develpoment';
    public running: boolean = false;

    public open(name = 'collab') {
        if (this.running) return this;
        this.channel = new BroadcastChannel(name);
        return this;
    }

    public listen(mode: 'develpoment' | 'production' = 'develpoment') {
        if (this.running) return this;
        if (!this.channel) throw new Error('Channel not opened');
        this.mode = mode;
        this.channel.onmessage = (event) => {

            if (event.data.type !== "fetch-response") return;
            const resolve = pendingRequests[event.data.id];
            if (!resolve) return;
            delete pendingRequests[event.data.id];

            resolve(new Response(event.data.body, {
                status: event.data.status,
                headers: event.data.headers
            }));
        };

        this.running = true;

        return this;
    }

    public async send(url: string, options: any): Promise<Response> {
        return new Promise((resolve, reject) => {

            if (!this.channel) {
                reject(new Error('Channel not opened'));
                return;
            }

            if (this.mode === 'production') {
                reject(new Error('Not prepared yet'));
                return;
            }

            const id: string = crypto.randomUUID();
            pendingRequests[id] = resolve;

            options.inDeveloped = true;

            const opt = {
                type: "fetch-request",
                id: id,
                url,
                server: 'example',
                options: JSON.stringify(options)

            }

            this.channel.postMessage(opt);
        });
    }

    public close() {
        this.channel?.close();
        this.channel = undefined;
        return this;
    }
}

export interface RequestMsgBase {
    type: "fetch-request",
    server: string,
    url: string,
    id: string,
    options: string,
    headers: any

}

export interface ResponseMsgBase {
    type: "fetch-response",
    id: string,
    body: string,
    status: number,
    headers: any
}

@customElement('test-user-102021')
export class TestUser extends StateLitElement {

    private fire = new Test();
    @state() users: any[] = [];
    @state() audit: any[] = [];
    private iptFilter = ''; 

    @state() form = {
        id: null,
        name: '',
        password: '',
        cpf: ''
    }; 

    async connectedCallback() {
        super.connectedCallback();
        await this.loadUsers();
        await this.loadAudit();
    }

    // -------------------------------------------------------------
    // 🔹 Render
    // -------------------------------------------------------------
    render() {
        return html`
            <div class="container">

                <!-- LISTA DE USUÁRIOS -->
                <div class="list">
                    <h3>Usuários <input type="text" @input=${(e:any) => this.iptFilter = e.target.value}/> <button @click=${()=> this.loadUsers(this.iptFilter)}> Buscar </button></h3>

                    ${this.users.map(u => html`
                        <div class="list-item" @click=${() => this.selectUser(u)}>
                            ${u.name} (${u.email})
                            <span class="delete-btn" @click=${(e: any) => {
                e.stopPropagation();
                this.onDelete(u.id);
            }}>🗑</span>
                        </div>
                    `)}
                </div>

                <!-- FORMULÁRIO -->
                <div>
                    <h3>${this.form.id ? "Editar usuário" : "Novo usuário"}</h3>

                    <div class="form">
                        <label>
                            Nome:
                            <input 
                                type="text"
                                .value=${this.form.name}
                                @input=${(e: any) => this.updateField("name", e.target.value)}
                            >
                        </label>

                        <label>
                            Password:
                            <input 
                                type="text"
                                .value=${this.form.password}
                                @input=${(e: any) => this.updateField("password", e.target.value)}
                            >
                        </label>

                        <label>
                            Cpf:
                            <input 
                                type="text"
                                .value=${this.form.cpf}
                                @input=${(e: any) => this.updateField("cpf", e.target.value)}
                            >
                        </label>

                        <button @click=${this.onSave}>
                            Salvar
                        </button>
                        <button @click=${this.resetForm}>Limpar</button>
                    </div>

                    <!-- AUDITORIA -->
                    <h3>Audit Log</h3>
                    <table>
                        <thead>
                            <tr>
                            <th>Id</th>
                                <th>User</th>
                                <th>Data</th>
                                <th>Ação</th>
                                <th>Origem</th>
                                <th>Descrição</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.audit.map(a => html`
                                <tr>
                                <td>${a.id}</td> 
                                    <td>${a.user}</td> 
                                    <td>${a.date}</td>
                                    <td>${a.action}</td>
                                    <td>${a.origin}</td>
                                    <td><pre>${a.description}</pre></td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } 

    // -------------------------------------------------------------
    // 🔹 Você implementa a lógica interna dessas funções no backend
    // -------------------------------------------------------------
    async loadUsers(filter:string = '') {

        const req = {
            action: 'listUser',
            params: { filter }
        }

        const res = await this.fire.send('example/exec/', req);
        const dt = (await res.json()).data ;
        const u: any[] = [];
        dt.forEach((i: any) => {
            u.push({
                id: i.id,
                name: i.details.name,
                password: i.details.password,
                cpf: i.details.cpf,
            })
        });

        this.users = u;
    }

    async saveUser(user: any) {

        const req = {
            version: '1',
            action: user.id ? 'uppUser' : 'addUser',
            params: {
                id: user.id,
                details: {
                    name: user.name,
                    password: user.password,
                    cpf: user.cpf
                }
            } as UserRecord
        }

        const res = await this.fire.send('example/exec/', req);

        console.info(res);

    }

    async deleteUser(id: any) {
        // remover no backend
        const req = {
            version: '1',
            action: 'delUser' ,
            params: {
                id,
                
            } 
        }

        const res = await this.fire.send('example/exec/', req);

        console.info(res);
    }

    async loadAudit() {

        const req = {
            action: 'listAudit',
            param: { filter: '' }
        }
        const res = await this.fire.send('example/exec/', req);
        const dt = (await res.json()).data;
        this.audit = dt;

    }

    // -------------------------------------------------------------
    // 🔹 Lógica de interface
    // -------------------------------------------------------------
    selectUser(u: any) {
        this.form = {
            id: u.id,
            name: u.name,
            password: u.password,
            cpf: u.cpf
        };
    }

    async onSave() {
        await this.saveUser(this.form);
        await this.loadUsers();
        await this.loadAudit();
        this.resetForm();
    }

    resetForm() {
        this.form = { id: null, name: '', password: '', cpf: '' };
    }

    async onDelete(id: any) {
        await this.deleteUser(id);
        await this.loadUsers();
        await this.loadAudit();

        if (this.form.id === id) {
            this.resetForm();
        }
    }

    updateField(field: any, value: any) {
        this.form = { ...this.form, [field]: value };
    }
}