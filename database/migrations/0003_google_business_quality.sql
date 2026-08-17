-- ---------------------------------------------------------------------------
-- LeadHunter — SPEC 1.2 (ajuste da FASE 4)
-- google_business_quality e uma metrica especifica de Google Business Profile:
-- fontes sem esse dado (OpenStreetMap) precisam de um terceiro estado que nao seja
-- "LOW" (que afirmaria um perfil ruim que nao existe para avaliar).
-- Execute depois de 0002_hardening.sql.
--
-- So adiciona um valor ao enum existente — nao renomeia, nao remove, nao mexe em
-- identidade. A migration da identidade multi-source (lead_sources ou equivalente)
-- continua pendente para a FASE 6, numerada separadamente quando chegar a hora.
-- ---------------------------------------------------------------------------

alter type google_business_quality add value if not exists 'NOT_APPLICABLE';
