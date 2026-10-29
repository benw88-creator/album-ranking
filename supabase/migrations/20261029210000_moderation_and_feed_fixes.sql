-- Four fixes from the second audit sweep (2026-10-29).
--
--  A. A duplicate crate entry's deletion no longer takes down the surviving
--     entry's post. unpost_deleted_album (20261029180000) removed every post
--     with the deleted rating's name and artist; it now does that only when no
--     other album rating of the same name and artist remains. The post under
--     the deleted id itself still always goes.
--  B. A report's target_user_id is worked out by the SERVER from the reported
--     row. It was whatever the reporting client sent, and admin_resolve bans
--     and blanks whoever it names — so a report on real content could name an
--     innocent account. Existing open reports are corrected the same way.
--  C. The avatars bucket takes images only (JPEG, PNG, WebP), 2MB at most. The
--     app only ever uploads its own cropped 512px JPEG; the bucket accepted any
--     file, publicly served, outside moderation.
--  D. crate_feed album fields are checked: an abusive album name or artist
--     refuses the row (skipped, never raised, so a bulk import is not failed by
--     one line), and album_art is kept only from the catalogue CDNs the app
--     uses. api/share.js applies the same host list.
--
-- Idempotent. Apply by hand, then:
--   supabase migration repair --status applied 20261029210000

-- ---------------------------------------------------------------- A
create or replace function public.unpost_deleted_album()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if old.kind <> 'album' then return old; end if;
  delete from public.crate_feed f
   where f.user_id = old.user_id
     and f.created_at <= clock_timestamp()
     and (f.album_id = old.item_id
          or (coalesce(old.data ->> 'name', '') <> '' and coalesce(old.data ->> 'artist', '') <> ''
              and lower(f.album_name) = lower(old.data ->> 'name')
              and lower(f.album_artist) = lower(old.data ->> 'artist')
              -- The same record still rated under another key keeps its post.
              and not exists (select 1 from public.ratings r
                               where r.user_id = old.user_id and r.kind = 'album' and r.item_id <> old.item_id
                                 and lower(r.data ->> 'name') = lower(old.data ->> 'name')
                                 and lower(r.data ->> 'artist') = lower(old.data ->> 'artist'))));
  return old;
end $function$;

-- ---------------------------------------------------------------- B
create or replace function public.report_target_owner(p_kind text, p_target text)
returns uuid
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v uuid;
begin
  if p_target is null then return null; end if;
  if p_kind = 'feed' then select user_id into v from public.crate_feed where id::text = p_target;
  elsif p_kind = 'comment' and p_target like 'sc:%' then select user_id into v from public.song_comments where 'sc:' || id::text = p_target;
  elsif p_kind = 'comment' and p_target like 'fc:%' then select user_id into v from public.feed_comments where 'fc:' || id::text = p_target;
  elsif p_kind = 'moment' then select user_id into v from public.moments where id::text = p_target;
  elsif p_kind = 'list' then select user_id into v from public.lists where id::text = p_target;
  elsif p_kind = 'groove' then select owner_id into v from public.grooves where id::text = p_target;
  elsif p_kind = 'lore' then select user_id into v from public.lore_answers where id::text = p_target;
  elsif p_kind = 'user' then select id into v from public.profiles where id::text = p_target;
  end if;
  return v;
end $function$;
revoke all on function public.report_target_owner(text, text) from public, anon, authenticated;

create or replace function public.report_derive_target()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Never the client's word. A target that cannot be found has no author.
  new.target_user_id := public.report_target_owner(new.target_kind, new.target_id);
  return new;
end $function$;

drop trigger if exists report_derive_target_trg on public.reports;
create trigger report_derive_target_trg before insert or update of target_kind, target_id, target_user_id on public.reports
  for each row execute function public.report_derive_target();

-- Correct open reports filed before this. Content already removed keeps the
-- author it was filed with (there is nothing left to derive it from).
update public.reports r
   set target_user_id = public.report_target_owner(r.target_kind, r.target_id)
 where r.status = 'open'
   and public.report_target_owner(r.target_kind, r.target_id) is not null
   and r.target_user_id is distinct from public.report_target_owner(r.target_kind, r.target_id);

-- ---------------------------------------------------------------- C
update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

-- ---------------------------------------------------------------- D
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

-- ---------------------------------------------------------------- guards
do $$
begin
  if exists (select 1 from storage.buckets where id = 'avatars' and (allowed_mime_types is null or file_size_limit is null)) then
    raise exception 'avatars bucket must be limited';
  end if;
  if (select count(*) from public.crate_feed
       where album_art <> '' and album_art !~ '^https://(cdn-images\.dzcdn\.net|e-cdns-images\.dzcdn\.net|i\.scdn\.co|is[0-9]+-ssl\.mzstatic\.com)/') > 0 then
    raise notice 'existing crate_feed rows carry sleeves from other hosts; left as they are';
  end if;
end $$;
