# CONTEXTO PARA O CODEX — HARDENING DA SPEC 2.0

## Objetivo

Corrigir o núcleo comercial da SPEC 2.0 atualmente presente na branch `main` do repositório `CarloshenAssis/qualificalead`, antes de iniciar integrações com Apify, provedor de e-mail, IA, rotas ou telas.

Commit que foi revisado: `8aa98b15894287fcef530213c050149aea1bd37c`.

O sistema é uma plataforma de prospecção B2B que:

1. coleta empresas e evidências públicas;
2. identifica gaps comercializáveis;
3. calcula um score multidimensional;
4. submete leads qualificados à revisão;
5. envia cold email apenas após aprovação;
6. registra resposta, pipeline e tarefas em CRM;
7. mantém WhatsApp estritamente manual por link `wa.me`.

## Regra de execução

Não implemente Apify, provedor de e-mail, automação de WhatsApp, novas telas ou novas rotas nesta tarefa. Faça somente o hardening descrito abaixo.

Antes de editar:

1. Leia `SPEC-2.0.md` integralmente.
2. Inspecione os módulos e testes existentes.
3. Execute a suíte atual para estabelecer o baseline.
4. Preserve alterações do usuário e não reescreva migrações antigas já aplicadas.

As correções de banco devem ser feitas em uma nova migração posterior à `0007_spec2_commercial_core.sql`, salvo se o projeto comprovar que a migração 0007 ainda nunca foi aplicada em nenhum ambiente compartilhado. Por segurança, assuma que já foi aplicada.

## P0 — Bloqueadores

### 1. Transformar o portão de envio em allowlist

Arquivo principal: `lib/email/eligibility.ts`.

Problema: o código usa uma lista de estágios proibidos. Assim, qualquer estágio novo ou esquecido pode se tornar enviável por padrão. Atualmente, estágios como `DISCOVERED`, `ENRICHED`, `QUALIFIED`, `REVIEW_PENDING`, `DISCOVERY`, `MEETING`, `PROPOSAL` e `UNRESPONSIVE` podem passar se os demais booleanos forem válidos.

Correção:

- Criar uma allowlist explícita.
- Somente `APPROVED_FOR_EMAIL` e `EMAIL_SEQUENCE_ACTIVE` podem ser elegíveis.
- Todo estágio desconhecido ou futuro deve falhar fechado.
- Continuar bloqueando supressão, opt-out, bounce, ausência de consentimento operacional exigido pela SPEC, campanha inativa, orçamento excedido, contato não enviável e falta de aprovação/evidência.

Testes obrigatórios:

- teste parametrizado cobrindo todos os estágios do pipeline;
- somente os dois estágios autorizados retornam elegível;
- valor de estágio desconhecido em runtime retorna inelegível;
- cada guardrail individual bloqueia o envio;
- combinação válida completa autoriza o envio.

### 2. Corrigir FKs compostas com ON DELETE SET NULL

Arquivo principal: nova migração de hardening.

Problema: existem FKs compostas no formato `(campo_opcional, user_id)` com `ON DELETE SET NULL`. Sem uma lista de colunas, o PostgreSQL tenta tornar também `user_id` nulo. Como `user_id` é `NOT NULL`, a exclusão do registro referenciado falha.

Corrigir, preservando `user_id`, todas as relações opcionais equivalentes a:

- qualification result → campaign;
- campaign lead → contact;
- campaign lead → qualification;
- sequence step → template;
- campaign → sequence;
- outbound message → contact;
- outbound message → sender;
- outbound message → step;
- outbound message → template;
- inbound message → campaign lead;
- task → contact.

Use a forma suportada pelo PostgreSQL, por exemplo `ON DELETE SET NULL (contact_id)`, ou redesenhe a FK de forma tenant-safe equivalente. Não remova o isolamento por `user_id`.

Testes SQL obrigatórios:

- inserir pai e filho para cada classe de FK;
- excluir o pai;
- confirmar que apenas a coluna opcional vira nula;
- confirmar que `user_id` permanece preenchido;
- confirmar que não é possível referenciar entidade de outro tenant.

### 3. Exigir evidência real para READY_FOR_EMAIL

Arquivos principais:

- `lib/qualification/score.ts`;
- `lib/gaps/catalog.ts`;
- `lib/offers/catalog.ts`;
- tipos e persistência relacionados.

Problema: um gap pode ser confirmado e produzir `READY_FOR_EMAIL` sem evidência vinculada. `evidenceIds` é opcional, `company_gaps.evidence_ids` aceita array vazio, `NO_WEBSITE` não exige observações e a oferta de website não exige evidência mínima.

