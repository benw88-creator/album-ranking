-- VINALL Replay: listening by DAY.
--
-- listening_plays holds one LIFETIME row per track — the right shape for
-- "what have you been rinsing", and useless for "what did you play in March",
-- because the dates inside the export are folded away before anything is
-- uploaded. Replay needs the period, so the import now also folds the same
-- events to one row per (local day, track) and sends those here.
--
-- Rules this file keeps:
--
--   * IDEMPOTENT, BECAUSE RE-IMPORTING IS NORMAL. Overlapping exports and the
--     same zip dropped twice must not double anything, so a conflict keeps the
--     GREATER of the two counts rather than adding them. A later export that
--     saw a day more completely raises it; the same export again changes
--     nothing.
--   * NO WRITE POLICY. Writes go through listening_days_put(), which stamps
--     the user from auth.uid() and enforces the greatest() rule — a direct
--     upsert could overwrite with a smaller number or add instead of merge.
--     A guard at the bottom raises if an insert/update policy ever appears.
--   * Day is the LOCAL date of the person importing, decided in the browser
--     (the export's timestamps are UTC). Weeks are Monday-based, matching
--     Postgres date_trunc('week') and the UK calendar.
--   * Cascades from auth.users, so account deletion removes it with no
--     delete_my_data() entry — the same arrangement as bid_wars.
--
-- Idempotent throughout: safe to paste into the SQL editor more than once.

create table if not exists public.listening_days (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  day        date        not null,
  k          text        not null,          -- VinalListening.keyOf(artist, track)
  artist     text        not null,
  track      text        not null,
  album      text,
  track_uri  text,
  plays      integer     not null default 0 check (plays >= 0),
  ms         bigint      not null default 0 check (ms >= 0),
  source     text        not null default 'spotify-export',
  updated_at timestamptz not null default now(),
  primary key (user_id, day, k)
);

comment on table public.listening_days is
  'Spotify export plays folded per local day and track, for Replay. Written only by listening_days_put().';

alter table public.listening_days enable row level security;

drop policy if exists "own listening days read" on public.listening_days;
create policy "own listening days read" on public.listening_days
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own listening days delete" on public.listening_days;
create policy "own listening days delete" on public.listening_days
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Write path. Takes a jsonb array of {day,k,artist,track,album,uri,plays,ms}.
-- Rows are grouped by (day,k) first: ON CONFLICT cannot touch one row twice
-- in a statement, and a client that sent a duplicate should get a merge, not
-- an error that drops the whole batch.
create or replace function public.listening_days_put(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a json array'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'at most 2000 rows per call'; end if;

  insert into public.listening_days as d
    (user_id, day, k, artist, track, album, track_uri, plays, ms, updated_at)
  select v_uid, x.day, x.k, x.artist, x.track, x.album, x.uri, x.plays, x.ms, now()
  from (
    select (r->>'day')::date                                   as day,
           left(r->>'k', 300)                                  as k,
           max(left(r->>'artist', 300))                        as artist,
           max(left(r->>'track', 300))                         as track,
           max(left(nullif(r->>'album', ''), 300))             as album,
           max(left(nullif(r->>'uri', ''), 100))               as uri,
           -- A day holds at most 86,400,000 ms; a track cannot honestly be
           -- played more than a few thousand times in one.
           least(max(greatest(coalesce((r->>'plays')::int, 0), 0)), 5000)         as plays,
           least(max(greatest(coalesce((r->>'ms')::bigint, 0), 0)), 86400000)     as ms
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'day', '') <> ''
      and coalesce(r->>'k', '') <> ''
      and coalesce(r->>'artist', '') <> ''
      and coalesce(r->>'track', '') <> ''
    group by 1, 2
  ) x
  on conflict (user_id, day, k) do update set
    plays      = greatest(d.plays, excluded.plays),
    ms         = greatest(d.ms, excluded.ms),
    album      = coalesce(d.album, excluded.album),
    track_uri  = coalesce(d.track_uri, excluded.track_uri),
    updated_at = now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.listening_days_put(jsonb) from public, anon;
grant execute on function public.listening_days_put(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- One period, aggregated on the server so the browser never downloads a
-- year of rows. Security INVOKER: it reads through the select policy above,
-- so it can only ever see the caller's own listening. Logged out, auth.uid()
-- is NULL, `user_id = NULL` matches nothing, and every figure is zero.
--
-- "New artists" are artists whose first day ANYWHERE in this person's data
-- falls inside the period. The client only presents them as discoveries when
-- the data starts well before the period — otherwise the first month of an
-- export would call everything a discovery.
create or replace function public.replay_listening(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (
    select day, k, artist, track, album, track_uri, plays, ms
    from public.listening_days where user_id = auth.uid()
  ),
  p as (select * from mine where day >= p_from and day <= p_to),
  art as (
    select lower(artist) as ak, max(artist) as artist,
           sum(plays)::bigint as plays, sum(ms)::bigint as ms, count(distinct k) as tracks
    from p group by lower(artist)
  ),
  firsts as (select lower(artist) as ak, min(day) as first_day from mine group by lower(artist))
  select jsonb_build_object(
    'data_from', (select min(day) from mine),
    'data_to',   (select max(day) from mine),
    'plays',   coalesce((select sum(plays) from p), 0),
    'ms',      coalesce((select sum(ms) from p), 0),
    'days',    (select count(distinct day) from p),
    'tracks',  (select count(distinct k) from p),
    'artists', (select count(*) from art),
    'top_artists', coalesce((select jsonb_agg(x) from (
        select artist, plays, ms, tracks from art order by ms desc, plays desc, artist limit 10) x), '[]'::jsonb),
    'top_tracks', coalesce((select jsonb_agg(x) from (
        select max(track) as track, max(artist) as artist, max(album) as album, max(track_uri) as uri,
               sum(plays)::bigint as plays, sum(ms)::bigint as ms
        from p group by k order by sum(plays) desc, sum(ms) desc, max(track) limit 10) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x.d) from (
        select day as d, sum(ms)::bigint as ms, sum(plays)::bigint as plays from p group by day) x), '[]'::jsonb),
    'new_artists', coalesce((select jsonb_agg(x) from (
        select a.artist, a.plays, a.ms, f.first_day
        from art a join firsts f using (ak)
        where f.first_day >= p_from
        order by a.ms desc, a.artist limit 10) x), '[]'::jsonb),
    'new_artist_count', (select count(*) from art a join firsts f using (ak) where f.first_day >= p_from)
  );
$$;

revoke all on function public.replay_listening(date, date) from public, anon;
grant execute on function public.replay_listening(date, date) to authenticated;

-- Per-week and per-month totals across everything, in ONE call, for the
-- Replay timeline. Weeks start on Monday (date_trunc('week')).
create or replace function public.replay_listening_index()
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (select day, plays, ms from public.listening_days where user_id = auth.uid())
  select jsonb_build_object(
    'data_from', (select min(day) from mine),
    'data_to',   (select max(day) from mine),
    'weeks', coalesce((select jsonb_agg(x order by x.w) from (
        select date_trunc('week', day)::date as w, sum(plays)::bigint as plays, sum(ms)::bigint as ms
        from mine group by 1) x), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(x order by x.m) from (
        select to_char(day, 'YYYY-MM') as m, sum(plays)::bigint as plays, sum(ms)::bigint as ms
        from mine group by 1) x), '[]'::jsonb)
  );
$$;

revoke all on function public.replay_listening_index() from public, anon;
grant execute on function public.replay_listening_index() to authenticated;

-- ---------------------------------------------------------------------------
-- Guards. Raise rather than report.
do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'listening_days'
               and cmd in ('INSERT', 'UPDATE', 'ALL')) then
    raise exception 'listening_days must have no insert/update policy: writes go through listening_days_put()';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'listening_days' and c.relrowsecurity) then
    raise exception 'listening_days must have row level security enabled';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'replay_listening' and p.prosecdef) then
    raise exception 'replay_listening must be security invoker so RLS scopes it to the caller';
  end if;
end $$;
