import { Card, EmptyState, LinkButton, SectionTitle, Stat } from '@/components/ui';
import { ScoreBadge } from '@/components/ui/ScoreBadge';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import type { Company, LeadStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [
    totalCompanies,
    withoutWebsite,
    highOpportunity,
    excellentOpportunity,
    leadStatusRows,
    topCompanies,
  ] = await Promise.all([
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('website_status', 'NO_WEBSITE_DETECTED'),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('opportunity_level', 'ALTA'),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('opportunity_level', 'EXCELENTE'),
    supabase.from('leads').select('status').eq('user_id', user.id),
    supabase
      .from('companies')
      .select('*')
      .eq('user_id', user.id)
      .order('opportunity_score', { ascending: false })
      .limit(5),
  ]);

  const leadCounts = ((leadStatusRows.data ?? []) as { status: LeadStatus }[]).reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<LeadStatus, number>>,
  );

  const top = (topCompanies.data ?? []) as Company[];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Painel</h1>
          <p className="text-sm text-ink-mute">Visao geral da sua base de prospeccao.</p>
        </div>
        <LinkButton href="/prospecting" variant="primary">
          Nova prospeccao
        </LinkButton>
      </header>

      <section>
        <SectionTitle>Base</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Empresas" value={totalCompanies.count ?? 0} />
          <Stat label="Sem site identificado" value={withoutWebsite.count ?? 0} tone="attention" />
          <Stat label="Oportunidades altas" value={highOpportunity.count ?? 0} tone="brand" />
          <Stat label="Excelentes" value={excellentOpportunity.count ?? 0} tone="positive" />
        </div>
      </section>

      <section>
        <SectionTitle>Pipeline</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Contatados" value={leadCounts.CONTATADO ?? 0} />
          <Stat label="Interessados" value={leadCounts.INTERESSADO ?? 0} tone="brand" />
          <Stat label="Propostas" value={leadCounts.PROPOSTA ?? 0} tone="attention" />
          <Stat label="Vendidos" value={leadCounts.VENDIDO ?? 0} tone="positive" />
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <Link href="/companies" className="text-sm font-medium text-brand-700 underline">
              Ver todas
            </Link>
          }
        >
          Principais oportunidades
        </SectionTitle>

        {top.length ? (
          <ul className="flex flex-col gap-2">
            {top.map((company) => (
              <li key={company.id}>
                <Card className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/companies/${company.id}`}
                      className="block truncate font-medium text-ink hover:underline"
                    >
                      {company.name}
                    </Link>
                    <p className="truncate text-xs text-ink-mute">
                      {company.category ?? 'Categoria nao informada'}
                      {company.city ? ` · ${company.city}` : ''}
                      {company.website_status === 'NO_WEBSITE_DETECTED' ? ' · sem site identificado' : ''}
                    </p>
                  </div>
                  <ScoreBadge score={company.opportunity_score} level={company.opportunity_level} />
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nenhuma empresa ainda"
            description="Execute a primeira prospeccao para comecar a montar sua base de leads."
            action={
              <LinkButton href="/prospecting" variant="primary">
                Prospectar agora
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}
