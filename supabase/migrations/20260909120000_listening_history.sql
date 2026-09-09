-- Listening history, and two holes in account deletion.
--
-- ---------------------------------------------------------------------------
-- Why this table exists
-- ---------------------------------------------------------------------------
-- Every Lore finder so far runs on ratings, because Spotify will not give us
-- listening data: Development Mode caps the app at 5 authenticated users,
-- Extended Quota needs a registered business with 250k MAU, `recently-played`
-- is a 50-item window that cannot be paged past, and there are no per-user
-- play counts in the API at any tier. That is a wall, not a queue.
--
-- The way round it is the user's own data. Spotify will post anybody their
-- Extended streaming history as JSON — complete, lifetime, no quota, no app
-- review — and Last.fm will hand over the same shape live for people who
-- scrobble. So listening data arrives as an import, and every feature reads
-- this table rather than the Spotify API. That was already the documented
-- design in CLAUDE.md; this is the store it was describing.
--
-- Aggregated, not raw. A real export is 100k-500k play events; the finders
-- only ever want "how many times, and when did it stop", so the browser folds
-- the events into one row per track before anything is uploaded. `k` is the
-- normalised 'artist|track' merge key, which is what makes a re-import of an
-- overlapping export idempotent instead of doubling every count.

create table if not exists public.listening_plays (
  user_id      uuid not null references auth.users(id) on delete cascade,
  k            text not null,
  track        text not null,
  artist       text not null,
  album        text,
  track_uri    text,
  plays        integer not null default 0,
  ms_played    bigint  not null default 0,
  first_played timestamptz,
  last_played  timestamptz,
  source       text not null default 'spotify-export',
  updated_at   timestamptz not null default now(),
  primary key (user_id, k)
);

comment on table public.listening_plays is
  'One row per track per person, folded from their own Spotify/Last.fm export. Never written from the Spotify API.';

-- The finders all ask the same two questions — what did you play most, and
-- what did you stop playing — so both orderings are worth an index.
create index if not exists listening_plays_top_idx
  on public.listening_plays (user_id, plays desc);
create index if not exists listening_plays_last_idx
  on public.listening_plays (user_id, last_played desc);

alter table public.listening_plays enable row level security;

-- Your listening history is the most personal thing in this database. Nobody
-- else reads it, not even to build somebody's public profile.
drop policy if exists "own listening only" on public.listening_plays;
create policy "own listening only" on public.listening_plays
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Account deletion, corrected
-- ---------------------------------------------------------------------------
-- Two tables were missing from the walk, and one of them mattered a lot:
--
--   * app_state — the cloud mirror of localStorage. Every rating, every diary
--     entry, the whole local store. "Delete my account" left all of it behind
--     unless the table happened to carry an on-delete-cascade to auth.users,
--     which is not something this file can see or rely on.
--   * listening_plays — new here, and lifetime listening history is not
--     something to forget to delete.
--
-- Everything else was already covered: bid_wars and bid_war_bids cascade from
-- auth.users, and client_errors deliberately holds no user id. The avatar file
-- in storage is handled in api/delete-account.js, which can reach the storage
-- API; SQL cannot.
--
-- Same dynamic walk as before, so a pair naming a table this project does not
-- have is skipped rather than raising.
create or replace function public.delete_my_data()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  t    text;
  c    text;
  pairs text[][] := array[
    ['lore_answers','user_id'], ['ratings','user_id'], ['crate_feed','user_id'],
    ['feed_likes','user_id'], ['feed_comments','user_id'], ['follows','follower_id'],
    ['follows','following_id'], ['groove_members','user_id'], ['grooves','owner_id'],
    ['lists','user_id'], ['leaderboard_times','user_id'], ['analytics_events','user_id'],
    ['reports','reporter_id'], ['blocks','blocker_id'], ['blocks','blocked_id'],
    ['notifications','user_id'], ['notifications','actor_id'],
    ['app_state','user_id'], ['listening_plays','user_id']
  ];
  i int;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    c := pairs[i][2];
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = c) then
      execute format('delete from public.%I where %I = $1', t, c) using v_me;
    end if;
  end loop;

  delete from public.profiles where id = v_me;
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
