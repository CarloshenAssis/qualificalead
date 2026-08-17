import type { ProspectingSource, SourceId } from './types';

/**
 * Registry central de fontes (SPEC 1.2 §20/§21/§23).
 *
 * A responsabilidade unica deste modulo e decidir **quais fontes podem rodar**.
 * Ele nao executa busca e nao conhece nenhuma API — por isso e testavel sem rede.
 */

export const PROSPECTING_MODES = ['FREE', 'BALANCED', 'CUSTOM'] as const;
export type ProspectingMode = (typeof PROSPECTING_MODES)[number];

/** O padrao do produto e o modo gratuito (SPEC 1.2 §21/§74). */
export const DEFAULT_PROSPECTING_MODE: ProspectingMode = 'FREE';

export type SkipReason = 'DISABLED' | 'PAID_NOT_ENABLED' | 'NOT_SELECTED' | 'MODE_FREE_ONLY';

export const SKIP_MESSAGES: Record<SkipReason, string> = {
  DISABLED: 'desativada',
  PAID_NOT_ENABLED: 'desativada (fonte paga exige habilitacao explicita)',
  NOT_SELECTED: 'nao selecionada para esta pesquisa',
  MODE_FREE_ONLY: 'ignorada no modo gratuito',
};

export type SkippedSource = {
  id: SourceId;
  name: string;
  reason: SkipReason;
  message: string;
};

export type SourceSelection = {
  selected: ProspectingSource[];
  skipped: SkippedSource[];
};

function skip(source: ProspectingSource, reason: SkipReason): SkippedSource {
  return { id: source.id, name: source.name, reason, message: SKIP_MESSAGES[reason] };
}

/**
 * Decide quais fontes executar.
 *
 * A ordem das checagens importa: uma fonte paga desativada e sempre barrada, mesmo que
 * o usuario a tenha escolhido explicitamente no modo CUSTOM. Isso e a barreira de custo
 * exigida pela SPEC 1.2 §23 — a selecao na interface nunca autoriza gasto sozinha.
 */
export function selectSources(
  sources: ProspectingSource[],
  mode: ProspectingMode = DEFAULT_PROSPECTING_MODE,
  requestedIds?: SourceId[],
): SourceSelection {
  const selected: ProspectingSource[] = [];
  const skipped: SkippedSource[] = [];

  for (const source of sources) {
    // Barreira de custo: vale acima de qualquer modo ou escolha do usuario.
    if (source.type === 'PAID' && !source.enabled) {
      skipped.push(skip(source, 'PAID_NOT_ENABLED'));
      continue;
    }

    if (!source.enabled) {
      skipped.push(skip(source, 'DISABLED'));
      continue;
    }

    if (mode === 'FREE' && source.type !== 'FREE') {
      skipped.push(skip(source, 'MODE_FREE_ONLY'));
      continue;
    }

    if (mode === 'CUSTOM' && requestedIds && !requestedIds.includes(source.id)) {
      skipped.push(skip(source, 'NOT_SELECTED'));
      continue;
    }

    selected.push(source);
  }

  return { selected, skipped };
}

/** Uma fonte paga jamais pode ser usada como fallback automatico (SPEC 1.2 §23). */
export function isPaidSource(source: ProspectingSource): boolean {
  return source.type === 'PAID';
}
