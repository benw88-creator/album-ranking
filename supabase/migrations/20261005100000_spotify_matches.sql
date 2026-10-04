-- Spotify → Deezer match cache. Apply by hand in the SQL editor, like the
-- others. Idempotent.
--
-- One row per Spotify URI: which Deezer track or album it is, and how sure
-- /api/spotify-match was. Not personal data — it is a fact about two
-- catalogues — so the second person to import a record costs Deezer nothing.
-- The import works without this table (every row is matched fresh); with it,
-- a popular library is mostly instant.

create table if not exists public.spotify_matches (
  uri        text primary key check (uri ~ '^spotify:(track|album):[A-Za-z0-9]+$'),
  kind       text not null check (kind in ('track', 'album')),
  status     text not null check (status in ('ok', 'check', 'none')),
  match      jsonb,
  alts       jsonb,
  matched_at timestamptz not null default now()
);

-- RLS on and NO policies: only the route reads and writes it, with the
-- service role. A browser that could write here could point everybody's
-- import of a song at a different record.
alter table public.spotify_matches enable row level security;

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'spotify_matches') then
    raise exception 'spotify_matches must have no policies — it is written only by /api/spotify-match';
  end if;
end $$;
