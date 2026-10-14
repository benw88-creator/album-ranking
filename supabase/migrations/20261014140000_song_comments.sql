-- For You comments: one thread per SONG (keyed artist|title, the feed's own
-- `skey`, so a legacy Spotify id and a Deezer id land on one thread — trap 4),
-- optionally pinned to a second inside the 30-second preview.
--
-- Safeguards live HERE, not in the browser:
--   * no insert/update policy at all — the only way in is song_comment_add()
--   * length 2..280, whitespace collapsed, control characters stripped
--   * slurs and targeted abuse refused; links refused (the classic spam payload)
--   * 4 a minute, 60 a day per person; the same text twice in 24h is refused
--   * three distinct reports hide a comment until an admin looks at it
-- Deleted accounts cascade away. Idempotent: safe to run twice.

create table if not exists public.song_comments (
  id          uuid primary key default gen_random_uuid(),
  song_key    text not null check (char_length(song_key) between 1 and 300),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text check (char_length(title) <= 300),
  artist      text check (char_length(artist) <= 300),
  body        text not null check (char_length(body) between 2 and 280),
  at_ms       int  check (at_ms between 0 and 30000),
  likes       int  not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists song_comments_key_idx  on public.song_comments (song_key, created_at desc);
create index if not exists song_comments_user_idx on public.song_comments (user_id, created_at desc);

alter table public.song_comments enable row level security;

drop policy if exists "song comments readable" on public.song_comments;
create policy "song comments readable" on public.song_comments
  for select using (
    not hidden
    or user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
drop policy if exists "song comments deletable by owner or admin" on public.song_comments;
create policy "song comments deletable by owner or admin" on public.song_comments
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create table if not exists public.song_comment_likes (
  comment_id uuid not null references public.song_comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.song_comment_likes enable row level security;
drop policy if exists "song comment likes readable" on public.song_comment_likes;
create policy "song comment likes readable" on public.song_comment_likes for select using (true);
drop policy if exists "like as yourself" on public.song_comment_likes;
create policy "like as yourself" on public.song_comment_likes
  for insert with check (
    user_id = auth.uid()
    and not exists (select 1 from public.song_comments c where c.id = comment_id and c.user_id = auth.uid())
  );
drop policy if exists "unlike as yourself" on public.song_comment_likes;
create policy "unlike as yourself" on public.song_comment_likes for delete using (user_id = auth.uid());

-- The like count is the trigger's alone; there is no update policy to reach it.
create or replace function public.song_comment_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.song_comments set likes = likes + 1 where id = new.comment_id;
  else
    update public.song_comments set likes = greatest(0, likes - 1) where id = old.comment_id;
  end if;
  return null;
end $$;
drop trigger if exists song_comment_like_count_trg on public.song_comment_likes;
create trigger song_comment_like_count_trg after insert or delete on public.song_comment_likes
  for each row execute function public.song_comment_like_count();

create or replace function public.song_comment_add(
  p_key text, p_body text, p_at_ms int default null, p_title text default null, p_artist text default null
) returns public.song_comments
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text;
  v_flat text;
  v_row  public.song_comments;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_key is null or char_length(p_key) not between 1 and 300 then raise exception 'bad_key'; end if;

  v_body := regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g');
  v_body := btrim(regexp_replace(v_body, '\s+', ' ', 'g'));
  if char_length(v_body) < 2 then raise exception 'too_short'; end if;
  if char_length(v_body) > 280 then raise exception 'too_long'; end if;

  -- Folded and squashed, so "k y s" and "F.A.G.G.O.T" are caught. Mirrors
  -- BAD_WORDS in index.html plus a few phrases of targeted abuse.
  v_flat := regexp_replace(lower(translate(v_body, 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç013457@$', 'aaaaaaeeeeiiiiooooouuuuyyncoieastas')), '[^a-z]', '', 'g');
  if v_flat ~ '(nigger|nigga|faggot|retard|kike|spic|chink|cunt|tranny|killyourself|kys$|^kys|gokillyourself|hopeyoudie)' then
    raise exception 'blocked_words';
  end if;
  if v_body ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|xyz|io|gg|ru|co|ly|me|app|link)(/|\s|$)|discord\.gg|t\.me/)' then
    raise exception 'no_links';
  end if;
  if v_body ~ '(.)\1{9,}' then raise exception 'spam'; end if;

  if (select count(*) from public.song_comments where user_id = v_uid and created_at > now() - interval '1 minute') >= 4 then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.song_comments where user_id = v_uid and created_at > now() - interval '1 day') >= 60 then
    raise exception 'daily_limit';
  end if;
  if exists (select 1 from public.song_comments where user_id = v_uid
             and lower(body) = lower(v_body) and created_at > now() - interval '1 day') then
    raise exception 'duplicate';
  end if;

  insert into public.song_comments (song_key, user_id, title, artist, body, at_ms)
  values (p_key, v_uid, left(p_title, 300), left(p_artist, 300), v_body,
          case when p_at_ms between 0 and 30000 then p_at_ms end)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.song_comment_add(text, text, int, text, text) from public, anon;
grant execute on function public.song_comment_add(text, text, int, text, text) to authenticated;

-- Moderation hook: three different people reporting a comment hides it. It is
-- still visible to its author and to admins, and an admin un-hides by hand.
-- Wrapped so a failure here can never stop a report being filed.
create or replace function public.song_comment_autohide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.target_kind = 'comment' and new.target_id like 'sc:%' then
      if (select count(distinct reporter_id) from public.reports
          where target_kind = 'comment' and target_id = new.target_id) >= 3 then
        update public.song_comments set hidden = true
        where id::text = substr(new.target_id, 4);
      end if;
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists song_comment_autohide_trg on public.reports;
create trigger song_comment_autohide_trg after insert on public.reports
  for each row execute function public.song_comment_autohide();

-- Guards: comments may only arrive through the function, and nobody but the
-- trigger moves `likes` or `hidden`.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'song_comments'
             and cmd in ('INSERT', 'UPDATE', 'ALL')) then
    raise exception 'song_comments must have no insert/update policy';
  end if;
end $$;
