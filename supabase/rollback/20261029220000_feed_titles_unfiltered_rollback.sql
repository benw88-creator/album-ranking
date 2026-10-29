-- ROLLBACK for 20261029220000_feed_titles_unfiltered.sql (not a migration): restores
-- crate_feed_guard as 20261029210000 left it (refuses abusive album titles).
--   supabase migration repair --status reverted 20261029220000
begin;
CREATE OR REPLACE FUNCTION public.crate_feed_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.user_id;
  if p.id is not null and coalesce(p.ratings_visibility, 'public') <> 'public' then return null; end if;
  if p.id is not null then
    new.username := coalesce(p.username, 'user_' || left(new.user_id::text, 8));
    new.avatar_url := coalesce(p.avatar_url, '');
  end if;
  if public.is_abusive_text(new.note) then new.note := ''; end if;
  -- The record's own fields: an abusive title or artist is not posted at all,
  -- and only the catalogue CDNs the app draws from are kept as sleeves.
  if public.is_abusive_text(new.album_name) or public.is_abusive_text(new.album_artist) then return null; end if;
  new.album_name := left(new.album_name, 300);
  new.album_artist := left(new.album_artist, 300);
  if coalesce(new.album_art, '') !~ '^https://(cdn-images\.dzcdn\.net|e-cdns-images\.dzcdn\.net|i\.scdn\.co|is[0-9]+-ssl\.mzstatic\.com)/[^\s''"()\\<>]*$' then
    new.album_art := '';
  end if;
  return new;
end $function$;
commit;
