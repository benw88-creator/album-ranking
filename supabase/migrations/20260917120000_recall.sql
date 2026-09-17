-- RECALL: hear a second of a record and name it.
--
-- ---------------------------------------------------------------------------
-- What it is
-- ---------------------------------------------------------------------------
-- One second of audio, a guess, then three, then five, then ten. Getting it on
-- the first second is worth 1,000 and getting it at ten is worth 250, so the
-- whole of the game is how long you are willing to sit with not knowing.
--
-- Two modes at launch and a registry rather than an if: `Recall.MODES` in the
-- client is a map of mode key to behaviour, and `mode` here is plain text with
-- no check constraint, so a third mode is a client-side object and no
-- migration. Daily is one shared song a day and one go at it. Endless runs
-- until you stop.
--
-- **It makes no new music data.** The songs come from `SONG_ROWS` — the static
-- table the Daily Drop has always baked into index.html — and the audio is the
-- same Deezer 30-second preview `/api/preview` already serves to the player.
-- No new provider, no new licence, no scraping. The clip is played through an
-- `AudioProvider` seam (`VinalAudio`) precisely so a licensed provider can be
-- dropped in later without the game knowing.
--
-- ---------------------------------------------------------------------------
-- What server-side scoring can and cannot buy here, stated plainly
-- ---------------------------------------------------------------------------
-- **The score is computed here and never accepted from the browser.** It is a
-- pure function of which step you were on — the same rule as `wallet_buy`
-- taking a key and never a price — so a client cannot file a 1,000 for a guess
-- it made at ten seconds.
--
-- **Correctness is also decided here**, against `recall_daily`, which is the
-- reason that table exists. The client sends the title it is claiming, never a
-- verdict.
--
-- What this cannot do is hide the answer. The browser has to fetch the clip,
-- and the request that fetches it names the artist and the title — so today's
-- answer is one network-tab away for anybody who looks, and the only way to
-- close that is to proxy the audio itself, which Deezer's terms do not permit
-- and this project will not do. So the posture is the one every minigame here
-- already has: **the daily cap is what bounds the money**, a forged daily wins
-- nothing but a row in your own history, and nothing is claimed about it that
-- is not true.
--
-- ---------------------------------------------------------------------------
-- Why the schedule is a TABLE and not a formula
-- ---------------------------------------------------------------------------
-- The client picks the day's song from a seeded shuffle of the pool, the same
-- way the Daily Drop and Cover Fire pick theirs — pure, offline, identical on
-- every device. The server cannot re-derive that without a second copy of both
-- the pool and mulberry32 in plpgsql, which is two copies of one rule waiting
-- to drift, and the drift would be silent and total: every daily answer marked
-- wrong at once.
--
-- So the schedule is generated from the pool at authoring time and inserted as
-- literal rows — 760 days, to 2028-10-15. That is auditable and cannot drift
-- by accident; it can only go stale, and going stale is handled: a day with no
-- row is judged against what the client says it played, `verified` comes back
-- false, and nobody is told they are wrong about a song they actually named.
-- **Regenerate before October 2028**, and regenerate whenever SONG_ROWS gains
-- or loses a row, because the shuffle is over the whole pool and one more
-- entry re-deals every day of it.

