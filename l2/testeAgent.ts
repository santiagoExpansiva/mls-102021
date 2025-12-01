/// <mls shortName="testeAgent" project="102021" enhancement="_100554_enhancementLit" />

import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { StateLitElement } from '_100554_/l2/stateLitElement';
import { addOrUpdateEndPoint } from './aiIntegrationHub';

@customElement('teste-agent-102021')
export class ExampleCqrs extends StateLitElement {

    
    render() {
        return html `<button @click=${this.clickMsg}>fire</button>`;
    }
    clickMsg() {
        const pt1 = {
            name: "listServices",
            intent: "I need an endpoint to fetch available services for selection.",
            responseInterfaces: "interface Service {\nid: string;\nname: string;\ndescription: string;\nprice: string;\niconUrl: string;\n}\ninterface ServicesResponse {\nservices: Service[];\n}",
            requestInterfaces: "",
        };
        const pt2 = {
            name: "listHighlightedServices",
            intent: "I need an endpoint to fetch the list of highlighted services.",
            responseInterfaces: "interface Service {\nname: string;\ndescription: string;\niconUrl: string;\n}\ninterface ServicesResponse {\nservices: Service[];\n}",
            requestInterfaces: "",
        };
        this.addMessageIA(JSON.stringify(pt1), pt1);
    }
    async addMessageIA(prompt:any, pt1:any) {
        //await executeAgentByFile('agentEndpoint', prompt, mls.stor.files['102021_2_testAgent.ts'], false);
        console.info('iniciou');
        await addOrUpdateEndPoint(pt1.name, pt1.intent, pt1.responseInterfaces, pt1.requestInterfaces, undefined);
        console.info('terminou');
    }

}