# SPEC-1.2 — LeadHunter Multi-Source Prospecting Engine

- **Status:** READY FOR IMPLEMENTATION
- **Versao:** 1.2.0
- **Fonte de verdade:** este documento
- **Base:** [`SPEC.md`](./SPEC.md) + [`SPEC-1.1.md`](./SPEC-1.1.md)
- **Objetivo:** substituir a dependencia obrigatoria do Google Places por uma arquitetura de
  multiplas fontes, tendo OpenStreetMap/Overpass como fonte gratuita principal.

---

## 1. CONTEXTO

O LeadHunter e uma aplicacao web de prospeccao B2B para identificar pequenas empresas que possuem
presenca comercial fisica/local, mas apresentam baixa presenca digital, especialmente ausencia de
website.

O sistema atual possui: autenticacao; Supabase; RLS multi-tenant; banco de leads; deduplicacao;
score; qualificacao digital; descoberta de Instagram; WhatsApp; briefing; geracao de prompt para
Lovable; pipeline; historico; exportacao; integracao preparada para Google Places API (New).

A versao 1.1 validou a arquitetura e corrigiu problemas de seguranca, integracao e observabilidade.

Entretanto, existe um problema estrategico:

> O Google Places nao deve ser uma dependencia obrigatoria do produto porque exige configuracao de
> Billing e pode gerar custo conforme a escala de prospeccao.

Portanto, a versao 1.2 introduz uma arquitetura de **Multi-Source Prospecting**.

---

## 2. OBJETIVO DA 1.2

O sistema deve permitir encontrar empresas por cidade, estado/regiao, categoria, termo livre e
opcionalmente raio/localizacao.

A fonte principal inicial sera **OpenStreetMap + Overpass API**.

O Google Places permanecera no codigo como fonte opcional, mas:

> GOOGLE PLACES DEVE FICAR DESATIVADO POR PADRAO.

O sistema nao pode realizar chamadas ao Google automaticamente se a fonte Google estiver desativada.

---

## 3. PRINCIPIOS

### 3.1 Nao quebrar a 1.1

Tudo que ja funciona deve continuar funcionando. Nao remover: autenticacao; RLS; Supabase; leads;
empresas; score; Instagram; WhatsApp; briefing; prompt Lovable; pipeline; interacoes; historico;
exportacao; health; testes.

### 3.2 Separar descoberta de qualificacao

A descoberta responde: "Quais empresas existem nessa regiao/categoria?"
A qualificacao responde: "Quais dessas empresas parecem bons prospects?"

Nao misturar essas responsabilidades.

### 3.3 Nenhuma fonte deve dominar o dominio

O dominio do LeadHunter nao deve depender da estrutura especifica do Google, OSM ou Foursquare.
Todas as fontes devem produzir um formato intermediario comum.

---

## 4. ARQUITETURA

```text
ProspectingSource
        ↓
RawBusiness
        ↓
Normalizer
        ↓
Deduplicator
        ↓
Digital Presence
        ↓
Qualification
        ↓
Score
        ↓
Lead
```

Estrutura sugerida:

```text
lib/
  prospecting/
    sources/
      types.ts
      overpass.ts
      google.ts
      foursquare.ts
      registry.ts
    normalize.ts
    dedupe.ts
    run.ts
  google/
    places.ts
  overpass/
    client.ts
    queries.ts
    mapping.ts
```

A estrutura pode ser adaptada a estrutura existente, desde que os principios sejam preservados.

---

## 5. INTERFACE DE FONTE

```ts
interface ProspectingSource {
  id: string;
  name: string;
  type: 'FREE' | 'PAID' | 'OPTIONAL';
  enabled: boolean;

  search(params: ProspectingSearchParams): Promise<SourceSearchResult>;
}

interface ProspectingSearchParams {
  query: string;
  city: string;
  state?: string;
  countryCode?: string;

  latitude?: number;
  longitude?: number;
  radiusMeters?: number;

  limit?: number;
}

interface SourceSearchResult {
  source: string;
  businesses: RawBusiness[];
  totalFound?: number;
  metrics: {
    requested: number;
    returned: number;
    durationMs: number;
  };
  warnings: string[];
}
```

---

## 6. FORMATO RAW BUSINESS

```ts
interface RawBusiness {
  source: string;
  sourceId: string;

  name?: string;

  address?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;

  latitude?: number;
  longitude?: number;

  phone?: string;
  website?: string;

  categories?: string[];

  rating?: number;
  reviewCount?: number;

  openingHours?: string[];

  businessStatus?: string;

  sourceUrl?: string;

  metadata?: Record<string, unknown>;
}
```

