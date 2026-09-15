import type { PipelineStage, ReplyClassification } from '@/types/spec2';

/**
 * Pipeline comercial (SPEC 2.0 §21).
 *
 * A regra estrutural da 2.0 esta no §21.2, primeira linha: **descoberta cria
 * empresa, nao cria oportunidade comercial**. Uma empresa encontrada e um dado;
 * uma oportunidade e um compromisso. Por isso `DISCOVERED` nao anda sozinho ate o
 * fim — cada avanco depende de um fato novo (enriquecimento, score, aprovacao
 * humana, envio, resposta).
 */

const TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  DISCOVERED: ['ENRICHED', 'DO_NOT_CONTACT'],
  ENRICHED: ['QUALIFIED', 'DISCOVERED', 'DO_NOT_CONTACT'],
  // Um lead qualificado nunca pula a revisao humana a caminho do e-mail (SPEC 2.0 §3.5).
  QUALIFIED: ['REVIEW_PENDING', 'ENRICHED', 'DO_NOT_CONTACT'],
  REVIEW_PENDING: ['APPROVED_FOR_EMAIL', 'NOT_INTERESTED', 'DO_NOT_CONTACT', 'QUALIFIED'],
  APPROVED_FOR_EMAIL: ['EMAIL_SEQUENCE_ACTIVE', 'REVIEW_PENDING', 'DO_NOT_CONTACT'],
  EMAIL_SEQUENCE_ACTIVE: ['REPLIED', 'UNRESPONSIVE', 'DO_NOT_CONTACT'],
  // Toda resposta passa por REPLIED antes de ser classificada (SPEC 2.0 §21.2).
  REPLIED: ['POSITIVE_REPLY', 'NOT_INTERESTED', 'UNRESPONSIVE', 'DO_NOT_CONTACT'],
  POSITIVE_REPLY: ['DISCOVERY', 'DIAGNOSIS_SENT', 'MEETING', 'NOT_INTERESTED', 'DO_NOT_CONTACT'],
  DISCOVERY: ['DIAGNOSIS_SENT', 'MEETING', 'PROPOSAL', 'NOT_INTERESTED', 'LOST'],
  DIAGNOSIS_SENT: ['MEETING', 'PROPOSAL', 'NOT_INTERESTED', 'LOST'],
  MEETING: ['PROPOSAL', 'NOT_INTERESTED', 'LOST'],
  PROPOSAL: ['WON', 'LOST', 'NOT_INTERESTED'],
  // Terminais da campanha (SPEC 2.0 §21.2).
  WON: [],
  LOST: [],
  DO_NOT_CONTACT: [],
  // Nao sao terminais: um lead sem interesse hoje pode voltar numa campanha futura.
  NOT_INTERESTED: ['DO_NOT_CONTACT'],
  UNRESPONSIVE: ['DO_NOT_CONTACT', 'REVIEW_PENDING'],
};

export const TERMINAL_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  'WON',
  'LOST',
  'DO_NOT_CONTACT',
]);

export function canAdvance(from: PipelineStage, to: PipelineStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedStages(from: PipelineStage): PipelineStage[] {
  return [...TRANSITIONS[from]];
}

export function isTerminalStage(stage: PipelineStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export class PipelineTransitionError extends Error {
  constructor(
    readonly from: PipelineStage,
    readonly to: PipelineStage,
  ) {
    super(`Transicao invalida de pipeline: ${from} -> ${to}.`);
    this.name = 'PipelineTransitionError';
  }
}

export function assertStageTransition(from: PipelineStage, to: PipelineStage): void {
  if (!canAdvance(from, to)) throw new PipelineTransitionError(from, to);
}

/**
 * Estagio para onde a resposta leva o lead depois de classificada (SPEC 2.0 §20.3).
 * O lead ja passou por `REPLIED` quando esta funcao e consultada — aqui so se
 * decide o destino.
 */
export function stageForReply(classification: ReplyClassification): PipelineStage {
  switch (classification) {
    case 'POSITIVE':
    case 'QUESTION':
    case 'REFERRAL':
      return 'POSITIVE_REPLY';
    case 'NEGATIVE':
    case 'NOT_NOW':
    case 'WRONG_PERSON':
      return 'NOT_INTERESTED';
    case 'UNSUBSCRIBE':
      return 'DO_NOT_CONTACT';
    /**
     * Ausencia temporaria e robo nao sao resposta da pessoa: o lead continua na
     * cadencia (possivelmente reagendado, §20.4) em vez de ser movido.
     */
    case 'OUT_OF_OFFICE':
    case 'AUTOMATED':
      return 'EMAIL_SEQUENCE_ACTIVE';
    case 'UNKNOWN':
      return 'REPLIED';
  }
}

/**
 * Uma resposta humana sempre marca `REPLIED` primeiro (§21.2). Resposta automatica
 * nao: ninguem leu o e-mail ainda.
 */
export function isHumanReply(classification: ReplyClassification): boolean {
  return classification !== 'AUTOMATED' && classification !== 'OUT_OF_OFFICE';
}
