import { ProspectingForm } from '@/components/prospecting/ProspectingForm';
import { Card } from '@/components/ui';
import { serverGoogleMapsKey } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/utils';
import type { ProspectingSearch } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function ProspectingPage() {
  const hasGoogleKey = Boolean(serverGoogleMapsKey());

  const supabase = await createClient();
  const { data } = await supabase
    .from('prospecting_searches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  const searches = (data ?? []) as ProspectingSearch[];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Nova prospeccao</h1>
        <p className="text-sm text-ink-mute">
          Informe cidade e segmento. Os dados vem da Places API do Google — nada e inventado.
        </p>
      </header>

      {!hasGoogleKey ? (
        <Card className="border-attention/30 bg-attention-soft">
          <p className="text-sm text-attention">
            A chave <code>GOOGLE_MAPS_API_KEY</code> nao esta configurada. Configure-a no ambiente
            para executar prospeccoes reais.
          </p>
        </Card>
      ) : null}

      <ProspectingForm />

      {searches.length ? (
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Pesquisas recentes</h2>
          <ul className="flex flex-col gap-2">
            {searches.map((search) => (
              <li key={search.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{search.query}</p>
                    <p className="text-xs text-ink-mute">{formatDateTime(search.created_at)}</p>
                  </div>
                  <p className="text-xs text-ink-mute">
                    {search.results_count} encontradas · {search.qualified_count} qualificadas
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
