/**
 * Smoke test manual e real da FASE 7 (SPEC 1.2): roda o pipeline completo de
 * prospeccao contra o Nominatim/Overpass e os sites reais das empresas encontradas —
 * ao contrario de tests/prospecting-run.test.ts, aqui `fetch` e `discoverInstagram`
 * NAO sao mockados. So a escrita final e substituida pelo mock em memoria que o
 * resto da suite ja usa e confia (tests/helpers/supabase-mock.ts, com filtragem
 * real, nao respostas enlatadas) — a mesma logica de dedup, resolucao de identidade,
 * score e persistencia que grava no projeto real, sem tocar o Supabase de producao.
 *
 * NAO RODA no sandbox de desenvolvimento usado para construir a FASE 7: o proxy de
 * rede desse ambiente bloqueia por politica (403 no CONNECT) tanto
 * nominatim.openstreetmap.org quanto overpass-api.de — confirmado via
 * `curl "$HTTPS_PROXY/__agentproxy/status"`, que lista os dois hosts em
 * `recentRelayFailures` com `connect_rejected`. Nao ha tambem credenciais do
 * Supabase configuradas nesse ambiente para uma verificacao ponta a ponta contra o
 * projeto real. Este arquivo fica commitado para ser executado em qualquer ambiente
 * com saida de rede real (maquina do usuario, CI, etc.) — nao foi executado com
 * rede real na sessao que o criou.
 *
 * Fora de tests/ de proposito: nao roda no `npm test` (nao bate no include do
 * vitest.config.mts) por depender de rede real. Uso manual:
 *
 *   npx vitest run scripts/smoke-osm.test.ts
 */
import { describe, expect, it } from 'vitest';
import { runProspecting, type ProspectingEvent } from '@/lib/prospecting/run';
import type { ProspectingSearchInput } from '@/lib/validation/schemas';
import { createSupabaseMock } from '../tests/helpers/supabase-mock';

describe('smoke test real — OpenStreetMap / FREE MODE (SPEC 1.2 FASE 7)', () => {
  it(
    'Sao Jose dos Campos / Restaurantes / limite 100: OSM -> normalizacao -> dedup -> presenca digital -> score -> leads',
    async () => {
      const { client, tables } = createSupabaseMock();
      const input: ProspectingSearchInput = {
        segment: 'Restaurantes',
        city: 'Sao Jose dos Campos',
        country: 'Brasil',
        limit: 100,
      };

      const calledUrls: string[] = [];
      const originalFetch = global.fetch;
      global.fetch = ((...args: Parameters<typeof fetch>) => {
        calledUrls.push(String(args[0]));
        return originalFetch(...args);
      }) as typeof fetch;

      const events: ProspectingEvent[] = [];
      try {
        for await (const event of runProspecting(client, 'smoke-test-user', input)) {
          events.push(event);
          if (event.type === 'stage') console.log(`[smoke] estagio: ${event.stage} — ${event.message}`);
          if (event.type === 'warning') console.log(`[smoke] aviso: ${event.message}`);
          if (event.type === 'error') console.log(`[smoke] ERRO: ${event.message} ${event.detail ?? ''}`);
        }
      } finally {
        global.fetch = originalFetch;
      }

      const done = events.find((e) => e.type === 'done');
      expect(done, 'esperava um evento done').toBeDefined();
      if (done?.type !== 'done') throw new Error('sem evento done');

      console.log('[smoke] resumo', done.summary);
      console.log(
        '[smoke] empresas salvas (amostra)',
        tables.companies.slice(0, 5).map((c) => ({ name: c.name, score: c.opportunity_score, website: c.website })),
      );

      // Sem Google API key e sem Billing do Google: nem chamada de rede, nem fonte no resumo.
      expect(calledUrls.some((url) => url.includes('googleapis.com'))).toBe(false);
      expect(done.summary.sources).toEqual(['OpenStreetMap']);

      // Dados reais: o Overpass realmente devolveu estabelecimentos para a busca.
      expect(done.summary.rawFound).toBeGreaterThan(0);
      expect(tables.companies.length).toBeGreaterThan(0);
      expect(tables.companies.length).toBe(done.summary.saved);

      // Toda empresa salva tem proveniencia OSM registrada (FASE 6).
      for (const company of tables.companies) {
        const sources = tables.lead_sources.filter((s) => s.company_id === company.id);
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every((s) => s.source === 'OPENSTREETMAP')).toBe(true);
      }

      // Score deterministico da FASE 4 rodou de verdade (formula nao tocada nesta fase).
      for (const company of tables.companies) {
        expect(typeof company.opportunity_score).toBe('number');
        expect(company.opportunity_score).toBeGreaterThanOrEqual(0);
        expect(company.opportunity_score).toBeLessThanOrEqual(100);
      }
    },
    300_000,
  );
});
