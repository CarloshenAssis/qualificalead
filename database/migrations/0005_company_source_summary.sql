-- ---------------------------------------------------------------------------
-- LeadHunter — SPEC 1.2 FASE 7 (lista de leads: filtro por fonte, MULTI_SOURCE)
-- Execute depois de 0004_multi_source.sql.
--
-- Uma unica view, aditiva: nenhuma tabela existente e alterada. Existe porque
-- "filtrar por fonte" e "MULTI_SOURCE" (mais de uma fonte para o mesmo lead)
-- exigem agregar lead_sources por company_id (count/array de fontes distintas) —
-- o PostgREST nao expressa HAVING count(distinct ...) > 1 sobre uma tabela crua.
--
-- `security_invoker = on` (Postgres 15+): a view roda com o RLS de quem consulta,
-- nao do dono do schema — herda o isolamento por usuario de `lead_sources`
-- automaticamente, sem precisar (nem poder) ter RLS proprio (views nao suportam
-- policies; sem `security_invoker` ela ignoraria RLS por padrao, o que seria uma
-- fuga de isolamento entre tenants).
-- ---------------------------------------------------------------------------

create or replace view company_source_summary
with (security_invoker = on) as
select
  company_id,
  array_agg(distinct source order by source) as sources,
  count(distinct source) as source_count,
  -- Enums em Postgres sao ordenados pela ordem declarada (LOW < MEDIUM < HIGH):
  -- max() aqui e "a melhor completude entre as fontes", nao um max numerico.
  max(source_quality) as best_source_quality
from lead_sources
group by company_id;
