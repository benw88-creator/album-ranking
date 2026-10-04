-- Push notifications. Apply by hand in the SQL editor, like the others.
-- Idempotent throughout.
--
-- Every notification and every direct message already becomes a row. This
-- makes each of those rows ALSO a push on any device whose owner switched them
-- on, by having the database call /api/push with the row's id as it lands —
-- which covers the rows the browser inserts (follows, recommendations, "rated
-- it too", review likes) AND the ones definer functions insert (Bid War and
-- Cover Fire turns and results) with one mechanism and no client code.
--
-- The route trusts nothing but the id. See api/push.js for why there is no
-- shared secret: it claims the row with `pushed_at` in the same UPDATE that
-- reads it, and only rows under ten minutes old.
--
-- pg_net is Supabase's async HTTP extension. The call is queued, never
-- awaited, and wrapped so that a missing extension or a dead endpoint can
-- never fail the INSERT it rides on: a notification is worth more than its
-- push.

create extension if not exists pg_net with schema extensions;

-- One row per browser that said yes. The endpoint is the identity: a device
-- belongs to whoever subscribed it most recently, which is what
-- push_subscribe() enforces.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists "read own push subscriptions" on public.push_subscriptions;
create policy "read own push subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policy: an upsert from the client could not take a
-- device over from the account that used it before (that row is not theirs to
-- update), and leaving it would push the last person's notifications to the
-- next person's phone. These two functions are the only way in.

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'bad endpoint'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

grant execute on function public.push_subscribe(text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;
alter table public.messages      add column if not exists pushed_at timestamptz;

create or replace function public.push_fanout()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_to uuid := case when tg_table_name = 'messages' then new.recipient_id else new.user_id end;
begin
  -- Nobody to tell: no HTTP call at all, which is nearly every row today.
  if not exists (select 1 from public.push_subscriptions where user_id = v_to) then return new; end if;
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

drop trigger if exists push_fanout on public.notifications;
create trigger push_fanout after insert on public.notifications
  for each row execute function public.push_fanout();
drop trigger if exists push_fanout on public.messages;
create trigger push_fanout after insert on public.messages
  for each row execute function public.push_fanout();

-- Guard: a write policy on push_subscriptions would reopen the device
-- take-over problem described above.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and cmd <> 'SELECT') then
    raise exception 'push_subscriptions must have no write policy — use push_subscribe()/push_unsubscribe()';
  end if;
end $$;
