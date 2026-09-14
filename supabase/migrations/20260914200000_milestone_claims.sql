-- Milestones pay in proportion to the milestone, and the server can prove it.
--
-- ---------------------------------------------------------------------------
-- 1. The bug this fixes, which cost people Discs silently
-- ---------------------------------------------------------------------------
-- Completing a discography on the album page ran this:
--
--   const celebKey = 'comp:' + meta.artistId;
--   if (complete && !isClaimed(celebKey)) { setClaimed(celebKey); celebrate(...); }
--
-- and the Achievements card's claim button used `key = 'comp:' + a.id` — **the
-- same string**. So finishing an artist by rating its last album marked the
-- achievement claimed, threw the confetti, and paid **nothing**. The card then
-- rendered as done with no Claim button, permanently, because claimed-ness was
-- the only gate.
--
-- Anyone who ever completed a discography the natural way got the celebration
-- and none of the reward, with no route back to it.
--
-- ---------------------------------------------------------------------------
-- 2. Why claims move server-side
-- ---------------------------------------------------------------------------
-- They lived in `crate_claimed` in localStorage. That is fine for "have I shown
-- you this confetti", and useless as a payment gate — clearing site data would
-- re-enable every claim.
--
-- The important part is that these are **the first awards in this app that can
-- actually be verified.** Every minigame runs in the browser and a win cannot
-- be checked, which is why they are all capped per day — the cap is the whole
-- defence. A milestone is different: "you have rated 50 albums" is a `count(*)`
-- against the `ratings` table, and "you completed this artist" is a count of
-- rows whose `data->>'artistId'` matches.
--
-- So these are **not capped**. A cap on a provable one-time award would only
-- punish somebody who arrived with eight milestones already earned — which,
-- given the bug above, is most people.
--
-- ---------------------------------------------------------------------------
-- 3. The amounts
-- ---------------------------------------------------------------------------
--   1 album        500        50 albums    12,000
--   5 albums     1,000       100 albums    25,000
--  10 albums     2,500       250 albums    50,000
--  25 albums     6,000       500 albums   100,000
--
-- 197,000 for the full run. Sized against the rating income for the same
-- journey: rating 500 albums pays 400 each, so ~200,000 from ratings alone.
-- The milestone ladder roughly doubles your rate over that stretch rather than
-- dwarfing it — 250→500 is 250 albums for 100,000, which is 400 an album, the
-- same as the rating itself.
--
-- **Completionist is proportionate to the discography**: `least(n, 15) * 800`
-- where n is how many of that artist's albums you have actually rated. A
-- three-album artist pays 2,400 and a twelve-album artist 9,600, because those
-- are not the same achievement. Capped at 15 so a pathological artist page
-- cannot mint, and floored at 2 because "completing" a one-album artist is not
-- a thing.

-- ------------------------------------------------------------------- table
create table if not exists public.milestone_claims (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  key        text    not null,
  awarded    integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.milestone_claims enable row level security;

-- Own rows readable so the client can draw claimed/unclaimed. No INSERT or
-- UPDATE policy at all: the definer function below is the only way in, exactly
-- like `collection`.
drop policy if exists "own milestone claims" on public.milestone_claims;
create policy "own milestone claims" on public.milestone_claims
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------------ claim
create or replace function public.wallet_claim_milestone(p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_n      integer;
  v_have   integer;
  v_artist text;
  v_amt    integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_key is null then raise exception 'No milestone given'; end if;

  /* Album-count milestones. The amount is decided here from the key, never
     sent by the client — same rule as wallet_buy taking a key and never a
     price, and wallet_award_game naming a game and never a number. */
  if p_key ~ '^albums:[0-9]+$' then
    v_n := split_part(p_key, ':', 2)::integer;
    v_amt := case v_n
      when 1   then 500     when 5   then 1000
      when 10  then 2500    when 25  then 6000
      when 50  then 12000   when 100 then 25000
      when 250 then 50000   when 500 then 100000
      else 0 end;
    if v_amt = 0 then raise exception 'Unknown milestone: %', p_key; end if;

    select count(*) into v_have
      from public.ratings where user_id = v_me and kind = 'album';
    if v_have < v_n then
      raise exception 'Not there yet — % of % albums', v_have, v_n;
    end if;

  /* Completionist. Verified as far as it can be: the server cannot know an
     artist's full discography (that is a Spotify call, and Postgres cannot
     make one), but it can check you have actually rated albums by them, and
     pay in proportion to how many. That turns a freely-forgeable claim into
     one that costs real ratings to fake. */
  elsif p_key ~ '^comp:[A-Za-z0-9]+$' then
    v_artist := split_part(p_key, ':', 2);
    select count(*) into v_have
      from public.ratings
     where user_id = v_me and kind = 'album'
       and data ->> 'artistId' = v_artist;
    if v_have < 2 then
      raise exception 'Rate at least two of their albums first';
    end if;
    v_amt := least(v_have, 15) * 800;

  else
    raise exception 'Unknown milestone: %', p_key;
  end if;

  -- One claim per milestone, forever. The primary key is the enforcement;
  -- the conflict clause turns a double-tap into a clean answer rather than an
  -- error the client has to interpret.
  insert into public.milestone_claims (user_id, key, awarded)
  values (v_me, p_key, v_amt)
  on conflict (user_id, key) do nothing;

  if not found then
    select * into p from public.profiles where id = v_me;
    return jsonb_build_object('ok', false, 'already', true, 'earned', 0,
                              'discs', p.discs, 'lifetime_xp', p.lifetime_xp,
                              'level', p.level);
  end if;

  update public.profiles set discs = coalesce(discs, 0) + v_amt
   where id = v_me returning * into p;

  return jsonb_build_object('ok', true, 'already', false, 'key', p_key,
                            'earned', v_amt, 'discs', p.discs,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_claim_milestone(text) from public, anon;
grant execute on function public.wallet_claim_milestone(text) to authenticated;

-- --------------------------------------------------------------- deletion
-- A table holding user rows means a line in delete_my_data(). Missing this is
-- how app_state survived account deletion for weeks.
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
    ['milestone_claims','user_id']
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
end $$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
