# LeadHunter

Aplicacao web para **encontrar, qualificar e organizar** pequenas empresas com oportunidade de
melhoria na presenca digital — especialmente as que nao tem site identificado, mas tem boa
reputacao no Google, telefone e movimento comercial.

O fluxo completo e: **login → prospeccao → qualificacao → base de empresas → lead → WhatsApp →
briefing → prompt para o Lovable**.

A especificacao funcional esta em [`SPEC.md`](./SPEC.md) (v1.0) e [`SPEC-1.1.md`](./SPEC-1.1.md)
(hardening e validacao real). Juntas, sao a fonte de verdade do projeto.

---

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions) + **React 19** + **TypeScript** estrito
- **Tailwind CSS v4**
- **Supabase** (PostgreSQL + Auth + Row Level Security)
- **Zod** para validacao
- **Lucide React** para icones
- **Vitest** para testes unitarios
- **Google Maps Platform — Places API (New)** e **Geocoding API**

Sem scraping do Google e sem bibliotecas desnecessarias: CSV e XLSX sao gerados por codigo proprio.

---

## Instalacao

```bash
npm install
cp .env.example .env.local   # preencha as credenciais
npm run dev
```

A aplicacao sobe em `http://localhost:3000`. Sem as variaveis do Supabase, qualquer rota redireciona
para `/setup`, que explica o que falta configurar.

---

## Configuracao do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **Project Settings → API**, copie `Project URL` e a chave `anon`.
3. Abra o **SQL Editor** e execute, **nesta ordem**:
   - [`database/migrations/0001_init.sql`](./database/migrations/0001_init.sql) — enums, tabelas,
     indices de deduplicacao, triggers de `updated_at`, criacao automatica de `profiles` e as
     **policies de RLS**;
   - [`database/migrations/0002_hardening.sql`](./database/migrations/0002_hardening.sql) —
     proveniencia dos dados enriquecidos, estado `UNKNOWN` de website, qualidade do perfil Google,
     acao recomendada, metricas por pesquisa e **integridade reforcada pelo banco** (um lead nunca
     pode apontar para a empresa de outro usuario).
4. Em **Authentication → Providers**, mantenha o provedor de e-mail/senha habilitado.
   Se a confirmacao de e-mail estiver ativa, o cadastro pede confirmacao antes do primeiro login —
   e o SMTP embutido do Supabase limita os envios a poucos por hora. Para uso serio, configure um
   SMTP proprio.
5. Recomendado: em **Authentication → Policies**, ative *Leaked password protection*.

Todas as tabelas tem `user_id` e RLS habilitada: cada usuario le e escreve **apenas** os proprios
registros. A aplicacao nunca usa a service role key para acessar dados de usuario — todo acesso
passa pela sessao autenticada.

---

## Configuracao do Google

