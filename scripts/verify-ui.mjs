/**
 * Fluxo real pela interface (SPEC 1.1 §64): login -> painel -> empresas -> filtros ->
 * ficha -> WhatsApp -> status -> briefing -> prompt -> copiar -> exportar -> logout,
 * checando tambem responsividade e ausencia de overflow horizontal.
 *
 *   npm run build && npm start          # em outro terminal
 *   node scripts/verify-ui.mjs
 *
 * Requer ao menos uma empresa na base do usuario de teste (rode antes
 * `node scripts/verify-supabase.mjs`, que cria a empresa "Cantina E2E").
 */
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const results = [];
const check = (passo, esperado, obtido) =>
  results.push({ passo, esperado, obtido, resultado: String(esperado) === String(obtido) ? 'PASS' : 'FAIL' });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  // 1. Login pela interface
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', process.env.E2E_USER_A ?? 'usuario.a@leadhunter.test');
  await page.fill('#password', process.env.E2E_PASS_A ?? 'senha-teste-a');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  check('login pela interface leva ao painel', true, page.url().includes('/dashboard'));

  // 2. Painel com numeros reais do banco
  const painel = await page.textContent('body');
  check('painel carrega', true, painel.includes('Painel'));
  check('painel mostra empresas da base', true, /Empresas/.test(painel));

  // 3. Lista de empresas
  await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
  const lista = await page.textContent('body');
  check('lista mostra a empresa persistida', true, lista.includes('Cantina E2E'));
  check('lista mostra status do site', true, lista.includes('Site nao identificado'));
  check(
    'lista mostra acao recomendada',
    true,
    /Contatar agora|Pesquisar mais|Baixa prioridade|Ja contatado|Nao contatar/.test(lista),
  );

  // 4. Filtro combinado pela URL
  await page.goto(`${BASE}/companies?website=without&minScore=70&sort=reviews`, { waitUntil: 'networkidle' });
  const filtrada = await page.textContent('body');
  check('filtro combinado mantem a empresa', true, filtrada.includes('Cantina E2E'));

  await page.goto(`${BASE}/companies?level=BAIXA`, { waitUntil: 'networkidle' });
  const vazia = await page.textContent('body');
  check('filtro que nao casa retorna vazio', true, vazia.includes('Nenhuma empresa por aqui'));

  // 5. Ficha da empresa
  await page.goto(`${BASE}/companies?website=without`, { waitUntil: 'networkidle' });
  await page.click('a:has-text("Ver detalhes")');
  await page.waitForURL('**/companies/**', { timeout: 20000 });
  const ficha = await page.textContent('body');
  check('ficha mostra o score', true, /\d+\/100/.test(ficha));
  check('ficha mostra a justificativa', true, ficha.includes('Site nao identificado'));
  check('ficha mostra acao recomendada', true, ficha.includes('ACAO RECOMENDADA') || /Acao recomendada/i.test(ficha));
  check('ficha mostra o CRM', true, ficha.includes('CRM'));

  // 6. WhatsApp com telefone valido
  const wa = await page.getAttribute('a:has-text("WhatsApp")', 'href');
  check('link de WhatsApp normalizado', 'https://wa.me/551239210000', wa);

  // 7. Alterar status do lead
  await page.selectOption('#status', 'INTERESSADO');
  await page.click('button:has-text("Salvar lead")');
  await page.waitForSelector('text=Lead atualizado.', { timeout: 20000 });
  check('status do lead salvo', true, true);

  // 8. Gerar briefing + prompt
  await page.click('button:has-text("GERAR BRIEFING"), button:has-text("ATUALIZAR BRIEFING")');
  await page.waitForSelector('text=BRIEFING PARA PRODUCAO DE SITE', { timeout: 20000 });
  const comBriefing = await page.textContent('body');
  check('briefing gerado', true, comBriefing.includes('INFORMACOES PENDENTES / A CONFIRMAR'));
  check('prompt do Lovable gerado', true, comBriefing.includes('DADOS CONFIRMADOS'));
  check('prompt separa dados a confirmar', true, comBriefing.includes('DADOS A CONFIRMAR'));

  // 9. Copiar (permissao de clipboard concedida ao contexto)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.click('button:has-text("COPIAR PROMPT PARA LOVABLE")');
  await page.waitForSelector('text=Copiado!', { timeout: 10000 });
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  check('copiar coloca o prompt na area de transferencia', true, copiado.includes('DADOS CONFIRMADOS'));

  // 10. Diagnostico
  await page.goto(`${BASE}/health`, { waitUntil: 'networkidle' });
  const health = await page.textContent('body');
  check('health mostra Supabase', true, health.includes('Supabase'));
  check('health detecta chave do Google ausente', true, health.includes('GOOGLE_MAPS_API_KEY'));
  check('health confirma banco conectado', true, health.includes('Conectado'));

  // 11. Exportacao respeitando filtro
  // Download nao pode ser aberto com page.goto: usa o contexto de requisicao com os cookies da sessao.
  const csv = await page.request.get(`${BASE}/api/export?format=csv&website=without`);
  const csvText = await csv.text();
  check('CSV exporta a empresa filtrada', true, csvText.includes('Cantina E2E'));
  check('CSV traz o link de WhatsApp', true, csvText.includes('wa.me/551239210000'));
  check('CSV traz a acao recomendada', true, csvText.includes('Acao recomendada'));

  const filtroSemResultado = await page.request.get(`${BASE}/api/export?format=csv&level=BAIXA`);
  const vazio = await filtroSemResultado.text();
  check('CSV respeita filtro sem resultado', false, vazio.includes('Cantina E2E'));

  const xlsx = await page.request.get(`${BASE}/api/export?format=xlsx`);
  const buffer = await xlsx.body();
  check('XLSX e um pacote ZIP valido', 'PK', String.fromCharCode(buffer[0], buffer[1]));

  // 12. Sem overflow horizontal no celular (390px)
  await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check('sem overflow horizontal em 390px', false, overflow);

  for (const width of [375, 414, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    check(`sem overflow horizontal em ${width}px`, false, over);
  }

  // 13. Logout
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sair da conta")');
  await page.waitForURL('**/login**', { timeout: 20000 });
  check('logout encerra a sessao', true, page.url().includes('/login'));

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  check('rota protegida apos logout', true, page.url().includes('/login'));
} catch (error) {
  results.push({ passo: 'ERRO', esperado: '-', obtido: String(error).slice(0, 200), resultado: 'FAIL' });
} finally {
  await browser.close();
}

console.table(results);
const failed = results.filter((r) => r.resultado === 'FAIL');
console.log(failed.length ? `\n${failed.length} FALHA(S)` : '\nTODOS OS PASSOS PASSARAM');
process.exit(failed.length ? 1 : 0);
