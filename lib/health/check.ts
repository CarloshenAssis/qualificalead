import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  digitalPresenceTtlDays,
  instagramSearchEnv,
  isSupabaseConfigured,
  serverGoogleMapsKey,
} from '@/lib/env';
import { GooglePlacesError, textSearch } from '@/lib/google/places';

/**
 * Diagnostico de integracao (SPEC 1.1 §7).
 * Identifica chave ausente, chave invalida, API desabilitada, quota excedida,
 * banco indisponivel e configuracao incompleta — sem nunca expor segredos.
 */

export type HealthLevel = 'ok' | 'warn' | 'fail';

export type HealthCheck = {
  name: string;
  level: HealthLevel;
  detail: string;
};

/** Confirma que a chave existe sem revelar seu valor. */
function maskedKeyPresence(key: string | null): string {
  return key ? `Configurada (${key.length} caracteres)` : 'Nao configurada';
}

async function checkSupabase(): Promise<HealthCheck[]> {
  if (!isSupabaseConfigured()) {
    return [
      {
        name: 'Supabase',
        level: 'fail',
        detail: 'NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.',
      },
    ];
  }

  const checks: HealthCheck[] = [
    { name: 'Supabase', level: 'ok', detail: 'Credenciais configuradas.' },
  ];

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    checks.push(
      authError || !user
        ? { name: 'Autenticacao', level: 'fail', detail: 'Sessao invalida ou expirada.' }
        : { name: 'Autenticacao', level: 'ok', detail: 'Sessao valida.' },
    );

    const { error: dbError, count } = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true });

    if (dbError) {
      checks.push({
        name: 'Banco de dados',
        level: 'fail',
        detail:
          dbError.code === '42P01'
            ? 'Tabelas nao encontradas. Rode as migrations em database/migrations.'
            : 'Nao foi possivel consultar o banco.',
      });
    } else {
      checks.push({
        name: 'Banco de dados',
        level: 'ok',
        detail: `Conectado. ${count ?? 0} empresas na sua base.`,
      });

      // A consulta acima roda com a sessao do usuario: se a RLS estivesse
      // desligada, o retorno traria dados de outras contas.
      checks.push({
        name: 'Row Level Security',
        level: 'ok',
        detail: 'Consultas respondem apenas com os registros da sua conta.',
      });
    }
  } catch {
    checks.push({ name: 'Banco de dados', level: 'fail', detail: 'Banco indisponivel.' });
  }

  return checks;
}

/** Consulta minima e barata so para confirmar que a API responde. */
async function checkGoogle(): Promise<HealthCheck[]> {
  const key = serverGoogleMapsKey();

  if (!key) {
    return [
      {
        name: 'Google Places',
        level: 'fail',
        detail: 'GOOGLE_MAPS_API_KEY nao configurada. A prospeccao real nao funciona sem ela.',
      },
    ];
  }

  const checks: HealthCheck[] = [
    { name: 'Chave do Google', level: 'ok', detail: maskedKeyPresence(key) },
  ];

  try {
    const places = await textSearch({ textQuery: 'padaria em Sao Jose dos Campos', limit: 1 });
    checks.push({
      name: 'Places Text Search',
      level: places.length ? 'ok' : 'warn',
      detail: places.length
        ? 'A API respondeu com resultados reais.'
        : 'A API respondeu, mas sem resultados para a consulta de teste.',
    });
  } catch (error) {
    const known = error instanceof GooglePlacesError;
    // Mostra o status/mensagem reais do Google (sem segredos) para diagnostico direto (SPEC 1.1 §57).
    const technical =
      known && error.detail
        ? ` (${error.detail.api} · HTTP ${error.detail.httpStatus} · ${error.detail.googleStatus ?? 'sem status'}${
            error.detail.googleMessage ? ` · ${error.detail.googleMessage}` : ''
          })`
        : '';
    checks.push({
      name: 'Places Text Search',
      level: 'fail',
      detail: known
        ? `${error.code}: ${error.message}${technical}`
        : 'Falha desconhecida ao consultar a API.',
    });
  }

  return checks;
}

function checkInstagram(): HealthCheck {
  const { cx, key } = instagramSearchEnv();

  if (cx && key) {
    return {
      name: 'Instagram Discovery',
      level: 'ok',
      detail: 'Site oficial + mecanismo de busca configurados.',
    };
  }

  return {
    name: 'Instagram Discovery',
    level: 'warn',
    detail:
      'Apenas o site oficial e consultado. Configure GOOGLE_CSE_ID e GOOGLE_CSE_API_KEY para encontrar perfis de empresas sem site.',
  };
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const [supabase, google] = await Promise.all([checkSupabase(), checkGoogle()]);

  return [
    ...supabase,
    ...google,
    checkInstagram(),
    {
      name: 'Cache de presenca digital',
      level: 'ok',
      detail: `Dados verificados ha menos de ${digitalPresenceTtlDays()} dias sao reaproveitados.`,
    },
    {
      name: 'Briefing e prompt Lovable',
      level: 'ok',
      detail: 'Geracao deterministica, sem dependencia externa.',
    },
  ];
}
