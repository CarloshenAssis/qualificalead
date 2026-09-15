import { describe, expect, it } from 'vitest';
import { EXTERNAL_GAPS, GAP_EVIDENCE_POLICY, evidenceSetSupportsGap, type GapEvidence } from '@/lib/gaps/catalog';

const base = { id: 'e', user_id: 'u', company_id: 'c', status: 'CONFIRMED' as const,
  observed_at: '2026-09-15T10:00:00Z', expires_at: null, source_url: 'https://example.test' };
const records = (gap: keyof typeof GAP_EVIDENCE_POLICY): GapEvidence[] =>
  (GAP_EVIDENCE_POLICY[gap] ?? []).map(([type, value], i) => ({ ...base, id: `e${i}`, type, value }));

describe('contrato semantico de evidencia externa', () => {
  it.each(EXTERNAL_GAPS)('%s exige exatamente todas as clausulas', (gap) => {
    const valid = records(gap);
    const expectsAutomatic = Boolean(GAP_EVIDENCE_POLICY[gap]?.length);
    expect(evidenceSetSupportsGap(valid, gap, 'u', 'c', '2026-09-15T12:00:00Z')).toBe(expectsAutomatic);
    if (valid.length) {
      expect(evidenceSetSupportsGap(valid.slice(1), gap, 'u', 'c', '2026-09-15T12:00:00Z')).toBe(false);
      expect(evidenceSetSupportsGap(valid.map((e, i) => i ? e : { ...e, value: !e.value }), gap, 'u', 'c', '2026-09-15T12:00:00Z')).toBe(false);
    }
  });
  it('site inacessivel nao sustenta gaps que pressupõem site', () => {
    for (const gap of EXTERNAL_GAPS.filter((g) => GAP_EVIDENCE_POLICY[g]?.some(([t,v]) => t === 'WEBSITE_REACHABLE' && v))) {
      const invalid = records(gap).map((e) => e.type === 'WEBSITE_REACHABLE' ? { ...e, value: false } : e);
      expect(evidenceSetSupportsGap(invalid, gap, 'u', 'c', '2026-09-15T12:00:00Z')).toBe(false);
    }
  });
});
