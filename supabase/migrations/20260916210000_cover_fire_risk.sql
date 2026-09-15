-- ===========================================================================
-- Cover Fire: the RISK ceiling, and a build version on every match
--
-- Two changes, and they are unrelated to each other except that both are the
-- server half of a client change that would fail silently without them.
--
-- 1. blitz_submit clamped a score to 3,600, which was the arithmetic ceiling of
--    a flawless run: ten right, every one instant, the streak multiplier taken
--    whole. RISK can double one round, and the best round to double is the
--    tenth at a nine-streak — 200 x 3 = 600, doubled adds 600. The ceiling is
--    therefore 4,200.
--
--    Leaving it at 3,600 would not have errored. It would have filed a great
--    run as a worse one, and decided a head to head on the wrong number. That
--    is the worst failure shape available: a 200 and a smaller figure. The
--    client now compares what comes back with what it sent and reports the gap
--    through reportIssue rather than accepting it, so an unapplied migration
--    says so in client_errors instead of quietly costing people matches.
--
--    Blitz.MAX_SCORE in index.html mirrors this number. Change one and you must
--    change the other — the same arrangement as LADDER against v_ladder.
--
-- 2. blitz_matches.build_v records which question list a match was dealt from.
--
--    The client builds ten questions from the seed with a seeded RNG, and the
--    list of question kinds is shuffled to order them. shuffled() draws one
--    random number per element, so ADDING A KIND changes every question built
--    from every seed. Five kinds were added with Cover Fire.
--
--    Without this column, a match created before the deploy where one player
--    had already played would have dealt the second player a different ten, and
--    nothing anywhere would have said so — the scores would simply have been
--    compared as though they answered the same questions. Existing rows keep 1
--    and replay against the frozen list; new rows get 2.
--
--    No function is changed for this. blitz_create returns the whole
--    blitz_matches row, so the column rides back on its own, and blitzList
--    selects *. That is why the default is flipped after the column is added
--    rather than the column being added with default 2: "add column ... default"
--    backfills every existing row with that value, which is the one thing this
--    must not do.
--
-- Idempotent throughout, like everything else here — "applied by hand and not
-- recorded in Supabase's migration history" is the normal case in this project.
-- ===========================================================================

-- ------------------------------------------------------------------ build_v
alter table public.blitz_matches
  add column if not exists build_v smallint not null default 1;

comment on column public.blitz_matches.build_v is
  'Which client question-kind list this match was dealt from. Existing matches keep 1; new ones take the default. Mirrored by KINDS_V1 / KINDS_V2 in index.html.';

-- Flipped AFTER the add, so rows that already exist keep 1.
alter table public.blitz_matches
  alter column build_v set default 2;

-- ------------------------------------------------------- blitz_submit, 4,200
-- Extracted programmatically from 20260916180000_album_blitz.sql and diffed
-- against it: exactly one line differs, the clamp. Do not retype this function.
create or replace function public.blitz_submit(p_match uuid, p_score integer,
                                               p_streak integer, p_correct integer)
returns public.blitz_matches
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  m       public.blitz_matches;
  v_first boolean;
  v_other uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into m from public.blitz_matches where id = p_match for update;
  if m.id is null then raise exception 'No such match'; end if;
  if v_me <> m.initiator_id and v_me <> m.opponent_id then raise exception 'Not your match'; end if;

  -- Clamped rather than trusted. 3,600 is a flawless run — ten right, every
  -- one instant, the multiplier climbing the whole way — so anything above it
  -- is arithmetic that did not happen.
  p_score   := greatest(least(coalesce(p_score, 0), 4200), 0);
  p_streak  := greatest(least(coalesce(p_streak, 0), 10), 0);
  p_correct := greatest(least(coalesce(p_correct, 0), 10), 0);

  v_first := (v_me = m.initiator_id);
  if v_first and m.initiator_score is not null then raise exception 'You have already played this one'; end if;
  if not v_first and m.opponent_score is not null then raise exception 'You have already played this one'; end if;

  update public.blitz_matches set
    initiator_score   = case when v_first then p_score   else initiator_score   end,
    initiator_streak  = case when v_first then p_streak  else initiator_streak  end,
    initiator_correct = case when v_first then p_correct else initiator_correct end,
    opponent_score    = case when v_first then opponent_score    else p_score   end,
    opponent_streak   = case when v_first then opponent_streak   else p_streak  end,
    opponent_correct  = case when v_first then opponent_correct  else p_correct end
  where id = p_match
  returning * into m;

  v_other := case when v_first then m.opponent_id else m.initiator_id end;

  if m.initiator_score is not null and m.opponent_score is not null then
    update public.blitz_matches set
      status      = 'resolved',
      resolved_at = now(),
      winner_id   = case when initiator_score > opponent_score then initiator_id
                         when opponent_score > initiator_score then opponent_id
                         else null end
    where id = p_match
    returning * into m;

    -- Both told, because the one who played first is not on the page.
    insert into public.notifications (user_id, actor_id, type, data)
    select t.uid, t.foe, 'blitz_result',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'match_id', p_match,
                              'outcome', case when m.winner_id is null then 'draw'
                                              when m.winner_id = t.uid then 'won'
                                              else 'lost' end)
    from (values (m.initiator_id, m.opponent_id),
                 (m.opponent_id,  m.initiator_id)) as t(uid, foe)
    join public.profiles p on p.id = t.foe;
  else
    insert into public.notifications (user_id, actor_id, type, data)
    select v_other, v_me, 'blitz_turn',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'match_id', p_match,
                              'score', p_score)
    from public.profiles p where p.id = v_me;
  end if;

  return m;
end $$;

-- ------------------------------------------------------------------- guards
do $guard$
declare
  v_def  text;
  v_dflt text;
  v_old  bigint;
begin
  -- The clamp actually moved, and the old one is gone rather than merely
  -- joined by the new one somewhere else in the body.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'blitz_submit';
  if v_def is null then
    raise exception 'blitz_submit is missing — apply 20260916180000_album_blitz.sql first';
  end if;
  if position('4200' in v_def) = 0 then
    raise exception 'blitz_submit does not clamp to 4200 — the replace did not take';
  end if;
  if position('3600' in v_def) > 0 then
    raise exception 'blitz_submit still mentions 3600 — an old clamp survived the replace';
  end if;

  -- New matches must be dealt v2 and old ones must NOT have been rewritten.
  select column_default into v_dflt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'blitz_matches' and column_name = 'build_v';
  -- split_part, not position: "2::smallint" and a bare "2" both have to pass,
  -- and position('2' in ...) would also wave through a default of 12.
  if v_dflt is null or split_part(v_dflt, '::', 1) <> '2' then
    raise exception 'blitz_matches.build_v does not default to 2 (got %)', coalesce(v_dflt, 'null');
  end if;

  /* Deliberately NOT "every pre-existing match is still v1". That reads as the
     obvious check and it is wrong on the second run: matches created legitimately
     after the first run carry 2 and are soon older than any window you pick, so
     the guard would fail the migration for doing its job. A guard that refuses
     correctly the first time and falsely ever after is worse than none. What is
     always true is that the column only ever holds a version that exists. */
  select count(*) into v_old from public.blitz_matches where build_v not in (1, 2);
  if v_old > 0 then
    raise exception '% matches carry a build_v that no client knows how to deal', v_old;
  end if;

  raise notice 'Cover Fire: ceiling 4,200, build_v default 2, % existing matches left at v1',
    (select count(*) from public.blitz_matches where build_v = 1);
end $guard$;