Nenhum campo deve ser inventado. Se a fonte nao possuir determinada informacao: `null`/`undefined`,
e nao uma estimativa.

---

## 7. OPENSTREETMAP / OVERPASS

A primeira fonte de descoberta sera OpenStreetMap atraves do Overpass API. O sistema deve consultar
objetos OSM por cidade, categoria, localizacao e tags relevantes.

---

## 8. OVERPASS ENDPOINT

O endpoint deve ser configuravel. Nao hardcodar um unico servidor de forma irreversivel.

```text
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
```

Permitir futuramente trocar para outro endpoint compativel.

---

## 9. CONSULTA POR CIDADE

A aplicacao deve converter "Sao Jose dos Campos" em uma area geografica adequada para consulta:

1. obter bounding box da cidade;
2. consultar a area;
3. executar a busca OSM dentro da area.

Nao fazer uma busca global.

---

## 10. GEOCODIFICACAO

```text
City → Geocoder → Bounding Box / Coordinates
```

A implementacao deve permitir cache, timeout, tratamento de erro e resultado deterministico.
Se ja existir integracao de Geocoding no projeto, reutilizar a infraestrutura existente quando
possivel. Nao duplicar codigo.

---

## 11. CATEGORIAS OSM

Mapeamento configuravel e extensivel:

```ts
const CATEGORY_MAP = {
  restaurante: [['amenity', 'restaurant']],
  dentista: [['amenity', 'dentist']],
  farmacia: [['amenity', 'pharmacy']],
  padaria: [['shop', 'bakery']],
  salao: [['shop', 'hairdresser']],
};
```

---

## 12. TERMOS LIVRES

O usuario tambem podera escrever termos como: clinica odontologica, auto pecas, mecanica, pet shop,
loja de roupas, contador, fotografo.

O sistema deve tentar mapear o termo para tags conhecidas. Se nao houver correspondencia: executar
uma estrategia de busca compativel, ou informar que a categoria nao possui mapeamento especifico.

**Nao inventar tags OSM arbitrarias.**

---

## 13. RESULTADOS OSM

Extrair quando disponiveis: nome; endereco; cidade; bairro; CEP; telefone; website; coordenadas;
categoria; horario; identificador OSM; URL do objeto.

> OSM nao deve ser tratado como equivalente ao Google Business Profile.

O sistema deve registrar explicitamente a proveniencia: `source = OPENSTREETMAP`.

---

## 14. QUALIDADE DOS DADOS OSM

Classificacao `HIGH` / `MEDIUM` / `LOW`:

- **HIGH:** nome; endereco; coordenadas; telefone ou website.
- **MEDIUM:** nome; localizacao; endereco parcial.
- **LOW:** apenas nome/coordenadas; poucos dados adicionais.

Isso **NAO** substitui o score comercial. Sao conceitos diferentes.

---

## 15. DEDUPLICACAO MULTI-SOURCE

A mesma empresa podera aparecer em OpenStreetMap, Google e Foursquare. O sistema nao pode criar tres
empresas.

Prioridade de identificacao:

1. `source` + `sourceId`;
2. identificador externo conhecido;
3. telefone normalizado;
4. website normalizado;
5. combinacao nome + endereco;
6. proximidade geografica + nome semelhante.

Nunca apagar automaticamente um lead apenas por nome semelhante. Quando houver incerteza:
`POSSIBLE_DUPLICATE` e registrar evidencia.

---

## 16. PROVENIENCIA

Cada dado externo importante deve possuir proveniencia:

```json
{
  "website": {
    "value": "https://empresa.com.br",
    "source": "OPENSTREETMAP",
    "confidence": "HIGH"
  }
}
```

Nao e necessario transformar toda a tabela em JSON se a arquitetura atual ja possui campos proprios.
O importante e manter a **origem do dado separada da conclusao do sistema**.

---

## 17-18. GOOGLE PLACES

O Google continua implementado como fonte opcional. ID: `GOOGLE_PLACES`. Estado padrao: `DISABLED`.

O sistema NAO deve consultar Google se `GOOGLE_PLACES_ENABLED=false` ou se a variavel nao existir.

Uma instalacao nova do LeadHunter deve funcionar para login, pesquisa, descoberta, armazenamento,
qualificacao e score **sem** `GOOGLE_MAPS_API_KEY`.

---

## 19. FOURSQUARE

