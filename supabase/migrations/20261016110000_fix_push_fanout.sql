-- Every insert into public.notifications has failed since 20261004100000_push
-- (last row: 2026-10-03 22:36 UTC). push_fanout() is attached to both
-- notifications and messages, and its declaration read
--   case when tg_table_name = 'messages' then new.recipient_id else new.user_id end
-- PL/pgSQL resolves NEW.recipient_id against the row type even on the branch
-- that is not taken, so on notifications it raised "record new has no field
-- recipient_id" and aborted the insert, and with it the surrounding statement:
-- follow notifications, Bid War / Cover Fire turns and results, and
-- admin_resolve (which notifies reporter and author), i.e. every moderation
-- action. Reading the column through to_jsonb() works on both tables.
-- Behaviour is otherwise unchanged. Idempotent.

create or replace function public.push_fanout() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_to uuid := (to_jsonb(new) ->> case when tg_table_name = 'messages' then 'recipient_id' else 'user_id' end)::uuid;
begin
  -- Nobody to tell: no HTTP call at all, which is nearly every row today.
  if v_to is null or not exists (select 1 from public.push_subscriptions where user_id = v_to) then return new; end if;
  begin
    perform net.http_post(
      url := 'https://www.vinall.xyz/api/push',
      body := jsonb_build_object('table', tg_table_name, 'id', new.id::text),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  exception when others then
    null;  -- the row matters more than its push
  end;
  return new;
end $$;
