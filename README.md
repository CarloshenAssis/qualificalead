# LeadHunter

Aplicacao web para **encontrar, qualificar e organizar** pequenas empresas com oportunidade de
melhoria na presenca digital — especialmente as que nao tem site identificado, mas tem boa
reputacao no Google, telefone e movimento comercial.

O fluxo completo e: **login → prospeccao → qualificacao → base de empresas → lead → WhatsApp →
briefing → prompt para o Lovable**.

A especificacao funcional completa esta em [`SPEC.md`](./SPEC.md) e e a fonte de verdade do projeto.

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
3. Abra o **SQL Editor** e execute o conteudo de
   [`database/migrations/0001_init.sql`](./database/migrations/0001_init.sql).
   O script cria enums, tabelas, indices de deduplicacao, triggers de `updated_at`, criacao
   automatica de `profiles` e as **policies de RLS**.
4. Em **Authentication → Providers**, mantenha o provedor de e-mail/senha habilitado.
   Se a confirmacao de e-mail estiver ativa, o cadastro pede confirmacao antes do primeiro login.

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

Controle de custo: cada prospeccao consulta no maximo 3 paginas (60 resultados), empresas ja
conhecidas nao tem o site reconsultado antes de 14 dias, e a deduplicacao evita registros repetidos.

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
```

---

## Como funciona

### Prospeccao

`app/api/prospecting/route.ts` executa a busca e transmite o progresso em **NDJSON**, um evento por
linha. A tela mostra as etapas (`Consultando empresas...`, `Verificando presenca digital...`,
`Calculando oportunidades...`) e a barra de progresso, sem nunca parecer travada.

Pipeline em `lib/prospecting/run.ts`:

1. Geocodifica a cidade quando ha raio definido.
2. Consulta a Places API (New) com paginacao limitada.
3. Normaliza cada resultado — campo ausente permanece nulo, nada e inventado.
4. Verifica a presenca digital.
5. Calcula o score.
6. Faz upsert deduplicado e grava o historico da pesquisa.

### Deteccao de site

O site vem do campo `websiteUri` da propria API. Quando ele nao existe, o registro fica como
`NO_WEBSITE_DETECTED` e a interface diz **"Site nao identificado"** — nunca "a empresa nao tem site",
porque a unica coisa observada e a ausencia do dado na fonte consultada.

### Instagram

O perfil so e associado quando o link aparece **no site oficial da empresa**. O sistema nunca supoe
que `@nomedaempresa` pertence ao negocio. Cada associacao recebe uma confianca de 0 a 100 e fica
`PENDING` ate voce confirmar ou rejeitar na ficha. Sua decisao nunca e sobrescrita por uma
prospeccao futura.

### Score

Motor deterministico em `lib/scoring/`, com todos os pesos centralizados em `config.ts` (nenhum
numero magico espalhado pelo codigo). Cada empresa guarda o `score_breakdown` item a item, exibido
na ficha. O score e um **indice de oportunidade a partir de sinais observaveis** — nao e previsao de
compra.

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

Cobrem as regras criticas: score e classificacao (incluindo o teto de 100), normalizacao de telefone
e link de WhatsApp, mapeamento da resposta do Google, chave de deduplicacao, confianca do Instagram,
briefing/prompt sem invencao de dados, escape de CSV/XLSX e traducao dos filtros para o banco.

Autenticacao e RLS sao garantidas no banco pelas policies do script de migracao e verificadas
manualmente: crie duas contas, cadastre empresas em uma e confirme que a outra nao as enxerga.

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

- A Places API (New) devolve no maximo 60 resultados por consulta (3 paginas de 20). Para cobrir uma
  cidade inteira, faca buscas por bairro ou por termos diferentes.
- O Instagram so e descoberto quando a empresa tem site com o link publicado. Sem site, o campo fica
  disponivel para preenchimento manual.
- A edicao dos pesos do score pela interface ainda nao existe: hoje eles sao ajustados em
  `lib/scoring/config.ts`. A tela de configuracoes ja mostra os valores vigentes.
- Nao ha cobranca, planos ou limites de uso — a V1 nao implementa billing, conforme a especificacao.
