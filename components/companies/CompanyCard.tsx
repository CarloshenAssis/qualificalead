import { ExternalLink, AtSign, MapPin, MessageCircle, Star } from 'lucide-react';
import { Badge, Card, ExternalLinkButton, LinkButton } from '@/components/ui';
import { ScoreBadge } from '@/components/ui/ScoreBadge';
import { AddToPipelineButton } from './AddToPipelineButton';
import { formatPhoneDisplay, whatsappLink } from '@/lib/whatsapp/phone';
import type { CompanyWithLead } from '@/types/database';

/** Cartao de resultado (SPEC 23) — em cards tambem no celular, sem tabela horizontal. */
export function CompanyCard({ company }: { company: CompanyWithLead }) {
  const lead = company.leads?.[0] ?? null;
  const wa = whatsappLink(company.phone_international ?? company.phone);
  const location = [company.city, company.state].filter(Boolean).join(' - ');

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{company.name}</h3>
          <p className="truncate text-sm text-ink-mute">
            {company.category ?? 'Categoria nao informada'}
            {location ? ` · ${location}` : ''}
          </p>
        </div>
        <ScoreBadge score={company.opportunity_score} level={company.opportunity_level} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {company.rating !== null ? (
          <Badge tone="neutral">
            <Star className="size-3.5" aria-hidden />
            {company.rating} ({company.review_count ?? 0})
          </Badge>
        ) : (
          <Badge tone="neutral">Sem avaliacoes</Badge>
        )}

        {company.website_status === 'HAS_WEBSITE' ? (
          <Badge tone="neutral">Com site</Badge>
        ) : (
          <Badge tone="attention">Site nao identificado</Badge>
        )}

        {company.instagram_url ? (
          <Badge tone={company.instagram_status === 'CONFIRMED' ? 'positive' : 'brand'}>
            <AtSign className="size-3.5" aria-hidden />
            {company.instagram_status === 'CONFIRMED' ? 'Confirmado' : 'A confirmar'}
          </Badge>
        ) : (
          <Badge tone="neutral">Instagram nao encontrado</Badge>
        )}

        {company.phone ? (
          <Badge tone="neutral">{formatPhoneDisplay(company.phone)}</Badge>
        ) : (
          <Badge tone="neutral">Sem telefone</Badge>
        )}

        {lead ? <Badge tone="brand">{lead.status}</Badge> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/companies/${company.id}`} variant="primary">
          Ver detalhes
        </LinkButton>

        {wa ? (
          <ExternalLinkButton href={wa} variant="positive" aria-label={`Abrir WhatsApp de ${company.name}`}>
            <MessageCircle className="size-4" aria-hidden />
            WhatsApp
          </ExternalLinkButton>
        ) : null}

        {company.instagram_url ? (
          <ExternalLinkButton href={company.instagram_url} aria-label={`Instagram de ${company.name}`}>
            <AtSign className="size-4" aria-hidden />
            Instagram
          </ExternalLinkButton>
        ) : null}

        {company.google_maps_url ? (
          <ExternalLinkButton href={company.google_maps_url} aria-label={`Google Maps de ${company.name}`}>
            <MapPin className="size-4" aria-hidden />
            Maps
          </ExternalLinkButton>
        ) : null}

        {company.website ? (
          <ExternalLinkButton href={company.website} aria-label={`Site de ${company.name}`}>
            <ExternalLink className="size-4" aria-hidden />
            Site
          </ExternalLinkButton>
        ) : null}

        <AddToPipelineButton companyId={company.id} alreadyIn={Boolean(lead)} />
      </div>
    </Card>
  );
}
