import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { companyFiltersSchema } from '@/lib/validation/schemas';
import { companiesExportQuery } from '@/lib/companies/query';
import { buildCsv } from '@/lib/export/csv';
import { buildXlsx } from '@/lib/export/xlsx';
import type { Company } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exportacao respeitando os filtros atuais da tela (SPEC 29). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Sessao expirada. Faca login novamente.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';

  const parsed = companyFiltersSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Filtros invalidos.' }, { status: 400 });
  }

  const { data, error } = await companiesExportQuery(supabase, user.id, parsed.data);

  if (error) {
    console.error('[api/export] falha ao carregar empresas', error);
    return NextResponse.json({ error: 'Nao foi possivel gerar a exportacao.' }, { status: 500 });
  }

  const companies = (data ?? []) as Company[];
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'xlsx') {
    const file = buildXlsx(companies);
    return new Response(file as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="leadhunter-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(buildCsv(companies), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leadhunter-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
