import { Download } from 'lucide-react';
import { CompanyCard } from '@/components/companies/CompanyCard';
import { CompanyFilters } from '@/components/companies/CompanyFilters';
import { ReprocessBanner } from '@/components/companies/ReprocessBanner';
import { Card, EmptyState, LinkButton } from '@/components/ui';
import { createClient, requireUser } from '@/lib/supabase/server';
import { companiesQuery, PAGE_SIZE } from '@/lib/companies/query';
import { companyFiltersSchema } from '@/lib/validation/schemas';
import type { CompanyWithLead } from '@/types/database';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function buildQueryString(params: SearchParams, overrides: Record<string, string> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') search.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) search.set(key, value);
  return search.toString();
}

/**
 * Paginas numeradas clicaveis (nao so Anterior/Proxima): sempre mostra a primeira,
 * a ultima e uma janela ao redor da pagina atual, com "..." nos buracos — evita uma
 * lista enorme quando ha dezenas de paginas.
 */
export function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | 'ellipsis')[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis');
    result.push(sorted[i]);
  }
  return result;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = companyFiltersSchema.safeParse(params);
  const filters = parsed.success ? parsed.data : companyFiltersSchema.parse({});

  const user = await requireUser();
  const supabase = await createClient();

  const [{ data, count, error }, { count: failedCount }] = await Promise.all([
    companiesQuery(supabase, user.id, filters),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('enrichment_status', 'FAILED'),
  ]);

  const companies = (data ?? []) as CompanyWithLead[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQuery = buildQueryString(params);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Empresas</h1>
          <p className="text-sm text-ink-mute">
            {total} {total === 1 ? 'empresa encontrada' : 'empresas encontradas'} com os filtros atuais.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/api/export?format=csv&${exportQuery}`} prefetch={false}>
            <Download className="size-4" aria-hidden />
            CSV
          </LinkButton>
          <LinkButton href={`/api/export?format=xlsx&${exportQuery}`} prefetch={false}>
            <Download className="size-4" aria-hidden />
            XLSX
          </LinkButton>
        </div>
      </header>

      <ReprocessBanner failedCount={failedCount ?? 0} />

      <CompanyFilters filters={filters} />

      {error ? (
        <Card className="border-danger/30 bg-danger-soft">
          <p className="text-sm text-danger">
            Nao foi possivel carregar as empresas agora. Atualize a pagina e tente novamente.
          </p>
        </Card>
      ) : null}

      {!error && companies.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa por aqui"
          description="Rode uma prospeccao ou ajuste os filtros para ver resultados."
          action={
            <LinkButton href="/prospecting" variant="primary">
              Nova prospeccao
            </LinkButton>
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {companies.map((company) => (
          <li key={company.id}>
            <CompanyCard company={company} />
          </li>
        ))}
      </ul>

      {totalPages > 1 ? (
        <nav aria-label="Paginacao" className="flex flex-col items-center gap-2">
          <p className="text-sm text-ink-mute">
            Pagina {filters.page} de {totalPages}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <LinkButton
              href={`/companies?${buildQueryString(params, { page: String(Math.max(1, filters.page - 1)) })}`}
              variant="secondary"
              aria-disabled={filters.page <= 1}
              className={filters.page <= 1 ? 'pointer-events-none opacity-50' : ''}
            >
              Anterior
            </LinkButton>

            {buildPageList(filters.page, totalPages).map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-1 text-sm text-ink-mute">
                  …
                </span>
              ) : (
                <LinkButton
                  key={item}
                  href={`/companies?${buildQueryString(params, { page: String(item) })}`}
                  variant={item === filters.page ? 'primary' : 'ghost'}
                  aria-current={item === filters.page ? 'page' : undefined}
                  className="min-w-11 justify-center px-2"
                >
                  {item}
                </LinkButton>
              ),
            )}

            <LinkButton
              href={`/companies?${buildQueryString(params, { page: String(Math.min(totalPages, filters.page + 1)) })}`}
              variant="secondary"
              aria-disabled={filters.page >= totalPages}
              className={filters.page >= totalPages ? 'pointer-events-none opacity-50' : ''}
            >
              Proxima
            </LinkButton>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
