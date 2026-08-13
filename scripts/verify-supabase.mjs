/**
 * Validacao real do Supabase (SPEC 1.1 §58/§64): auth, persistencia, deduplicacao
 * e RLS pelo mesmo caminho que a aplicacao usa (PostgREST + sessao de usuario).
 *
 *   node scripts/verify-supabase.mjs
 *
 * Requer dois usuarios de teste. Crie-os rodando `database/tests/rls.sql`
 * (ou pelo painel do Supabase) e informe as credenciais abaixo por variavel:
 *
 *   SB_URL, SB_ANON, E2E_USER_A, E2E_PASS_A, E2E_USER_B, E2E_PASS_B
 *
 * Nenhum dado real e alterado: tudo criado aqui usa o prefixo E2E_.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SB_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SB_ANON ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  console.error('Defina SB_URL e SB_ANON (ou as variaveis NEXT_PUBLIC_ equivalentes).');
  process.exit(1);
}

const userA = {
  email: process.env.E2E_USER_A ?? 'usuario.a@leadhunter.test',
  password: process.env.E2E_PASS_A ?? 'senha-teste-a',
};
const userB = {
  email: process.env.E2E_USER_B ?? 'usuario.b@leadhunter.test',
  password: process.env.E2E_PASS_B ?? 'senha-teste-b',
};

const results = [];
const check = (passo, esperado, obtido) =>
  results.push({ passo, esperado, obtido, resultado: String(esperado) === String(obtido) ? 'PASS' : 'FAIL' });

async function login(creds) {
  const client = createClient(URL, ANON);
  const { data, error } = await client.auth.signInWithPassword(creds);
  if (error) throw new Error(`login: ${error.message}`);
  return { client, user: data.user, session: data.session };
}

const a = await login(userA);
check('login do usuario A cria sessao', true, Boolean(a.session));

const b = await login(userB);
check('login do usuario B cria sessao', true, Boolean(b.session));

// credencial errada nao autentica
const wrong = createClient(URL, ANON);
const { error: wrongError } = await wrong.auth.signInWithPassword({ ...userA, password: 'errada' });
check('senha errada e recusada', true, Boolean(wrongError));

// sem sessao nenhuma linha e visivel (anon)
const anon = createClient(URL, ANON);
const { data: anonRows } = await anon.from('companies').select('id');
check('anonimo nao le companies', 0, anonRows?.length ?? 0);

// profile criado pelo trigger
const { data: profileA } = await a.client.from('profiles').select('*').eq('user_id', a.user.id);
check('profile do A criado automaticamente', 1, profileA?.length ?? 0);

// persistencia via PostgREST (o mesmo caminho do app)
const place = `E2E_${Date.now()}`;
const { data: inserted, error: insertError } = await a.client
  .from('companies')
  .insert({
    user_id: a.user.id,
    google_place_id: place,
    name: 'Cantina E2E',
    city: 'Sao Jose dos Campos',
    rating: 4.8,
    review_count: 183,
    phone: '(12) 3921-0000',
    website_status: 'NO_WEBSITE_DETECTED',
    opportunity_score: 97,
    opportunity_level: 'EXCELENTE',
    score_breakdown: [{ code: 'NO_WEBSITE', label: 'Site nao identificado', points: 30 }],
    google_business_quality: 'HIGH',
    next_action: 'CONTACT_NOW',
    enrichment_status: 'OK',
  })
  .select('id, opportunity_score, next_action')
  .single();

check('A grava empresa pela API', null, insertError?.message ?? null);
check('score persistido', 97, inserted?.opportunity_score);
check('next_action persistido', 'CONTACT_NOW', inserted?.next_action);

// deduplicacao pela API
const { error: dupError } = await a.client.from('companies').insert({
  user_id: a.user.id,
  google_place_id: place,
  name: 'Cantina E2E duplicada',
});
check('insercao duplicada bloqueada', '23505', dupError?.code ?? 'PERMITIDO');

// upsert idempotente (o que a prospeccao faz na 2a busca)
const { error: upsertError } = await a.client
  .from('companies')
  .upsert(
    { user_id: a.user.id, google_place_id: place, name: 'Cantina E2E', review_count: 200 },
    { onConflict: 'user_id,google_place_id' },
  );
check('upsert da 2a pesquisa aceito', null, upsertError?.message ?? null);

const { count: totalA } = await a.client
  .from('companies')
  .select('id', { count: 'exact', head: true })
  .eq('google_place_id', place);
check('2a pesquisa nao duplicou', 1, totalA);

// CRM: lead + interacao + briefing
const { data: lead, error: leadError } = await a.client
  .from('leads')
  .insert({ user_id: a.user.id, company_id: inserted.id, status: 'CONTATADO' })
  .select('id, status')
  .single();
check('lead criado', 'CONTATADO', lead?.status ?? leadError?.message);

const { error: interactionError } = await a.client
  .from('interactions')
  .insert({ user_id: a.user.id, lead_id: lead.id, type: 'WHATSAPP', description: 'contato e2e' });
check('interacao registrada', null, interactionError?.message ?? null);

const { error: briefingError } = await a.client
  .from('briefings')
  .insert({ user_id: a.user.id, company_id: inserted.id, generated_briefing: 'briefing e2e', generated_lovable_prompt: 'prompt e2e' });
check('briefing salvo', null, briefingError?.message ?? null);

// RLS pela API
const { data: bSees } = await b.client.from('companies').select('id').eq('google_place_id', place);
check('B enxerga empresa de A pela API', 0, bSees?.length ?? 0);

const { data: bLeads } = await b.client.from('leads').select('id');
check('B enxerga leads de A pela API', 0, bLeads?.length ?? 0);

const { data: bUpdated } = await b.client
  .from('companies')
  .update({ name: 'sequestrada' })
  .eq('id', inserted.id)
  .select('id');
check('B altera empresa de A pela API', 0, bUpdated?.length ?? 0);

// logout encerra o acesso
await a.client.auth.signOut();
const { data: afterSignOut } = await a.client.from('companies').select('id');
check('apos logout A nao le dados', 0, afterSignOut?.length ?? 0);

// login de volta
const relog = createClient(URL, ANON);
const { data: session, error: loginError } = await relog.auth.signInWithPassword(userA);
check('login com senha funciona', true, Boolean(session?.session) && !loginError);

const { data: afterLogin } = await relog.from('companies').select('id').eq('google_place_id', place);
check('apos login A volta a ver seus dados', 1, afterLogin?.length ?? 0);

// Limpeza: remove tudo que este script criou.
await a.client.from('companies').delete().eq('google_place_id', place);

console.table(results);
const failed = results.filter((r) => r.resultado === 'FAIL');
console.log(failed.length ? `\n${failed.length} FALHA(S)` : '\nTODOS OS PASSOS PASSARAM');
process.exit(failed.length ? 1 : 0);
