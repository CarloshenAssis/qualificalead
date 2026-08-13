import type { Company } from '@/types/database';
import { EXPORT_HEADERS, companyToRow } from './rows';

/** Escapa um valor de celula para CSV (RFC 4180). */
function escapeCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function buildCsv(companies: Company[]): string {
  const lines = [
    EXPORT_HEADERS.map(escapeCell).join(','),
    ...companies.map((company) => companyToRow(company).map(escapeCell).join(',')),
  ];

  // BOM para o Excel abrir acentuacao corretamente.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
