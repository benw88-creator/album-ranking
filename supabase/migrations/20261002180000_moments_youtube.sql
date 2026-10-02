-- Community Choice picks from the WHOLE song, played through YouTube's embedded
-- player. Apply by hand in the SQL editor. Idempotent.
--
-- A Deezer pick stays what it was: a window inside the 30-second preview of
-- one Deezer track. A YouTube pick is a window anywhere in one YouTube video,
-- and carries that video's length so the feed can draw where the window sits
-- without loading a player per card. The Deezer track id stays on both, as the
-- record's identity for covers, names and the one-pick-per-song rule.

alter table public.moments add column if not exists source text not null default 'deezer';
alter table public.moments add column if not exists video_id text;
alter table public.moments add column if not exists duration_ms int;

-- The original column check capped start_ms at 30,000 for everybody; it now
-- depends on the source, so it moves into the constraint below.
alter table public.moments drop constraint if exists moments_start_ms_check;
alter table public.moments drop constraint if exists moments_window;
alter table public.moments drop constraint if exists moments_source;

alter table public.moments add constraint moments_source check (
  (source = 'deezer'
     and video_id is null
     and start_ms between 0 and 30000
     and start_ms + len_ms <= 30500)
  or
  (source = 'youtube'
     and video_id ~ '^[A-Za-z0-9_-]{11}$'
     and duration_ms between 30000 and 1200000
     and start_ms >= 0
     and start_ms + len_ms <= duration_ms + 500)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'moments_source') then
    raise exception 'moments_source did not land';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moments' and cmd in ('UPDATE', 'ALL')) then
    raise exception 'moments must have no UPDATE policy — likes would become client-writable';
  end if;
end $$;
