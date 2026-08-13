# LeadHunter — SPEC 1.1

**Hardening, Validacao Real e Enriquecimento da Prospeccao**

- **Versao:** 1.1.0
- **Base:** SPEC 1.0.0 ja implementada ([`SPEC.md`](./SPEC.md))
- **Status:** Ready for Hardening
- **Tipo:** Correcao, validacao, enriquecimento e preparacao para uso real

---

## 0. Objetivo desta versao

A 1.1 **nao reconstroi** o projeto. A implementacao existente e preservada sempre que correta.

Objetivos: validar contra dados reais; corrigir problemas; validar Supabase, Google Places,
persistencia, deduplicacao e RLS reais; melhorar descoberta de Instagram, confiabilidade dos dados
e o fluxo de prospeccao; garantir que o sistema seja realmente utilizavel; preparar arquitetura
para expansao SaaS.

Prioridade: **FUNCIONAMENTO REAL > ROBUSTEZ > UX > NOVAS FUNCIONALIDADES**.

---

## 1. Regra principal

O sistema nao esta pronto so porque testes, TypeScript, ESLint e build passam. Sucesso exige uma
**execucao real de prospeccao** com Google Places + Supabase, dados persistidos, score calculado,
deduplicacao funcionando e lead acessivel pela interface.

## 2–3. Estado atual e nao reconstruir

A 1.0 ja entrega stack, schema, RLS, score, telefone, Places, orquestrador, Instagram, CRM,
briefing, prompt, exportacao, 53 testes, typecheck, lint e build.

O agente **nao deve** apagar a implementacao, reescrever o projeto, trocar framework/Supabase/Next,
substituir o motor de score sem necessidade, remover testes ou criar arquitetura paralela.

Ordem: `AUDITAR → IDENTIFICAR → CORRIGIR → TESTAR`.

## 4. Auditoria inicial obrigatoria

Antes de modificar codigo, auditar estrutura, SPEC, package.json, env, Supabase, migrations, RLS,
Places, fluxo de prospeccao, score, Instagram, CRM, briefing, exportacao, auth e responsividade,
produzindo a matriz `COMPONENTE | STATUS | PROBLEMA | ACAO`. Nao alterar o que ja funciona.

## 5. Severidade

- **P0 — Bloqueador:** impede uso real (Google/Supabase/login quebrados, vazamento de RLS, dados falsos, build quebrado).
- **P1 — Critico:** duplicacao, score incorreto, telefone errado, Instagram incorreto, chamadas excessivas de API.
- **P2 — Importante:** afeta experiencia.
- **P3 — Melhoria:** cosmetico ou futuro.

Ordem de correcao: P0 → P1 → P2 → P3.

## 6. Configuracao de ambiente

`.env.example` com apenas variaveis realmente usadas. Nao criar variavel ficticia para aparentar
suporte a uma integracao inexistente.

## 7. Diagnostico de integracao

Pagina/funcao de **System Health** para o proprietario, cobrindo Supabase, banco, autenticacao,
Places API, Text Search, RLS, Instagram Discovery e briefing. Deve identificar chave ausente,
chave invalida, API desabilitada, quota excedida, erro de autenticacao, banco indisponivel e
configuracao incompleta. **Nunca expor secrets.**

## 8–10. Google Places

Consultar a documentacao atual antes de validar; nao assumir endpoints antigos. Validar Text
Search, paginacao, campos, status, erros e quota. Executar ao menos uma busca real
(ex.: Restaurante / Sao Jose dos Campos / 20 km) e registrar o resultado. Manter o limite de 3
paginas — sem paginacao infinita — e informar quando o limite for atingido.

## 11–12. Custo e cache

Evitar chamadas desnecessarias: nao repetir consultas, reaproveitar dados salvos, usar `place_id`,
respeitar limites, nunca criar loops. Politica de cache por `google_place_id + timestamp`:
dados com menos de 7 dias sao reutilizados; a partir de 7 dias, atualizacao permitida. O periodo
deve ser configuravel.

## 13–14. Deduplicacao

Duas execucoes da mesma pesquisa nao podem criar empresas duplicadas; a segunda atualiza
`last_checked_at` e registra a nova pesquisa. Sem `place_id`, deduplicar por nome normalizado +
telefone + endereco + localizacao, tolerando caixa, acentos, espacos e pontuacao.

## 15–16. Proveniencia

Separar **dados da fonte**, **dados derivados** (`opportunity_score`, `opportunity_level`,
`score_breakdown`, `instagram_confidence`, `website_status`) e **dados manuais**. Nunca misturar os
tres. Campos enriquecidos guardam `source`, `confidence` e `checked_at`.

## 17–18. Website

