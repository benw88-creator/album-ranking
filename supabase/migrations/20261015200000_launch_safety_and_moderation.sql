-- Launch safety: economy races, lost profile pins, public-feed privacy and
-- identity, a server text filter, and an admin moderation queue.
-- REVIEW/APPLY ONLY AFTER APPROVAL. Idempotent; transactional. Only data change:
-- re-granting the OG badge to accounts the pin regression skipped.
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. collection_sell paid on every concurrent call: it read the row unlocked
--    and refunded whether or not its DELETE removed anything. Now the DELETE
--    is the claim — only the call that removed the row is paid.
create or replace function public.collection_sell(p_album_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := auth.uid();
  v_row  public.collection;
  v_back bigint;
  p      public.profiles;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_row from public.collection
   where user_id = v_me and album_id = p_album_id for update;
  if v_row.album_id is null then raise exception 'You do not own that'; end if;
  if coalesce(v_row.via_pick, false) then
    raise exception 'That one was a Mythic pick — it is yours to keep, not to sell';
  end if;
  delete from public.collection where user_id = v_me and album_id = p_album_id;
  if not found then raise exception 'You do not own that'; end if;
  v_back := floor(v_row.price * 0.7);
  update public.profiles set discs = coalesce(discs, 0) + v_back
   where id = v_me returning * into p;
  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'refund', v_back, 'paid', v_row.price,
    'discs', p.discs,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = v_me),
    'owned', (select count(*) from public.collection where user_id = v_me));
