# LeadHunter — SPEC-Driven Development

## 0. Status do documento

- **Projeto:** LeadHunter
- **Tipo:** Sistema web de prospecção e qualificação comercial
- **Versão da especificação:** 1.0.0
- **Status:** Ready for Implementation
- **Prioridade:** Alta

Este documento é a **fonte de verdade (Single Source of Truth)** do projeto.
O agente de desenvolvimento deve consultar esta especificação antes de implementar qualquer funcionalidade.
Se houver conflito entre uma implementação sugerida pelo agente e este documento, **este documento prevalece**.

---

## 1. Visão do produto

O LeadHunter é uma aplicação web para encontrar, qualificar e organizar pequenas empresas que possuem presença no Google Business/Google Maps, mas apresentam oportunidades de melhoria na presença digital, especialmente empresas que:

- não possuem site;
- possuem presença digital incompleta;
- possuem boa reputação no Google;
- possuem avaliações suficientes para indicar atividade comercial;
- possuem telefone/WhatsApp;
- possuem Instagram ou outras redes sociais;
- apresentam sinais de que poderiam se beneficiar de um site profissional.

O sistema deve transformar uma pesquisa simples como:

> "Restaurantes em São José dos Campos"

em uma lista priorizada de potenciais clientes.

O objetivo não é simplesmente encontrar empresas. O objetivo é:

> **Encontrar empresas com maior potencial comercial para abordagem e produção de websites.**

---

## 2. Objetivo principal

O usuário deve conseguir:

1. informar uma cidade/região;
2. informar um segmento;
3. definir raio ou área de pesquisa;
4. executar a prospecção;
5. obter empresas encontradas;
6. verificar automaticamente presença/ausência de website;
7. identificar telefone/WhatsApp;
8. identificar Instagram quando possível;
9. analisar avaliações e presença digital;
10. calcular um score de oportunidade;
11. armazenar os resultados no banco;
12. evitar duplicação de empresas;
13. abrir WhatsApp diretamente;
14. organizar leads em pipeline;
15. complementar manualmente informações;
16. gerar um briefing estruturado;
17. gerar um prompt pronto para utilização no Lovable;
18. copiar o briefing/prompt com um clique.

---

## 3. Princípios fundamentais

### 3.1 Não inventar dados

O sistema nunca deve fabricar telefone, Instagram, website, endereço, avaliações, descrição, serviços, horários ou informações comerciais.

Quando uma informação não estiver disponível, utilizar:

```text
Não encontrado
```

ou

```text
Não informado
```

### 3.2 Dados observáveis ≠ previsão de compra

O sistema não deve afirmar "Esta empresa tem 90% de chance de comprar."

O score representa:

> Índice de oportunidade comercial baseado nos sinais observáveis encontrados.

O score deve ser explicável.

### 3.3 Automação sem apagar controle humano

O sistema deve automatizar a coleta e análise, mas permitir que o usuário:

- corrija informações;
- complemente informações;
- descarte leads;
- altere status;
- adicione observações;
- altere score manualmente futuramente;
- confirme ou rejeite Instagram;
- confirme ou rejeite dados encontrados.

---

## 4. Público inicial

O sistema inicialmente será utilizado por um único proprietário, mas deve ser arquitetado desde o início para suportar múltiplos usuários. Portanto:

- autenticação obrigatória;
- dados isolados por usuário;
- cada usuário visualiza apenas seus próprios leads;
- banco preparado para multi-tenant;
- arquitetura preparada para futura comercialização como SaaS.

**Não implementar cobrança ou assinatura na V1.**

---

## 5. Stack tecnológica

**Frontend:** Next.js, TypeScript, React, Tailwind CSS
**Backend:** Next.js Server Actions / Route Handlers (ou arquitetura equivalente segura)
**Banco:** Supabase / PostgreSQL
**Autenticação:** Supabase Auth
**Validação:** Zod
**Ícones:** Lucide React

Evitar dependências desnecessárias.

---

## 6. Arquitetura