Estados: `HAS_WEBSITE` (Site encontrado), `NO_WEBSITE_DETECTED` (Site nao identificado) e
`UNKNOWN` (Nao foi possivel verificar). Nunca afirmar "esta empresa nao possui site" quando o
sistema apenas nao encontrou. Armazenar e validar o formato do site; sem crawling completo nem
scraping.

## 19–26. Instagram

A 1.1 permite descoberta alem do site oficial — inclusive para empresas sem website —, mas
**descoberta nao e confirmacao**. Fontes permitidas: site oficial, links publicos, fontes
confiaveis, mecanismos de busca permitidos e APIs apropriadas. Proibido scraping agressivo, login
automatizado e burla de anti-bot.

`discoverInstagram(company)` recebe nome, categoria, cidade, estado, telefone, website e endereco;
devolve `instagram_url`, `instagram_handle`, `confidence`, `status`, `evidence`, `source` e
`checked_at`.

Faixas: `0–39 LOW`, `40–69 POSSIBLE`, `70–89 HIGH`, `90–100 VERY_HIGH`. `LOW` nunca e tratado
automaticamente como pertencente a empresa. A confianca considera varios sinais (nome, cidade,
categoria, telefone, dominio, links) — nunca apenas o nome. Status: `CONFIRMED`, `REJECTED` ou
`PENDING`. Instagram de baixa confianca nao entra no briefing nem no prompt como oficial.

## 27–29. Score

Manter determinístico, 0–100, pesos centralizados. O exemplo "94/100" da SPEC 1.0 e **erro
documental**: a soma real dos itens e 97. A documentacao deve refletir a soma correta. Instagram
encontrado vale +10; o bonus extra de +5 exige **confirmado ou confianca muito alta** — nunca para
baixa confianca.

## 30–33. Qualidade e proxima acao

Avaliar a qualidade do perfil Google (`LOW`/`MEDIUM`/`HIGH`) a partir de varios sinais, nao apenas
rating: 5.0 com 1 avaliacao nao equivale a 4.8 com 183. Destacar alta oportunidade quando houver
combinacao de sinais. Adicionar `next_action` determinística: `CONTACT_NOW`, `RESEARCH_MORE`,
`LOW_PRIORITY`, `ALREADY_CONTACTED`, `DO_NOT_CONTACT`, com motivo.

## 34–35. Contato

Nunca enviar mensagem automaticamente — apenas **ABRIR WHATSAPP**. Validar DDI, DDD e normalizacao;
sem numero confiavel, mostrar "WhatsApp indisponivel" e nao criar link.

## 36–39. Ficha, briefing e prompt

A ficha separa visualmente dados encontrados, derivados, confirmados manualmente e pendentes. O
briefing respeita a proveniencia (nao escrever "Instagram oficial" antes da confirmacao). O prompt
do Lovable tem secoes distintas `DADOS CONFIRMADOS` e `DADOS A CONFIRMAR`, alem da instrucao
explicita de nao inventar informacoes e usar placeholders.

## 40–41. Campos manuais e uploads

Campos manuais persistem no banco. Se houver Supabase Storage, criar buckets com regras de acesso —
usuario A nunca acessa arquivo privado de B.

## 42–43. CRM

Validar os nove status e a persistencia das alteracoes. Cada interacao registra tipo, data e
descricao.

## 44–46. Dashboard e historico

Numeros vindos do banco real, nunca hardcoded. Acesso as pesquisas recentes com segmento,
localizacao, data, quantidade encontrada e qualificada. Cada pesquisa guarda segmento, localizacao,
filtros, data, encontradas, novas, existentes e qualificadas.

## 47–50. Resultados, filtros e exportacao

Ordenacao por score, rating, numero de avaliacoes, distancia e data de descoberta. Filtros
combinaveis funcionando em conjunto. Estado dos filtros refletido na URL. CSV/XLSX exportam apenas
o resultado filtrado, com os campos recomendados.

## 51–53. Mobile, responsividade e performance

Validar login, dashboard, prospeccao, resultados, ficha, WhatsApp, pipeline, briefing e copiar em
375, 390, 414, 768, 1024 e 1280px. Sem overflow horizontal, botoes cortados, tabelas ilegiveis,
modal maior que a viewport ou texto sobreposto. Nenhuma acao critica pode depender de hover. Medir
tempos reais antes de otimizar.

## 54–57. Estados, erros, retry e observabilidade