end $$;
revoke all on function public.collection_sell(text) from public, anon;
grant execute on function public.collection_sell(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Completionist milestones count ratings rows the client writes, so a made-up
--    artistId minted 12,000 Discs per key without limit. Two comp claims a UTC
--    day bounds it at a day of games; honest completions are rarely faster.
create or replace function public.limit_comp_claims() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key like 'comp:%'
     and not exists (select 1 from public.milestone_claims where user_id = new.user_id and key = new.key)
     and (select count(*) from public.milestone_claims
           where user_id = new.user_id and key like 'comp:%'
             and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= 2 then
    raise exception 'Two discography rewards a day — come back tomorrow for this one';
  end if;
  return new;
end $$;
revoke all on function public.limit_comp_claims() from public, anon, authenticated;
drop trigger if exists limit_comp_claims_trg on public.milestone_claims;
create trigger limit_comp_claims_trg before insert on public.milestone_claims
  for each row execute function public.limit_comp_claims();

-- ---------------------------------------------------------------------------
-- 3. 20260921140000 redefined pin_profile_economy from a copy older than the
--    referral migration, silently dropping its pins on badges and the referral
--    columns (and the OG grant). A separate trigger, so the long economy body
--    is not retyped. INVOKER: current_user must be the caller (see launch mig).
create or replace function public.pin_profile_social() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.badges := '["og"]'::jsonb;
    new.referral_code := null;
    new.referred_by := null;
    new.referral_paid_count := 0;
  else
    new.badges := old.badges;
    new.referral_code := old.referral_code;
    new.referred_by := old.referred_by;
    new.referral_paid_count := old.referral_paid_count;
  end if;
  return new;
end $$;
revoke all on function public.pin_profile_social() from public, anon, authenticated;
drop trigger if exists pin_profile_social_trg on public.profiles;
create trigger pin_profile_social_trg before insert or update on public.profiles
  for each row execute function public.pin_profile_social();

update public.profiles set badges = '["og"]'::jsonb
 where badges is null or badges = '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 4. Higher or Lower accepted any streak to 2,000. A run never repeats a record
--    and draws only from your rated albums, so the streak is bounded by them,
--    and each guess takes at least 0.7s (the verdict pause alone is 0.62s). Patched in place like the launch
--    migration patches pin_profile_economy: the rest of game_score is untouched.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.game_score(text,text,jsonb,integer,uuid,integer)'::regprocedure);
  if position('if n < 0 or n > 2000 then raise exception ''out of range''; end if;' in v_def) > 0 then
    v_def := replace(v_def,
      'if n < 0 or n > 2000 then raise exception ''out of range''; end if;',
      'if n < 0 or n > least(2000, (select count(*) from public.ratings where user_id = p_user and kind = ''album'')) then raise exception ''out of range''; end if;');
    v_def := replace(v_def, 'if p_ms < n * 400 then raise exception ''too fast''; end if;',
                            'if p_ms < n * 700 then raise exception ''too fast''; end if;');
    execute v_def;
  elsif position('from public.ratings where user_id = p_user and kind = ''album''' in v_def) = 0 then
    raise exception 'Unexpected game_score: review its Higher or Lower branch';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4b. Album-page comments never saved: the client writes feed_id 'album:<id>'
--     into a uuid FK to crate_feed. They get their own key instead.
alter table public.feed_comments add column if not exists album_id text;
alter table public.feed_comments alter column feed_id drop not null;
alter table public.feed_comments drop constraint if exists feed_comments_target_check;
alter table public.feed_comments add constraint feed_comments_target_check
  check ((feed_id is not null) <> (album_id is not null));
create index if not exists feed_comments_album_idx on public.feed_comments (album_id, created_at) where album_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Shared text filter. Folded (accents, leetspeak) and matched on WORDS, so
--    "Scunthorpe" and "conspicuous" pass; a few phrases are matched squashed.
create or replace function public.is_abusive_text(p text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
    regexp_replace(lower(translate(p, 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç013457@$', 'aaaaaaeeeeiiiiooooouuuuyyncoieastas')), '[^a-z]+', ' ', 'g')
      ~ '\m(nigg(er|a|az|ers)|faggots?|fags?|retards?|kikes?|spics?|chinks?|cunts?|trann(y|ies)|kys)\M'
    or regexp_replace(lower(translate(p, 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç013457@$', 'aaaaaaeeeeiiiiooooouuuuyyncoieastas')), '[^a-z]', '', 'g')
      ~ '(nigger|faggot|killyourself|hopeyoudie|^kys$)', false)
$$;

create or replace function public.reject_abusive_text() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_col text;
begin
  foreach v_col in array tg_argv loop
    if public.is_abusive_text(to_jsonb(new) ->> v_col) then
      raise exception 'blocked_words' using hint = 'That wording is not allowed on VINALL.';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.reject_abusive_text() from public, anon, authenticated;

drop trigger if exists text_filter_trg on public.feed_comments;
create trigger text_filter_trg before insert or update on public.feed_comments
  for each row execute function public.reject_abusive_text('body');
drop trigger if exists text_filter_trg on public.lists;
create trigger text_filter_trg before insert or update on public.lists
  for each row execute function public.reject_abusive_text('title');
drop trigger if exists text_filter_trg on public.grooves;
create trigger text_filter_trg before insert or update on public.grooves
  for each row execute function public.reject_abusive_text('name');
drop trigger if exists text_filter_trg on public.moments;
create trigger text_filter_trg before insert or update on public.moments
  for each row execute function public.reject_abusive_text('featuring');
drop trigger if exists text_filter_trg on public.suggestions;
create trigger text_filter_trg before insert or update on public.suggestions
  for each row execute function public.reject_abusive_text('label', 'note');
-- Profiles: only when the text changes, so an old bio never blocks a Disc award.
drop trigger if exists text_filter_trg on public.profiles;
create trigger text_filter_trg before insert or update of username, bio on public.profiles
  for each row when (current_user in ('authenticated', 'anon'))
  execute function public.reject_abusive_text('username', 'bio');

-- ---------------------------------------------------------------------------
-- 6. crate_feed is public to read. A row now carries the author's REAL name and
--    avatar (the client supplied them, so anyone could post as anyone), a
--    filtered note (a bulk import must not fail on one row, so the note is
--    dropped rather than the rating), and is refused while the author's ratings
--    are private or friends-only. Leaving public removes existing posts.
create or replace function public.crate_feed_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
revoke all on function public.crate_feed_guard() from public, anon, authenticated;
drop trigger if exists crate_feed_guard_trg on public.crate_feed;
create trigger crate_feed_guard_trg before insert or update on public.crate_feed
  for each row execute function public.crate_feed_guard();

create or replace function public.unpublish_private_feed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.ratings_visibility, 'public') <> 'public'
     and coalesce(old.ratings_visibility, 'public') = 'public' then
    delete from public.crate_feed where user_id = new.id;
  end if;
  if new.username is distinct from old.username or new.avatar_url is distinct from old.avatar_url then
    update public.crate_feed set username = new.username, avatar_url = coalesce(new.avatar_url, '')
     where user_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.unpublish_private_feed() from public, anon, authenticated;
drop trigger if exists unpublish_private_feed_trg on public.profiles;
create trigger unpublish_private_feed_trg after update on public.profiles
  for each row execute function public.unpublish_private_feed();

-- ---------------------------------------------------------------------------
-- 7. Moderation. Reports gain the kinds the app can now report and a record of
--    how each was resolved; admins work the queue through two RPCs.
alter table public.reports drop constraint if exists reports_target_kind_check;
alter table public.reports add constraint reports_target_kind_check
  check (target_kind in ('user','lore','list','comment','groove','feed','moment'));
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolved_by uuid references auth.users(id) on delete set null;
alter table public.reports add column if not exists resolution text;
create index if not exists reports_open_idx on public.reports (created_at) where status = 'open';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The open queue with the reported content inlined, one row per TARGET.
create or replace function public.admin_reports(p_status text default 'open', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return coalesce((
    select jsonb_agg(x order by x.first_at) from (
      select r.target_kind kind, r.target_id target, max(r.target_user_id::text) target_user,
             (select username from public.profiles where id = max(r.target_user_id::text)::uuid) target_username,
             (select coalesce(banned_until > now(), false) from auth.users where id = max(r.target_user_id::text)::uuid) suspended,
             count(*) reports, min(r.created_at) first_at,
             jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'at', r.created_at,
               'reporter', (select username from public.profiles where id = r.reporter_id)) order by r.created_at) items,
             case r.target_kind
               when 'feed' then (select coalesce(note, '') || ' [' || album_name || ', ' || score || ']' from public.crate_feed where id::text = r.target_id)
               when 'comment' then coalesce(
                 (select body from public.song_comments where 'sc:' || id::text = r.target_id),
                 (select body from public.feed_comments where 'fc:' || id::text = r.target_id))
               when 'moment' then (select coalesce(track_name, '') || ' — ' || coalesce(featuring, '') from public.moments where id::text = r.target_id)
               when 'list' then (select title from public.lists where id::text = r.target_id)
               when 'groove' then (select name from public.grooves where id::text = r.target_id)
               when 'lore' then (select note from public.lore_answers where id::text = r.target_id)
               when 'user' then (select username || ' — ' || coalesce(bio, '') from public.profiles where id::text = r.target_id)
             end content
        from public.reports r
       where r.status = coalesce(p_status, 'open')
       group by r.target_kind, r.target_id
       limit greatest(1, least(p_limit, 500))
    ) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_reports(text, int) from public, anon;
grant execute on function public.admin_reports(text, int) to authenticated;

-- p_action: dismiss | remove | suspend | remove_suspend. Every report on the
-- target is closed together, each reporter is told the outcome, and the author
-- of removed content is told what was removed and how to appeal.
create or replace function public.admin_resolve(p_kind text, p_target text, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_author uuid;
  v_removed int := 0;
  v_status text := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_action not in ('dismiss', 'remove', 'suspend', 'remove_suspend') then raise exception 'bad_action'; end if;
  select target_user_id into v_author from public.reports
   where target_kind = p_kind and target_id = p_target and target_user_id is not null limit 1;
  if p_kind = 'user' then v_author := coalesce(v_author, p_target::uuid); end if;

  if p_action in ('remove', 'remove_suspend') then
    if p_kind = 'feed' then delete from public.crate_feed where id::text = p_target;
    elsif p_kind = 'comment' and p_target like 'sc:%' then delete from public.song_comments where 'sc:' || id::text = p_target;
    elsif p_kind = 'comment' and p_target like 'fc:%' then delete from public.feed_comments where 'fc:' || id::text = p_target;
    elsif p_kind = 'moment' then delete from public.moments where id::text = p_target;
    elsif p_kind = 'list' then delete from public.lists where id::text = p_target;
    elsif p_kind = 'groove' then delete from public.grooves where id::text = p_target;
    elsif p_kind = 'lore' then update public.lore_answers set note = null where id::text = p_target;
    elsif p_kind = 'user' then
      -- A profile is not deleted by a moderator; what people can see of it is.
      update public.profiles set bio = '', avatar_url = '' where id = v_author;
    end if;
    get diagnostics v_removed = row_count;
  end if;

  if p_action in ('suspend', 'remove_suspend') and v_author is not null then
    if v_author = auth.uid() then raise exception 'cannot_suspend_self'; end if;
    update auth.users set banned_until = now() + interval '100 years' where id = v_author;
    delete from auth.sessions where user_id = v_author;
  end if;

  update public.reports set status = v_status, resolved_at = now(), resolved_by = auth.uid(), resolution = p_note
   where target_kind = p_kind and target_id = p_target and status = 'open';

  insert into public.notifications (user_id, actor_id, type, data)
  select distinct reporter_id, auth.uid(), 'report_update', jsonb_build_object('outcome', v_status, 'kind', p_kind)
    from public.reports where target_kind = p_kind and target_id = p_target and reporter_id <> auth.uid();
  if p_action in ('remove', 'remove_suspend') and v_author is not null and v_removed > 0 then
    insert into public.notifications (user_id, actor_id, type, data)
    values (v_author, auth.uid(), 'content_removed', jsonb_build_object('kind', p_kind, 'note', p_note));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'removed', v_removed);
end $$;
revoke all on function public.admin_resolve(text, text, text, text) from public, anon;
grant execute on function public.admin_resolve(text, text, text, text) to authenticated;

create or replace function public.admin_unsuspend(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update auth.users set banned_until = null where id = p_user;
end $$;
revoke all on function public.admin_unsuspend(uuid) from public, anon;
grant execute on function public.admin_unsuspend(uuid) to authenticated;

-- Guards.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and cmd in ('DELETE')) then
    raise exception 'reports must not gain a delete policy';
  end if;
  if not public.is_abusive_text('k y s') or not public.is_abusive_text('F.A.G.G.O.T') then
    raise exception 'text filter misses folded abuse';
  end if;
  if public.is_abusive_text('Scunthorpe United, conspicuous, Dickens, assassin') then
    raise exception 'text filter flags ordinary words';
  end if;
end $$;

commit;
