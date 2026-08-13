import type { Company, LeadStatus } from '@/types/database';
import { computeGoogleBusinessQuality, computeNextAction, computeOpportunityScore } from './score';
import { normalizePhone } from '@/lib/whatsapp/phone';

/**
 * Recalcula os dados derivados de uma empresa (SPEC 1.1 §15).
 * Usado sempre que um sinal muda: confirmacao de Instagram, mudanca de status do lead etc.
 */
export function derivedFieldsFor(company: Company, leadStatus?: LeadStatus | null) {
  const phone = company.phone ?? company.phone_international;

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

  const score = computeOpportunityScore(scoreInput);
  const quality = computeGoogleBusinessQuality(scoreInput);
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