Criar suporte arquitetural para Foursquare, mas nao tornar obrigatorio. `FOURSQUARE_ENABLED=false`
por padrao. Nao bloquear a execucao se nao houver credencial — a fonte fica indisponivel e e
ignorada, sem erro fatal.

---

## 20. REGISTRY DE FONTES

```ts
const sources = [openStreetMapSource, foursquareSource, googlePlacesSource];
```

O orquestrador deve decidir quais fontes executar.

---

## 21. MODOS DE PESQUISA

- **FREE:** somente fontes gratuitas (OpenStreetMap).
- **BALANCED:** fontes gratuitas + fontes opcionais habilitadas.
- **CUSTOM:** usuario/configuracao escolhe as fontes.

O padrao do sistema deve ser **FREE**.

---

## 22. UI DE FONTES

Na tela de prospeccao, adicionar uma secao "Fontes" mostrando OpenStreetMap (Gratuita), Foursquare
(Opcional) e Google Places (Desativado). **Nao exibir API keys na interface.**

---

## 23. PROTECAO CONTRA CUSTOS

```text
if source.isPaid && !source.enabled: skip
```

Nao usar fallback automatico para fonte paga:

```text
Overpass falhou → NAO chamar Google automaticamente → informar "Fonte gratuita indisponivel."
```

Isso e obrigatorio.

---

## 24. LIMITE DE RESULTADOS

O usuario deve escolher entre 25, 50, 100, 250 e 500. O limite deve ser validado no servidor. Nao
permitir valores arbitrarios gigantes.

---

## 25. CACHE

Implementar cache de consultas de descoberta. Chave logica: `source + cidade + categoria +
parametros`. TTL configuravel: `OVERPASS_CACHE_TTL_HOURS=24`.

Se a mesma pesquisa for realizada novamente dentro do TTL, usar cache sem repetir a consulta.

---

## 26. RATE LIMIT

Timeout; retry limitado; backoff; maximo de tentativas; respeito a HTTP 429; respeito a erros
transitorios. **Nunca criar loop infinito.**

---

## 27. FALHAS PARCIAIS

```text
OpenStreetMap → sucesso
Foursquare    → falha
Google        → desativado
```

Resultado: `SUCCESS_WITH_WARNINGS`, e nao `ERROR`. A interface deve informar quantas empresas foram
encontradas, qual fonte foi utilizada e o estado das demais.

---

## 28. ZERO RESULTADOS

Zero resultados NAO deve ser tratado automaticamente como erro. Mostrar mensagem e sugerir categoria
mais ampla, cidade, termo livre ou raio maior. **Nao executar nova consulta automaticamente.**

---

## 29-31. NORMALIZACAO

Todos os resultados devem passar por `normalizeBusiness()` antes de entrar no dominio, normalizando
telefone, URL, nome, endereco, cidade, estado, CEP e categorias.

**Telefone:** continuar usando o normalizador existente (Brasil `+55`). Nao inventar telefone.

**Website:** manter a regra da 1.1 — o sistema NAO pode afirmar "nao possui site" quando a unica
evidencia e "website nao encontrado na fonte". Usar `UNKNOWN` quando nao houver evidencia
suficiente.

---

## 32. INSTAGRAM

Manter as regras da 1.1. Nunca inferir `@empresa` apenas pelo nome. Instagram deve possuir fonte,
evidencia e confianca. A descoberta externa continua opcional.

---

## 33. QUALIDADE DO GOOGLE BUSINESS

Essa metrica deve continuar existindo **apenas quando houver dados Google**. Nao usar
`OSM rating = Google rating`. Nunca misturar.

---

## 34. SCORE

O score atual deve continuar funcionando. Adicionar `data_source_quality` ao score somente se isso
estiver definido na configuracao de scoring. **Nao alterar pesos silenciosamente.** Qualquer novo
peso deve ser explicitamente documentado.

---

## 35-36. SOURCE COVERAGE E SCORE COMERCIAL

Adicionar uma metrica separada `source_coverage` (`HIGH`/`MEDIUM`/`LOW`), que mede quao completos
sao os dados encontrados pela fonte. Nao representa probabilidade de compra.

O score deve continuar respondendo "Esse lead parece interessante para oferecer um site?" e nao
"Esse lead esta bem cadastrado no OSM?". Manter essa separacao.

---

## 37. NEXT ACTION

A logica de proxima acao da 1.1 continua. Nao criar uma acao do tipo `CONTACT_BECAUSE_OSM` — a fonte
nao determina automaticamente a acao comercial.

