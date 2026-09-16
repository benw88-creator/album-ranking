-- VINALL's own player becomes a listening source.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
-- `listening_plays` was built for one thing: an import of the user's own
-- Spotify data export, because Spotify hands out no per-user listening data at
-- any tier this app can reach. That is still true. What changed is that VINALL
-- now plays audio itself — 30-second previews, in its own <audio> element — so
-- for the first time it can observe a play directly instead of waiting for
-- somebody to request a data export, which almost nobody ever does.
--
-- `findRinsed` and `findAbandoned` are first in buildQueue and have been
-- reading an empty table for most accounts since they shipped. This is what
-- fills it.
--
-- ---------------------------------------------------------------------------
-- Why a function rather than an upsert
-- ---------------------------------------------------------------------------
-- The client cannot do this with PostgREST. An upsert REPLACES the row, so a
-- browser incrementing a play count would have to read the current value,
-- add one, and write it back — which loses a play whenever two devices do it
-- at once, and invites a client to simply name its own number.
--
-- This takes no count. It takes the track and adds exactly one play, the same
-- rule as wallet_buy taking a key and never a price. There is nothing to
-- forge that is worth forging — nothing in the economy pays out from this
-- table — but keeping the shape consistent costs nothing and the day
-- something does pay out from it, the boundary is already in the right place.
--
-- ---------------------------------------------------------------------------
-- Honesty about what a "play" is here
-- ---------------------------------------------------------------------------
-- A preview is 30 seconds, and the import's threshold is 30 seconds, so a
-- preview heard to the end is exactly Spotify's own definition of a play and
-- no more. The client only calls this past 20 seconds, so a tap and a skip is
-- not a play — counting those would make "what have you been rinsing" mean
-- the opposite of what it says, which is the note the original migration
-- already makes about skips.
--
-- `source` is left ALONE on an existing row and set to 'vinall' only on
-- insert. A row that came from an export keeps saying so; merging the two
-- would quietly relabel somebody's imported history.
--
-- Idempotent throughout, because migrations here are pasted into the SQL
-- editor by hand and re-running one is the normal case, not the exception.

create or replace function public.listening_note_play(
  p_k        text,
  p_track    text,
  p_artist   text,
  p_album    text default null,
  p_uri      text default null,
  p_ms       integer default 30000
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ms bigint := greatest(0, least(coalesce(p_ms, 0), 600000));  -- a preview
begin                                                            -- cannot be
  if auth.uid() is null then                                     -- ten minutes
    return;                                                      -- long
  end if;
  if p_k is null or btrim(p_k) = '' or p_track is null or p_artist is null then
    return;
  end if;

  insert into public.listening_plays
    (user_id, k, track, artist, album, track_uri,
     plays, ms_played, first_played, last_played, source, updated_at)
  values
    (auth.uid(), p_k, p_track, p_artist, p_album, p_uri,
     1, v_ms, now(), now(), 'vinall', now())
  on conflict (user_id, k) do update set
    plays        = public.listening_plays.plays + 1,
    ms_played    = public.listening_plays.ms_played + v_ms,
    first_played = coalesce(public.listening_plays.first_played, now()),
    last_played  = now(),
    -- album and uri fill in a gap, they never overwrite what is already known:
    -- the import carries better metadata than a preview lookup does.
    album        = coalesce(public.listening_plays.album, excluded.album),
    track_uri    = coalesce(public.listening_plays.track_uri, excluded.track_uri),
    updated_at   = now();
end;
$$;

revoke all on function public.listening_note_play(text, text, text, text, text, integer) from public;
grant execute on function public.listening_note_play(text, text, text, text, text, integer) to authenticated;

comment on function public.listening_note_play is
  'Adds exactly one play from VINALL''s own player. Takes no count. Never relabels an imported row''s source.';

-- Guard: the whole point is that the caller cannot name a number. If this
-- function ever grows a plays parameter, this fails rather than shipping.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'listening_note_play'
      and pg_get_function_identity_arguments(p.oid) ilike '%plays%'
  ) then
    raise exception 'listening_note_play must not take a play count from the client';
  end if;
end $$;
