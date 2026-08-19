import { SOURCE_LABELS, type SourceId } from '@/lib/prospecting/sources/types';
import type { SourceQualityLevel } from '@/types/database';

/**
 * Resume as fontes de um lead para exibicao (SPEC 1.2 FASE 7 §5).
 * Nao inventa nada novo: so formata o que `lead_sources` ja carrega.
 */
export function summarizeSources(
  sources: { source: SourceId; source_quality: SourceQualityLevel | null }[] | null | undefined,
): { label: string; multi: boolean; quality: SourceQualityLevel | null; all: SourceId[] } {
  const list = sources ?? [];
  const distinct = [...new Set(list.map((s) => s.source))];

  const qualityRank: Record<SourceQualityLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const bestQuality = list.reduce<SourceQualityLevel | null>((best, s) => {
    if (!s.source_quality) return best;
    if (!best || qualityRank[s.source_quality] > qualityRank[best]) return s.source_quality;
    return best;
  }, null);

  if (!distinct.length) return { label: 'Origem nao registrada', multi: false, quality: null, all: [] };
  if (distinct.length === 1) return { label: SOURCE_LABELS[distinct[0]], multi: false, quality: bestQuality, all: distinct };

  return {
    label: distinct.map((s) => SOURCE_LABELS[s]).join(' + '),
    multi: true,
    quality: bestQuality,
    all: distinct,
  };
}