```text
app/
├── dashboard/
├── prospecting/
├── companies/
├── leads/
├── pipeline/
├── briefings/
├── settings/
└── auth/

components/
├── dashboard/
├── prospecting/
├── companies/
├── leads/
├── pipeline/
├── briefing/
└── ui/

lib/
├── supabase/
├── google/
├── instagram/
├── scoring/
├── briefing/
├── whatsapp/
└── validation/

types/
database/
```

A estrutura exata pode ser adaptada, desde que mantenha separação clara de responsabilidades.

---

## 7. Integrações externas

### 7.1 Google

1. API oficial do Google Maps Platform / Places;
2. somente utilizar APIs alternativas se tecnicamente necessárias e legalmente adequadas;
3. não implementar scraping frágil do Google Maps.

O agente deve pesquisar a documentação atual da API antes da implementação. Nunca assumir endpoints obsoletos.

---

## 8. Dados desejados do Google

Sempre que disponíveis: `place_id`, nome, categoria principal, categorias, endereço, cidade, estado, país, latitude, longitude, telefone, telefone internacional, website, Google Maps URL, rating, `user_ratings_total`, horário, status operacional, descrição, localização e outras informações permitidas pela API utilizada.

Os campos efetivamente disponíveis dependem da API/plano utilizado. A aplicação deve tratar campos opcionais.

---

## 9. Detecção de website

Regra principal:

```text
website = informado pela fonte
```

- Se o Google fornecer website: `HAS_WEBSITE`
- Se não fornecer: `NO_WEBSITE_DETECTED`

Não afirmar que uma empresa "não possui site" de maneira absoluta. A interface deve utilizar **"Site não identificado"** quando a ausência for baseada somente na fonte consultada.

---

## 10. Instagram

O sistema deve tentar identificar Instagram associado à empresa quando houver fonte confiável disponível (website oficial, links públicos, APIs permitidas, mecanismos de busca, fontes públicas apropriadas).

O sistema **NÃO** deve assumir que `@empresa` pertence à empresa. Deve existir `instagram_match_confidence`:

```text
0-39   = baixa confiança
40-69  = possível
70-89  = alta
90-100 = muito alta
```

O usuário deve conseguir confirmar, rejeitar, editar ou remover.

---

## 11. WhatsApp

O sistema deve utilizar o telefone encontrado para criar a ação **Abrir WhatsApp**, normalizando números antes de criar o link.

**Não enviar mensagens automaticamente.** A ação deve apenas abrir a conversa correspondente quando tecnicamente possível.

---

## 12. Busca de prospecção

**Localização:** cidade, estado, país, raio quando suportado.

**Segmento:** campo livre (ex.: Restaurante, Dentista, Oficina mecânica, Pet shop, Contador, Imobiliária, Loja de roupas, Clínica de estética).

Não limitar o usuário a categorias fixas.

---

## 13. Filtros

- **Website:** Todos / Sem site identificado / Com site
- **Avaliação:** qualquer / ≥ 3 / ≥ 3.5 / ≥ 4 / ≥ 4.5
- **Quantidade de avaliações:** qualquer / ≥ 10 / ≥ 25 / ≥ 50 / ≥ 100
- **Instagram:** encontrado / não encontrado / alta confiança / pendente de confirmação
- **Telefone:** disponível / indisponível
- **Score:** baixa / média / alta / excelente

---

## 14. Score de oportunidade

Motor determinístico, score `0–100`:

| Critério | Pontos |
| --- | --- |
| Site não identificado | +30 |
| Google Business ativo/completo | +15 |
| Rating ≥ 4.5 | +15 |
| Instagram encontrado | +10 |
| Instagram com alta confiança | +5 |
| Telefone disponível | +5 |
| Empresa aparentemente ativa | +5 |

Quantidade de avaliações (escalonado):

```text
0–4 avaliações       +0
5–24                 +3
25–49                +7
50–99                +10
100–199              +12
200+                 +15
```

O score deve ser limitado a 100. Os pesos devem ficar centralizados em um módulo de configuração. **Não espalhar números mágicos pelo código.**

---

## 15. Classificação

```text
0–39    BAIXA OPORTUNIDADE
40–69   MÉDIA OPORTUNIDADE
70–84   ALTA OPORTUNIDADE
85–100  EXCELENTE OPORTUNIDADE
```

A interface deve utilizar destaque visual diferente para cada classificação.