1. No [Google Cloud Console](https://console.cloud.google.com), habilite:
   - **Places API (New)**
   - **Geocoding API** (usada quando voce define um raio de busca)
2. Crie uma chave de API e restrinja-a por API e por IP do servidor.
3. Coloque a chave em `GOOGLE_MAPS_API_KEY`.

A chave e usada **somente no servidor** (`lib/google/places.ts` importa `server-only`). Ela nunca vai
para o bundle do browser.

Controle de custo: cada prospeccao consulta no maximo 3 paginas (60 resultados); empresas ja
conhecidas nao tem a presenca digital reconsultada antes de `DIGITAL_PRESENCE_TTL_DAYS` (padrao 7);
a deduplicacao evita registros repetidos; e o retry so acontece em erro transitorio, no maximo 2
tentativas com backoff — credencial invalida ou permissao negada nunca sao repetidas.

---

## Variaveis de ambiente

| Variavel | Obrigatoria | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | Chave publica do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | nao | Reservada para tarefas administrativas futuras |
| `GOOGLE_MAPS_API_KEY` | sim (para prospectar) | Places API (New) + Geocoding |
| `GOOGLE_PLACES_REGION_CODE` | nao | Padrao `BR` |
| `GOOGLE_PLACES_LANGUAGE_CODE` | nao | Padrao `pt-BR` |
| `DEFAULT_PHONE_COUNTRY_CODE` | nao | Padrao `55`, usado ao normalizar telefones |
| `DIGITAL_PRESENCE_TTL_DAYS` | nao | Padrao `7`. Dias antes de reconsultar a presenca digital |
| `GOOGLE_CSE_ID` | nao | Programmable Search Engine, para achar Instagram de empresa sem site |
| `GOOGLE_CSE_API_KEY` | nao | Chave da Programmable Search JSON API |

Nao ha variaveis de IA: **briefing, prompt do Lovable e score sao deterministicos**, gerados por
codigo. Isso mantem o resultado reproduzivel e evita que a ferramenta invente informacao.

---

## Scripts

```bash
npm run dev        # desenvolvimento
npm run build      # build de producao
npm start          # sobe o build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest

# Validacoes contra os servicos reais (SPEC 1.1)
npm run verify:google     # busca real na Places API e qualificacao do resultado
npm run verify:supabase   # auth + persistencia + deduplicacao + RLS pela API real
npm run verify:ui         # fluxo completo pela interface (precisa do app rodando)
```

Com o app rodando e autenticado, a pagina **`/health`** faz o mesmo diagnostico pela interface:
Supabase, banco, autenticacao, RLS, Places API, descoberta de Instagram e cache — sem exibir
nenhuma chave.

---

## Como funciona

### Prospeccao

`app/api/prospecting/route.ts` executa a busca e transmite o progresso em **NDJSON**, um evento por
linha. A tela mostra as etapas (`Localizando regiao...`, `Consultando Google Places...`,
`Processando empresas...`, `Verificando presenca digital...`, `Calculando oportunidades...`,
`Salvando resultados...`) e a barra de progresso, sem nunca parecer travada.

Pipeline em `lib/prospecting/run.ts`:

1. Localiza a regiao (Geocoding) quando ha raio definido.
2. Consulta a Places API (New) com paginacao limitada a 3 paginas.
3. Normaliza cada resultado — campo ausente permanece nulo, nada e inventado.
4. Verifica a presenca digital, reaproveitando o cache de quem ja e conhecido.
5. Calcula score, qualidade do perfil e acao recomendada.
6. Faz upsert deduplicado e grava o historico e as metricas da pesquisa.

Ao final, o resumo traz numeros reais: encontradas, novas, ja existentes, sem site, qualificadas,
excelentes, reaproveitadas do cache e duplicatas criadas.

### Deteccao de site

O site vem do campo `websiteUri` da propria API. Ha tres estados: `HAS_WEBSITE` (Site encontrado),
`NO_WEBSITE_DETECTED` (Site nao identificado) e `UNKNOWN` (Nao foi possivel verificar). A interface
nunca afirma "a empresa nao tem site": a unica coisa observada e a ausencia do dado na fonte.

### Instagram

Duas fontes, ambas publicas e sem scraping: o link publicado **no site oficial** e, quando as
variaveis `GOOGLE_CSE_*` estao configuradas, a **Programmable Search JSON API** do Google — que
permite achar o perfil de empresas sem site. A busca externa so roda quando o site nao resolve.

A confianca vem de varios sinais combinados (site oficial, nome, cidade, categoria, telefone,
dominio), nunca do nome sozinho, e cada sinal fica registrado como evidencia visivel na ficha.
Candidato sem nenhum sinal e descartado. O resultado fica `PENDING` ate voce confirmar ou rejeitar,
e sua decisao nunca e sobrescrita por uma prospeccao futura.

### Score e qualificacao

Motor deterministico em `lib/scoring/`, com todos os pesos centralizados em `config.ts` (nenhum
numero magico espalhado pelo codigo). Cada empresa guarda:

- **score** (0–100) com `score_breakdown` item a item;
- **qualidade do perfil Google** (`LOW`/`MEDIUM`/`HIGH`) — considera completude do cadastro e
  volume de avaliacoes, entao 5.0 com 1 avaliacao nao vale o mesmo que 4.8 com 183;
- **acao recomendada** (`CONTACT_NOW`, `RESEARCH_MORE`, `LOW_PRIORITY`, `ALREADY_CONTACTED`,
  `DO_NOT_CONTACT`) com o motivo em texto.

O bonus extra de Instagram exige confirmacao humana ou confianca muito alta — perfil de baixa
confianca nunca infla o score. O score e um **indice de oportunidade a partir de sinais
observaveis**, nao previsao de compra.

### Falhas parciais

Se a verificacao de presenca digital falhar para algumas empresas, a pesquisa e reportada como
**concluida parcialmente**, com a contagem exata. As empresas ficam salvas e a lista mostra um aviso
com o botao **REPROCESSAR**, que refaz apenas o que falhou — sem repetir a busca no Google.

### Briefing e prompt do Lovable

A ficha permite complementar dados manualmente (logo, cores, servicos, cardapio, precos...), sempre
separados dos dados coletados. O briefing lista o que foi identificado, o que esta ausente e o que
precisa ser confirmado. O prompt do Lovable instrui explicitamente a nao inventar dados e usa
`[PREENCHER: item]` para cada lacuna. Ambos tem botao de copiar com feedback.

---

## Testes

```bash
npm test
```

Cobrem as regras criticas: score, classificacao e teto de 100; qualidade do perfil Google; acao
recomendada; normalizacao de telefone e link de WhatsApp; mapeamento da resposta do Google;
mapeamento de erros da API e regras de retry; cache de presenca digital; chave de deduplicacao;
confianca e evidencias do Instagram; briefing e prompt sem invencao de dados, com separacao entre
confirmado e pendente; escape de CSV/XLSX; e traducao dos filtros para o banco.

Alem dos testes unitarios, ha tres validacoes contra os servicos reais:

- `database/tests/rls.sql` — isolamento entre dois usuarios em todas as tabelas, executado no
  proprio banco, do jeito que o PostgREST avalia (`role authenticated` + `request.jwt.claims`);
- `npm run verify:supabase` — login, persistencia, deduplicacao e RLS pela API real;
- `npm run verify:ui` — o fluxo completo pela interface, incluindo responsividade.

---

## Deploy

Funciona em qualquer plataforma que rode Next.js em Node. Na Vercel:

1. Importe o repositorio.
2. Cadastre as variaveis de ambiente do quadro acima.
3. Faca o deploy — a rota de prospeccao usa runtime Node e streaming.

Rode o script de migracao no Supabase de producao antes do primeiro uso.

---

## Estrutura

```text
app/
  (app)/          telas autenticadas: dashboard, prospecting, companies, pipeline, settings
  api/            prospeccao (streaming) e exportacao
  auth/           server actions de login, cadastro e logout
components/       ui, navegacao, prospeccao, empresas, leads, briefing
lib/
  google/         cliente da Places API e normalizacao
  instagram/      descoberta com nivel de confianca
  scoring/        pesos e motor de score
  briefing/       briefing e prompt do Lovable
  whatsapp/       normalizacao de telefone e wa.me
  export/         CSV e XLSX
  prospecting/    orquestracao da busca
  supabase/       clientes de browser, servidor e sessao
database/         migracao SQL com RLS
tests/            testes unitarios
```

---

## Limitacoes conhecidas

- A Places API (New) devolve no maximo 60 resultados por consulta (3 paginas de 20). Quando o teto e
  atingido, a interface avisa. Para cobrir uma cidade inteira, busque por bairro ou por termos
  diferentes.
- Sem `GOOGLE_CSE_*`, o Instagram so e descoberto quando a empresa tem site com o link publicado.
  Em qualquer caso o campo aceita preenchimento manual.
- A edicao dos pesos do score pela interface ainda nao existe: hoje eles sao ajustados em
  `lib/scoring/config.ts`. A tela de configuracoes ja mostra os valores vigentes.
- Nao ha cobranca, planos ou limites de uso — a V1 nao implementa billing, conforme a especificacao.
