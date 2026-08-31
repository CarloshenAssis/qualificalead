-- ---------------------------------------------------------------------------
-- LeadHunter — captura de email como contato adicional.
-- Mesma forma de `phone`: coluna de texto simples, sem enum/status/confidence
-- proprio. Hoje so o OpenStreetMap expoe email (tags `email`/`contact:email`);
-- o Google Places API nao tem esse campo, entao para leads Google/Foursquare/
-- LEGACY a coluna fica nula ate existir uma etapa de scraping de site.
-- Execute depois de 0005_company_source_summary.sql.
-- ---------------------------------------------------------------------------

alter table companies add column if not exists email text;