---

## 16. Explicação do score

Cada lead deve possuir `score` e `score_breakdown`:

> **Correcao documental (SPEC 1.1 §28):** a soma dos itens do exemplo abaixo e **97**,
> nao 94. O sistema respeita os pesos reais da tabela da secao 14.

```text
Score: 97/100

+30  Site não identificado
+15  Google Business bem configurado
+15  Avaliação 4.8
+12  183 avaliações
+10  Instagram encontrado
+5   Instagram alta confiança
+5   Telefone disponível
+5   Empresa ativa
```

O usuário deve conseguir visualizar isso.

---

## 17. Banco de dados

**profiles:** `id`, `user_id`, `name`, `created_at`, `updated_at`

**companies:** `id`, `user_id`, `google_place_id`, `name`, `category`, `categories`, `description`, `phone`, `phone_international`, `whatsapp`, `website`, `website_status`, `google_maps_url`, `address`, `city`, `state`, `country`, `latitude`, `longitude`, `rating`, `review_count`, `opening_hours`, `business_status`, `instagram_url`, `instagram_handle`, `instagram_confidence`, `instagram_status`, `opportunity_score`, `opportunity_level`, `score_breakdown`, `source_data`, `created_at`, `updated_at`, `last_checked_at`

**prospecting_searches:** `id`, `user_id`, `query`, `city`, `state`, `country`, `radius`, `filters`, `results_count`, `qualified_count`, `created_at`

**leads:** `id`, `user_id`, `company_id`, `status`, `priority`, `notes`, `created_at`, `updated_at`, `last_contacted_at`, `next_follow_up_at`

**interactions:** `id`, `user_id`, `lead_id`, `type`, `description`, `created_at`

**briefings:** `id`, `user_id`, `company_id`, `manual_data`, `generated_briefing`, `generated_lovable_prompt`, `created_at`, `updated_at`

A estrutura pode ser normalizada adicionalmente se necessário.

---

## 18. Deduplicação

Chave principal: `google_place_id`.

Se não houver `place_id` confiável, utilizar combinação de nome, telefone, endereço e localização.

Uma mesma empresa não deve aparecer repetida no banco.

---

## 19. Histórico

O sistema deve lembrar quando a empresa foi encontrada, em qual pesquisa, quando foi atualizada, quando foi contatada, mudanças de status e observações.

---

## 20. Pipeline

```text
NOVO
QUALIFICADO
CONTATADO
RESPONDEU
INTERESSADO
PROPOSTA
VENDIDO
SEM_INTERESSE
DESCARTADO
```

O usuário deve conseguir alterar o status.

---

## 21. Dashboard

Deve mostrar: empresas cadastradas, empresas sem site identificado, oportunidades altas, oportunidades excelentes, leads contatados, interessados, propostas, vendidos.

Também deve mostrar **Principais oportunidades**, ordenadas pelo score.

---

## 22. Tela de prospecção

Campos: Cidade, Estado, Raio, Segmento. Botão: `ENCONTRAR LEADS`.

Durante a busca mostrar progresso, quantidade encontrada, quantidade processada, possíveis erros e conclusão.

**Nunca deixar a interface aparentemente travada.**

---

## 23. Tela de resultados

Cada empresa deve apresentar: nome, categoria, rating, quantidade de avaliações, cidade, telefone, website, Instagram, score, classificação, status do lead.

Ações: `Ver detalhes`, `WhatsApp`, `Instagram`, `Google Maps`, `Adicionar ao pipeline`.

---

## 24. Tela de detalhes

- **Informações básicas:** nome, categoria, endereço, telefone, WhatsApp, horário.
- **Google:** avaliação, quantidade de avaliações, mapa, URL.
- **Presença digital:** website, Instagram, status, confiança.
- **Score:** nota e justificativa.
- **CRM:** status, prioridade, notas, histórico.
- **Produção:** botão `GERAR BRIEFING PARA SITE`.

---

## 25. Briefing automático

Gerado usando exclusivamente informações disponíveis.