---

## 38-39. BANCO E IDENTIDADE EXTERNA

Adicionar apenas as colunas necessarias: `source`, `source_id`, `source_url`, `source_quality`,
`source_metadata`. Se a tabela atual ja possuir campos equivalentes, **reutilizar em vez de
duplicar**.

Idealmente criar `lead_sources` (ou equivalente) com `lead_id`, `source`, `source_id`, `source_url`,
`first_seen_at`, `last_seen_at`, `raw_data`. Isso permite:

```text
Lead A
 ├── OpenStreetMap ID
 ├── Google Place ID
 └── Foursquare ID
```

sem criar tres leads.

---

## 40-41. MIGRATION E RLS

Criar `0003_multi_source.sql`. Nao modificar migrations ja aplicadas. A migration deve ser
idempotente quando possivel, compativel com dados existentes, protegida por RLS e multi-tenant.

Toda nova tabela deve possuir RLS. Nenhum usuario pode ler, alterar ou excluir dados de outro
usuario. Dados publicos de fonte nao justificam quebrar o isolamento do tenant.

---

## 42-44. LOGS, METRICAS E HISTORICO

Logs estruturados com `source`, `query`, `city`, `resultCount`, `durationMs`, `status`, `errorCode`.
**Nunca registrar** API keys, tokens, cookies, senhas ou secrets.

Cada pesquisa deve registrar: `source`, `requested`, `returned`, `deduplicated`, `newLeads`,
`updatedLeads`, `errors`, `duration`, `cacheHit`.

Manter historico das pesquisas, e clicar deve permitir consultar os resultados daquela execucao.

---

## 45-46. UI DA PESQUISA E PROGRESSO

A interface deve permanecer limpa: Cidade, Categoria, Limite, Fontes e o botao PROSPECTAR.

Manter o sistema de eventos existente, com etapas: Preparando pesquisa → Localizando cidade →
Consultando OpenStreetMap → Recebendo resultados → Normalizando empresas → Removendo duplicados →
Qualificando presenca digital → Calculando score → Salvando leads → Concluido.

---

## 47-50. LISTA, FILTROS E EXPORTACAO

Adicionar coluna **Fonte** na lista de leads e filtro **Fonte** (Todas / OpenStreetMap / Foursquare
/ Google / Multiplas fontes).

Criar filtro `MULTI_SOURCE` para empresas identificadas em mais de uma fonte — sinal de qualidade de
descoberta, nao necessariamente sinal comercial.

CSV/XLSX existentes devem continuar funcionando, acrescentando `source`, `source_id`, `source_url`,
`source_quality` quando disponiveis.

---

## 51-53. WHATSAPP, BRIEFING E PROMPT

WhatsApp continua usando o telefone normalizado e apenas abre a conversa — nunca envia mensagem
automaticamente.

O briefing deve informar a origem dos dados e nao transformar ausencia de dado em afirmacao
("Website: Nao identificado na fonte consultada").

O prompt do Lovable continua separando `DADOS CONFIRMADOS` de `DADOS A CONFIRMAR`, preservando a
origem dos dados.

---

## 54. CONFIGURACAO

```text
PROSPECTING_DEFAULT_SOURCE=OPENSTREETMAP
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
OVERPASS_CACHE_TTL_HOURS=24
OVERPASS_TIMEOUT_MS=30000
GOOGLE_PLACES_ENABLED=false
FOURSQUARE_ENABLED=false
```

Os nomes podem ser adaptados a convencao existente.

---

## 55-57. SEGURANCA E BILLING SAFETY

Nenhuma chave de API deve ser enviada ao browser, incluida em logs, no HTML, no bundle ou commitada.
OpenStreetMap/Overpass e publico e nao precisa de segredo para uso basico.

**Mesmo que `GOOGLE_MAPS_API_KEY` esteja presente, o Google NAO deve ser utilizado enquanto
`GOOGLE_PLACES_ENABLED=false`. Isso e obrigatorio. A simples existencia da variavel nao autoriza
chamadas.** Mesma regra para Foursquare.

---

## 58-61. TESTES

**Overpass:** construcao da query; categorias; cidade; parsing; timeout; erro 429; erro 5xx;
resposta vazia.

**Normalizacao:** telefone; URL; endereco; categorias.

**Deduplicacao:** mesmo source ID; mesmo telefone; mesmo website; nome + endereco; multiplas fontes.

