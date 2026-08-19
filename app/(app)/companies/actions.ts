'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/supabase/server';
import {
  briefingManualSchema,
  firstIssueMessage,
  instagramReviewSchema,
  interactionSchema,
  leadUpsertSchema,
} from '@/lib/validation/schemas';
import { derivedFieldsFor } from '@/lib/scoring/rescore';
import { loadCompanySources } from '@/lib/prospecting/sources/identity';
import { buildBriefing } from '@/lib/briefing/generate';
import { buildLovablePrompt } from '@/lib/briefing/lovable';
import { summarizeSources } from '@/lib/companies/source-display';
import type { BriefingManualData, Company, LeadSource, LeadStatus } from '@/types/database';

export type ActionState = { error?: string; message?: string };

const GENERIC_ERROR = 'Nao foi possivel concluir a acao. Tente novamente.';

function fail(error: unknown, message = GENERIC_ERROR): ActionState {
  console.error('[companies/actions]', error);
  return { error: message };
}

/**
 * Recalcula score, qualidade do perfil e acao recomendada apos qualquer mudanca
 * que afete os sinais (SPEC 14, SPEC 1.1 §15/§33).
 */
async function rescoreCompany(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).single();
  if (error || !data) return;

  const company = data as Company;

  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('company_id', company.id)
    .maybeSingle();

  const sources = (await loadCompanySources(supabase, [company.id])).get(company.id);

  await supabase
    .from('companies')
    .update(derivedFieldsFor(company, (lead?.status as LeadStatus | undefined) ?? null, sources))
    .eq('id', company.id)
    .eq('user_id', company.user_id);
}

/** Cria (ou recupera) o lead da empresa no pipeline (SPEC 20). */
export async function addToPipeline(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = leadUpsertSchema.safeParse({ companyId: formData.get('companyId') });
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { error } = await supabase
      .from('leads')
      .upsert(
        { user_id: user.id, company_id: parsed.data.companyId, status: 'NOVO' satisfies LeadStatus },
        { onConflict: 'user_id,company_id', ignoreDuplicates: true },
      );

    if (error) return fail(error);

    revalidatePath('/companies');
    revalidatePath(`/companies/${parsed.data.companyId}`);
    revalidatePath('/pipeline');
    return { message: 'Lead adicionado ao pipeline.' };
  } catch (error) {
    return fail(error);
  }
}

/** Atualiza status, prioridade, notas e follow-up, registrando o historico (SPEC 19/20). */
export async function updateLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = leadUpsertSchema.safeParse({
    companyId: formData.get('companyId'),
    status: formData.get('status') || undefined,
    priority: formData.get('priority') || undefined,
    notes: formData.get('notes') ?? undefined,
    nextFollowUpAt: formData.get('nextFollowUpAt') ?? undefined,
  });

  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('company_id', parsed.data.companyId)
      .maybeSingle();

    const payload = {
      user_id: user.id,
      company_id: parsed.data.companyId,
      status: parsed.data.status ?? existing?.status ?? 'NOVO',
      priority: parsed.data.priority,
      notes: parsed.data.notes ?? null,
      next_follow_up_at: parsed.data.nextFollowUpAt ? parsed.data.nextFollowUpAt : null,
    };

    const { data: lead, error } = await supabase
      .from('leads')
      .upsert(payload, { onConflict: 'user_id,company_id' })
      .select('id')
      .single();

    if (error) return fail(error);

    if (parsed.data.status && existing && existing.status !== parsed.data.status) {
      await supabase.from('interactions').insert({
        user_id: user.id,
        lead_id: lead.id,
        type: 'MUDANCA_STATUS',
        description: `Status alterado de ${existing.status} para ${parsed.data.status}.`,
      });
    }

    // A acao recomendada depende do estado do lead (SPEC 1.1 §33).
    await rescoreCompany(parsed.data.companyId);

    revalidatePath(`/companies/${parsed.data.companyId}`);
    revalidatePath('/pipeline');
    revalidatePath('/dashboard');
    return { message: 'Lead atualizado.' };
  } catch (error) {
    return fail(error);
  }
}

