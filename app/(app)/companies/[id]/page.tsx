import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, MapPin, MessageCircle, Star } from 'lucide-react';
import { Badge, Card, ExternalLinkButton, SectionTitle } from '@/components/ui';
import { ScoreBreakdown } from '@/components/ui/ScoreBadge';
import { InstagramReview } from '@/components/companies/InstagramReview';
import { LeadPanel } from '@/components/leads/LeadPanel';
import { BriefingPanel } from '@/components/briefing/BriefingPanel';
import { createClient, requireUser } from '@/lib/supabase/server';
import { formatPhoneDisplay, whatsappLink } from '@/lib/whatsapp/phone';
import { formatDate } from '@/lib/utils';
import type { Briefing, Company, Interaction, Lead } from '@/types/database';

export const dynamic = 'force-dynamic';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-0">
      <dt className="text-sm text-ink-mute">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: companyRow } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!companyRow) notFound();
  const company = companyRow as Company;

  const { data: leadRow } = await supabase
    .from('leads')
    .select('*')
    .eq('company_id', company.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const lead = (leadRow as Lead | null) ?? null;

  const { data: interactionRows } = lead
    ? await supabase
        .from('interactions')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] };

  const { data: briefingRow } = await supabase
    .from('briefings')
    .select('*')
    .eq('company_id', company.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const wa = whatsappLink(company.phone_international ?? company.phone);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-ink-mute">
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para empresas
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">{company.name}</h1>
        <p className="text-sm text-ink-mute">
          {company.category ?? 'Categoria nao informada'}
          {company.city ? ` · ${company.city}${company.state ? ` - ${company.state}` : ''}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {wa ? (
          <ExternalLinkButton href={wa} variant="positive">
            <MessageCircle className="size-4" aria-hidden />
            WhatsApp
          </ExternalLinkButton>
        ) : null}
        {company.google_maps_url ? (
          <ExternalLinkButton href={company.google_maps_url}>
            <MapPin className="size-4" aria-hidden />
            Google Maps
          </ExternalLinkButton>
        ) : null}
        {company.website ? (
          <ExternalLinkButton href={company.website}>
            <ExternalLink className="size-4" aria-hidden />
            Site
          </ExternalLinkButton>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Informacoes basicas</SectionTitle>
          <dl>
            <InfoRow label="Nome" value={company.name} />
            <InfoRow label="Categoria" value={company.category ?? 'Nao informado'} />
            <InfoRow label="Endereco" value={company.address ?? 'Nao informado'} />
            <InfoRow label="Telefone" value={formatPhoneDisplay(company.phone) ?? 'Nao encontrado'} />
            <InfoRow
              label="WhatsApp"
              value={wa ? <span className="text-positive">Disponivel</span> : 'Nao encontrado'}
            />
            <InfoRow
              label="Horarios"
              value={
                company.opening_hours?.length ? (
                  <span className="block text-right text-xs font-normal text-ink-soft">
                    {company.opening_hours.map((hour) => (
                      <span key={hour} className="block">
                        {hour}
                      </span>
                    ))}
                  </span>
                ) : (
                  'Nao informado'
                )
              }
            />
          </dl>
        </Card>

        <Card>
          <SectionTitle>Google</SectionTitle>
          <dl>
            <InfoRow
              label="Avaliacao"
              value={
                company.rating !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-4 text-attention" aria-hidden />
                    {company.rating}
                  </span>
                ) : (
                  'Nao encontrado'
                )
              }
            />
            <InfoRow label="Quantidade de avaliacoes" value={company.review_count ?? 'Nao encontrado'} />
            <InfoRow label="Situacao" value={company.business_status ?? 'Nao informado'} />
            <InfoRow label="Encontrada em" value={formatDate(company.created_at)} />
            <InfoRow label="Ultima verificacao" value={formatDate(company.last_checked_at)} />
          </dl>
        </Card>

        <Card>
          <SectionTitle>Presenca digital</SectionTitle>
          <dl>
            <InfoRow
              label="Website"
              value={
                company.website_status === 'HAS_WEBSITE' && company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline"
                  >
                    {company.website}
                  </a>
                ) : (
                  <Badge tone="attention">Site nao identificado</Badge>
                )
              }
            />
            <InfoRow
              label="Instagram"
              value={company.instagram_handle ?? (company.instagram_url ? company.instagram_url : 'Nao encontrado')}
            />
            <InfoRow label="Situacao do Instagram" value={company.instagram_status} />
          </dl>
          <p className="mt-3 text-xs text-ink-mute">
            &quot;Site nao identificado&quot; significa que a fonte consultada nao informou um site —
            nao e uma afirmacao definitiva de que a empresa nao possui um.
          </p>
        </Card>

        <ScoreBreakdown
          score={company.opportunity_score}
          level={company.opportunity_level}
          breakdown={company.score_breakdown ?? []}
        />

        <InstagramReview company={company} />

        <LeadPanel
          companyId={company.id}
          lead={lead}
          interactions={(interactionRows ?? []) as Interaction[]}
          whatsappUrl={wa}
        />

        <div className="lg:col-span-2">
          <BriefingPanel companyId={company.id} briefing={(briefingRow as Briefing | null) ?? null} />
        </div>
      </div>
    </div>
  );
}
