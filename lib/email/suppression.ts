import type { SuppressionEntry, SuppressionScope } from '@/types/spec2';
import { emailDomain, normalizeEmail } from '@/lib/contacts/priority';

/**
 * Lista de supressao (SPEC 2.0 §29.2).
 *
 * "Supressao sempre prevalece sobre campanhas e automacoes." Isso vale mesmo que o
 * lead tenha score 100, mesmo que a campanha esteja ativa, mesmo que o usuario
 * tenha aprovado na fila de revisao. Nao ha excecao e nao deve haver flag para
 * ignorar — e por isso que a checagem mora numa funcao pura e sem dependencias,
 * facil de chamar em qualquer ponto do caminho de envio.
 */

export type SuppressionQuery = {
  email: string | null;
  contactId: string | null;
  companyId: string | null;
};

export type SuppressionMatch = {
  suppressed: boolean;
  /** A entrada que barrou o envio. `null` quando nao ha bloqueio. */
  entry: Pick<SuppressionEntry, 'scope' | 'value' | 'reason'> | null;
};

const NOT_SUPPRESSED: SuppressionMatch = { suppressed: false, entry: null };

/**
 * A ordem de checagem vai do mais especifico ao mais amplo apenas para dar uma
 * mensagem util: qualquer acerto bloqueia igualmente.
 */
export function checkSuppression(
  query: SuppressionQuery,
  entries: ReadonlyArray<Pick<SuppressionEntry, 'scope' | 'value' | 'reason'>>,
): SuppressionMatch {
  const email = normalizeEmail(query.email);
  const domain = emailDomain(query.email);

  const byScope = (scope: SuppressionScope, value: string | null) => {
    if (!value) return null;
    const needle = value.trim().toLowerCase();
    return (
      entries.find(
        (entry) => entry.scope === scope && entry.value.trim().toLowerCase() === needle,
      ) ?? null
    );
  };

  const match =
    byScope('EMAIL', email) ??
    byScope('CONTACT', query.contactId) ??
    byScope('COMPANY', query.companyId) ??
    byScope('DOMAIN', domain);

  return match ? { suppressed: true, entry: match } : NOT_SUPPRESSED;
}

/**
 * Normaliza o valor antes de gravar, para que a comparacao no `checkSuppression`
 * nao dependa de como o endereco foi digitado.
 */
export function suppressionValue(scope: SuppressionScope, rawValue: string): string {
  if (scope === 'EMAIL') return normalizeEmail(rawValue) ?? rawValue.trim().toLowerCase();
  if (scope === 'DOMAIN') return rawValue.trim().toLowerCase().replace(/^@/, '');
  return rawValue.trim();
}
