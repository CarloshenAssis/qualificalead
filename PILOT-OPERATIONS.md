# Piloto Apify + e-mail controlado

> **Bloqueado para produção:** as migrations `0008`, `0009` e `0010` ainda precisam ser executadas e validadas em PostgreSQL real. Nunca defina `POSTGRES_VALIDATED=true` antes disso.

## Configuração segura

Todas as integrações começam desligadas. Não use prefixo `NEXT_PUBLIC_` em nenhum segredo.

```dotenv
APIFY_ENABLED=false
APIFY_TOKEN=
# Configure exatamente um:
APIFY_ACTOR_ID=
# APIFY_TASK_ID=
APIFY_WEBHOOK_SECRET=
APIFY_MAX_RESULTS_PER_RUN=20
APIFY_MAX_COST_CENTS_PER_CAMPAIGN=500
APP_BASE_URL=https://app.example.com

EMAIL_SENDING_ENABLED=false
EMAIL_DRY_RUN=true
EMAIL_PROVIDER=resend
RESEND_API_KEY=
EMAIL_WEBHOOK_SECRET=
EMAIL_FROM=vendas@example.com
EMAIL_REPLY_TO=respostas@example.com
EMAIL_DAILY_LIMIT=20
EMAIL_CAMPAIGN_DAILY_LIMIT=20

# Gates operacionais, não credenciais. Só habilitar depois das validações abaixo.
POSTGRES_VALIDATED=false
EMAIL_DNS_VALIDATED=false
```

O token Apify e a chave Resend são enviados somente no header `Authorization` pelo servidor. Logs devem conter apenas provider, run/message ID, estado, duração e custo — nunca token, destinatário, assunto, corpo ou payload bruto.

## Fluxo operacional

1. Crie uma campanha em `/campaigns`; ela nasce `PAUSED`, com até 50 resultados e 50 envios/dia.
2. Faça a coleta Apify somente depois de revisar o teto de custo. A aplicação rejeita limite acima do configurado.
3. O webhook autenticado agenda `IMPORT_APIFY_DATASET`; receipts e IDs externos tornam reentregas idempotentes.
4. Itens inválidos são descartados, e os válidos são normalizados/deduplicados por ID de fonte, domínio, telefone e identidade de local.
5. Campos importados são dados de fonte; ausência não vira evidência negativa. Auditoria de site deve produzir observações antes do score.
6. Todo lead entra em `REVIEW_PENDING`. Em `/review`, confira evidências e contato e marque a confirmação individual para aprovar.
7. Primeiro execute em dry-run. A mensagem é persistida e exibida, mas o adapter não é chamado.
8. Ative a campanha e o envio real apenas depois de concluir o checklist.

## Checklist obrigatório de ativação

- [ ] PostgreSQL real: banco vazio `0001..0010` validado.
- [ ] PostgreSQL real: banco separado `0001..0007`, depois `0008..0010`, validado.
- [ ] `database/tests/migration-assertions.sql` passou.
- [ ] RLS, FKs tenant-safe, append-only, imutabilidade e triggers testados.
- [ ] Remetente ativo e cadastro com SPF **PASS**, DKIM **PASS** e DMARC **PASS**.
- [ ] `EMAIL_FROM` e `EMAIL_REPLY_TO` conferidos.
- [ ] Webhooks Apify e e-mail autenticados em HTTPS.
- [ ] Limites globais e por campanha em 20/dia (teto absoluto 50).
- [ ] Sequência possui mensagem inicial e no máximo um follow-up.
- [ ] Template aprovado contém identidade e opt-out.
- [ ] Supressões, bounce, complaint, unsubscribe e reply foram ensaiados.
- [ ] Follow-up é cancelado imediatamente nos eventos terminais.
- [ ] Cada lead foi aprovado individualmente.
- [ ] Dry-run revisado por operador.
- [ ] Defina `POSTGRES_VALIDATED=true` e `EMAIL_DNS_VALIDATED=true` somente após registrar evidências.
- [ ] Por último, defina `EMAIL_DRY_RUN=false` e `EMAIL_SENDING_ENABLED=true`.

## Incidentes e pausa

Pause a campanha imediatamente diante de bounce/complaint anormais. Um timeout após iniciar a requisição ao Resend é **ambíguo**: não faça retry automático; consulte o provedor usando a chave idempotente. Eventos duplicados são auditados sem repetir efeitos. Jobs transitórios usam backoff e vão para dead-letter ao esgotar tentativas.

## WhatsApp

WhatsApp permanece estritamente manual por link `wa.me`. Não há API, webhook, credencial, fila nem job de WhatsApp.

## Wiring operacional e evidência de CI

O workflow `.github/workflows/pilot-postgres.yml` é o gate obrigatório. Ele cria dois bancos PostgreSQL 16 independentes: o primeiro recebe `0001..0011`; o segundo recebe primeiro `0001..0007` e somente depois `0008..0011`. Ambos executam assertions, testes comportamentais e a jornada de integração com tabelas reais. O workflow **não** altera `POSTGRES_VALIDATED`; um operador registra o run verde e só então muda o gate no ambiente.

Configure no Apify um `headersTemplate` explícito para enviar `Authorization: Bearer <APIFY_WEBHOOK_SECRET>`. O Apify não gera uma assinatura HMAC implícita. O endpoint só aceita os quatro estados documentados de Actor Run, deriva o tenant do `campaign_source` persistido e registra receipt/job na mesma função PostgreSQL.

O webhook Resend usa os headers Standard Webhooks/Svix `svix-id`, `svix-timestamp` e `svix-signature`, o corpo bruto e tolerância de cinco minutos. `svix-id` é a chave de replay persistida. Uma resposta 2xx só ocorre depois que a função PostgreSQL gravou receipt, evento e job transacionalmente.

Custos Apify usam `amount_minor` e `currency=USD`. O campo de orçamento do piloto também representa centavos de dólar e é exibido como `US$`; nenhuma conversão BRL/USD implícita é realizada.

### Limitações antes da ativação

- O workflow precisa estar verde no PR e o resultado deve ser revisado por uma pessoa.
- `POSTGRES_VALIDATED=false`, `EMAIL_DNS_VALIDATED=false`, `EMAIL_SENDING_ENABLED=false` e `EMAIL_DRY_RUN=true` permanecem obrigatórios até essa revisão.
- Runs, webhooks e importações são conectados ao banco, porém chamadas externas continuam desligadas por padrão.
- Um envio `AMBIGUOUS` exige reconciliação humana no Resend e nunca recebe retry automático.