```text
NOME DA EMPRESA
SEGMENTO
LOCALIZAÇÃO
CONTATOS
GOOGLE
PRESENÇA DIGITAL
INSTAGRAM
DESCRIÇÃO ENCONTRADA
DADOS IDENTIFICADOS
DADOS AUSENTES
INFORMAÇÕES QUE PRECISAM SER CONFIRMADAS
SUGESTÃO DE ESTRUTURA DO SITE
```

---

## 26. Campos manuais

O usuário poderá adicionar: logo, cores, descrição, serviços, produtos, diferenciais, fotos, cardápio, preços, informações institucionais, links, observações.

Esses dados devem ser claramente separados dos dados coletados automaticamente.

---

## 27. Prompt para Lovable

Botão: `COPIAR PROMPT PARA LOVABLE`.

O prompt deve incluir: identidade da empresa, segmento, localização, contatos, informações públicas, estrutura recomendada, conteúdo disponível, informações pendentes, requisitos de responsividade, CTA, WhatsApp, SEO local básico e instruções para não inventar informações.

**Não gerar informações falsas para preencher lacunas.**

---

## 28. Copiar

Todos os conteúdos gerados devem possuir botão `Copiar` com feedback `Copiado!`. Não exigir seleção manual de texto.

---

## 29. Exportação

Manter `Exportar CSV` e `Exportar XLSX`. A exportação deve respeitar os filtros atuais.

---

## 30. Responsividade

100% responsiva. Prioridade: celular, tablet, desktop.

No celular: navegação inferior ou menu compacto, cards, botões grandes, evitar tabelas horizontais, ações importantes acessíveis com uma mão, WhatsApp facilmente acessível.

---

## 31. Design system

Visual claro, moderno, profissional, vivo, limpo e minimalista.

**Evitar:** excesso de gradientes, excesso de sombras, interface cinza e burocrática, excesso de cores, componentes gigantes.

**Usar:** fundo claro, cards brancos, bordas sutis, tipografia legível, azul como cor primária, verde para ações positivas, amarelo/laranja para atenção, vermelho somente quando necessário.

---

## 32. Acessibilidade

Contraste adequado, navegação por teclado, labels, aria-labels quando necessários, foco visível, botões com área clicável adequada, mensagens de erro claras.

---

## 33. Segurança

- chaves de API somente em variáveis de ambiente;
- nunca expor secrets no frontend;
- Row Level Security no Supabase;
- cada usuário acessa apenas seus próprios registros;
- validar inputs;
- sanitizar dados;
- proteger endpoints;
- evitar exposição de dados sensíveis.

---

## 34. Variáveis de ambiente

Criar `.env.example`. Nunca versionar `.env` com credenciais reais.

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GOOGLE_MAPS_API_KEY=

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Somente incluir variáveis realmente utilizadas. Não adicionar integrações de IA desnecessárias.

---

## 35. IA

A IA deve ser utilizada principalmente para gerar briefing, organizar informações, gerar prompt para Lovable, sugerir estrutura de site e eventualmente gerar abordagem comercial.

Não utilizar IA para substituir regras determinísticas. **O score deve ser calculado por código.**

---

## 36. Performance

Evitar chamadas duplicadas, armazenar resultados, usar cache quando apropriado, respeitar limites das APIs, processar resultados de maneira controlada, não bloquear a interface durante buscas, paginar listas grandes.

---

## 37. Controle de custos

Cache, deduplicação, evitar chamadas desnecessárias, não reconsultar empresas sem necessidade, permitir reprocessamento manual, armazenar resultados.

**Nunca fazer loops infinitos de consulta.**

---

## 38. Tratamento de erros

Erros amigáveis:

```text
Não foi possível consultar os dados desta empresa.
Tente novamente.
```

Nunca exibir stack traces ao usuário final. Logs técnicos devem existir separadamente.

---

## 39. Estado de carregamento

```text
Consultando empresas...
Processando resultados...
Verificando presença digital...
Calculando oportunidades...
Finalizando...
```

Ao terminar:

```text
Pesquisa concluída.

184 empresas encontradas.
67 sem site identificado.
23 excelentes oportunidades.
```

---

## 40. Experiência de uso

```text
Login → Nova prospecção → Cidade → Segmento → Buscar → Resultados →
Filtrar → Abrir lead → WhatsApp → Gerar briefing → Copiar prompt
```

