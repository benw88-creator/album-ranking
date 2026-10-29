-- Real album titles are not refused from the feed.
--
-- 20261029210000 made crate_feed_guard refuse a post whose album name or
-- artist trips is_abusive_text(). Real catalogue records do — Ol' Dirty
-- Bastard's "Nigga Please", $uicideboy$'s "Kill Yourself" series — and the
-- refusal was silent: the rating saved, the post never appeared, and an
-- existing post stopped updating. The word filter is for things people WRITE
-- (notes, comments, names); album fields describe a record somebody else made.
--
-- What still protects the share cards those fields reach: api/share.js takes
-- a numeric (Deezer) record's name and sleeve from Deezer itself and otherwise
-- from the majority of posts, and only catalogue-CDN sleeves are ever stored
-- (below) or drawn. A post with a made-up title is the poster's own post,
-- reportable like any other.
--
-- Idempotent. Apply by hand, then:
--   supabase migration repair --status applied 20261029220000

create or replace function public.crate_feed_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.user_id;
  if p.id is not null and coalesce(p.ratings_visibility, 'public') <> 'public' then return null; end if;
  if p.id is not null then
    new.username := coalesce(p.username, 'user_' || left(new.user_id::text, 8));
    new.avatar_url := coalesce(p.avatar_url, '');
  end if;
  if public.is_abusive_text(new.note) then new.note := ''; end if;
  new.album_name := left(new.album_name, 300);
  new.album_artist := left(new.album_artist, 300);
  -- Only the catalogue CDNs the app draws from are kept as sleeves.
  if coalesce(new.album_art, '') !~ '^https://(cdn-images\.dzcdn\.net|e-cdns-images\.dzcdn\.net|i\.scdn\.co|is[0-9]+-ssl\.mzstatic\.com)/[^\s''"()\\<>]*$' then
    new.album_art := '';
  end if;
  return new;
end $function$;
