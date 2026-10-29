-- ROLLBACK for 20261029210000_moderation_and_feed_fixes.sql (not a migration).
-- Restores unpost_deleted_album and crate_feed_guard as they were live before
-- it, removes the report-target trigger and helper, and lifts the avatars
-- bucket limits. Report rows the migration corrected keep their corrected
-- author: the pre-migration copy is in ~/VINALL-db-backups/2026-10-29-pre-moderation-fixes/reports.json.
--   supabase migration repair --status reverted 20261029210000
begin;
drop trigger if exists report_derive_target_trg on public.reports;
drop function if exists public.report_derive_target();
drop function if exists public.report_target_owner(text, text);
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'avatars';

CREATE OR REPLACE FUNCTION public.unpost_deleted_album()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.kind <> 'album' then return old; end if;
  delete from public.crate_feed f
   where f.user_id = old.user_id
     and (f.album_id = old.item_id
          or (coalesce(old.data ->> 'name', '') <> '' and coalesce(old.data ->> 'artist', '') <> ''
              and lower(f.album_name) = lower(old.data ->> 'name')
              and lower(f.album_artist) = lower(old.data ->> 'artist')))
     and f.created_at <= clock_timestamp();
  return old;
end $function$;


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
  return new;
end $function$;

commit;
