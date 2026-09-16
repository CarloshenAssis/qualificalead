-- Exercise the SQL function directly so PostgreSQL validates its declared record shape.
select *
from qualification_gap_evidence_policy('NO_LEAD_CAPTURE');

do $$
begin
  if (select count(*) from qualification_gap_evidence_policy('NO_LEAD_CAPTURE')) <> 2
    or exists (
      (select * from qualification_gap_evidence_policy('NO_LEAD_CAPTURE'))
      except
      (values ('WEBSITE_REACHABLE'::text, true), ('HAS_FORM'::text, false))
    )
    or exists (
      (values ('WEBSITE_REACHABLE'::text, true), ('HAS_FORM'::text, false))
      except
      (select * from qualification_gap_evidence_policy('NO_LEAD_CAPTURE'))
    ) then
    raise exception 'NO_LEAD_CAPTURE evidence policy does not match the expected two rows';
  end if;

  if (select count(*) from qualification_gap_evidence_policy('NO_WEBSITE')) <> 1
    or exists (
      (select * from qualification_gap_evidence_policy('NO_WEBSITE'))
      except
      (values ('WEBSITE_REACHABLE'::text, false))
    ) then
    raise exception 'NO_WEBSITE evidence policy does not match WEBSITE_REACHABLE=false';
  end if;
end $$;