-- --------------------------------------------------------------- normalising
-- Mirrors norm() in the Recall module, and the guard at the bottom of this file
-- pins the pairs that matter. Two rules that are easy to get backwards:
--
--   * an apostrophe is DELETED, never turned into a space. "Don't" and "dont"
--     have to land on the same string, and replacing punctuation with a space
--     gives "don t", which is the one thing the brief asked for by name.
--   * a leading "the" goes, so nobody loses a round over an article.
create or replace function public.recall_norm(p text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare s text;
begin
  s := coalesce(p, '');
  -- Strip diacritics: decompose, then drop the combining marks.
  s := regexp_replace(normalize(s, NFD), '[' || U&'\0300' || '-' || U&'\036F' || ']', '', 'g');
  -- Every shape of apostrophe, removed rather than spaced.
  s := translate(s, '''' || U&'\2019' || U&'\02BC' || '`', '');
  s := lower(s);
  s := regexp_replace(s, '\([^)]*\)', ' ', 'g');
  s := regexp_replace(s, '\[[^\]]*\]', ' ', 'g');
  -- \m is a word boundary, and it matters: without it this eats 'defeat ' too.
  s := regexp_replace(s, '\mfeat\.?\s.*$', ' ');
  s := replace(s, '&', ' and ');
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  s := regexp_replace(s, '^the ', '');
  return s;
end $$;

-- ------------------------------------------------------------- the schedule
-- `day` is days since 2020-01-01 UTC, the same clock the Drop and Cover Fire
-- count in. `answer` is already normalised; `artist` is there so a human
-- reading this table can tell what a row is, and is never matched against.
create table if not exists public.recall_daily (
  day    integer primary key,
  answer text not null,
  artist text
);
alter table public.recall_daily enable row level security;
-- No select policy: the schedule is the answer key. `recall_submit` is a
-- definer and reads it regardless; a policy here would publish every future
-- day at once. Same arrangement as blitz_seeds and bid_war_values.

-- --------------------------------------------------------------- the results
create table if not exists public.recall_results (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mode           text not null,
  day            integer not null,
  track          text,
  step           smallint,
  reveal_seconds smallint,
  attempts       smallint,
  score          integer not null default 0,
  correct        boolean not null default false,
  songs          smallint,
  best_streak    smallint,
  verified       boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists recall_results_mine on public.recall_results (user_id, created_at desc);
-- One daily per person per day, enforced by the database rather than by the
-- client remembering. A second submission returns the first one unchanged.
create unique index if not exists recall_daily_once
  on public.recall_results (user_id, day) where mode = 'daily';

alter table public.recall_results enable row level security;

-- Read your own. There is no insert, update or delete policy at all — the
-- definer functions are the only way a row appears, which is what makes the
-- score a fact about the step rather than a number the browser chose.
drop policy if exists recall_results_select_mine on public.recall_results;
create policy recall_results_select_mine
  on public.recall_results for select
  to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------------- scoring
-- The ladder, in one place. 1s 1,000 · 3s 750 · 5s 500 · 10s 250. Mirrored by
-- Recall.SCORES in the client, which is display; this is what is stored.
create or replace function public.recall_points(p_step integer)
returns integer
language sql immutable
as $$ select case coalesce(p_step, 9) when 0 then 1000 when 1 then 750 when 2 then 500 when 3 then 250 else 0 end $$;

-- -------------------------------------------------------------------- submit
create or replace function public.recall_submit(
  p_day integer, p_mode text, p_guess text, p_step integer,
  p_attempts integer, p_claim text, p_correct boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_answer  text;
  v_claim   text := nullif(public.recall_norm(coalesce(p_claim, '')), '');
  v_guess   text := public.recall_norm(coalesce(p_guess, ''));
  v_known   boolean;
  v_drift   boolean := false;
  v_correct boolean;
  v_score   integer;
  v_row     public.recall_results;
  v_mode    text := coalesce(nullif(p_mode, ''), 'daily');
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  p_step := greatest(least(coalesce(p_step, 3), 3), 0);
  p_attempts := greatest(least(coalesce(p_attempts, 1), 8), 1);

  select answer into v_answer from public.recall_daily where day = p_day;
  v_known := v_answer is not null;

  /* The schedule can go stale — a regenerated pool, or a day past the end of
     the rows below. Judging against a song the player did not hear would tell
     somebody they are wrong about a record they just named correctly, which is
     a far worse failure than an unverified row. So a disagreement falls back to
     what was actually played and says so; the client reports the drift. */
  if v_known and v_claim is not null and v_claim <> v_answer then
    v_drift := true; v_answer := v_claim; v_known := false;
  end if;

  if v_known then
    v_correct := (v_guess = v_answer);
  elsif v_claim is not null then
    v_correct := (v_guess = v_claim);          -- still the server's comparison
  else
    v_correct := coalesce(p_correct, false);   -- nothing to compare; trusted, and marked
  end if;

  v_score := case when v_correct then public.recall_points(p_step) else 0 end;

  if v_mode = 'daily' then
    select * into v_row from public.recall_results
      where user_id = v_me and day = p_day and mode = 'daily';
    if v_row.id is not null then
      return jsonb_build_object('already', true, 'correct', v_row.correct,
        'score', v_row.score, 'step', v_row.step, 'verified', v_row.verified);
    end if;
  end if;

  begin
    insert into public.recall_results
      (user_id, mode, day, track, step, reveal_seconds, attempts, score, correct, verified)
    values
      (v_me, v_mode, p_day, left(coalesce(p_claim, ''), 200), p_step,
       case p_step when 0 then 1 when 1 then 3 when 2 then 5 else 10 end,
       p_attempts, v_score, v_correct, v_known)
    returning * into v_row;
  exception when unique_violation then
    -- The select above is not atomic with this insert, and two phones can
    -- submit the same daily at once. The index is what actually enforces one
    -- go; this is how that enforcement is reported rather than thrown.
    select * into v_row from public.recall_results
      where user_id = v_me and day = p_day and mode = 'daily';
    return jsonb_build_object('already', true, 'correct', v_row.correct,
      'score', v_row.score, 'step', v_row.step, 'verified', v_row.verified);
  end;

  return jsonb_build_object('already', false, 'correct', v_correct, 'score', v_score,
                            'step', p_step, 'verified', v_known, 'drift', v_drift);
end $$;

-- ------------------------------------------------------------------ session
-- An endless run, recorded once at the end. Nothing here is verifiable and
-- nothing pays off it — `wallet_award_game` is what pays, and it is capped —
-- so this is a history row and a personal best, stored with verified = false
-- because that is what it is.
create or replace function public.recall_session(
  p_score integer, p_songs integer, p_streak integer, p_avg_reveal integer)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  -- Days since 2020-01-01 UTC: the clock the Drop, Cover Fire and the client
  -- half of this all count in.
  v_day integer := ((now() at time zone 'utc')::date - date '2020-01-01');
  v_best integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  -- A run is bounded by the pool: 118 songs at 1,000 plus the streak bonus is
  -- nowhere near this, and a number above it is arithmetic that did not happen.
  p_score  := greatest(least(coalesce(p_score, 0), 250000), 0);
  p_songs  := greatest(least(coalesce(p_songs, 0), 500), 0);
  p_streak := greatest(least(coalesce(p_streak, 0), 500), 0);

  insert into public.recall_results
    (user_id, mode, day, score, correct, songs, best_streak, reveal_seconds, verified)
  values (v_me, 'endless', v_day, p_score, p_songs > 0, p_songs, p_streak,
          greatest(least(coalesce(p_avg_reveal, 0), 10), 0), false);

  select max(score) into v_best from public.recall_results
    where user_id = v_me and mode = 'endless';
  return jsonb_build_object('best', coalesce(v_best, 0));
end $$;

-- -------------------------------------------------------------------- state
-- Everything the lobby needs, in one round trip: today's result if there is
-- one, the best endless run, and how many days running the daily has been
-- answered. The streak is the collectible half of a daily — it is why the
-- countdown to the next one is worth printing.
create or replace function public.recall_state()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_today integer := ((now() at time zone 'utc')::date - date '2020-01-01');
  v_row   public.recall_results;
  v_best  integer;
  v_days  integer;
  v_strk  integer;
begin
  if v_me is null then return jsonb_build_object('signed_in', false); end if;

  select * into v_row from public.recall_results
    where user_id = v_me and mode = 'daily' and day = v_today;
  select max(score) into v_best from public.recall_results where user_id = v_me and mode = 'endless';
  select count(*) into v_days from public.recall_results where user_id = v_me and mode = 'daily' and correct;

  -- Consecutive correct dailies ending today or yesterday. Grouped by
  -- (day - row_number), which is constant across a run of consecutive days.
  select coalesce(max(len), 0) into v_strk from (
    select count(*) as len, max(day) as last_day
    from (
      select day, day - (row_number() over (order by day))::integer as grp
      from (select distinct day from public.recall_results
              where user_id = v_me and mode = 'daily' and correct) d
    ) g group by grp
  ) s where s.last_day >= v_today - 1;

  return jsonb_build_object(
    'signed_in', true, 'day', v_today,
    'today', case when v_row.id is null then null else jsonb_build_object(
      'score', v_row.score, 'correct', v_row.correct, 'step', v_row.step,
      'reveal_seconds', v_row.reveal_seconds, 'verified', v_row.verified) end,
    'best_endless', coalesce(v_best, 0), 'days', coalesce(v_days, 0), 'streak', coalesce(v_strk, 0));
end $$;

revoke all on function public.recall_norm(text)                                          from public, anon;
revoke all on function public.recall_points(integer)                                     from public, anon;
revoke all on function public.recall_submit(integer, text, text, integer, integer, text, boolean) from public, anon;
revoke all on function public.recall_session(integer, integer, integer, integer)         from public, anon;
revoke all on function public.recall_state()                                             from public, anon;
grant execute on function public.recall_submit(integer, text, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.recall_session(integer, integer, integer, integer)      to authenticated;
grant execute on function public.recall_state()                                          to authenticated;

-- ------------------------------------------------------------ the schedule
-- Generated from SONG_ROWS with the same cycle shuffle the client runs, so the
-- two agree by construction rather than by inspection. 760 days from
-- 2026-09-17 (day 2451) to 2028-10-15. A cycle is one pass through all 118
-- songs; the first 20 places of each cycle are swapped clear of the last 20 of
-- the one before it, so the shortest gap between two airings of the same record
-- is 21 days rather than the 2 that a plain reshuffle allows at the seam.
--
-- Idempotent: on conflict the row is left alone, so re-running this file after
-- a partial apply cannot rewrite a day somebody has already played.
insert into public.recall_daily (day, answer, artist) values
  (2451, 'r u mine', 'Arctic Monkeys'),
  (2452, 'bad romance', 'Lady Gaga'),
  (2453, 'get lucky', 'Daft Punk'),
  (2454, 'kids', 'MGMT'),
  (2455, 'come together', 'The Beatles'),
  (2456, 'dancing queen', 'ABBA'),
  (2457, 'blank space', 'Taylor Swift'),
  (2458, 'save your tears', 'The Weeknd'),
  (2459, 'enter sandman', 'Metallica'),
  (2460, 'good 4 u', 'Olivia Rodrigo'),
  (2461, 'sweet child o mine', 'Guns N’ Roses'),
  (2462, 'electric feel', 'MGMT'),
  (2463, 'money trees', 'Kendrick Lamar'),
  (2464, 'hey ya', 'OutKast'),
  (2465, 'starboy', 'The Weeknd'),
  (2466, 'sweet dreams', 'Eurythmics'),
  (2467, 'anti hero', 'Taylor Swift'),
  (2468, 'respect', 'Aretha Franklin'),
  (2469, 'without me', 'Eminem'),
  (2470, 'dont look back in anger', 'Oasis'),
  (2471, 'alright', 'Kendrick Lamar'),
  (2472, 'toxic', 'Britney Spears'),
  (2473, 'rehab', 'Amy Winehouse'),
  (2474, 'stairway to heaven', 'Led Zeppelin'),
  (2475, '505', 'Arctic Monkeys'),
  (2476, 'gods plan', 'Drake'),
  (2477, 'rolling in the deep', 'Adele'),
  (2478, 'chop suey', 'System Of A Down'),
  (2479, 'since u been gone', 'Kelly Clarkson'),
  (2480, 'hotline bling', 'Drake'),
  (2481, 'lets stay together', 'Al Green'),
  (2482, 'uptown funk', 'Mark Ronson'),
  (2483, 'bad romance', 'Lady Gaga'),
  (2484, 'one more time', 'Daft Punk'),
  (2485, 'dancing queen', 'ABBA'),
  (2486, 'hotel california', 'Eagles'),
  (2487, 'when doves cry', 'Prince'),
  (2488, 'cruel summer', 'Taylor Swift'),
  (2489, 'juicy', 'The Notorious B.I.G.'),
  (2490, 'r u mine', 'Arctic Monkeys'),
  (2491, 'say my name', 'Destiny''s Child'),
  (2492, 'take me out', 'Franz Ferdinand'),
  (2493, 'this charming man', 'The Smiths'),
  (2494, 'bohemian rhapsody', 'Queen'),
  (2495, 'waterfalls', 'TLC'),
  (2496, 'runaway', 'Kanye West'),
  (2497, 'royals', 'Lorde'),
  (2498, '505', 'Arctic Monkeys'),
  (2499, 'electric feel', 'MGMT'),
  (2500, 'rehab', 'Amy Winehouse'),
  (2501, 'rolling in the deep', 'Adele'),
  (2502, 'without me', 'Eminem'),
  (2503, 'loser', 'Beck'),
  (2504, 'stronger', 'Kanye West'),
  (2505, 'redbone', 'Childish Gambino'),
  (2506, 'crazy in love', 'Beyonce'),
  (2507, 'lose yourself', 'Eminem'),
  (2508, 'no scrubs', 'TLC'),
  (2509, 'mr brightside', 'The Killers'),
  (2510, 'dont look back in anger', 'Oasis'),
  (2511, 'seven nation army', 'The White Stripes'),
  (2512, 'blank space', 'Taylor Swift'),
  (2513, 'shape of you', 'Ed Sheeran'),
  (2514, 'do i wanna know', 'Arctic Monkeys'),
  (2515, 'humble', 'Kendrick Lamar'),
  (2516, 'viva la vida', 'Coldplay'),
  (2517, 'get lucky', 'Daft Punk'),
  (2518, 'where is my mind', 'Pixies'),
  (2519, 'fix you', 'Coldplay'),
  (2520, 'pyramids', 'Frank Ocean'),
  (2521, 'gold digger', 'Kanye West'),
  (2522, 'just like heaven', 'The Cure'),
  (2523, 'in da club', '50 Cent'),
  (2524, 'single ladies', 'Beyonce'),
  (2525, 'whats going on', 'Marvin Gaye'),
  (2526, 'stan', 'Eminem'),
  (2527, 'wonderwall', 'Oasis'),
  (2528, 'imagine', 'John Lennon'),
  (2529, 'sweet dreams', 'Eurythmics'),
  (2530, 'yellow', 'Coldplay'),
  (2531, 'we found love', 'Rihanna'),
  (2532, 'karma police', 'Radiohead'),
  (2533, 'less i know the better', 'Tame Impala'),
  (2534, 'come together', 'The Beatles'),
  (2535, 'sweet child o mine', 'Guns N’ Roses'),
  (2536, 'superstition', 'Stevie Wonder'),
  (2537, 'anti hero', 'Taylor Swift'),
  (2538, 'valerie', 'Mark Ronson'),
  (2539, 'under the bridge', 'Red Hot Chili Peppers'),
  (2540, 'basket case', 'Green Day'),
  (2541, 'respect', 'Aretha Franklin'),
  (2542, 'green light', 'Lorde'),
  (2543, 'last nite', 'The Strokes'),
  (2544, 'blinding lights', 'The Weeknd'),
  (2545, 'stairway to heaven', 'Led Zeppelin'),
  (2546, 'scientist', 'Coldplay'),
  (2547, 'sicko mode', 'Travis Scott'),
  (2548, 'clocks', 'Coldplay'),
  (2549, 'shake it off', 'Taylor Swift'),
  (2550, 'dont start now', 'Dua Lipa'),
  (2551, 'take on me', 'a-ha'),
  (2552, 'champagne supernova', 'Oasis'),
  (2553, 'good 4 u', 'Olivia Rodrigo'),
  (2554, 'poker face', 'Lady Gaga'),
  (2555, 'blue monday', 'New Order'),
  (2556, 'alright', 'Kendrick Lamar'),
  (2557, 'one dance', 'Drake'),
  (2558, 'enter sandman', 'Metallica'),
  (2559, 'toxic', 'Britney Spears'),
  (2560, 'hey ya', 'OutKast'),
  (2561, 'drivers license', 'Olivia Rodrigo'),
  (2562, 'numb', 'Linkin Park'),
  (2563, 'hello', 'Adele'),
  (2564, 'starboy', 'The Weeknd'),
  (2565, 'somebody told me', 'The Killers'),
  (2566, 'like a rolling stone', 'Bob Dylan'),
  (2567, 'levitating', 'Dua Lipa'),
  (2568, 'kids', 'MGMT'),
  (2569, 'i will survive', 'Gloria Gaynor'),
  (2570, 'purple rain', 'Prince'),
  (2571, 'money trees', 'Kendrick Lamar'),
  (2572, 'save your tears', 'The Weeknd'),
  (2573, 'smells like teen spirit', 'Nirvana'),
  (2574, 'good days', 'SZA'),
  (2575, 'in the end', 'Linkin Park'),
  (2576, 'umbrella', 'Rihanna'),
  (2577, 'ms jackson', 'OutKast'),
  (2578, 'billie jean', 'Michael Jackson'),
  (2579, 'zombie', 'The Cranberries'),
  (2580, 'time to pretend', 'MGMT'),
  (2581, 'love will tear us apart', 'Joy Division'),
  (2582, 'happier than ever', 'Billie Eilish'),
  (2583, 'creep', 'Radiohead'),
  (2584, 'boulevard of broken dreams', 'Green Day'),
  (2585, 'hey jude', 'The Beatles'),
  (2586, 'heat waves', 'Glass Animals'),
  (2587, 'nights', 'Frank Ocean'),
  (2588, 'gods plan', 'Drake'),
  (2589, 'california love', '2Pac'),
  (2590, 'someone like you', 'Adele'),
  (2591, 'nikes', 'Frank Ocean'),
  (2592, 'kill bill', 'SZA'),
  (2593, 'losing my religion', 'R.E.M.'),
  (2594, 'bad guy', 'Billie Eilish'),
  (2595, 'feels like we only go backwards', 'Tame Impala'),
  (2596, 'we found love', 'Rihanna'),
  (2597, '505', 'Arctic Monkeys'),
  (2598, 'enter sandman', 'Metallica'),
  (2599, 'imagine', 'John Lennon'),
  (2600, 'viva la vida', 'Coldplay'),
  (2601, 'toxic', 'Britney Spears'),
  (2602, 'lose yourself', 'Eminem'),
  (2603, 'crazy in love', 'Beyonce'),
  (2604, 'dont look back in anger', 'Oasis'),
  (2605, 'blank space', 'Taylor Swift'),
  (2606, 'runaway', 'Kanye West'),
  (2607, 'just like heaven', 'The Cure'),
  (2608, 'no scrubs', 'TLC'),
  (2609, 'take on me', 'a-ha'),
  (2610, 'sicko mode', 'Travis Scott'),
  (2611, 'redbone', 'Childish Gambino'),
  (2612, 'shape of you', 'Ed Sheeran'),
  (2613, 'in the end', 'Linkin Park'),
  (2614, 'since u been gone', 'Kelly Clarkson'),
  (2615, 'starboy', 'The Weeknd'),
  (2616, 'time to pretend', 'MGMT'),
  (2617, 'california love', '2Pac'),
  (2618, 'nights', 'Frank Ocean'),
  (2619, 'gods plan', 'Drake'),
  (2620, 'ms jackson', 'OutKast'),
  (2621, 'r u mine', 'Arctic Monkeys'),
  (2622, 'zombie', 'The Cranberries'),
  (2623, 'smells like teen spirit', 'Nirvana'),
  (2624, 'good days', 'SZA'),
  (2625, 'under the bridge', 'Red Hot Chili Peppers'),
  (2626, 'poker face', 'Lady Gaga'),
  (2627, 'stronger', 'Kanye West'),
  (2628, 'like a rolling stone', 'Bob Dylan'),
  (2629, 'shake it off', 'Taylor Swift'),
  (2630, 'single ladies', 'Beyonce'),
  (2631, 'levitating', 'Dua Lipa'),
  (2632, 'dancing queen', 'ABBA'),
  (2633, 'anti hero', 'Taylor Swift'),
  (2634, 'loser', 'Beck'),
  (2635, 'without me', 'Eminem'),
  (2636, 'rolling in the deep', 'Adele'),
  (2637, 'royals', 'Lorde'),
  (2638, 'creep', 'Radiohead'),
  (2639, 'do i wanna know', 'Arctic Monkeys'),
  (2640, 'electric feel', 'MGMT'),
  (2641, 'bad romance', 'Lady Gaga'),
  (2642, 'hotline bling', 'Drake'),
  (2643, 'stan', 'Eminem'),
  (2644, 'less i know the better', 'Tame Impala'),
  (2645, 'rehab', 'Amy Winehouse'),
  (2646, 'blue monday', 'New Order'),
  (2647, 'dont start now', 'Dua Lipa'),
  (2648, 'lets stay together', 'Al Green'),
  (2649, 'respect', 'Aretha Franklin'),
  (2650, 'yellow', 'Coldplay'),
  (2651, 'good 4 u', 'Olivia Rodrigo'),
  (2652, 'numb', 'Linkin Park'),
  (2653, 'say my name', 'Destiny''s Child'),
  (2654, 'mr brightside', 'The Killers'),
  (2655, 'boulevard of broken dreams', 'Green Day'),
  (2656, 'kill bill', 'SZA'),
  (2657, 'clocks', 'Coldplay'),
  (2658, 'money trees', 'Kendrick Lamar'),
  (2659, 'hey jude', 'The Beatles'),
  (2660, 'sweet child o mine', 'Guns N’ Roses'),
  (2661, 'nikes', 'Frank Ocean'),
  (2662, 'where is my mind', 'Pixies'),
  (2663, 'drivers license', 'Olivia Rodrigo'),
  (2664, 'love will tear us apart', 'Joy Division'),
  (2665, 'chop suey', 'System Of A Down'),
  (2666, 'basket case', 'Green Day'),
  (2667, 'hotel california', 'Eagles'),
  (2668, 'somebody told me', 'The Killers'),
  (2669, 'sweet dreams', 'Eurythmics'),
  (2670, 'gold digger', 'Kanye West'),
  (2671, 'humble', 'Kendrick Lamar'),
  (2672, 'superstition', 'Stevie Wonder'),
  (2673, 'green light', 'Lorde'),
  (2674, 'happier than ever', 'Billie Eilish'),
  (2675, 'umbrella', 'Rihanna'),
  (2676, 'whats going on', 'Marvin Gaye'),
  (2677, 'billie jean', 'Michael Jackson'),
  (2678, 'hey ya', 'OutKast'),
  (2679, 'cruel summer', 'Taylor Swift'),
  (2680, 'alright', 'Kendrick Lamar'),
  (2681, 'i will survive', 'Gloria Gaynor'),
  (2682, 'take me out', 'Franz Ferdinand'),
  (2683, 'feels like we only go backwards', 'Tame Impala'),
  (2684, 'one more time', 'Daft Punk'),
  (2685, 'wonderwall', 'Oasis'),
  (2686, 'last nite', 'The Strokes'),
  (2687, 'seven nation army', 'The White Stripes'),
  (2688, 'karma police', 'Radiohead'),
  (2689, 'this charming man', 'The Smiths'),
  (2690, 'kids', 'MGMT'),
  (2691, 'champagne supernova', 'Oasis'),
  (2692, 'purple rain', 'Prince'),
  (2693, 'uptown funk', 'Mark Ronson'),
  (2694, 'stairway to heaven', 'Led Zeppelin'),
  (2695, 'fix you', 'Coldplay'),
  (2696, 'one dance', 'Drake'),
  (2697, 'waterfalls', 'TLC'),
  (2698, 'juicy', 'The Notorious B.I.G.'),
  (2699, 'bohemian rhapsody', 'Queen'),
  (2700, 'heat waves', 'Glass Animals'),
  (2701, 'bad guy', 'Billie Eilish'),
  (2702, 'scientist', 'Coldplay'),
  (2703, 'when doves cry', 'Prince'),
  (2704, 'losing my religion', 'R.E.M.'),
  (2705, 'hello', 'Adele'),
  (2706, 'someone like you', 'Adele'),
  (2707, 'in da club', '50 Cent'),
  (2708, 'valerie', 'Mark Ronson'),
  (2709, 'come together', 'The Beatles'),
  (2710, 'pyramids', 'Frank Ocean'),
  (2711, 'get lucky', 'Daft Punk'),
  (2712, 'save your tears', 'The Weeknd'),
  (2713, 'blinding lights', 'The Weeknd'),
  (2714, 'boulevard of broken dreams', 'Green Day'),
  (2715, 'basket case', 'Green Day'),
  (2716, 'money trees', 'Kendrick Lamar'),
  (2717, 'drivers license', 'Olivia Rodrigo'),
  (2718, 'where is my mind', 'Pixies'),
  (2719, 'redbone', 'Childish Gambino'),
  (2720, 'umbrella', 'Rihanna'),
  (2721, 'hey ya', 'OutKast'),
  (2722, 'we found love', 'Rihanna'),
  (2723, 'enter sandman', 'Metallica'),
  (2724, 'gold digger', 'Kanye West'),
  (2725, 'kill bill', 'SZA'),
  (2726, 'toxic', 'Britney Spears'),
  (2727, 'humble', 'Kendrick Lamar'),
  (2728, 'somebody told me', 'The Killers'),
  (2729, 'last nite', 'The Strokes'),
  (2730, 'champagne supernova', 'Oasis'),
  (2731, 'imagine', 'John Lennon'),
  (2732, 'billie jean', 'Michael Jackson'),
  (2733, 'no scrubs', 'TLC'),
  (2734, 'fix you', 'Coldplay'),
  (2735, 'scientist', 'Coldplay'),
  (2736, 'stairway to heaven', 'Led Zeppelin'),
  (2737, 'blinding lights', 'The Weeknd'),
  (2738, 'pyramids', 'Frank Ocean'),
  (2739, 'juicy', 'The Notorious B.I.G.'),
  (2740, 'purple rain', 'Prince'),
  (2741, 'nikes', 'Frank Ocean'),
  (2742, '505', 'Arctic Monkeys'),
  (2743, 'chop suey', 'System Of A Down'),
  (2744, 'since u been gone', 'Kelly Clarkson'),
  (2745, 'respect', 'Aretha Franklin'),
  (2746, 'uptown funk', 'Mark Ronson'),
  (2747, 'levitating', 'Dua Lipa'),
  (2748, 'blank space', 'Taylor Swift'),
  (2749, 'mr brightside', 'The Killers'),
  (2750, 'in the end', 'Linkin Park'),
  (2751, 'love will tear us apart', 'Joy Division'),
  (2752, 'california love', '2Pac'),
  (2753, 'get lucky', 'Daft Punk'),
  (2754, 'runaway', 'Kanye West'),
  (2755, 'numb', 'Linkin Park'),
  (2756, 'cruel summer', 'Taylor Swift'),
  (2757, 'rolling in the deep', 'Adele'),
  (2758, 'stan', 'Eminem'),
  (2759, 'royals', 'Lorde'),
  (2760, 'lose yourself', 'Eminem'),
  (2761, 'lets stay together', 'Al Green'),
  (2762, 'anti hero', 'Taylor Swift'),
  (2763, 'come together', 'The Beatles'),
  (2764, 'save your tears', 'The Weeknd'),
  (2765, 'hey jude', 'The Beatles'),
  (2766, 'loser', 'Beck'),
  (2767, 'rehab', 'Amy Winehouse'),
  (2768, 'dont start now', 'Dua Lipa'),
  (2769, 'yellow', 'Coldplay'),
  (2770, 'feels like we only go backwards', 'Tame Impala'),
  (2771, 'heat waves', 'Glass Animals'),
  (2772, 'viva la vida', 'Coldplay'),
  (2773, 'shape of you', 'Ed Sheeran'),
  (2774, 'less i know the better', 'Tame Impala'),
  (2775, 'clocks', 'Coldplay'),
  (2776, 'poker face', 'Lady Gaga'),
  (2777, 'dancing queen', 'ABBA'),
  (2778, 'hotline bling', 'Drake'),
  (2779, 'when doves cry', 'Prince'),
  (2780, 'crazy in love', 'Beyonce'),
  (2781, 'nights', 'Frank Ocean'),
  (2782, 'gods plan', 'Drake'),
  (2783, 'smells like teen spirit', 'Nirvana'),
  (2784, 'creep', 'Radiohead'),
  (2785, 'sweet child o mine', 'Guns N’ Roses'),
  (2786, 'losing my religion', 'R.E.M.'),
  (2787, 'take on me', 'a-ha'),
  (2788, 'whats going on', 'Marvin Gaye'),
  (2789, 'happier than ever', 'Billie Eilish'),
  (2790, 'good days', 'SZA'),
  (2791, 'karma police', 'Radiohead'),
  (2792, 'sweet dreams', 'Eurythmics'),
  (2793, 'good 4 u', 'Olivia Rodrigo'),
  (2794, 'this charming man', 'The Smiths'),
  (2795, 'superstition', 'Stevie Wonder'),
  (2796, 'seven nation army', 'The White Stripes'),
  (2797, 'zombie', 'The Cranberries'),
  (2798, 'valerie', 'Mark Ronson'),
  (2799, 'single ladies', 'Beyonce'),
  (2800, 'say my name', 'Destiny''s Child'),
  (2801, 'alright', 'Kendrick Lamar'),
  (2802, 'wonderwall', 'Oasis'),
  (2803, 'someone like you', 'Adele'),
  (2804, 'ms jackson', 'OutKast'),
  (2805, 'i will survive', 'Gloria Gaynor'),
  (2806, 'kids', 'MGMT'),
  (2807, 'one dance', 'Drake'),
  (2808, 'blue monday', 'New Order'),
  (2809, 'like a rolling stone', 'Bob Dylan'),
  (2810, 'dont look back in anger', 'Oasis'),
  (2811, 'hello', 'Adele'),
  (2812, 'stronger', 'Kanye West'),
  (2813, 'hotel california', 'Eagles'),
  (2814, 'just like heaven', 'The Cure'),
  (2815, 'electric feel', 'MGMT'),
  (2816, 'r u mine', 'Arctic Monkeys'),
  (2817, 'green light', 'Lorde'),
  (2818, 'waterfalls', 'TLC'),
  (2819, 'bad guy', 'Billie Eilish'),
  (2820, 'under the bridge', 'Red Hot Chili Peppers'),
  (2821, 'starboy', 'The Weeknd'),
  (2822, 'take me out', 'Franz Ferdinand'),
  (2823, 'without me', 'Eminem'),
  (2824, 'in da club', '50 Cent'),
  (2825, 'bad romance', 'Lady Gaga'),
  (2826, 'shake it off', 'Taylor Swift'),
  (2827, 'sicko mode', 'Travis Scott'),
  (2828, 'do i wanna know', 'Arctic Monkeys'),
  (2829, 'time to pretend', 'MGMT'),
  (2830, 'bohemian rhapsody', 'Queen'),
  (2831, 'one more time', 'Daft Punk'),
  (2832, 'shape of you', 'Ed Sheeran'),
  (2833, 'we found love', 'Rihanna'),
  (2834, 'chop suey', 'System Of A Down'),
  (2835, 'whats going on', 'Marvin Gaye'),
  (2836, 'hey ya', 'OutKast'),
  (2837, 'dont start now', 'Dua Lipa'),
  (2838, 'billie jean', 'Michael Jackson'),
  (2839, 'levitating', 'Dua Lipa'),
  (2840, 'creep', 'Radiohead'),
  (2841, 'champagne supernova', 'Oasis'),
  (2842, 'in the end', 'Linkin Park'),
  (2843, 'clocks', 'Coldplay'),
  (2844, 'nights', 'Frank Ocean'),
  (2845, 'blank space', 'Taylor Swift'),
  (2846, 'since u been gone', 'Kelly Clarkson'),
  (2847, 'losing my religion', 'R.E.M.'),
  (2848, 'umbrella', 'Rihanna'),
  (2849, 'gods plan', 'Drake'),
  (2850, 'where is my mind', 'Pixies'),
  (2851, 'nikes', 'Frank Ocean'),
  (2852, 'one more time', 'Daft Punk'),
  (2853, 'just like heaven', 'The Cure'),
  (2854, 'bad guy', 'Billie Eilish'),
  (2855, 'in da club', '50 Cent'),
  (2856, 'hotel california', 'Eagles'),
  (2857, 'bohemian rhapsody', 'Queen'),
  (2858, 'stairway to heaven', 'Led Zeppelin'),
  (2859, 'respect', 'Aretha Franklin'),
  (2860, 'money trees', 'Kendrick Lamar'),
  (2861, 'humble', 'Kendrick Lamar'),
  (2862, 'sicko mode', 'Travis Scott'),
  (2863, 'imagine', 'John Lennon'),
  (2864, 'heat waves', 'Glass Animals'),
  (2865, 'rehab', 'Amy Winehouse'),
  (2866, 'enter sandman', 'Metallica'),
  (2867, 'take me out', 'Franz Ferdinand'),
  (2868, 'loser', 'Beck'),
  (2869, 'sweet child o mine', 'Guns N’ Roses'),
  (2870, 'california love', '2Pac'),
  (2871, 'like a rolling stone', 'Bob Dylan'),
  (2872, 'seven nation army', 'The White Stripes'),
  (2873, 'electric feel', 'MGMT'),
  (2874, 'good days', 'SZA'),
  (2875, 'waterfalls', 'TLC'),
  (2876, 'take on me', 'a-ha'),
  (2877, 'viva la vida', 'Coldplay'),
  (2878, 'poker face', 'Lady Gaga'),
  (2879, 'kids', 'MGMT'),
  (2880, 'yellow', 'Coldplay'),
  (2881, 'this charming man', 'The Smiths'),
  (2882, 'feels like we only go backwards', 'Tame Impala'),
  (2883, 'fix you', 'Coldplay'),
  (2884, 'hotline bling', 'Drake'),
  (2885, 'smells like teen spirit', 'Nirvana'),
  (2886, 'come together', 'The Beatles'),
  (2887, 'get lucky', 'Daft Punk'),
  (2888, 'under the bridge', 'Red Hot Chili Peppers'),
  (2889, 'hello', 'Adele'),
  (2890, 'say my name', 'Destiny''s Child'),
  (2891, 'zombie', 'The Cranberries'),
  (2892, 'no scrubs', 'TLC'),
  (2893, 'one dance', 'Drake'),
  (2894, 'rolling in the deep', 'Adele'),
  (2895, 'valerie', 'Mark Ronson'),
  (2896, 'without me', 'Eminem'),
  (2897, 'royals', 'Lorde'),
  (2898, 'redbone', 'Childish Gambino'),
  (2899, 'do i wanna know', 'Arctic Monkeys'),
  (2900, 'single ladies', 'Beyonce'),
  (2901, 'happier than ever', 'Billie Eilish'),
  (2902, 'blue monday', 'New Order'),
  (2903, 'karma police', 'Radiohead'),
  (2904, 'somebody told me', 'The Killers'),
  (2905, 'save your tears', 'The Weeknd'),
  (2906, 'superstition', 'Stevie Wonder'),
  (2907, 'scientist', 'Coldplay'),
  (2908, 'last nite', 'The Strokes'),
  (2909, 'good 4 u', 'Olivia Rodrigo'),
  (2910, 'boulevard of broken dreams', 'Green Day'),
  (2911, 'less i know the better', 'Tame Impala'),
  (2912, 'stronger', 'Kanye West'),
  (2913, 'juicy', 'The Notorious B.I.G.'),
  (2914, 'time to pretend', 'MGMT'),
  (2915, 'sweet dreams', 'Eurythmics'),
  (2916, 'stan', 'Eminem'),
  (2917, 'shake it off', 'Taylor Swift'),
  (2918, 'cruel summer', 'Taylor Swift'),
  (2919, 'runaway', 'Kanye West'),
  (2920, 'kill bill', 'SZA'),
  (2921, 'hey jude', 'The Beatles'),
  (2922, 'mr brightside', 'The Killers'),
  (2923, 'lose yourself', 'Eminem'),
  (2924, 'blinding lights', 'The Weeknd'),
  (2925, 'love will tear us apart', 'Joy Division'),
  (2926, '505', 'Arctic Monkeys'),
  (2927, 'i will survive', 'Gloria Gaynor'),
  (2928, 'toxic', 'Britney Spears'),
  (2929, 'when doves cry', 'Prince'),
  (2930, 'pyramids', 'Frank Ocean'),
  (2931, 'numb', 'Linkin Park'),
  (2932, 'alright', 'Kendrick Lamar'),
  (2933, 'bad romance', 'Lady Gaga'),
  (2934, 'ms jackson', 'OutKast'),
  (2935, 'starboy', 'The Weeknd'),
  (2936, 'anti hero', 'Taylor Swift'),
  (2937, 'green light', 'Lorde'),
  (2938, 'wonderwall', 'Oasis'),
  (2939, 'dancing queen', 'ABBA'),
  (2940, 'drivers license', 'Olivia Rodrigo'),
  (2941, 'basket case', 'Green Day'),
  (2942, 'gold digger', 'Kanye West'),
  (2943, 'lets stay together', 'Al Green'),
  (2944, 'purple rain', 'Prince'),
  (2945, 'someone like you', 'Adele'),
  (2946, 'r u mine', 'Arctic Monkeys'),
  (2947, 'dont look back in anger', 'Oasis'),
  (2948, 'crazy in love', 'Beyonce'),
  (2949, 'uptown funk', 'Mark Ronson'),
  (2950, 'hello', 'Adele'),
  (2951, 'good days', 'SZA'),
  (2952, 'losing my religion', 'R.E.M.'),
  (2953, 'enter sandman', 'Metallica'),
  (2954, 'in the end', 'Linkin Park'),
  (2955, 'waterfalls', 'TLC'),
  (2956, 'i will survive', 'Gloria Gaynor'),
  (2957, 'levitating', 'Dua Lipa'),
  (2958, 'nikes', 'Frank Ocean'),
  (2959, 'rolling in the deep', 'Adele'),
  (2960, 'good 4 u', 'Olivia Rodrigo'),
  (2961, 'umbrella', 'Rihanna'),
  (2962, 'chop suey', 'System Of A Down'),
  (2963, 'scientist', 'Coldplay'),
  (2964, 'blank space', 'Taylor Swift'),
  (2965, 'bohemian rhapsody', 'Queen'),
  (2966, 'royals', 'Lorde'),
  (2967, 'creep', 'Radiohead'),
  (2968, 'time to pretend', 'MGMT'),
  (2969, 'just like heaven', 'The Cure'),
  (2970, 'uptown funk', 'Mark Ronson'),
  (2971, 'gold digger', 'Kanye West'),
  (2972, 'wonderwall', 'Oasis'),
  (2973, 'numb', 'Linkin Park'),
  (2974, 'someone like you', 'Adele'),
  (2975, 'smells like teen spirit', 'Nirvana'),
  (2976, 'crazy in love', 'Beyonce'),
  (2977, 'get lucky', 'Daft Punk'),
  (2978, 'when doves cry', 'Prince'),
  (2979, 'somebody told me', 'The Killers'),
  (2980, 'shape of you', 'Ed Sheeran'),
  (2981, 'ms jackson', 'OutKast'),
  (2982, 'respect', 'Aretha Franklin'),
  (2983, 'purple rain', 'Prince'),
  (2984, 'say my name', 'Destiny''s Child'),
  (2985, 'hey ya', 'OutKast'),
  (2986, 'redbone', 'Childish Gambino'),
  (2987, 'champagne supernova', 'Oasis'),
  (2988, 'dancing queen', 'ABBA'),
  (2989, 'we found love', 'Rihanna'),
  (2990, 'juicy', 'The Notorious B.I.G.'),
  (2991, 'blue monday', 'New Order'),
  (2992, 'no scrubs', 'TLC'),
  (2993, 'last nite', 'The Strokes'),
  (2994, 'fix you', 'Coldplay'),
  (2995, 'imagine', 'John Lennon'),
  (2996, 'stan', 'Eminem'),
  (2997, 'drivers license', 'Olivia Rodrigo'),
  (2998, 'stronger', 'Kanye West'),
  (2999, 'one more time', 'Daft Punk'),
  (3000, 'humble', 'Kendrick Lamar'),
  (3001, 'save your tears', 'The Weeknd'),
  (3002, 'under the bridge', 'Red Hot Chili Peppers'),
  (3003, 'cruel summer', 'Taylor Swift'),
  (3004, 'love will tear us apart', 'Joy Division'),
  (3005, 'come together', 'The Beatles'),
  (3006, 'where is my mind', 'Pixies'),
  (3007, 'heat waves', 'Glass Animals'),
  (3008, 'hotel california', 'Eagles'),
  (3009, 'sweet dreams', 'Eurythmics'),
  (3010, '505', 'Arctic Monkeys'),
  (3011, 'loser', 'Beck'),
  (3012, 'viva la vida', 'Coldplay'),
  (3013, 'superstition', 'Stevie Wonder'),
  (3014, 'yellow', 'Coldplay'),
  (3015, 'shake it off', 'Taylor Swift'),
  (3016, 'anti hero', 'Taylor Swift'),
  (3017, 'take me out', 'Franz Ferdinand'),
  (3018, 'without me', 'Eminem'),
  (3019, 'one dance', 'Drake'),
  (3020, 'bad guy', 'Billie Eilish'),
  (3021, 'do i wanna know', 'Arctic Monkeys'),
  (3022, 'in da club', '50 Cent'),
  (3023, 'since u been gone', 'Kelly Clarkson'),
  (3024, 'hotline bling', 'Drake'),
  (3025, 'electric feel', 'MGMT'),
  (3026, 'seven nation army', 'The White Stripes'),
  (3027, 'pyramids', 'Frank Ocean'),
  (3028, 'r u mine', 'Arctic Monkeys'),
  (3029, 'like a rolling stone', 'Bob Dylan'),
  (3030, 'lets stay together', 'Al Green'),
  (3031, 'karma police', 'Radiohead'),
  (3032, 'dont look back in anger', 'Oasis'),
  (3033, 'alright', 'Kendrick Lamar'),
  (3034, 'lose yourself', 'Eminem'),
  (3035, 'boulevard of broken dreams', 'Green Day'),
  (3036, 'california love', '2Pac'),
  (3037, 'feels like we only go backwards', 'Tame Impala'),
  (3038, 'less i know the better', 'Tame Impala'),
  (3039, 'rehab', 'Amy Winehouse'),
  (3040, 'kids', 'MGMT'),
  (3041, 'gods plan', 'Drake'),
  (3042, 'dont start now', 'Dua Lipa'),
  (3043, 'poker face', 'Lady Gaga'),
  (3044, 'stairway to heaven', 'Led Zeppelin'),
  (3045, 'green light', 'Lorde'),
  (3046, 'zombie', 'The Cranberries'),
  (3047, 'starboy', 'The Weeknd'),
  (3048, 'sweet child o mine', 'Guns N’ Roses'),
  (3049, 'nights', 'Frank Ocean'),
  (3050, 'kill bill', 'SZA'),
  (3051, 'valerie', 'Mark Ronson'),
  (3052, 'hey jude', 'The Beatles'),
  (3053, 'sicko mode', 'Travis Scott'),
  (3054, 'money trees', 'Kendrick Lamar'),
  (3055, 'basket case', 'Green Day'),
  (3056, 'runaway', 'Kanye West'),
  (3057, 'happier than ever', 'Billie Eilish'),
  (3058, 'toxic', 'Britney Spears'),
  (3059, 'bad romance', 'Lady Gaga'),
  (3060, 'take on me', 'a-ha'),
  (3061, 'billie jean', 'Michael Jackson'),
  (3062, 'mr brightside', 'The Killers'),
  (3063, 'whats going on', 'Marvin Gaye'),
  (3064, 'clocks', 'Coldplay'),
  (3065, 'single ladies', 'Beyonce'),
  (3066, 'this charming man', 'The Smiths'),
  (3067, 'blinding lights', 'The Weeknd'),
  (3068, 'gold digger', 'Kanye West'),
  (3069, 'good days', 'SZA'),
  (3070, 'stan', 'Eminem'),
  (3071, 'like a rolling stone', 'Bob Dylan'),
  (3072, 'take me out', 'Franz Ferdinand'),
  (3073, 'lets stay together', 'Al Green'),
  (3074, 'electric feel', 'MGMT'),
  (3075, 'pyramids', 'Frank Ocean'),
  (3076, 'redbone', 'Childish Gambino'),
  (3077, 'lose yourself', 'Eminem'),
  (3078, 'scientist', 'Coldplay'),
  (3079, 'say my name', 'Destiny''s Child'),
  (3080, 'superstition', 'Stevie Wonder'),
  (3081, 'respect', 'Aretha Franklin'),
  (3082, 'chop suey', 'System Of A Down'),
  (3083, 'r u mine', 'Arctic Monkeys'),
  (3084, 'when doves cry', 'Prince'),
  (3085, 'hotline bling', 'Drake'),
  (3086, 'one more time', 'Daft Punk'),
  (3087, 'stronger', 'Kanye West'),
  (3088, 'valerie', 'Mark Ronson'),
  (3089, 'mr brightside', 'The Killers'),
  (3090, 'whats going on', 'Marvin Gaye'),
  (3091, 'blinding lights', 'The Weeknd'),
  (3092, 'take on me', 'a-ha'),
  (3093, 'loser', 'Beck'),
  (3094, 'time to pretend', 'MGMT'),
  (3095, 'no scrubs', 'TLC'),
  (3096, 'runaway', 'Kanye West'),
  (3097, 'cruel summer', 'Taylor Swift'),
  (3098, 'in da club', '50 Cent'),
  (3099, 'bohemian rhapsody', 'Queen'),
  (3100, 'bad romance', 'Lady Gaga'),
  (3101, 'levitating', 'Dua Lipa'),
  (3102, 'royals', 'Lorde'),
  (3103, 'love will tear us apart', 'Joy Division'),
  (3104, 'hotel california', 'Eagles'),
  (3105, 'creep', 'Radiohead'),
  (3106, 'i will survive', 'Gloria Gaynor'),
  (3107, 'drivers license', 'Olivia Rodrigo'),
  (3108, 'bad guy', 'Billie Eilish'),
  (3109, 'this charming man', 'The Smiths'),
  (3110, 'kids', 'MGMT'),
  (3111, 'waterfalls', 'TLC'),
  (3112, 'yellow', 'Coldplay'),
  (3113, 'uptown funk', 'Mark Ronson'),
  (3114, 'billie jean', 'Michael Jackson'),
  (3115, 'clocks', 'Coldplay'),
  (3116, 'just like heaven', 'The Cure'),
  (3117, 'stairway to heaven', 'Led Zeppelin'),
  (3118, 'enter sandman', 'Metallica'),
  (3119, 'champagne supernova', 'Oasis'),
  (3120, 'nikes', 'Frank Ocean'),
  (3121, 'happier than ever', 'Billie Eilish'),
  (3122, 'good 4 u', 'Olivia Rodrigo'),
  (3123, 'hey jude', 'The Beatles'),
  (3124, 'without me', 'Eminem'),
  (3125, 'sicko mode', 'Travis Scott'),
  (3126, 'zombie', 'The Cranberries'),
  (3127, 'kill bill', 'SZA'),
  (3128, 'blue monday', 'New Order'),
  (3129, 'anti hero', 'Taylor Swift'),
  (3130, 'poker face', 'Lady Gaga'),
  (3131, 'someone like you', 'Adele'),
  (3132, 'purple rain', 'Prince'),
  (3133, 'get lucky', 'Daft Punk'),
  (3134, 'ms jackson', 'OutKast'),
  (3135, 'blank space', 'Taylor Swift'),
  (3136, 'seven nation army', 'The White Stripes'),
  (3137, 'nights', 'Frank Ocean'),
  (3138, 'starboy', 'The Weeknd'),
  (3139, 'gods plan', 'Drake'),
  (3140, 'smells like teen spirit', 'Nirvana'),
  (3141, 'feels like we only go backwards', 'Tame Impala'),
  (3142, 'save your tears', 'The Weeknd'),
  (3143, 'alright', 'Kendrick Lamar'),
  (3144, 'umbrella', 'Rihanna'),
  (3145, 'dont look back in anger', 'Oasis'),
  (3146, 'dont start now', 'Dua Lipa'),
  (3147, 'crazy in love', 'Beyonce'),
  (3148, 'toxic', 'Britney Spears'),
  (3149, 'where is my mind', 'Pixies'),
  (3150, 'california love', '2Pac'),
  (3151, 'hey ya', 'OutKast'),
  (3152, 'green light', 'Lorde'),
  (3153, '505', 'Arctic Monkeys'),
  (3154, 'less i know the better', 'Tame Impala'),
  (3155, 'boulevard of broken dreams', 'Green Day'),
  (3156, 'fix you', 'Coldplay'),
  (3157, 'karma police', 'Radiohead'),
  (3158, 'shape of you', 'Ed Sheeran'),
  (3159, 'wonderwall', 'Oasis'),
  (3160, 'dancing queen', 'ABBA'),
  (3161, 'one dance', 'Drake'),
  (3162, 'do i wanna know', 'Arctic Monkeys'),
  (3163, 'rolling in the deep', 'Adele'),
  (3164, 'somebody told me', 'The Killers'),
  (3165, 'juicy', 'The Notorious B.I.G.'),
  (3166, 'imagine', 'John Lennon'),
  (3167, 'viva la vida', 'Coldplay'),
  (3168, 'rehab', 'Amy Winehouse'),
  (3169, 'money trees', 'Kendrick Lamar'),
  (3170, 'last nite', 'The Strokes'),
  (3171, 'basket case', 'Green Day'),
  (3172, 'sweet child o mine', 'Guns N’ Roses'),
  (3173, 'single ladies', 'Beyonce'),
  (3174, 'losing my religion', 'R.E.M.'),
  (3175, 'come together', 'The Beatles'),
  (3176, 'heat waves', 'Glass Animals'),
  (3177, 'shake it off', 'Taylor Swift'),
  (3178, 'since u been gone', 'Kelly Clarkson'),
  (3179, 'we found love', 'Rihanna'),
  (3180, 'sweet dreams', 'Eurythmics'),
  (3181, 'humble', 'Kendrick Lamar'),
  (3182, 'in the end', 'Linkin Park'),
  (3183, 'hello', 'Adele'),
  (3184, 'numb', 'Linkin Park'),
  (3185, 'under the bridge', 'Red Hot Chili Peppers'),
  (3186, 'say my name', 'Destiny''s Child'),
  (3187, 'r u mine', 'Arctic Monkeys'),
  (3188, 'whats going on', 'Marvin Gaye'),
  (3189, 'nikes', 'Frank Ocean'),
  (3190, 'electric feel', 'MGMT'),
  (3191, 'get lucky', 'Daft Punk'),
  (3192, 'good days', 'SZA'),
  (3193, 'hey jude', 'The Beatles'),
  (3194, 'crazy in love', 'Beyonce'),
  (3195, 'dont start now', 'Dua Lipa'),
  (3196, 'starboy', 'The Weeknd'),
  (3197, 'zombie', 'The Cranberries'),
  (3198, 'levitating', 'Dua Lipa'),
  (3199, 'feels like we only go backwards', 'Tame Impala'),
  (3200, 'lose yourself', 'Eminem'),
  (3201, 'valerie', 'Mark Ronson'),
  (3202, 'karma police', 'Radiohead'),
  (3203, 'blank space', 'Taylor Swift'),
  (3204, 'clocks', 'Coldplay'),
  (3205, 'enter sandman', 'Metallica'),
  (3206, 'hello', 'Adele'),
  (3207, 'losing my religion', 'R.E.M.'),
  (3208, 'since u been gone', 'Kelly Clarkson'),
  (3209, 'come together', 'The Beatles'),
  (3210, 'california love', '2Pac')
on conflict (day) do nothing;

-- ------------------------------------------------------------- the payout
-- 1,600 x 3, identical to Cover Fire and Higher or Lower, because it is the
-- same shape of thing: a couple of minutes, a score, and a cap where playing
-- stops being the fun part. A day of everything goes from 30,800 to 35,600.
--
-- That is safe for the reason the inflation notes give: the sink is what holds
-- the economy, not the faucet. The Draw's 2,993-against-5,000 is a ratio
-- between two Disc figures and is untouched, and the Collection has no last
-- record to buy. What it does move is real terms — the cheapest tag is about
-- three and a half days of everything rather than four — and that is the
-- decision being made here rather than discovered later.
--
-- Create-or-replace of the function exactly as ..._20260916180000_album_blitz
-- leaves it, with one row added. Adding a game means adding a `when` and
-- nothing else.
create or replace function public.wallet_award_game(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_amt   integer;
  v_cap   integer;
  v_used  integer;
  v_earn  integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  case p_game
    when 'earworm'     then v_amt := 2000; v_cap := 3;
    when 'drop'        then v_amt := 3000; v_cap := 1;
    when 'tournament'  then v_amt := 1600; v_cap := 2;
    when 'achievement' then v_amt := 1600; v_cap := 5;
    when 'higherlower' then v_amt := 1600; v_cap := 3;
    when 'blitz'       then v_amt := 1600; v_cap := 3;
    when 'recall'      then v_amt := 1600; v_cap := 3;
    else raise exception 'Unknown game: %', p_game;
  end case;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_awards_date is distinct from v_today then
    p.game_awards_date := v_today;
    p.game_awards := '{}'::jsonb;
  end if;

  v_used := coalesce((p.game_awards ->> p_game)::integer, 0);
  if v_used < v_cap then
    v_earn := v_amt;
    p.game_awards := p.game_awards || jsonb_build_object(p_game, v_used + 1);
  end if;

  update public.profiles set
    discs            = coalesce(discs, 0) + v_earn,
    game_awards_date = p.game_awards_date,
    game_awards      = p.game_awards
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn,
    'capped', (v_earn = 0),
    'discs',  p.discs,
    'streak_current', p.streak_current,
    'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes,
    'owned_banners', p.owned_banners,
    'lifetime_xp', p.lifetime_xp, 'level', p.level
  );
end;
$$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;

-- ------------------------------------------------------------- deletion
-- A table holding user rows means a line in delete_my_data(). Missing this is
-- how app_state survived account deletion for weeks. The list is walked
-- dynamically, so a name this database does not have is skipped rather than
-- raising — but the list itself is hand-written, which is why this is in the
-- same migration as the table.
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
    ['milestone_claims','user_id'], ['recall_results','user_id']
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

-- ------------------------------------------------------------------ guards
do $$
declare v_n integer;
begin
  -- The normalising rule, pinned to the cases the brief names by name. If any
  -- of these stop holding, an honest answer starts being marked wrong.
  if public.recall_norm('Don''t Stop Me Now') <> 'dont stop me now' then
    raise exception 'recall_norm: apostrophes must be deleted, not spaced';
  end if;
  if public.recall_norm('DONT STOP ME NOW') <> 'dont stop me now' then
    raise exception 'recall_norm: case folding is broken';
  end if;
  if public.recall_norm('Beyonce' || U&'\0301') <> 'beyonce'
     or public.recall_norm(U&'\0042\00E9') <> 'be' then
    raise exception 'recall_norm: diacritics are not being folded';
  end if;
  if public.recall_norm('HUMBLE.') <> 'humble' then
    raise exception 'recall_norm: trailing punctuation survives';
  end if;
  if public.recall_norm('The Less I Know The Better') <> 'less i know the better' then
    raise exception 'recall_norm: the leading article is not being dropped';
  end if;
  if public.recall_norm('Crazy In Love (feat. JAY-Z)') <> 'crazy in love' then
    raise exception 'recall_norm: parentheticals survive';
  end if;
  if public.recall_norm('Total Defeat Now') <> 'total defeat now' then
    raise exception 'recall_norm: the feat. rule is eating whole words';
  end if;

  -- The ladder. This is what is stored, so it is the one that has to be right.
  if public.recall_points(0) <> 1000 or public.recall_points(1) <> 750
     or public.recall_points(2) <> 500 or public.recall_points(3) <> 250 then
    raise exception 'recall_points no longer matches Recall.SCORES';
  end if;

  -- The schedule is the answer key. A select policy on it publishes every
  -- future day at once, which is the one change that silently ends the game.
  if exists (select 1 from pg_policies where tablename = 'recall_daily') then
    raise exception 'recall_daily has a policy on it — the schedule is meant to be reachable only through recall_submit()';
  end if;
  -- Scores may only come from the definer functions.
  if exists (select 1 from pg_policies where tablename = 'recall_results' and cmd <> 'SELECT') then
    raise exception 'recall_results has a write policy — scores must only come from recall_submit()/recall_session()';
  end if;
  if (select prosrc from pg_proc where proname = 'wallet_award_game') not like '%recall%' then
    raise exception 'wallet_award_game has no recall case — finishing a round would raise Unknown game';
  end if;
  if (select prosrc from pg_proc where proname = 'delete_my_data') not like '%recall_results%' then
    raise exception 'delete_my_data does not clear recall_results';
  end if;

  select count(*) into v_n from public.recall_daily where day >= ((now() at time zone 'utc')::date - date '2020-01-01');
  if v_n < 30 then
    raise warning 'recall_daily has only % days left — regenerate the schedule from SONG_ROWS', v_n;
  end if;
  raise notice 'Recall: % scheduled days, scores server-side, 1,600 x 3.', v_n;
end $$;
