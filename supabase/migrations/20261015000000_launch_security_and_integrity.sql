-- Launch fixes. REVIEW/APPLY ONLY AFTER APPROVAL. No historical user balances
-- or ratings are rewritten. Core schema was maintained outside migration history.
-- This filename follows the existing forward-dated migrations on this branch.
begin;

-- current_user inside a SECURITY DEFINER trigger is its OWNER, not its caller.
-- Preserve the installed body (and newer columns), but restore its intended
-- boundary: API writes run as authenticated; wallet functions run as their owner.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.pin_profile_economy()'::regprocedure);
  if position('current_user <> ''authenticated''' in v_def) = 0
     and position('current_user not in (''authenticated'', ''anon'')' in v_def) = 0 then
    raise exception 'Unexpected economy trigger: review its installed definition';
  end if;
  v_def := replace(v_def, 'current_user <> ''authenticated''', 'current_user not in (''authenticated'', ''anon'')');
  v_def := replace(v_def, 'SECURITY DEFINER', 'SECURITY INVOKER');
  execute v_def;
end $$;
alter function public.pin_profile_economy() security invoker;
alter function public.boost_profile_awards() security invoker;

-- Older migrations left two triggers pointing at the same economy function.
drop trigger if exists pin_profile_economy on public.profiles;
drop trigger if exists pin_profile_economy_trg on public.profiles;
create trigger pin_profile_economy_trg before insert or update on public.profiles
  for each row execute function public.pin_profile_economy();

-- Same provider allow-list as api/_push-endpoint.js. Delivery validates again,
-- so existing bad subscriptions cannot become outbound requests either.
create or replace function public.is_push_endpoint(p_endpoint text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(length(p_endpoint) <= 1000 and p_endpoint !~ '[[:space:]#]'
    and p_endpoint ~ '^https://(fcm\.googleapis\.com(:443)?/(fcm/send|wp)/[^/?#]+|updates\.push\.services\.mozilla\.com(:443)?/wpush/v[12]/[^/?#]+|web\.push\.apple\.com(:443)?/[^?#]+|wns[0-9]+-[a-z0-9-]+\.notify\.windows\.com(:443)?/)', false)
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_push_endpoint(p_endpoint) then raise exception 'bad endpoint'; end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'bad subscription keys'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid())
     and (select count(*) from public.push_subscriptions where user_id = auth.uid()) >= 10 then
    raise exception 'too many subscriptions';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id,
    p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
revoke all on function public.push_subscribe(text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text) to authenticated;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- The URI-keyed import cache cannot be trusted: callers supplied its identity.
-- Start a separate metadata-keyed cache; retain the old table for rollback/review.
create table if not exists public.catalogue_matches (
  cache_key text primary key check (cache_key ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('track', 'album')),
  status text not null check (status in ('ok', 'check', 'none')),
  match jsonb, alts jsonb,
  matched_at timestamptz not null default now()
);
alter table public.catalogue_matches enable row level security;
revoke all on public.catalogue_matches from public, anon, authenticated;
grant select, insert, update on public.catalogue_matches to service_role;

-- Recipient blocks are deliberately invisible to a sender under blocks RLS.
-- This narrow helper answers only whether the caller may message this person.
create or replace function public.can_message(p_recipient uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and p_recipient is not null and p_recipient <> auth.uid()
    and not exists (select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_recipient)
         or (b.blocker_id = p_recipient and b.blocked_id = auth.uid()))
$$;
revoke all on function public.can_message(uuid) from public, anon;
grant execute on function public.can_message(uuid) to authenticated;
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_message(recipient_id));

-- Recall deliberately permits a different clip when the scheduled one has no
-- preview. Keep that playable private result, but never publish its caller-
-- supplied answer as a verified daily leaderboard score.
do $$
declare v_def text; v_old text := 'where r.user_id = p_user and r.mode = ''daily'' and r.day = p_day;';
begin
  v_def := pg_get_functiondef('public.game_score(text,text,jsonb,integer,uuid,integer)'::regprocedure);
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old,
      'where r.user_id = p_user and r.mode = ''daily'' and r.day = p_day and r.verified;');
  elsif position('r.day = p_day and r.verified' in v_def) = 0 then
    raise exception 'Unexpected daily scoring definition: review before applying';
  end if;
end $$;

-- A missing key is not a deletion in a union merge. Durable tombstones stop
-- stale clients recreating ratings through either ratings or app_state writes.
create table if not exists public.rating_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('album', 'song')),
  item_id text not null,
  deleted_ms bigint not null check (deleted_ms > 0),
  primary key (user_id, kind, item_id)
);
alter table public.rating_deletions enable row level security;
drop policy if exists rating_deletions_own on public.rating_deletions;
create policy rating_deletions_own on public.rating_deletions for select to authenticated
  using (user_id = auth.uid());
revoke all on public.rating_deletions from public, anon, authenticated;
grant select on public.rating_deletions to authenticated;

create or replace function public.rating_item_stamp(p_data jsonb)
returns bigint language sql immutable set search_path = public, pg_temp as $$
  select greatest(
    case when p_data->>'ratedAt' ~ '^[0-9]{1,16}$' then (p_data->>'ratedAt')::bigint else 0 end,
    case when p_data->>'savedAt' ~ '^[0-9]{1,16}$' then (p_data->>'savedAt')::bigint else 0 end)
$$;

