-- Community Choice: somebody picks the best stretch of a song, everybody else
-- listens to exactly that stretch and agrees or does not.
--
-- Apply by hand in the SQL editor, like the others. Idempotent throughout for
-- the usual reason: "applied by hand and not recorded" is the normal case here.
--
-- THE WINDOW IS INSIDE A PREVIEW, NOT INSIDE THE SONG. The only audio VINALL
-- can play is Deezer's thirty-second clip, so start_ms is an offset into that
-- clip and the clip is fetched fresh by track id at play time (the urls are
-- signed and die in about ten minutes — never store one). Same recording,
-- same clip, same offset: the snippet everybody votes on is the snippet that
-- was picked.

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (category in ('verse', 'feature', 'hook', 'beat')),
  track_id text not null check (track_id ~ '^[0-9]{1,20}$'),
  track_name text not null check (char_length(track_name) between 1 and 200),
  artist text not null check (char_length(artist) between 1 and 200),
  album text check (album is null or char_length(album) <= 200),
  -- Deezer's image CDN only. A free url here would be a tracking pixel on
  -- every feed render, for everybody.
  art text check (art is null or art ~ '^https://[a-z0-9-]+\.dzcdn\.net/'),
  -- Whose part it is. Required for a feature, meaningless otherwise.
  featuring text check (featuring is null or char_length(featuring) between 1 and 60),
  start_ms int not null check (start_ms between 0 and 30000),
  len_ms int not null check (len_ms between 5000 and 30000),
  -- The clip's real loudness envelope, decoded in the submitter's browser so
  -- the feed can draw a true waveform without downloading every clip on the
  -- page. Display only, so a constrained string rather than anything trusted.
  peaks text check (peaks is null or peaks ~ '^[0-9a-z]{16,96}$'),
  likes int not null default 0,
  created_at timestamptz not null default now(),
  constraint moments_window check (start_ms + len_ms <= 30500),
  constraint moments_feature check (category <> 'feature' or featuring is not null),
  -- One pick per song per category per person. Changing your mind is a
  -- delete and a new pick, which resets the count — as it should, because
  -- the people who agreed agreed with a different thirty seconds.
  constraint moments_one_pick unique (user_id, track_id, category)
);

create index if not exists moments_top_idx on public.moments (likes desc, created_at desc);
create index if not exists moments_cat_top_idx on public.moments (category, likes desc, created_at desc);
create index if not exists moments_new_idx on public.moments (created_at desc);

create table if not exists public.moment_likes (
  moment_id uuid not null references public.moments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);
create index if not exists moment_likes_user_idx on public.moment_likes (user_id);

alter table public.moments enable row level security;
alter table public.moment_likes enable row level security;

-- Public to read, like crate_feed: a pick nobody can hear is not a pick.
drop policy if exists "moments readable" on public.moments;
create policy "moments readable" on public.moments for select using (true);

drop policy if exists "moments insert own" on public.moments;
create policy "moments insert own" on public.moments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "moments delete own" on public.moments;
create policy "moments delete own" on public.moments
  for delete to authenticated using (user_id = auth.uid());

-- NO UPDATE POLICY, deliberately. `likes` is the ranking, and the only thing
-- that may move it is the trigger below; a row its owner could update is a
-- row its owner could put at number one.

drop policy if exists "moment likes readable" on public.moment_likes;
create policy "moment likes readable" on public.moment_likes for select using (true);

-- Agreeing with yourself is not agreement. The submitter is already counted
-- by having picked it, and the card says so.
drop policy if exists "moment likes insert own" on public.moment_likes;
create policy "moment likes insert own" on public.moment_likes
  for insert to authenticated with check (
    user_id = auth.uid()
    and not exists (select 1 from public.moments m where m.id = moment_id and m.user_id = auth.uid())
  );

drop policy if exists "moment likes delete own" on public.moment_likes;
create policy "moment likes delete own" on public.moment_likes
  for delete to authenticated using (user_id = auth.uid());

-- A new pick starts at zero whatever the request says, and is stamped with
-- the caller. Twenty a day is generous for a person and a wall for a loop.
create or replace function public.moments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.likes := 0;
  new.created_at := now();
  if auth.uid() is not null then
    new.user_id := auth.uid();
    if (select count(*) from public.moments
          where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
      raise exception 'moment_daily_limit' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists moments_before_insert on public.moments;
create trigger moments_before_insert before insert on public.moments
  for each row execute function public.moments_before_insert();

create or replace function public.moment_likes_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.moments set likes = likes + 1 where id = new.moment_id;
  elsif tg_op = 'DELETE' then
    update public.moments set likes = greatest(likes - 1, 0) where id = old.moment_id;
  end if;
  return null;
end $$;

drop trigger if exists moment_likes_count on public.moment_likes;
create trigger moment_likes_count after insert or delete on public.moment_likes
  for each row execute function public.moment_likes_count();

-- Needs no entry in delete_my_data(): both tables cascade from auth.users,
-- and a cascaded delete of somebody's likes still fires the count trigger,
-- so every pick they agreed with loses exactly their one.

-- Guard: the ranking column must stay out of every client's reach.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moments' and cmd in ('UPDATE', 'ALL')) then
    raise exception 'moments must have no UPDATE policy — likes would become client-writable';
  end if;
end $$;