Correção:

- Nenhum resultado pode chegar a `READY_FOR_EMAIL` sem pelo menos uma evidência válida vinculada ao gap principal.
- A evidência deve pertencer ao mesmo `user_id` e à mesma empresa.
- Deve estar ativa/não expirada no momento da decisão.
- Deve sustentar um tipo compatível com o gap.
- Confirmação humana do gap continua obrigatória.
- Se a pontuação for suficiente, mas a evidência estiver ausente, incompatível, expirada ou de outra empresa, retornar `REVIEW_FOR_EMAIL` ou ação conservadora equivalente prevista na SPEC — nunca `READY_FOR_EMAIL`.
- Para `NO_WEBSITE`, modelar evidência negativa auditável, como resultado de resolução/presença de site, fonte, timestamp e status. A ausência de um registro não é evidência.

Testes obrigatórios:

- score alto + gap confirmado + zero evidências não fica pronto;
- evidência expirada não fica pronto;
- evidência de outra empresa não fica pronto;
- evidência de outro tenant não fica pronto;
- evidência incompatível com o gap não fica pronto;
- evidência válida + todos os guardrails permite `READY_FOR_EMAIL`;
- `NO_WEBSITE` exige observação negativa explícita.

### 4. Completar integridade tenant-safe

Adicionar FKs compostas por `(id, user_id)` ou desenho equivalente para:

- `sales_opportunities.contact_id`;
- `sales_opportunities.campaign_id`;
- `inbound_messages.contact_id`;
- `inbound_messages.outbound_message_id`;
- `jobs.campaign_id`.

Requisitos:

- referência cruzada entre tenants deve falhar no banco;
- exclusão deve seguir a semântica definida na SPEC;
- relações opcionais devem preservar `user_id` ao aplicar `SET NULL`;
- índices devem apoiar as FKs e consultas relevantes.

Criar testes SQL negativos para todas as referências cruzadas.

## P1 — Integridade e imutabilidade

### 5. Separar corretamente score v1 e score v2 nos tipos

Problema: a migração preserva linhas legadas com valores em português e ações antigas, mas `QualificationResult` tipa somente os enums v2. Uma linha v1 válida no banco viola o contrato TypeScript.

Correção preferida:

- transformar o tipo em união discriminada por `scoreVersion`/`score_version`;
- definir explicitamente o formato legado v1 e o formato v2;
- normalizar snake_case/camelCase na camada de repositório;
- impedir que funções exclusivas de v2 aceitem v1 sem conversão explícita.

Alternativa aceitável: normalizar os valores legados na migração, somente se não houver perda semântica e houver mapeamento total documentado.

Testes obrigatórios:

- parse/hidratação de linha v1 real;
- parse/hidratação de linha v2;
- rejeição de versão desconhecida;
- função v2 não processa silenciosamente linha v1.

### 6. Tornar qualification_results append-only

Problema: as policies genéricas permitem UPDATE e DELETE, contrariando o histórico auditável.

Correção:

- remover policies de UPDATE e DELETE da tabela;
- impedir UPDATE/DELETE também para o papel usado pela aplicação, considerando bypass por service role;
- se service role precisar corrigir dados, fornecer função administrativa explícita e auditada, não acesso genérico;
- novas avaliações geram novas linhas e versão, sem sobrescrever a anterior.

Testes SQL obrigatórios:

- SELECT e INSERT permitidos ao próprio tenant;
- UPDATE e DELETE negados;
- outro tenant não lê nem insere;
- uma nova qualificação preserva a anterior.

### 7. Tornar o conteúdo de outbound_messages imutável após envio

Problema: depois de enviado, ainda é possível alterar destinatário, assunto, corpo e referências do template, destruindo a auditabilidade.

Correção:

- enquanto o registro estiver em estado pré-envio, permitir apenas as alterações previstas;
- após atingir `SENT` ou estado posterior, bloquear mudanças em pelo menos:
  - `to_email`;
  - `subject`;
  - corpo texto/HTML;
  - `contact_id`;
  - `template_id`;
  - `sequence_step_id`;
  - `campaign_lead_id`;
  - identidade do remetente;
  - provider/message id e chave de idempotência, salvo preenchimento único controlado.
- permitir somente evolução válida de status e metadados operacionais autorizados.
- preferir trigger de banco para garantir o invariante independentemente da aplicação.

Testes SQL obrigatórios:

- conteúdo pode ser definido no rascunho;
- após envio, alteração de cada campo protegido falha;
- evento legítimo ainda consegue avançar o status;
- outro tenant não altera a mensagem.

### 8. Substituir ranking linear dos eventos por transições válidas

