-- Liked songs on For You. Private by default; a profile setting
-- (profiles.likes_public) makes them visible on the profile.
-- Apply by hand in the SQL editor, like the others.

alter table public.profiles add column if not exists likes_public boolean not null default false;

create table if not exists public.liked_songs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  track_key  text not null,
  name       text,
  artist     text,
  art        text,
  created_at timestamptz not null default now(),
  primary key (user_id, track_key)
);

alter table public.liked_songs enable row level security;

drop policy if exists liked_songs_select on public.liked_songs;
create policy liked_songs_select on public.liked_songs for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = liked_songs.user_id and p.likes_public)
  );

drop policy if exists liked_songs_insert on public.liked_songs;
create policy liked_songs_insert on public.liked_songs for insert
  with check (user_id = auth.uid());

drop policy if exists liked_songs_delete on public.liked_songs;
create policy liked_songs_delete on public.liked_songs for delete
  using (user_id = auth.uid());

-- delete_my_data() walks a hand-written table list; a new table is not
-- covered until it is added here, same trap app_state and listening_plays
-- fell into.
create or replace function public.delete_my_data()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  t    text;
  c    text;
  pairs text[][] := array[
    ['lore_answers','user_id'], ['ratings','user_id'], ['crate_feed','user_id'],
    ['feed_likes','user_id'], ['feed_comments','user_id'], ['follows','follower_id'],
    ['follows','following_id'], ['groove_members','user_id'], ['grooves','owner_id'],
    ['lists','user_id'], ['leaderboard_times','user_id'], ['analytics_events','user_id'],
    ['reports','reporter_id'], ['blocks','blocker_id'], ['blocks','blocked_id'],
    ['notifications','user_id'], ['notifications','actor_id'],
    ['app_state','user_id'], ['listening_plays','user_id'], ['collection','user_id'],
    ['milestone_claims','user_id'], ['recall_results','user_id'],
    ['suggestions','user_id'], ['liked_songs','user_id']
  ];
  i int;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    c := pairs[i][2];
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = c) then
      execute format('delete from public.%I where %I = $1', t, c) using v_me;
    end if;
  end loop;

  delete from public.profiles where id = v_me;
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