Etapas visiveis: localizando regiao, consultando Places, processando empresas, verificando presenca
digital, calculando oportunidades, salvando, finalizando. Mapear `INVALID_ARGUMENT`,
`UNAUTHENTICATED`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`, `NOT_FOUND` e `INTERNAL` em mensagens
uteis. Retry apenas para erros transitorios, no maximo 2 tentativas com backoff — nunca para
credencial invalida, permissao negada ou argumento invalido. Logs estruturados de inicio, fim,
erro e contagens, sem chaves, senhas, tokens ou dados sensiveis.

## 58–62. Seguranca

Teste obrigatorio de RLS com dois usuarios em companies, leads, interactions, briefings,
prospecting_searches, profiles e storage. Validar cadastro, login, logout, sessao, sessao expirada
e rota protegida. Revisar fronteiras server/client, secrets, service role, rotas, inputs, SQL, RLS,
redirects, XSS e CSRF. `SUPABASE_SERVICE_ROLE_KEY` nunca chega ao browser. Nenhuma chave no codigo,
Git, frontend, logs ou HTML.

## 63–74. Testes

Preservar os 53 testes existentes e acrescentar cobertura de normalizacao do Google, deduplicacao,
score (todos os criterios e limites), Instagram (faixas, confirmacao, rejeicao), WhatsApp, briefing
e seguranca por usuario. Executar o fluxo real completo quando houver credenciais; repetir a mesma
pesquisa (esperado: 0 duplicatas); validar multiplos segmentos; tratar sem resultados, sem
telefone, sem website, sem Instagram, API indisponivel, quota excedida e dados incompletos sem
quebrar. Informacoes importantes carregam estado: `FOUND`, `CONFIRMED`, `PENDING`, `NOT_FOUND`,
`UNKNOWN`.

## 75–79. Interface

Sem redesign completo. Corrigir inconsistencias, mobile, loading, feedback, acessibilidade e
hierarquia. A ficha responde rapidamente: quem e, onde esta, e boa oportunidade, por que, tem site,
tem Instagram, posso falar, o que faco agora. Mostrar a acao recomendada de forma visual. Briefing
dividido em automaticas, confirmadas, pendentes, dados a completar e estrutura sugerida.

## 80–84. Escopo

Nao integrar diretamente com o Lovable — o usuario copia o prompt. Manter CSV/XLSX. Nao implementar
cobranca; manter `user_id` em todas as entidades e permitir evolucao para workspace/plano/uso.
Estruturar metricas por pesquisa (`search_count`, `places_requested`, `places_processed`,
`enrichment_count`, `results_count`, `new_companies_count`, `existing_companies_count`,
`qualified_count`, `high_opportunity_count`, `excellent_opportunity_count`).

## 85–87. Resumo honesto da pesquisa

Ao final, mostrar numeros reais. Se uma etapa falhar parcialmente, dizer **"Pesquisa concluida
parcialmente"** com as contagens de falha — nunca mascarar. Permitir reprocessar apenas os
registros que falharam, sem repetir a pesquisa inteira.

## 88–94. Banco e qualidade

Auditar indices, foreign keys, constraints, enums, timestamps, RLS, policies e cascades. A
integridade (company/lead/briefing/interaction/pesquisa pertencem ao mesmo usuario) deve ser
reforcada pelo banco, nao apenas pela aplicacao. Manter `strict: true`, evitar `any`, build,
typecheck e lint sem erros, todos os testes passando — sem remover testes para aprovar.

## 95–97. Criterios de aceite

- **P0:** login, Supabase, RLS, Places com dados reais, pesquisa real, persistencia, deduplicacao,
  score, ficha, WhatsApp com telefone valido, briefing, prompt Lovable e build.
- **P1:** Instagram discovery e confianca, confirmacao/rejeicao, cache, filtros combinados,
  historico, dashboard real, exportacao, segunda pesquisa sem duplicar, isolamento entre usuarios.
- **P2:** mobile 375/390/414, tablet, loading, erros amigaveis, acessibilidade basica e feedback de copiar.

## 98–100. Definition of Done e relatorio

`SPEC 1.1 → AUDITORIA → CONFIGURACAO → GOOGLE REAL → SUPABASE REAL → PERSISTENCIA → DEDUPLICACAO →
QUALIFICACAO → INSTAGRAM → SCORE → CRM → WHATSAPP → BRIEFING → PROMPT LOVABLE → RLS → TESTES →
BUILD → VALIDACAO FINAL`.

O relatorio final lista alteracoes, resultados de testes/typecheck/lint/build e o veredito
PASS/FAIL de Google Places, Supabase, persistencia, deduplicacao, RLS, WhatsApp, briefing e prompt.
Limitacoes devem ser declaradas explicitamente. **Nunca declarar "tudo funcionando" se uma
dependencia externa nao foi validada.**

## 101–102. Regra final

Prioridade absoluta: transformar o codigo existente em um sistema comprovadamente funcional para
prospeccao real. Nao gastar a sessao com animacoes, efeitos, paginas desnecessarias, SaaS ou
billing. Ao final, o proprietario deve pedir "quero restaurantes em Sao Jose dos Campos" e obter
empresa real → dados Google → avaliacoes → site → Instagram → telefone → score → oportunidade →
WhatsApp → CRM → briefing → prompt Lovable, sem tocar em banco, codigo ou APIs manualmente.
