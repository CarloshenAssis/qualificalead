import { describe, expect, it } from 'vitest';
import { classifyReply, requiresSuppression, shouldCancelSequence } from '@/lib/inbox/classify';
import {
  PipelineTransitionError,
  assertStageTransition,
  canAdvance,
  isHumanReply,
  isTerminalStage,
  stageForReply,
} from '@/lib/crm/pipeline';
import { PIPELINE_STAGES, REPLY_CLASSIFICATIONS } from '@/types/spec2';

describe('classificacao de respostas (SPEC 2.0 §20.2)', () => {
  it('descadastro vence qualquer outro sinal, inclusive texto positivo', () => {
    const result = classifyReply({
      subject: 'Tenho interesse, mas',
      body: 'Gostei da proposta, porem quero me descadastrar desta lista.',
    });
    expect(result.classification).toBe('UNSUBSCRIBE');
  });

  it('descadastro vence ate uma resposta automatica', () => {
    const result = classifyReply({
      subject: 'Resposta automatica',
      body: 'Pare de enviar e-mails para este endereco.',
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    expect(result.classification).toBe('UNSUBSCRIBE');
  });

  it('reconhece ausencia temporaria', () => {
    const result = classifyReply({
      subject: 'Ausencia temporaria',
      body: 'Estou de ferias, retorno no dia 20/09.',
    });
    expect(result.classification).toBe('OUT_OF_OFFICE');
    expect(result.needsHumanReview).toBe(false);
  });

  it('cabecalho automatico identifica robo mesmo sem texto reconhecivel', () => {
    const result = classifyReply({
      subject: 'Ticket #4432',
      body: 'Recebemos sua mensagem.',
      headers: { 'X-Autoreply': 'yes' },
    });
    expect(result.classification).toBe('AUTOMATED');
    expect(result.signals).toContain('header:x-autoreply');
  });

  it('precedence bulk conta como automatico', () => {
    const result = classifyReply({
      subject: 'Aviso',
      body: 'Mensagem do sistema.',
      headers: { Precedence: 'bulk' },
    });
    expect(result.classification).toBe('AUTOMATED');
  });

  it('classifica recusa, adiamento, encaminhamento e pessoa errada', () => {
    expect(classifyReply({ subject: null, body: 'Nao temos interesse.' }).classification).toBe(
      'NEGATIVE',
    );
    expect(
      classifyReply({ subject: null, body: 'No momento nao, talvez mais para frente.' })
        .classification,
    ).toBe('NOT_NOW');
    expect(
      classifyReply({ subject: null, body: 'Fale com o Joao, ele cuida disso.' }).classification,
    ).toBe('REFERRAL');
    expect(
      classifyReply({ subject: null, body: 'Nao sou a pessoa responsavel por isso.' })
        .classification,
    ).toBe('WRONG_PERSON');
  });

  it('classifica interesse e pedido de preco como positivo', () => {
    expect(classifyReply({ subject: null, body: 'Tenho interesse, pode enviar.' }).classification)
      .toBe('POSITIVE');
    expect(classifyReply({ subject: null, body: 'Quanto custa?' }).classification).toBe('POSITIVE');
  });

  it('resposta positiva pede confirmacao humana — ela move dinheiro', () => {
    expect(classifyReply({ subject: null, body: 'Vamos conversar.' }).needsHumanReview).toBe(true);
  });

  it('texto ambiguo vira UNKNOWN e vai para revisao humana (SPEC 2.0 §20.4)', () => {
    const result = classifyReply({ subject: 'ok', body: 'ok' });
    expect(result.classification).toBe('UNKNOWN');
    expect(result.needsHumanReview).toBe(true);
  });

  it('corpo vazio nao quebra e nao inventa classificacao', () => {
    const result = classifyReply({ subject: null, body: null });
    expect(result.classification).toBe('UNKNOWN');
    expect(result.signals).toEqual([]);
  });

  it('ignora acentuacao e caixa', () => {
    expect(
      classifyReply({ subject: null, body: 'NÃO TEMOS INTERESSE' }).classification,
    ).toBe('NEGATIVE');
  });

  it('a decisao sempre cita os sinais que a sustentaram (SPEC 2.0 §3.1)', () => {
    const result = classifyReply({ subject: null, body: 'Quero me descadastrar.' });
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('toda resposta interrompe a cadencia (SPEC 2.0 §3.4)', () => {
    expect(shouldCancelSequence()).toBe(true);
  });

  it('so descadastro exige supressao', () => {
    for (const classification of REPLY_CLASSIFICATIONS) {
      expect(requiresSuppression(classification), classification).toBe(
        classification === 'UNSUBSCRIBE',
      );
    }
  });
});

describe('pipeline (SPEC 2.0 §21)', () => {
  it('descoberta nao cria oportunidade comercial automaticamente (§21.2)', () => {
    expect(canAdvance('DISCOVERED', 'QUALIFIED')).toBe(false);
    expect(canAdvance('DISCOVERED', 'APPROVED_FOR_EMAIL')).toBe(false);
    expect(canAdvance('DISCOVERED', 'ENRICHED')).toBe(true);
  });

  it('um lead qualificado nunca pula a revisao humana', () => {
    expect(canAdvance('QUALIFIED', 'APPROVED_FOR_EMAIL')).toBe(false);
    expect(canAdvance('QUALIFIED', 'REVIEW_PENDING')).toBe(true);
    expect(canAdvance('REVIEW_PENDING', 'APPROVED_FOR_EMAIL')).toBe(true);
  });

  it('WON, LOST e DO_NOT_CONTACT sao terminais', () => {
    for (const stage of ['WON', 'LOST', 'DO_NOT_CONTACT'] as const) {
      expect(isTerminalStage(stage), stage).toBe(true);
      for (const target of PIPELINE_STAGES) {
        expect(canAdvance(stage, target), `${stage} -> ${target}`).toBe(false);
      }
    }
  });

  it('nenhum estagio transiciona para si mesmo', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(canAdvance(stage, stage), stage).toBe(false);
    }
  });

  it('um lead sem interesse hoje nao e terminal — pode voltar numa campanha futura', () => {
    expect(isTerminalStage('NOT_INTERESTED')).toBe(false);
    expect(isTerminalStage('UNRESPONSIVE')).toBe(false);
  });

  it('toda resposta passa por REPLIED antes de ser classificada', () => {
    expect(canAdvance('EMAIL_SEQUENCE_ACTIVE', 'REPLIED')).toBe(true);
    expect(canAdvance('EMAIL_SEQUENCE_ACTIVE', 'POSITIVE_REPLY')).toBe(false);
    expect(canAdvance('REPLIED', 'POSITIVE_REPLY')).toBe(true);
  });

  it('assertStageTransition lanca com os dois estagios na mensagem', () => {
    expect(() => assertStageTransition('WON', 'PROPOSAL')).toThrow(PipelineTransitionError);
    expect(() => assertStageTransition('WON', 'PROPOSAL')).toThrow(/WON -> PROPOSAL/);
  });

  it('todo estagio alcancavel a partir de REPLIED e valido', () => {
    for (const classification of REPLY_CLASSIFICATIONS) {
      const stage = stageForReply(classification);
      expect(PIPELINE_STAGES, classification).toContain(stage);
    }
  });

  it('a classificacao decide o destino do lead (SPEC 2.0 §20.3)', () => {
    expect(stageForReply('POSITIVE')).toBe('POSITIVE_REPLY');
    expect(stageForReply('QUESTION')).toBe('POSITIVE_REPLY');
    expect(stageForReply('REFERRAL')).toBe('POSITIVE_REPLY');
    expect(stageForReply('NEGATIVE')).toBe('NOT_INTERESTED');
    expect(stageForReply('NOT_NOW')).toBe('NOT_INTERESTED');
    expect(stageForReply('UNSUBSCRIBE')).toBe('DO_NOT_CONTACT');
    expect(stageForReply('UNKNOWN')).toBe('REPLIED');
  });

  it('robo e ausencia temporaria nao tiram o lead da cadencia', () => {
    expect(stageForReply('AUTOMATED')).toBe('EMAIL_SEQUENCE_ACTIVE');
    expect(stageForReply('OUT_OF_OFFICE')).toBe('EMAIL_SEQUENCE_ACTIVE');
    expect(isHumanReply('AUTOMATED')).toBe(false);
    expect(isHumanReply('OUT_OF_OFFICE')).toBe(false);
    expect(isHumanReply('POSITIVE')).toBe(true);
  });

  it('o caminho completo da SPEC 2.0 §38 e percorrivel de ponta a ponta', () => {
    const journey: Array<[(typeof PIPELINE_STAGES)[number], (typeof PIPELINE_STAGES)[number]]> = [
      ['DISCOVERED', 'ENRICHED'],
      ['ENRICHED', 'QUALIFIED'],
      ['QUALIFIED', 'REVIEW_PENDING'],
      ['REVIEW_PENDING', 'APPROVED_FOR_EMAIL'],
      ['APPROVED_FOR_EMAIL', 'EMAIL_SEQUENCE_ACTIVE'],
      ['EMAIL_SEQUENCE_ACTIVE', 'REPLIED'],
      ['REPLIED', 'POSITIVE_REPLY'],
      ['POSITIVE_REPLY', 'DIAGNOSIS_SENT'],
      ['DIAGNOSIS_SENT', 'MEETING'],
      ['MEETING', 'PROPOSAL'],
      ['PROPOSAL', 'WON'],
    ];

    for (const [from, to] of journey) {
      expect(canAdvance(from, to), `${from} -> ${to}`).toBe(true);
    }
  });
});
