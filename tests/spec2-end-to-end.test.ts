import { describe, expect, it } from 'vitest';
import type { CampaignStatus, MessageStatus, PipelineStage } from '@/types/spec2';
import { assertTransition, canSendEmails } from '@/lib/campaigns/state';
import { qualifyCompany } from '@/lib/qualification/score';
import {
  buildIdempotencyKey,
  checkSendEligibility,
  type SendEligibilityInput,
} from '@/lib/email/eligibility';
import { emailEventEffects, mergeMessageStatus } from '@/lib/email/events';
import { classifyReply } from '@/lib/inbox/classify';
import { assertStageTransition, stageForReply } from '@/lib/crm/pipeline';
import { checkSuppression } from '@/lib/email/suppression';

/**
 * Jornada completa da SPEC 2.0 §32.3, percorrida pelas regras de dominio.
 *
 * Nao toca em banco nem em rede de proposito: o que este teste protege sao as
 * **decisoes** — quem pode ser contatado, quando o envio para, o que uma resposta
 * cancela. Os adaptadores (Apify, provedor de e-mail, IA) trocam; estas regras nao.
 */

describe('jornada: campanha -> aprovacao -> envio -> resposta -> venda', () => {
  it('percorre o funil inteiro e interrompe a cadencia na resposta', () => {
    // --- 1. Campanha sai do rascunho e chega a revisao ------------------------
    let campaignStatus: CampaignStatus = 'DRAFT';
    for (const next of [
      'READY',
      'DISCOVERING',
      'ENRICHING',
      'SCORING',
      'REVIEW_REQUIRED',
    ] as CampaignStatus[]) {
      assertTransition(campaignStatus, next);
      campaignStatus = next;
    }

    // Nada sai antes da ativacao, por mais pronta que a campanha pareca (§7.4).
    expect(canSendEmails(campaignStatus)).toBe(false);

    // --- 2. Empresa descoberta e qualificada ---------------------------------
    let stage: PipelineStage = 'DISCOVERED';
    for (const next of ['ENRICHED', 'QUALIFIED', 'REVIEW_PENDING'] as PipelineStage[]) {
      assertStageTransition(stage, next);
      stage = next;
    }

    const qualification = qualifyCompany({
      gaps: [
        { gap_type: 'NO_CONVERSION_PAGE', severity: 4, confidence: 0.9, status: 'CONFIRMED' },
        { gap_type: 'NO_LEAD_CAPTURE', severity: 4, confidence: 0.85, status: 'CONFIRMED' },
      ],
      contacts: [{ email_verification_status: 'VALID', is_decision_maker: true, hasPhone: true }],
      capacity: {
        reviewCount: 180,
        rating: 4.7,
        hasOpeningHours: true,
        hasAddress: true,
        hasPhone: true,
        hasMultipleServices: true,
        hasMultipleContacts: false,
        websiteReachable: true,
      },
      timing: ['ACTIVE_CAMPAIGN'],
      dataConfidence: { coverage: 0.9, freshness: 0.9, consistency: 1, sourceCount: 2 },
      segment: 'clinicas odontologicas',
      availableObservations: ['WEBSITE_REACHABLE', 'HAS_CTA', 'HAS_FORM'],
    });

    expect(qualification.primary_gap).toBe('NO_CONVERSION_PAGE');
    expect(qualification.recommended_offer).toBe('LANDING_PAGE');
    expect(qualification.recommended_action).toBe('READY_FOR_EMAIL');

    // --- 3. Aprovacao humana e ativacao --------------------------------------
    assertStageTransition(stage, 'APPROVED_FOR_EMAIL');
    stage = 'APPROVED_FOR_EMAIL';

    assertTransition(campaignStatus, 'ACTIVE');
    campaignStatus = 'ACTIVE';
    expect(canSendEmails(campaignStatus)).toBe(true);

    // --- 4. Primeiro envio ----------------------------------------------------
    const suppression = checkSuppression(
      { email: 'ana@clinicasorriso.com.br', contactId: 'contact-1', companyId: 'company-1' },
      [],
    );
    expect(suppression.suppressed).toBe(false);

    const sendInput: SendEligibilityInput = {
      campaignStatus,
      leadStage: stage,
      leadApproved: true,
      contactEmail: 'ana@clinicasorriso.com.br',
      emailVerificationStatus: 'VALID',
      isSuppressed: suppression.suppressed,
      hasReplied: false,
      hasHardBounced: false,
      hasUnsubscribed: false,
      alreadySentForStep: false,
      hoursSinceLastSend: null,
      minIntervalHours: 72,
      senderIsActive: true,
      senderSpf: 'PASS',
      senderDkim: 'PASS',
      senderDmarc: 'PASS',
      senderSentToday: 3,
      senderDailyLimit: 25,
      campaignSentToday: 3,
      campaignDailyLimit: 25,
      templateStatus: 'APPROVED',
      messageHasIdentityAndOptOut: true,
      withinSendingWindow: true,
    };

    expect(checkSendEligibility(sendInput).allowed).toBe(true);

    const idempotencyKey = buildIdempotencyKey('campaign-lead-1', 'step-1', 'contact-1');
    let messageStatus: MessageStatus = 'SCHEDULED';

    assertStageTransition(stage, 'EMAIL_SEQUENCE_ACTIVE');
    stage = 'EMAIL_SEQUENCE_ACTIVE';

    for (const event of ['QUEUED', 'SENT', 'DELIVERED'] as const) {
      messageStatus = mergeMessageStatus(messageStatus, emailEventEffects(event).messageStatus);
    }
    expect(messageStatus).toBe('DELIVERED');

    // Um retry recalcula a mesma chave — o provedor ja aceitou, nao pode duplicar.
    expect(buildIdempotencyKey('campaign-lead-1', 'step-1', 'contact-1')).toBe(idempotencyKey);

    // --- 5. Resposta chega e interrompe tudo ---------------------------------
    const replied = emailEventEffects('REPLIED');
    expect(replied.cancelRemainingSteps).toBe(true);
    expect(replied.createTask).toBe(true);
    messageStatus = mergeMessageStatus(messageStatus, replied.messageStatus);
    expect(messageStatus).toBe('REPLIED');

    assertStageTransition(stage, 'REPLIED');
    stage = 'REPLIED';

    // O passo 2 da sequencia nunca poderia sair a partir daqui.
    const followUp = checkSendEligibility({
      ...sendInput,
      leadStage: stage,
      hasReplied: true,
      alreadySentForStep: false,
    });
    expect(followUp.allowed).toBe(false);
    expect(followUp.blockers.map((blocker) => blocker.code)).toContain('ALREADY_REPLIED');

    // --- 6. Classificacao e oportunidade -------------------------------------
    const classification = classifyReply({
      subject: 'Re: uma observacao sobre o site de voces',
      body: 'Tenho interesse sim, pode enviar. Qual o prazo?',
    });
    expect(classification.classification).toBe('POSITIVE');
    expect(classification.needsHumanReview).toBe(true);

    const nextStage = stageForReply(classification.classification);
    assertStageTransition(stage, nextStage);
    stage = nextStage;
    expect(stage).toBe('POSITIVE_REPLY');

    // --- 7. Diagnostico, reuniao, proposta, venda ----------------------------
    for (const next of ['DIAGNOSIS_SENT', 'MEETING', 'PROPOSAL', 'WON'] as PipelineStage[]) {
      assertStageTransition(stage, next);
      stage = next;
    }
    expect(stage).toBe('WON');
  });

  it('um descadastro no meio da cadencia suprime e encerra o lead', () => {
    const unsubscribe = classifyReply({
      subject: 'Re: proposta',
      body: 'Por favor, remova meu email desta lista.',
    });
    expect(unsubscribe.classification).toBe('UNSUBSCRIBE');

    const effects = emailEventEffects('UNSUBSCRIBED');
    expect(effects.suppress).toEqual({ scope: 'EMAIL', reason: 'UNSUBSCRIBE' });

    const stage = stageForReply(unsubscribe.classification);
    expect(stage).toBe('DO_NOT_CONTACT');

    // A supressao gravada barra qualquer envio futuro, em qualquer campanha.
    const blocked = checkSuppression(
      { email: 'ana@clinicasorriso.com.br', contactId: null, companyId: null },
      [{ scope: 'EMAIL', value: 'ana@clinicasorriso.com.br', reason: 'UNSUBSCRIBE' }],
    );
    expect(blocked.suppressed).toBe(true);
  });

  it('um bounce permanente encerra o endereco sem encerrar a campanha', () => {
    const effects = emailEventEffects('HARD_BOUNCE');
    expect(effects.suppress).toEqual({ scope: 'EMAIL', reason: 'HARD_BOUNCE' });
    expect(effects.cancelRemainingSteps).toBe(true);

    // A campanha continua ativa — o que parou foi o contato, nao o trabalho.
    expect(canSendEmails('ACTIVE')).toBe(true);
  });
});
