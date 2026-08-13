import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton } from '@/components/ui';
import { createClient, requireUser } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { LEAD_STATUSES, type Company, type Lead, type LeadStatus } from '@/types/database';

export const dynamic = 'force-dynamic';

type LeadWithCompany = Lead & { companies: Company | null };

const STATUS_TONE: Partial<Record<LeadStatus, 'brand' | 'positive' | 'attention' | 'neutral'>> = {
  NOVO: 'neutral',
  QUALIFICADO: 'brand',
  CONTATADO: 'brand',
  RESPONDEU: 'brand',
  INTERESSADO: 'attention',
  PROPOSTA: 'attention',
  VENDIDO: 'positive',
  SEM_INTERESSE: 'neutral',
  DESCARTADO: 'neutral',
};

export default async function PipelinePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('leads')
    .select('*, companies(*)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  const leads = (data ?? []) as LeadWithCompany[];

  if (!leads.length) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
        <EmptyState
          title="Nenhum lead no pipeline"
          description="Adicione empresas ao pipeline a partir da lista de resultados."
          action={
            <LinkButton href="/companies" variant="primary">
              Ver empresas
            </LinkButton>
          }
        />
      </div>
    );
  }

  const byStatus = LEAD_STATUSES.map((status) => ({
    status,
    items: leads.filter((lead) => lead.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
        <p className="text-sm text-ink-mute">{leads.length} leads em acompanhamento.</p>
      </header>

      {byStatus.map((group) => (
        <section key={group.status}>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{group.status.replace(/_/g, ' ')}</h2>
            <Badge tone={STATUS_TONE[group.status] ?? 'neutral'}>{group.items.length}</Badge>
          </div>

          <ul className="flex flex-col gap-2">
            {group.items.map((lead) => (
              <li key={lead.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {lead.companies ? (
                      <Link
                        href={`/companies/${lead.companies.id}`}
                        className="block truncate font-medium text-ink hover:underline"
                      >
                        {lead.companies.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">Empresa removida</span>
                    )}
                    <p className="truncate text-xs text-ink-mute">
                      Prioridade {lead.priority}
                      {lead.last_contacted_at
                        ? ` · ultimo contato em ${formatDate(lead.last_contacted_at)}`
                        : ' · sem contato registrado'}
                    </p>
                  </div>

                  {lead.companies ? (
                    <LinkButton href={`/companies/${lead.companies.id}`} variant="secondary">
                      Abrir
                    </LinkButton>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
