import { normalizePhone, formatPhoneDisplay } from './phone';

/**
 * WhatsApp manual (SPEC 2.0 §22) — e **so** manual.
 *
 * A decisao central da 2.0 mora aqui (§37, item 9): o LeadHunter nunca envia,
 * agenda, recebe ou le WhatsApp. Este modulo produz um link e um texto sugerido,
 * nada mais. Nao ha cliente HTTP, credencial, webhook nem job de WhatsApp em
 * lugar nenhum do sistema, e o teste `tests/spec2-whatsapp-manual.test.ts`
 * verifica essa ausencia no codigo, nao apenas na intencao.
 *
 * Quem envia e o usuario, no aplicativo dele, fora do produto.
 */

export type ManualWhatsappContext = {
  companyName: string;
  phone: string | null;
  /** Observacao sustentada por evidencia — nunca uma alegacao inventada (§3.3). */
  observation?: string | null;
  senderName?: string | null;
};

export type ManualWhatsappAction = {
  /** `null` quando o telefone nao pode ser normalizado — nunca um numero chutado. */
  link: string | null;
  normalizedPhone: string | null;
  displayPhone: string | null;
  suggestedMessage: string;
  /** Sempre `true`: existe para deixar explicito no dado que o envio nao e automatico. */
  requiresManualSend: true;
};

/**
 * Texto sugerido para o usuario enviar **a mao**. Sem observacao com evidencia, a
 * mensagem fica curta de proposito: e melhor um contato generico e honesto que um
 * detalhe inventado (§3.3).
 */
export function suggestedWhatsappMessage(context: ManualWhatsappContext): string {
  const greeting = `Ola! Aqui e ${context.senderName?.trim() || '[seu nome]'}.`;
  const about = `Estou falando com a ${context.companyName.trim()}?`;
  const observation = context.observation?.trim();

  return observation
    ? `${greeting} ${about} ${observation} Posso te explicar melhor?`
    : `${greeting} ${about} Posso te fazer uma pergunta rapida?`;
}

/**
 * Monta a acao manual de WhatsApp. O texto vai no link apenas como sugestao
 * pre-preenchida: o wa.me abre a conversa no aplicativo do usuario e para por ai.
 */
export function buildManualWhatsappAction(
  context: ManualWhatsappContext,
  defaultCountryCode?: string,
): ManualWhatsappAction {
  const normalizedPhone = normalizePhone(context.phone, defaultCountryCode);
  const suggestedMessage = suggestedWhatsappMessage(context);

  return {
    link: normalizedPhone
      ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(suggestedMessage)}`
      : null,
    normalizedPhone,
    displayPhone: formatPhoneDisplay(context.phone),
    suggestedMessage,
    requiresManualSend: true,
  };
}

/**
 * Interacao de WhatsApp registrada a mao pelo usuario, depois do fato (§22.1).
 * Nunca criada por automacao, e por isso nao move o estagio do lead sozinha
 * (§22.2, ultima linha): quem move o pipeline e a pessoa que conversou.
 */
export type ManualWhatsappLog = {
  companyId: string;
  contactId: string | null;
  /** O que o usuario fez, em texto livre. */
  notes: string;
  occurredAt: string;
  recordedManually: true;
};

export function buildManualWhatsappLog(
  companyId: string,
  contactId: string | null,
  notes: string,
  occurredAt: string,
): ManualWhatsappLog {
  return { companyId, contactId, notes, occurredAt, recordedManually: true };
}