Arquivo principal: `lib/email/events.ts`.

Problema: o ranking atual permite que um evento tardio `FAILED` ou `CANCELLED` sobrescreva `DELIVERED`. Estados de entrega não formam uma ordem linear simples.

Correção:

- criar uma matriz/função explícita de transições válidas;
- eventos devem ser idempotentes pelo identificador do provedor;
- eventos duplicados não podem reaplicar efeitos;
- evento atrasado incompatível deve ser armazenado para auditoria, mas não regredir o estado materializado;
- `DELIVERED` não pode virar `FAILED` ou `CANCELLED`;
- `BOUNCED`, `COMPLAINED`, `UNSUBSCRIBED` e `REPLIED` devem executar os efeitos de supressão/pipeline previstos, com semântica explícita;
- distinguir falha de tentativa antes da aceitação do provedor de falha final após aceitação;
- não repetir envio apenas porque permaneceu `QUEUED`.

Testes obrigatórios:

- eventos em ordem;
- eventos fora de ordem;
- evento duplicado;
- `DELIVERED → FAILED` não regride;
- bounce/complaint/opt-out aplicam supressão uma única vez;
- reply atualiza pipeline uma única vez;
- provider timeout antes e depois da confirmação não gera duplicidade.

## P1 adicional — Consistência de e-mail

Existe uma inconsistência entre `contacts/priority.ts` e a qualificação: um caminho considera `UNKNOWN` ou `RISKY` agendável, enquanto o outro aceita apenas `VALID`, `ROLE_BASED` e `ACCEPT_ALL`.

Definir uma única política central de sendability e reutilizá-la em:

- qualificação;
- agendamento;
- portão de envio;
- importação;
- UI futura.

A política deve falhar fechada. `UNKNOWN`, `RISKY`, `INVALID`, `BOUNCED`, `SUPPRESSED` e `DISPOSABLE` não devem ser enviados automaticamente. Se `ACCEPT_ALL` ou `ROLE_BASED` forem aceitos, isso deve ser uma decisão explícita e testada.

## Migrações e compatibilidade

- Criar uma migração nova, incremental e idempotente.
- Não apagar dados existentes.
- Não editar migrações históricas já aplicadas.
- Validar em:
  1. banco vazio com todas as migrações;
  2. banco que já chegou à 0007;
  3. segunda execução/no-op, se o mecanismo do projeto exigir idempotência;
  4. cenário com dados v1 legados;
  5. exclusões reais das entidades pai afetadas.
- Confirmar RLS e policies consultando os catálogos do PostgreSQL, não apenas inspecionando texto SQL.

## Critérios de aceite gerais

A tarefa só está concluída quando:

- todos os P0 e P1 acima estão corrigidos;
- testes unitários, integração e SQL cobrem caminhos positivos e negativos;
- `npm test` retorna 0;
- typecheck retorna 0;
- lint retorna 0;
- build retorna 0;
- verificação das migrações em PostgreSQL real retorna 0;
- `git diff --check` retorna 0;
- nenhuma API ou automação de WhatsApp foi adicionada;
- nenhuma integração Apify/e-mail foi iniciada;
- nenhuma credencial, token ou segredo foi commitado;
- documentação registra decisões e possíveis incompatibilidades.

Não declare sucesso se algum teste não puder ser executado. Nesse caso, informe exatamente o comando, erro e impacto.

## Estratégia de commits

Criar commits pequenos e revisáveis, preferencialmente:

1. `fix(email): close send eligibility and centralize sendability`
2. `fix(db): repair tenant-safe foreign keys`
3. `fix(qualification): require validated evidence`
4. `fix(types): discriminate qualification score versions`
5. `fix(audit): enforce append-only and message immutability`
6. `fix(email): handle event transitions idempotently`
7. `test(spec2): cover hardening regressions`

Não fazer push direto para `main`. Criar uma branch de correção e abrir PR somente depois de todas as verificações passarem.

## Prompt curto para iniciar o Codex

> Leia integralmente o arquivo `CODEX-HARDENING-CONTEXT.md` e a `SPEC-2.0.md`. Implemente todas as correções P0 e P1 em uma branch nova, sem iniciar Apify, provedor de e-mail, WhatsApp automatizado, telas ou rotas. Preserve dados e migrações já aplicadas; use uma nova migração incremental. Adicione os testes unitários e SQL especificados, execute a suíte completa, typecheck, lint, build e validação das migrações em PostgreSQL real. Não faça push nem abra PR antes de tudo retornar código 0. Ao final, entregue resumo por correção, arquivos alterados, comandos executados, resultados reais e riscos restantes.