com o mínimo possível de cliques.

---

## 41. Página de configurações

Inicialmente: nome, e-mail, senha, logout, configurações de pesquisa, preferências de score. **Não implementar cobrança ainda.**

---

## 42. Preparação para SaaS futuro

A arquitetura deve permitir futuramente planos, limites, créditos, cobrança, usuários, equipes, permissões e painel administrativo. Porém: **NÃO implementar billing na V1.**

---

## 43. Regras de implementação

**Fase 1 — Análise:** analisar repositório, stack existente, arquivos, dependências, configurações, documentação atual das APIs, limitações e apresentar plano técnico curto. Não apagar projeto existente sem necessidade.

**Fase 2 — Fundação:** Next.js, Supabase, autenticação, banco, RLS, layout, design system, navegação.

**Fase 3 — Prospecção:** pesquisa, integração Google, resultados, persistência, deduplicação.

**Fase 4 — Qualificação:** website, Instagram, telefone, score, classificação, justificativas.

**Fase 5 — CRM:** leads, pipeline, interações, histórico.

**Fase 6 — Briefing:** dados automáticos, campos manuais, briefing, prompt Lovable, copiar.

**Fase 7 — UX:** mobile, loading, erros, feedback, acessibilidade.

**Fase 8 — Testes:** typecheck, lint, build, testes unitários, integração, regras de score, autenticação, RLS, deduplicação. Corrigir erros encontrados.

---

## 44. Critérios de aceite

**Autenticação:** criar conta, login, sessão, logout, isolamento entre usuários.

**Prospecção:** cidade funciona, segmento livre funciona, pesquisa retorna empresas, resultados armazenados, sem duplicação.

**Qualificação:** website identificado quando disponível, ausência tratada corretamente, avaliações e telefone armazenados, WhatsApp abre, Instagram com nível de confiança, score calculado e explicado.

**CRM:** lead criado, status alterado, observações adicionadas, histórico funciona.

**Briefing:** briefing gerado, informações automáticas e manuais, prompt Lovable gerado, conteúdo copiável.

**UX:** desktop, tablet e celular funcionam; loading funciona; erros tratados; ações principais acessíveis.

---

## 45. Não fazer

- criar scraping frágil do Google;
- inventar informações;
- hardcodar API keys;
- criar billing;
- criar funcionalidades não especificadas sem necessidade;
- adicionar dezenas de bibliotecas sem justificativa;
- substituir o banco por armazenamento local;
- criar dados mockados como se fossem dados reais;
- declarar uma empresa sem site com certeza absoluta quando apenas não foi encontrado;
- afirmar probabilidade real de compra;
- enviar mensagens automáticas de WhatsApp;
- expor dados de usuários diferentes;
- criar uma interface apenas desktop.

---

## 46. Dados mockados

Mocks apenas para desenvolvimento, testes e demonstração visual. Devem estar claramente separados dos dados reais. **Nunca apresentar dados mockados como leads reais.**

---

## 47. Qualidade do código

TypeScript estrito, componentes reutilizáveis, funções pequenas, separação de responsabilidades, validação, tratamento de erros, nomes claros, ausência de código morto e de duplicação desnecessária.

---

## 48. Documentação

Criar/atualizar `README.md`, `.env.example`, `SPEC.md`.

README deve explicar instalação, configuração, Supabase, APIs, variáveis de ambiente, execução local, build, testes e deploy.

---

## 49. Regra final para o agente

```text
SPEC.md → Implementação → Testes → Build → Correção dos erros →
Revisão da especificação → Conclusão
```

"A interface está pronta" não é conclusão. O projeto só está concluído quando o fluxo real de
prospecção → qualificação → armazenamento → lead → WhatsApp → briefing → prompt Lovable estiver funcional.

---

## 50. Definição de pronto

O LeadHunter está pronto quando um usuário consegue: fazer login → pesquisar "restaurantes em uma cidade" → receber empresas reais → identificar quais não possuem site identificado → visualizar avaliações e presença digital → receber score de oportunidade → salvar os leads → abrir o WhatsApp → registrar o contato → complementar informações → gerar briefing → gerar prompt para Lovable → copiar o prompt.