**Registry:** fonte habilitada; fonte desabilitada; fonte paga desabilitada; fonte gratuita
funcionando.

**Google safety (obrigatorio):** `GOOGLE_PLACES_ENABLED=false` → nenhuma chamada HTTP ao Google.

**Isolamento de fonte:** Overpass falha + Google desativado → pesquisa encerrada com erro
controlado, Google NAO foi chamado.

**Multi-source:** Empresa A (OSM+Google), Empresa B (OSM), Empresa C (Google) → 3 empresas, nao 4.

**Regressao:** todos os testes existentes da 1.1 devem continuar passando. Meta: 0 regressoes.

---

## 62-66. VERIFICACOES OBRIGATORIAS

`npm run typecheck` PASS; `npm run lint` PASS; `npm run build` PASS; `npm test` PASS. Nenhum teste
antigo pode ser removido apenas para obter PASS.

Criar `npm run verify:overpass`, que executa uma pesquisa real ("Restaurantes em Sao Jose dos
Campos") e exibe source, results e duration. Nao salvar dados de teste no banco de producao.

---

## 67-68. HEALTH E OBSERVABILIDADE

Atualizar `/health` para informar o estado das fontes:

```json
{
  "sources": {
    "openstreetmap": { "enabled": true },
    "foursquare": { "enabled": false },
    "google": { "enabled": false }
  }
}
```

Nao revelar secrets. O sistema deve permitir diagnosticar qual fonte foi usada, qual falhou, quantos
resultados retornou, quanto tempo levou e se veio do cache.

---

## 69-70. UX MOBILE E DESIGN

Manter requisito da 1.1: 100% responsivo, testado em 375, 390, 414, 768, 1024 e 1280px. A tela de
prospeccao deve funcionar integralmente no celular.

Manter fundo claro; cores vivas; cards limpos; boa hierarquia; poucos elementos simultaneos; botoes
claros; feedback visual. Nao transformar a tela em um painel tecnico excessivamente complexo.

---

## 71-72. OBJETIVO COMERCIAL E SCORE

O sistema deve otimizar para encontrar empresas com potencial de compra de presenca digital, e nao
simplesmente o maior numero possivel de empresas. 1000 empresas ruins e menos util que 100 empresas
qualificadas.

Manter a logica de score existente da 1.1. Nao substituir o score atual por uma heuristica nova
apenas por causa da migracao de fonte. Se forem necessarios novos pesos: documentar; centralizar em
configuracao; criar testes; nao espalhar numeros magicos pelo codigo.

---

## 73-74. IA E CUSTO

Nao usar LLM para deduplicacao basica, normalizacao, calculo de score, identificacao deterministica
de website, calculo de distancia ou parsing de dados. IA podera ser adicionada posteriormente como
camada opcional.

O modo padrao do LeadHunter deve ser **FREE MODE**, com OpenStreetMap/Overpass como fonte de
descoberta. Nenhuma API paga deve ser chamada.

---

## 75. NAO FAZER

Nao implementar: scraping do Google Maps; scraping de resultados protegidos; bypass de CAPTCHA;
bypass de rate limit; proxies para esconder abuso; automacao contra termos de uso; chamadas ocultas
ao Google; cobranca automatica; envio automatico de WhatsApp; envio automatico de e-mail.

---

## 76. MIGRACAO DOS LEADS EXISTENTES

Leads existentes da 1.1 devem continuar acessiveis. Nao apagar. Quando nao houver fonte registrada:
`source = LEGACY` ou equivalente. **Nao inventar retrospectivamente que um lead veio do OSM.**

---

## 77-80. DEPLOY, TIMEOUT, RETRY E CACHE

A aplicacao deve continuar funcionando na Vercel, sem depender de processo persistente, filesystem
local, worker permanente ou banco local. Overpass deve ser chamado pelo servidor.

Nenhuma requisicao externa deve ficar indefinidamente aguardando — timeout configuravel (ex.: 30s).
Retry somente em erros transitorios (429, 502, 503, 504), nunca indefinidamente e nunca em erros de
configuracao.

```text
Pesquisa → Cache? ├── SIM → usar resultado
                  └── NAO → consultar fonte → normalizar → dedupe → salvar
```

---

## 81. EXECUCAO EM FASES

- **FASE 1 — Auditoria:** ler SPEC.md, SPEC-1.1.md; mapear arquitetura, tabelas e APIs; identificar
  o que ja existe. Nao reimplementar algo que ja existe.
- **FASE 2 — Abstracao:** criar `ProspectingSource`, `RawBusiness`, `SourceSearchResult`,
  `SourceRegistry`. Sem alterar a UI ainda. Rodar testes.
- **FASE 3 — OpenStreetMap:** geocoding/bounding box; Overpass; categorias; parser; normalizacao;
  timeout; retry; cache. Criar testes.
- **FASE 4 — Orquestrador:** Registry → Selected Sources → Search → Normalize → Deduplicate →
  Qualification → Score → Persist.
- **FASE 5 — Seguranca de custos:** `GOOGLE_PLACES_ENABLED=false`, `FOURSQUARE_ENABLED=false`, com
  testes garantindo que nenhuma chamada ocorre quando desabilitado.
- **FASE 6 — Banco:** criar migration 0003, adicionar apenas o necessario, executar testes RLS.
- **FASE 7 — UI:** selecao de fontes; FREE mode; fonte; metricas; filtros; status; warnings.
- **FASE 8 — Regressao:** tests, typecheck, lint, build.
- **FASE 9 — Smoke test:** `npm run verify:overpass` com "Restaurantes / Sao Jose dos Campos".

---

## 82. CRITERIOS DE ACEITE

A SPEC 1.2 somente estara concluida se:

- **A** — o usuario conseguir pesquisar "Restaurantes / Sao Jose dos Campos" sem possuir Google API key;
- **B** — a pesquisa retornar empresas reais provenientes do OpenStreetMap/Overpass;
- **C** — os resultados forem persistidos no Supabase;
- **D** — empresas duplicadas forem consolidadas;
- **E** — a fonte de cada empresa for identificavel;
- **F** — o score continuar funcionando;
- **G** — website continuar sendo qualificado corretamente;
- **H** — Instagram continuar seguindo as regras de confianca da 1.1;
- **I** — WhatsApp continuar funcionando;
- **J** — briefing continuar funcionando;
- **K** — prompt Lovable continuar funcionando;
- **L** — Google nao for chamado quando estiver desativado;
- **M** — Foursquare nao for chamado quando estiver desativado;
- **N** — RLS continuar isolando usuarios;
- **O** — todos os testes anteriores continuarem passando;
- **P** — typecheck passar;
- **Q** — lint passar;
- **R** — build passar;
- **S** — o sistema continuar responsivo.

---

## 83. CRITERIO DE SUCESSO PRINCIPAL

```text
USUARIO NOVO → cria conta → entra no LeadHunter →
seleciona Sao Jose dos Campos / Restaurantes / 100 resultados / FREE MODE →
PROSPECTAR → OpenStreetMap/Overpass → empresas encontradas →
qualificacao → score → leads salvos
```

Tudo isso deve funcionar **sem Google Maps API Key e sem Billing do Google Maps**.

---

## 84-85. ENTREGAVEIS E DOCUMENTACAO

`SPEC-1.2.md`; migration `0003_multi_source.sql`; codigo da abstracao de fontes; integracao
Overpass; registry; normalizacao; deduplicacao; cache; protecao contra fontes pagas; UI atualizada;
testes; `verify:overpass`; documentacao no `.env.example`; atualizacao do README.

O README deve explicar o setup e deixar claro que o Google Places nao e necessario para utilizar o
modo gratuito, que Foursquare e Google sao fontes opcionais, e como habilitar cada fonte
posteriormente.

---

## 86. REGRA FINAL DE IMPLEMENTACAO

Antes de codar: leia SPEC.md; leia SPEC-1.1.md; leia este documento; inspecione o codigo atual;
identifique componentes reutilizaveis; nao duplique funcionalidades; nao remova comportamento
existente sem justificativa; implemente fase por fase; teste cada fase; somente considere concluido
apos todos os criterios de aceite.

---

## 87. RESULTADO ESPERADO

```text
                  LEADHUNTER
                       │
                       ▼
                PESQUISA LOCAL
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        OPENSTREETMAP        OUTRAS FONTES
          GRATUITO             OPCIONAIS
             │                   │
             └─────────┬─────────┘
                       ▼
                 NORMALIZACAO
                       ▼
                 DEDUPLICACAO
                       ▼
              PRESENCA DIGITAL
                       ▼
                 QUALIFICACAO
                       ▼
                    SCORE
                       ▼
              PROXIMA ACAO
                       ▼
                    CRM
                       ▼
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     WhatsApp      Briefing       Lovable
```

O Google Places passa a ser **OPCIONAL** e nunca uma dependencia estrutural.

**FIM DA SPEC-1.2**
