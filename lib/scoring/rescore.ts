import type { Company, LeadStatus } from '@/types/database';
import { computeGoogleBusinessQuality, computeNextAction, computeOpportunityScore } from './score';
import { normalizePhone } from '@/lib/whatsapp/phone';
import { capabilitiesFor } from '@/lib/prospecting/sources/types';
import { inferCompanySource } from '@/lib/prospecting/sources/identity';

/**
 * Recalcula os dados derivados de uma empresa (SPEC 1.1 §15).
 * Usado sempre que um sinal muda: confirmacao de Instagram, mudanca de status do lead etc.
 *
 * O recalculo precisa das mesmas capacidades de fonte usadas na prospeccao original
 * (SPEC 1.2 §35) — senao um lead do OSM reavaliado aqui ganharia pontos por sinais que
 * a fonte nunca conseguiu observar.
 */
export function derivedFieldsFor(company: Company, leadStatus?: LeadStatus | null) {
  const phone = company.phone ?? company.phone_international;
  const capabilities = capabilitiesFor(inferCompanySource(company).source);

  const scoreInput = {
    website_status: company.website_status,
    rating: company.rating,
    review_count: company.review_count,
    phone,
    instagram_url: company.instagram_url,
    instagram_confidence: company.instagram_confidence,
    instagram_status: company.instagram_status,
    business_status: company.business_status,
    address: company.address,
    category: company.category,
    opening_hours: company.opening_hours,
    description: company.description,
    google_maps_url: company.google_maps_url,
  };

  const score = computeOpportunityScore(scoreInput, capabilities);
  const quality = computeGoogleBusinessQuality(scoreInput, capabilities);
  const nextAction = computeNextAction({
    score: score.score,
    quality,
    hasPhone: Boolean(normalizePhone(phone)),
    websiteStatus: company.website_status,
    businessStatus: company.business_status,
    leadStatus,
  });

  return {
    opportunity_score: score.score,
    opportunity_level: score.level,
    score_breakdown: score.breakdown,
    google_business_quality: quality,
    next_action: nextAction.action,
    next_action_reason: nextAction.reason,
  };
}