-- Statement locks run before row locks, serializing rating/state/deletion
-- writes for one API user without a row-lock/advisory-lock inversion.
create or replace function public.lock_rating_sync() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  end if;
  return null;
end $$;
drop trigger if exists rating_sync_lock on public.ratings;
create trigger rating_sync_lock before insert or update or delete on public.ratings
  for each statement execute function public.lock_rating_sync();
drop trigger if exists rating_state_lock on public.app_state;
create trigger rating_state_lock before insert or update on public.app_state
  for each statement execute function public.lock_rating_sync();

create or replace function public.guard_deleted_rating() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.rating_deletions d where d.user_id = new.user_id
    and d.kind = new.kind and d.item_id = new.item_id
    and public.rating_item_stamp(new.data::jsonb) <= d.deleted_ms) then
    return null; -- old clients may bulk-upsert; skip stale rows, keep fresh ones
  end if;
  return new;
end $$;
drop trigger if exists guard_deleted_rating_trg on public.ratings;
create trigger guard_deleted_rating_trg before insert or update on public.ratings
  for each row execute function public.guard_deleted_rating();

create or replace function public.guard_rating_state() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kind text;
begin
  v_kind := case new.key when 'crate_albums_v1' then 'album' when 'crate_songs_v1' then 'song' end;
  if v_kind is null then return new; end if;
  if jsonb_typeof(new.value::jsonb) <> 'object' then raise exception 'bad rating state'; end if;
  new.value := coalesce((select jsonb_object_agg(e.key, e.value)
    from jsonb_each(new.value::jsonb) e where not exists (
      select 1 from public.rating_deletions d where d.user_id = new.user_id
      and d.kind = v_kind and d.item_id = e.key
      and public.rating_item_stamp(e.value) <= d.deleted_ms)), '{}'::jsonb);
  return new;
end $$;
drop trigger if exists guard_rating_state_trg on public.app_state;
create trigger guard_rating_state_trg before insert or update on public.app_state
  for each row execute function public.guard_rating_state();

-- Direct DELETEs from older clients also establish a tombstone. During auth
-- user cascade deletion, do not reinsert a child of the disappearing account.
create or replace function public.note_rating_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ms bigint;
begin
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if coalesce(current_setting('vinall.rating_delete_rpc', true), '') = '1' then return old; end if;
  v_ms := greatest(floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    public.rating_item_stamp(old.data::jsonb));
  insert into public.rating_deletions (user_id, kind, item_id, deleted_ms)
  values (old.user_id, old.kind, old.item_id, v_ms)
  on conflict (user_id, kind, item_id) do update
    set deleted_ms = greatest(rating_deletions.deleted_ms, excluded.deleted_ms);
  -- Re-run the state guard, removing the deleted key from the canonical blob.
  update public.app_state set value = value where user_id = old.user_id
    and key = case old.kind when 'album' then 'crate_albums_v1' else 'crate_songs_v1' end;
  return old;
end $$;
drop trigger if exists note_rating_delete_trg on public.ratings;
create trigger note_rating_delete_trg after delete on public.ratings
  for each row execute function public.note_rating_delete();

-- Also works when the row never synced. Client event time preserves the order
-- of an offline deletion and a later re-rating; retries never move that time.
create or replace function public.rating_delete(p_kind text, p_item_id text, p_deleted_ms bigint, p_owner uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_ms bigint;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if p_owner is distinct from v_me then raise exception 'account changed'; end if;
  if p_kind is null or p_kind not in ('album', 'song') or p_item_id is null
     or length(p_item_id) not between 1 and 300 or p_deleted_ms is null
     or p_deleted_ms <= 0 or p_deleted_ms > 9007199254740991 then raise exception 'bad deletion'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_me::text, 1));
  insert into public.rating_deletions (user_id, kind, item_id, deleted_ms)
  values (v_me, p_kind, p_item_id, p_deleted_ms)
  on conflict (user_id, kind, item_id) do update
    set deleted_ms = greatest(rating_deletions.deleted_ms, excluded.deleted_ms)
  returning deleted_ms into v_ms;
  perform set_config('vinall.rating_delete_rpc', '1', true);
  delete from public.ratings where user_id = v_me and kind = p_kind and item_id = p_item_id
    and public.rating_item_stamp(data::jsonb) <= v_ms;
  perform set_config('vinall.rating_delete_rpc', '', true);
  update public.app_state set value = value where user_id = v_me
    and key = case p_kind when 'album' then 'crate_albums_v1' else 'crate_songs_v1' end;
  return v_ms;
end $$;
revoke all on function public.rating_delete(text, text, bigint, uuid) from public, anon;
grant execute on function public.rating_delete(text, text, bigint, uuid) to authenticated;

-- Trigger functions are not public RPCs. Their use by installed triggers is
-- unaffected by revoking direct EXECUTE. Stamp helpers remain available to SQL.
revoke all on function public.guard_deleted_rating(), public.guard_rating_state(),
  public.note_rating_delete(), public.lock_rating_sync(), public.pin_profile_economy(),
  public.boost_profile_awards() from public, anon, authenticated;

do $$
begin
  if (select prosecdef from pg_proc where oid = 'public.pin_profile_economy()'::regprocedure) then
    raise exception 'Economy trigger must run as its caller';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
    and tablename in ('catalogue_matches', 'rating_deletions') and cmd <> 'SELECT') then
    raise exception 'Protected launch tables must have no client write policies';
  end if;
end $$;
commit;
