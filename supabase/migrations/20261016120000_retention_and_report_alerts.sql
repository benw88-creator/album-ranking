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
--
-- 3. Notifications written by users. 'users create notifications as actor'
--    let any signed-in user insert any type with any data for anyone, and push
--    shows it on the lock screen: the same stranger-to-child channel as the DMs
--    closed in 20261016100000. Client inserts are now limited to the five types
--    the app writes, refused between blocked users, rate-limited, and their
--    names come from the real profile / groove. Server-side inserts (definer
--    functions, triggers) are untouched.

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

-- Lookups the guard needs but the caller's RLS hides (their own sent count,
-- another groove's name). Definer, narrow, and only ever about the caller.
create or replace function public.notification_guard_facts(p_actor uuid, p_groove text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'username', (select username from public.profiles where id = p_actor),
    'avatar_url', (select avatar_url from public.profiles where id = p_actor),
    'groove_name', (select name from public.grooves where id::text = p_groove),
    'sent_last_hour', (select count(*) from public.notifications where actor_id = p_actor and created_at > now() - interval '1 hour'))
  where p_actor = auth.uid()
$$;
revoke all on function public.notification_guard_facts(uuid, text) from public, anon;
grant execute on function public.notification_guard_facts(uuid, text) to authenticated;

-- INVOKER on purpose: current_user is 'authenticated' only for a direct client
-- insert. Inside a definer function (Bid War, Cover Fire, moderation, report
-- alerts) it is the owner, and those inserts pass untouched. Same boundary as
-- the economy trigger (20261015000000).
create or replace function public.guard_client_notification() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare f jsonb;
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.type not in ('follow', 'suggestion', 'groove_invite', 'review_like', 'rated_too') then
    raise exception 'notification type not allowed';
  end if;
  if not public.can_message(new.user_id) then return null; end if;   -- self or blocked: dropped silently
  f := coalesce(public.notification_guard_facts(new.actor_id, new.data ->> 'groove_id'), '{}'::jsonb);
  if (f ->> 'sent_last_hour')::int >= 60 then raise exception 'too many notifications'; end if;
  new.data := coalesce(new.data, '{}'::jsonb)
    || jsonb_build_object('username', coalesce(f ->> 'username', 'someone'), 'avatar_url', coalesce(f ->> 'avatar_url', ''));
  if new.type = 'groove_invite' then
    new.data := new.data || jsonb_build_object('groove_name', coalesce(f ->> 'groove_name', ''));
  end if;
  if jsonb_typeof(new.data -> 'item') = 'object' then
    new.data := jsonb_set(new.data, '{item}', (new.data -> 'item') || jsonb_build_object(
      'name', left(coalesce(new.data #>> '{item,name}', ''), 120),
      'artist', left(coalesce(new.data #>> '{item,artist}', ''), 120)));
    if public.is_abusive_text(new.data #>> '{item,name}') or public.is_abusive_text(new.data #>> '{item,artist}') then
      raise exception 'abusive text';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_client_notification() from public, anon;
drop trigger if exists guard_client_notification_trg on public.notifications;
create trigger guard_client_notification_trg before insert on public.notifications
  for each row execute function public.guard_client_notification();

do $$
begin
  if (select count(*) from cron.job where jobname in ('vinall_retention_analytics', 'vinall_retention_client_errors')) <> 2 then
    raise exception 'retention jobs not scheduled';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.guard_client_notification()'::regprocedure) then
    raise exception 'guard_client_notification must be security invoker';
  end if;
end $$;
