import type { ReplyClassification } from '@/types/spec2';

/**
 * Classificacao deterministica de respostas (SPEC 2.0 §20.2).
 *
 * A IA e opcional em todo o produto (§15.5), entao a triagem precisa funcionar sem
 * ela. Este classificador le sinais explicitos — cabecalhos automaticos e
 * expressoes inequivocas — e assume `UNKNOWN` sempre que a leitura seria um
 * palpite. `UNKNOWN` nao e falha: e o estado que manda o caso para um humano
 * (§20.4), que e o comportamento correto quando o sistema nao sabe.
 */

export type ReplyInput = {
  subject: string | null;
  body: string | null;
  /** Cabecalhos relevantes, em minusculas na chave. */
  headers?: Record<string, string>;
};

export type ReplyClassificationResult = {
  classification: ReplyClassification;
  /** Sinais que sustentaram a decisao — sempre citaveis (SPEC 2.0 §3.1). */
  signals: string[];
  /** `true` quando a decisao precisa de confirmacao humana (§20.4). */
  needsHumanReview: boolean;
};

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const UNSUBSCRIBE_PATTERNS = [
  'descadastr',
  'remover meu email',
  'remova meu email',
  'nao quero receber',
  'pare de enviar',
  'parem de enviar',
  'sair da lista',
  'unsubscribe',
  'opt out',
  'opt-out',
];

const OUT_OF_OFFICE_PATTERNS = [
  'ausencia temporaria',
  'estarei ausente',
  'estou ausente',
  'de ferias',
  'em ferias',
  'retorno no dia',
  'out of office',
  'automatic reply',
  'resposta automatica',
];

const NEGATIVE_PATTERNS = [
  'nao temos interesse',
  'nao tenho interesse',
  'sem interesse',
  'nao precisamos',
  'ja temos fornecedor',
  'ja temos site',
  'nao obrigado',
  'nao, obrigado',
];

const NOT_NOW_PATTERNS = [
  'no momento nao',
  'agora nao',
  'talvez mais para frente',
  'mais para frente',
  'volte a falar',
  'retome em',
  'depois do',
  'ano que vem',
  'proximo trimestre',
];

const REFERRAL_PATTERNS = [
  'fale com',
  'falar com',
  'encaminhei para',
  'encaminhando para',
  'quem cuida disso e',
  'responsavel e',
  'segue em copia',
  'coloco em copia',
];

const WRONG_PERSON_PATTERNS = [
  'nao sou a pessoa',
  'nao trabalho mais',
  'nao faco parte',
  'email errado',
  'pessoa errada',
  'nao trabalha mais',
];

const POSITIVE_PATTERNS = [
  'tenho interesse',
  'temos interesse',
  'pode enviar',
  'pode mandar',
  'quero ver',
  'gostaria de ver',
  'vamos conversar',
  'podemos conversar',
  'me liga',
  'qual o valor',
  'quanto custa',
  'qual o preco',
  'qual o prazo',
  'agendar',
  'marcar uma conversa',
];

const QUESTION_PATTERNS = ['como funciona', 'voces fazem', 'voce faz', 'seria possivel'];

function matches(haystack: string, patterns: string[]): string[] {
  return patterns.filter((pattern) => haystack.includes(pattern));
}

/** Cabecalhos que provam origem automatica — mais confiaveis que qualquer texto. */
function detectAutomated(headers: Record<string, string>): string[] {
  const signals: string[] = [];
  const autoSubmitted = headers['auto-submitted']?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') signals.push('header:auto-submitted');
  if (headers['x-autoreply']) signals.push('header:x-autoreply');
  if (headers['x-autorespond']) signals.push('header:x-autorespond');
  if (headers['precedence']?.toLowerCase() === 'bulk') signals.push('header:precedence=bulk');
  return signals;
}

export function classifyReply(input: ReplyInput): ReplyClassificationResult {
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const text = `${normalize(input.subject)}\n${normalize(input.body)}`;

  const automatedSignals = detectAutomated(headers);

  /**
   * Descadastro vence tudo, inclusive resposta automatica e texto positivo no
   * mesmo e-mail (SPEC 2.0 §20.4). Sempre.
   */
  const unsubscribe = matches(text, UNSUBSCRIBE_PATTERNS);
  if (unsubscribe.length) {
    return {
      classification: 'UNSUBSCRIBE',
      signals: unsubscribe,
      needsHumanReview: false,
    };
  }

  const outOfOffice = matches(text, OUT_OF_OFFICE_PATTERNS);
  if (outOfOffice.length) {
    return {
      classification: 'OUT_OF_OFFICE',
      signals: [...automatedSignals, ...outOfOffice],
      needsHumanReview: false,
    };
  }

  if (automatedSignals.length) {
    return { classification: 'AUTOMATED', signals: automatedSignals, needsHumanReview: false };
  }

  const wrongPerson = matches(text, WRONG_PERSON_PATTERNS);
  if (wrongPerson.length) {
    return { classification: 'WRONG_PERSON', signals: wrongPerson, needsHumanReview: true };
  }

  const referral = matches(text, REFERRAL_PATTERNS);
  if (referral.length) {
    // Gera ou relaciona um contato novo (§20.4) — decisao que passa por humano.
    return { classification: 'REFERRAL', signals: referral, needsHumanReview: true };
  }

  const negative = matches(text, NEGATIVE_PATTERNS);
  if (negative.length) {
    return { classification: 'NEGATIVE', signals: negative, needsHumanReview: false };
  }

  const notNow = matches(text, NOT_NOW_PATTERNS);
  if (notNow.length) {
    return { classification: 'NOT_NOW', signals: notNow, needsHumanReview: false };
  }

  const positive = matches(text, POSITIVE_PATTERNS);
  if (positive.length) {
    // Resposta positiva move dinheiro: confirmar com humano e barato, errar nao e.
    return { classification: 'POSITIVE', signals: positive, needsHumanReview: true };
  }

  const question = matches(text, QUESTION_PATTERNS);
  if (question.length || text.includes('?')) {
    return {
      classification: 'QUESTION',
      signals: question.length ? question : ['contem interrogacao'],
      needsHumanReview: true,
    };
  }

  return { classification: 'UNKNOWN', signals: [], needsHumanReview: true };
}

/** Toda resposta interrompe a cadencia, seja qual for a classificacao (SPEC 2.0 §3.4). */
export function shouldCancelSequence(): boolean {
  return true;
}

/** Classificacoes que exigem supressao imediata (SPEC 2.0 §20.4/§29.2). */
export function requiresSuppression(classification: ReplyClassification): boolean {
  return classification === 'UNSUBSCRIBE';
}
