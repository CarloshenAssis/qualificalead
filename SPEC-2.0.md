# SPEC 2.0 — LeadHunter: Prospeccao Inteligente e CRM de Outbound

Status: **nucleo de dominio implementado (Fase 0 + Fase 1) — integracoes externas pendentes**

Base tecnica: LeadHunter no commit `a74d13f`
Documentos anteriores: `SPEC.md`, `SPEC-1.1.md`, `SPEC-1.2.md`

Este documento registra **o que foi construido** da SPEC 2.0 e, com a mesma clareza,
o que ainda nao foi. A SPEC 2.0 descreve seis fases; esta entrega cobre as regras de
dominio que todas as fases seguintes consomem, mais o schema completo.

---

## 1. Decisoes que o codigo ja garante

| Decisao (SPEC 2.0 §37) | Onde vive | Como e verificada |
| --- | --- | --- |
| WhatsApp e manual, fora de qualquer motor de automacao | `lib/whatsapp/manual.ts` | `tests/spec2-whatsapp-manual.test.ts` varre `lib/`, `app/`, `components/` e `types/` procurando cliente de API, biblioteca nao oficial ou credencial de WhatsApp. O teste falha se alguem adicionar um. |
| Score multidimensional e versionado | `lib/qualification/` | `score_version` em toda saida; o score da 1.x vira historico `score_version = 1` na migracao. |
| A oferta e recomendada por regra versionada, derivada do gap | `lib/offers/catalog.ts` | Cada oferta declara os gaps que resolve e a evidencia minima que exige. |
| Resposta interrompe a cadencia | `lib/email/events.ts`, `lib/email/eligibility.ts` | `REPLIED` cancela os passos seguintes; o portao de envio barra qualquer lead que ja respondeu. |
| Ausencia na fonte nao confirma ausencia real | `types/spec2.ts`, `lib/gaps/catalog.ts` | Observacao com valor `null` ("nao consegui olhar") impede a avaliacao do gap, em vez de virar `false`. |
| Supressao prevalece sobre campanha e automacao | `lib/email/suppression.ts` | Checagem pura, sem dependencia, chamavel em qualquer ponto do caminho de envio. |
| Volume bruto nao e metrica de sucesso | `lib/email/events.ts` | Abertura e clique nao mudam estado de mensagem; a metrica primaria e resposta (§18.5). |

## 2. O que foi implementado

### Dominio (puro, testavel sem banco e sem rede)

- **Campanhas** (`lib/campaigns/state.ts`) — maquina de estados §7.3, pre-condicoes de
  ativacao §7.4 e barreira de orcamento §8.5. `canSendEmails` so devolve `true` para
  `ACTIVE`: `DRAFT` e `REVIEW_REQUIRED` nunca enviam.
- **Catalogo de gaps** (`lib/gaps/catalog.ts`) — os 12 gaps externos e os 4 internos do
  §12, cada um com a evidencia que exige. Gap interno nasce em `NEEDS_REVIEW`.
- **Catalogo de ofertas** (`lib/offers/catalog.ts`) — as 12 ofertas do §13 com gaps
  compativeis, evidencia minima, CTA e tipo de demonstracao. Preco fica `null`: e
  decisao comercial do usuario, nao do sistema.
- **Qualificacao** (`lib/qualification/`) — os seis subscores do §14.1, a formula do
  §14.2, as faixas do §14.3 e **todos** os guardrails do §14.4, incluindo o teto de 40%
  para um unico gap (com a forma fechada que o torna estavel apos a reducao).
- **Contatos** (`lib/contacts/priority.ts`) — normalizacao, estados de verificacao §10.2
  e a hierarquia de prioridade §10.3. E-mail invalido, com bounce ou suprimido nunca e
  agendavel.
- **E-mail** (`lib/email/`) — portao de envio §17.3 (21 condicoes, todas reportadas de
  uma vez), idempotencia §17.4, janela e jitter deterministico §17.5, efeitos de evento
  §19 e processamento fora de ordem §19.2.
