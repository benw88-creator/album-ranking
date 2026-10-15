-- UK compliance follow-up (2026-10-15). NOT APPLIED until the owner approves.
-- Idempotent: safe to run twice.
--
-- 1. Retention. UK GDPR storage limitation: usage events and crash reports had
--    no end date. Usage events are kept 13 months (a season compared with the
--    same season a year earlier is the longest comparison the admin panel
--    makes); crash reports 90 days (a bug is fixed or superseded long before).
--    Daily pg_cron jobs delete anything older. Nothing else is touched. The
--    oldest rows (8 Sept 2026) mean the first real deletions happen around
--    7 Dec 2026 (crash reports) and Oct 2027 (usage events).
--
-- 2. Report alerts. The terms promise review within 48 hours (24 for safety),
--    but nothing told an admin a report had arrived. Each new report now
--    notifies every admin; the existing notifications->push trigger delivers it
--    to any device the admin has turned notifications on for.

create extension if not exists pg_cron;

select cron.schedule('vinall_retention_analytics', '17 3 * * *',
  $$delete from public.analytics_events where created_at < now() - interval '13 months'$$);
select cron.schedule('vinall_retention_client_errors', '23 3 * * *',
  $$delete from public.client_errors where created_at < now() - interval '90 days'$$);

create or replace function public.notify_admins_of_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, actor_id, type, data)
  select p.id, null, 'report_new',
         jsonb_build_object('kind', new.target_kind, 'reason', left(coalesce(new.reason, ''), 80))
    from public.profiles p
   where p.is_admin and p.id is distinct from new.reporter_id;
  return new;
exception when others then
  return new;   -- an alert must never stop a report being filed
end $$;
revoke all on function public.notify_admins_of_report() from public, anon, authenticated;

drop trigger if exists notify_admins_of_report_trg on public.reports;
create trigger notify_admins_of_report_trg after insert on public.reports
  for each row execute function public.notify_admins_of_report();

do $$
begin
  if (select count(*) from cron.job where jobname in ('vinall_retention_analytics', 'vinall_retention_client_errors')) <> 2 then
    raise exception 'retention jobs not scheduled';
  end if;
end $$;
