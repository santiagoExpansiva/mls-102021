# agentChangeBackend — spec (sem implementação)

Projeto: master backend (102021). Tipo: **worker (reconciliador) de backend**.
Documento auto-contido (não depende de outros arquivos).

## Propósito

Olhar o `status` dos owners no `l4` e **fazer só o que está pendente** (um "to-be"): criar/atualizar/remover a **persistência e implementação** — tabelas (`layer_1_external`), entidades de runtime (`layer_4`), implementação de usecases (`layer_3`) e tabelas de métrica — a partir da **ontologia + operations/workflows** (o contrato BFF de intenção). Chama a **materialização** (`.defs.ts → .ts`). No fim, muda o `status`. Pode ser chamado **a qualquer momento** e fazer **um único item** (uma tabela, um usecase, um arquivo). Idempotente.

## Modelo compartilhado (contexto auto-contido)

**Camadas:** `l4` = business (lido daqui); `l1` = artefatos de backend (escritos aqui); `l5` = dados de projeto. Caminhos:
- Lê de `l4` (no **projeto do cliente**, ex.: `mls-102043`): `l4/{module}/ontology/*`, `l4/operations/*`, `l4/workflows/*`, `l4/rules/*`.
- Escreve em `l1` (projeto do cliente): `l1/{module}/layer_1_external/*` (tabelas + metric tables), `l1/{module}/layer_4_entities/*` (runtime das entidades), `l1/{module}/layer_3_usecases/*` (implementação dos usecases).
- Materializa `.defs.ts → .ts` (L1).

> Observação: os artefatos moram sempre no **projeto do cliente**; o que muda é qual **agente/projeto** roda. Este agente é definido em 102021 (master backend) e opera sobre o `l4`/`l1` do projeto do cliente.

**Owners (de onde o backend nasce):**
- **Operation** = ação direta sobre 1 entidade → mapeia para a tabela/binding da entidade + implementação `layer_3` do usecase. A Operation declara `reads`/`writes` por **id de ontologia**; o backend deriva as tabelas.
- **Workflow** = processo → orquestra operations; pode implicar `layer_3` de orquestração e efeitos de persistência (status/eventos).
- **Ontology** = entidades de dados → tabelas (`layer_1`) + runtime (`layer_4`).

**Enum de status (único, no item de Workflow/Operation/Rule):** `toCreate | toUpdate | toRemove | inProgress | done`.

**Espaço de IDs:** o backend resolve tabelas a partir dos **ids de ontologia** das operations/entities. **Nunca** confiar em nomes de agregado.

**Guardrails (lições analise10/11/12):**
- **Ontologia = só dados** (o agente nunca cria tabela para use-case/`Uc*`; se aparecer entidade `kind:"usecase"`, ignora — não é dado persistente, não trava).
- `metricsTablesRequired` é invariante derivado (métricas pedidas ⇒ `true`); nunca rebaixar — coagir se necessário, não falhar.
- **Critic/repair:** erros determinísticos (integridade referencial) são duros; quando o critic (LLM) não converge no budget, aceita o último índice e rebaixa o restante a **warning** — nunca derruba a task.
- Telas, contratos BFF por página e menu **não** são responsabilidade deste agente.

## Responsabilidade deste agente

1. **Varrer** o `l4` em busca de owners (Operations/Workflows/Ontology) com `status` ≠ `done` — ou processar **um item específico** recebido como argumento.
2. Para cada item pendente:
   - `toCreate` / `toUpdate`: derivar/atualizar persistência — índice de persistência, tabela(s) (`layer_1`), runtime (`layer_4`), implementação `layer_3` do(s) usecase(s), e metric tables quando aplicável; **materializar** (`.defs.ts → .ts` L1).
   - `toRemove`: remover/deprecar tabela/impl + `.ts` materializado (cascata; **cuidado com dados** — marcar `deprecated` e exigir confirmação antes de drop real).
3. **Mudar o `status`** do item ao concluir.

## Steps (alto nível, sem implementação)

- `scan-pending` — lista owners com status pendente (ou recebe 1 item).
- `plan-persistence` — do conjunto pendente, planeja tabelas/índice (com os guardrails acima). Mantém o loop critic/repair endurecido.
- `generate-backend` (por item) — tabela / layer_4 / layer_3 / metric table.
- `materialize` — chama a materialização L1 existente (`.defs.ts → .ts`).
- `flip-status` — marca `inProgress` ao iniciar e `done` ao concluir (ver nota de status).

## Entrada / Saída

- **Entrada:** `l4` do módulo (ontologia + operations/workflows + rules + status). Opcional: um item específico (tabela/usecase/entity) para processar só ele.
- **Saída:** artefatos de backend em `l1` criados/atualizados/removidos, materializados em `.ts`, e `status` dos itens processados atualizado.

## Status (único, no owner)

Pega itens com `status` ≠ `done`; ao iniciar seta `inProgress`; ao concluir marca `done`. Como o status é único e este worker costuma ser o **terminal** numa mudança que envolve frontend+backend, a convenção é: rodar `agentChangeFrontend` antes e o backend marcar `done`; mudança só de backend é marcada `done` por ele mesmo. *(Detalhe a refinar na implementação.)*

## O que este agente NÃO faz

- Não decide O QUE muda (isso é `agentChangeSolution`/`agentNewSolution2`); só executa o que já está marcado no `l4`.
- Não gera telas, contratos BFF por página nem menu.
- Não cria/edita ontologia, workflows, operations ou rules (consome).

## Referências de artefato
- Lê: `l4/...` (ontologia + operations/workflows + rules) no projeto do cliente.
- Escreve: `l1/{module}/layer_1_external/*`, `l1/{module}/layer_4_entities/*`, `l1/{module}/layer_3_usecases/*` + `.ts` materializado.
- Reusa: materialização L1 já existente (102021 agentMaterializeL1).