/** Registra uma interacao manual no historico do lead. */
export async function addInteraction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = interactionSchema.safeParse({
    leadId: formData.get('leadId'),
    type: formData.get('type'),
    description: formData.get('description') ?? undefined,
  });

  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const companyId = String(formData.get('companyId') ?? '');

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { error } = await supabase.from('interactions').insert({
      user_id: user.id,
      lead_id: parsed.data.leadId,
      type: parsed.data.type,
      description: parsed.data.description ?? null,
    });

    if (error) return fail(error);

    if (parsed.data.type === 'WHATSAPP' || parsed.data.type === 'LIGACAO') {
      await supabase
        .from('leads')
        .update({ last_contacted_at: new Date().toISOString() })
        .eq('id', parsed.data.leadId)
        .eq('user_id', user.id);
    }

    if (companyId) revalidatePath(`/companies/${companyId}`);
    revalidatePath('/pipeline');
    return { message: 'Interacao registrada.' };
  } catch (error) {
    return fail(error);
  }
}

/** Confirma, rejeita ou substitui o Instagram encontrado (SPEC 10). */
export async function reviewInstagram(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = instagramReviewSchema.safeParse({
    companyId: formData.get('companyId'),
    action: formData.get('action'),
    handle: formData.get('handle') ?? undefined,
  });

  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  try {
    const user = await requireUser();
    const supabase = await createClient();

    let payload: Record<string, unknown>;

    const now = new Date().toISOString();

    if (parsed.data.action === 'confirm') {
      payload = {
        instagram_status: 'CONFIRMED',
        instagram_confidence: 100,
        instagram_checked_at: now,
      };
    } else if (parsed.data.action === 'reject') {
      payload = {
        instagram_status: 'REJECTED',
        instagram_url: null,
        instagram_handle: null,
        instagram_confidence: null,
        instagram_source: null,
        instagram_evidence: [],
        instagram_checked_at: now,
      };
    } else {
      const handle = parsed.data.handle?.trim().replace(/^@/, '').replace(/\/+$/, '');
      if (!handle) return { error: 'Informe o perfil do Instagram.' };
      if (!/^[A-Za-z0-9_.]+$/.test(handle)) return { error: 'Perfil invalido.' };

      payload = {
        instagram_status: 'CONFIRMED',
        instagram_url: `https://instagram.com/${handle}`,
        instagram_handle: `@${handle}`,
        // Informado pelo usuario: confianca maxima porque houve confirmacao humana.
        instagram_confidence: 100,
        instagram_source: 'Informado manualmente',
        instagram_evidence: [{ signal: 'MANUAL', label: 'Confirmado pelo usuario', matched: true }],
        instagram_checked_at: now,
      };
    }

    const { error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', parsed.data.companyId)
      .eq('user_id', user.id);

    if (error) return fail(error);

    await rescoreCompany(parsed.data.companyId);

    revalidatePath(`/companies/${parsed.data.companyId}`);
    revalidatePath('/companies');
    return { message: 'Instagram atualizado.' };
  } catch (error) {
    return fail(error);
  }
}

/** Salva os campos manuais e regenera briefing + prompt do Lovable (SPEC 25/26/27). */
export async function saveBriefing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = briefingManualSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const { companyId, ...manualRaw } = parsed.data;

  // Campos vazios nao viram string vazia no banco.
  const manual: BriefingManualData = Object.fromEntries(
    Object.entries(manualRaw).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  );

  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data, error: companyError } = await supabase
      .from('companies')
      .select('*, lead_sources(source, source_url, source_quality)')
      .eq('id', companyId)
      .eq('user_id', user.id)
      .single();

    if (companyError || !data) return fail(companyError, 'Empresa nao encontrada.');

    const { lead_sources, ...companyFields } = data as Company & {
      lead_sources: Pick<LeadSource, 'source' | 'source_url' | 'source_quality'>[] | null;
    };
    const company = companyFields as Company;
    const sourceLabel = summarizeSources(lead_sources).label;
    const briefing = buildBriefing(company, manual, sourceLabel);
    const prompt = buildLovablePrompt(company, manual, sourceLabel);

    const { error } = await supabase.from('briefings').upsert(
      {
        user_id: user.id,
        company_id: companyId,
        manual_data: manual,
        generated_briefing: briefing,
        generated_lovable_prompt: prompt,
      },
      { onConflict: 'user_id,company_id' },
    );

    if (error) return fail(error);

    revalidatePath(`/companies/${companyId}`);
    return { message: 'Briefing gerado.' };
  } catch (error) {
    return fail(error);
  }
}
