-- ===========================================================================
-- Two things that were entirely missing: any way to see whether the product
-- works, and any way for a user to deal with another user.
-- ===========================================================================

-- --- Analytics ------------------------------------------------------------
-- Deliberately event names and small prop bags, not page views. The number
-- that decides whether VINALL is a business is "did anyone answer a second
-- question", and nothing in the app could answer that before now.
create table if not exists public.analytics_events (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_name_time_idx on public.analytics_events (name, created_at desc);
create index analytics_user_time_idx on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;

-- You may record your own events and read your own back. Nobody reads anyone
-- else's: the aggregate view below is how the numbers get looked at.
create policy "log own events" on public.analytics_events
  for insert with check (auth.uid() = user_id);
create policy "read own events" on public.analytics_events
  for select using (auth.uid() = user_id);

-- Admin-only summary. security definer so it can see across users, with an
-- explicit is_admin gate rather than relying on a policy.
create or replace function public.analytics_summary(p_days integer default 14)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Admins only';
  end if;

  select jsonb_build_object(
    'days', p_days,
    'active_users',      (select count(distinct user_id) from public.analytics_events where created_at > v_since),
    'questions_shown',   (select count(*) from public.analytics_events where name = 'question_shown'    and created_at > v_since),
    'questions_answered',(select count(*) from public.analytics_events where name = 'question_answered' and created_at > v_since),
    'questions_skipped', (select count(*) from public.analytics_events where name = 'question_skipped'  and created_at > v_since),
    'other_used',        (select count(*) from public.analytics_events where name = 'question_other'    and created_at > v_since),
    'notes_added',       (select count(*) from public.analytics_events where name = 'note_added'        and created_at > v_since),
    'today_opened',      (select count(*) from public.analytics_events where name = 'today_opened'      and created_at > v_since),
    -- the retention number that actually matters
    'answered_2_plus',   (select count(*) from (
                            select user_id from public.analytics_events
                            where name = 'question_answered' and created_at > v_since
                            group by user_id having count(*) >= 2) t),
    'answerers',         (select count(distinct user_id) from public.analytics_events
                            where name = 'question_answered' and created_at > v_since),
    'total_lore',        (select count(*) from public.lore_answers where not skipped and choice is not null)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.analytics_summary(integer) from public, anon;
grant execute on function public.analytics_summary(integer) to authenticated;

-- --- Reporting and blocking -----------------------------------------------
-- App Store guideline 1.2 requires all four of these for user-generated
-- content: a filter, a way to report, a way to block, and a contact. The
-- filter (hasSlur) already existed on groove names; the rest did not.

create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references auth.users(id) on delete cascade,
  target_kind    text not null check (target_kind in ('user','lore','list','comment','groove','feed')),
  target_id      text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  reason         text not null,
  note           text,
  status         text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at     timestamptz not null default now(),
  unique (reporter_id, target_kind, target_id)
);

alter table public.reports enable row level security;

create policy "file own reports" on public.reports
  for insert with check (auth.uid() = reporter_id);
-- Reporters can see what they filed; admins see the queue.
create policy "read own reports or all if admin" on public.reports
  for select using (
    auth.uid() = reporter_id
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  );
create policy "admins update reports" on public.reports
  for update using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

-- Only you can see or change who you have blocked. The person blocked is not
-- told, which is the whole point of a block.
create policy "manage own blocks" on public.blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- --- Account deletion ------------------------------------------------------
-- Removes everything this person wrote. The auth user itself is deleted by
-- /api/delete-account with the service role, because auth.users is not ours
-- to write from here.
create or replace function public.delete_my_data()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  t    text;
  c    text;
  -- table/column pairs, walked dynamically so a table this project does not
  -- have (or gains later) never turns account deletion into a hard error.
  pairs text[][] := array[
    ['lore_answers','user_id'], ['ratings','user_id'], ['crate_feed','user_id'],
    ['feed_likes','user_id'], ['feed_comments','user_id'], ['follows','follower_id'],
    ['follows','following_id'], ['groove_members','user_id'], ['grooves','owner_id'],
    ['lists','user_id'], ['leaderboard_times','user_id'], ['analytics_events','user_id'],
    ['reports','reporter_id'], ['blocks','blocker_id'], ['blocks','blocked_id'],
    ['notifications','user_id'], ['notifications','actor_id']
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