- **Inbox** (`lib/inbox/classify.ts`) — as 10 classificacoes do §20.2 por regra
  deterministica, sem depender de IA. `UNKNOWN` manda para revisao humana em vez de
  chutar.
- **CRM** (`lib/crm/pipeline.ts`) — os 17 estagios do §21.1 e as transicoes do §21.2.
  Descoberta cria empresa, nunca oportunidade.
- **Jobs** (`lib/jobs/retry.ts`) — backoff, dead-letter, lock com expiracao §24.4.
- **Ambiente** (`lib/env-spec2.ts`) — as variaveis do §31, todas desligadas por padrao.

### Banco (`database/migrations/0007_spec2_commercial_core.sql`)

As 22 tabelas novas do §25.2, com RLS por `user_id`, chaves compostas `(id, user_id)`
e as constraints que sustentam as regras: a unique de idempotencia que transforma um
retry em conflito, o indice que impede dois runs ativos por campanha, o teto de tres
passos por sequencia. `message_events` e `audit_log` nao recebem policy de UPDATE nem
de DELETE — sao imutaveis (§25.4).

A migracao **nao remove nem renomeia nada** (§36.1) e faz o backfill do §36.2: o score
antigo vira `score_version = 1` e o `companies.email` da 1.2 vira um contato com
verificacao `UNKNOWN` — coletar nao e verificar.

Verificacao: `scripts/verify-migrations.sh` aplica todas as migracoes num PostgreSQL
local (via `database/tests/supabase-shim.sql`) em banco vazio **e** em banco ja
atualizado, depois roda `database/tests/migration-assertions.sql`. Isso cobre o criterio
do §32.4.

### Testes

421 testes passando (259 antes desta entrega). Os novos cobrem os itens do §32.1 que
dependem do dominio, mais a jornada do §32.3 em `tests/spec2-end-to-end.test.ts`.

## 3. O que NAO foi implementado

Estas partes exigem servico externo, credencial ou interface, e ficaram para as fases
seguintes. O dominio acima foi escrito para recebe-las sem reescrita.

| Fase | Pendente |
| --- | --- |
| 2 — Apify | Adapter HTTP, criacao de run, webhook assinado, importacao de dataset em lotes. O `SourceId` e as capacidades ja existem; falta o cliente. |
| 3 — Auditoria e IA | Auditor de sites (fetch, robots.txt, extracao), detector que transforma observacao em gap, e o cliente de IA com saida validada por Zod. Os contratos (`ObservationType`, `isGapEvaluable`) ja estao definidos. |
| 4 — CRM de e-mail | Implementacao de `EmailProvider`, rotas de webhook `/api/webhooks/*`, worker de jobs e telas de inbox. As regras que essas rotas vao chamar ja estao prontas e testadas. |
| 5 — Comercial | Telas de oportunidade, tarefas, diagnostico e previa; geradores de briefing por oferta. |
| 6 — Otimizacao | Testes A/B, ajuste de score por resultado, relatorios de coorte. |
| Interface (§27) | Nenhuma tela da 2.0 foi construida. As telas da 1.2 continuam funcionando sem alteracao. |
| APIs (§26) | Nenhuma rota nova. As rotas da 1.2 continuam funcionando. |

Nada disso esta pela metade: o que existe esta completo e testado, e o que falta nao
foi comecado.

## 4. Como aplicar

```bash
# 1. Migracao — no SQL Editor do Supabase, em ordem:
#    0001 ... 0006 (ja aplicadas) e entao:
#    database/migrations/0007_spec2_commercial_core.sql

# 2. Verificacao local opcional, com PostgreSQL rodando:
PGHOST=... PGPORT=... PGUSER=... ./scripts/verify-migrations.sh

# 3. Nenhuma variavel de ambiente nova e obrigatoria.
#    Tudo da secao "SPEC 2.0" do .env.example vem desligado.
```
