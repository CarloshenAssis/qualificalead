import { z } from 'zod';
import {
  INSTAGRAM_STATUSES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  INTERACTION_TYPES,
} from '@/types/database';

/** Validacao de toda entrada vinda do cliente (SPEC 33/47). */

export const prospectingSearchSchema = z.object({
  segment: z
    .string()
    .trim()
    .min(2, 'Informe o segmento (ex.: restaurante, dentista, pet shop).')
    .max(120, 'Segmento muito longo.'),
  city: z.string().trim().min(2, 'Informe a cidade.').max(120, 'Cidade muito longa.'),
  state: z.string().trim().max(60).optional().or(z.literal('')),
  country: z.string().trim().max(60).optional().or(z.literal('')),
  /** Raio em quilometros; o Google aceita ate 50 km. */
  radiusKm: z.coerce.number().int().min(1).max(50).optional(),
  /** Teto de resultados por execucao — controla custo de API (SPEC 37). */
  limit: z.coerce.number().int().min(1).max(60).default(60),
});

export type ProspectingSearchInput = z.infer<typeof prospectingSearchSchema>;

export const companyFiltersSchema = z.object({
  website: z.enum(['all', 'without', 'with']).default('all'),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minReviews: z.coerce.number().int().min(0).optional(),
  instagram: z.enum(['all', 'found', 'not_found', 'high_confidence', 'pending']).default('all'),
  phone: z.enum(['all', 'available', 'unavailable']).default('all'),
  level: z.enum(['all', 'BAIXA', 'MEDIA', 'ALTA', 'EXCELENTE']).default('all'),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  city: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  /** Ordenacao dos resultados (SPEC 1.1 §47). */
  sort: z
    .enum(['score', 'rating', 'reviews', 'recent', 'name'])
    .default('score'),
  page: z.coerce.number().int().min(1).default(1),
});

export type CompanyFilters = z.infer<typeof companyFiltersSchema>;

export const leadUpsertSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(LEAD_STATUSES).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  notes: z.string().trim().max(5000).optional(),
  nextFollowUpAt: z.string().trim().max(40).optional().or(z.literal('')),
});

export const interactionSchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(INTERACTION_TYPES),
  description: z.string().trim().max(2000).optional(),
});

export const instagramReviewSchema = z.object({
  companyId: z.string().uuid(),
  action: z.enum(['confirm', 'reject', 'set']),
  handle: z.string().trim().max(60).optional(),
});

export const instagramStatusSchema = z.enum(INSTAGRAM_STATUSES);

export const briefingManualSchema = z.object({
  companyId: z.string().uuid(),
  logo_url: z.string().trim().max(500).optional(),
  colors: z.string().trim().max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  services: z.string().trim().max(4000).optional(),
  products: z.string().trim().max(4000).optional(),
  differentials: z.string().trim().max(4000).optional(),
  photos: z.string().trim().max(2000).optional(),
  menu: z.string().trim().max(4000).optional(),
  prices: z.string().trim().max(2000).optional(),
  institutional: z.string().trim().max(4000).optional(),
  links: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const authSchema = z.object({
  email: z.string().trim().email('Informe um e-mail valido.'),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.'),
  name: z.string().trim().max(120).optional(),
});

/** Primeira mensagem de erro de um ZodError, pronta para a interface (SPEC 38). */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Dados invalidos.';
}
