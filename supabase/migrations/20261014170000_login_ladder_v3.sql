-- The seven-day ladder, third shape. Apply by hand like the others; idempotent.
--
--   week one (login_streak 1..7)        every week after (8..)
--   1  1,500                             1  1,500
--   2  2,000                             2  2,000
--   3  2,500                             3  2,500
--   4  3,000                             4  3,000
--   5  VINALL Wrapped (unlocks Replay)   5  I GOT TOO MUCH PROFIT tag (10,000 if owned)
--   6  25,000                            6  25,000
--   7  album of your choice +            7  ??? — a mystery box, rolled HERE
--      IT'S VIRJI ISN'T IT (exclusive)
--
-- Mirrored for display by LADDER / LADDER_NEXT in the Discs module of
-- index.html. Change one, change the other. The client is told what was
-- granted (`granted`) and never decides it.
--
-- `profiles.replay_unlocked` is new and pinned by its own small trigger rather
-- than by re-declaring pin_profile_economy (long, hand-edited; a retyped copy
-- loses a line). Everybody who has already reached a five-day run keeps Replay.
-- The VIRJI tag is deliberately NOT a shop_items row: it cannot be bought and
-- is not in the Draw's tag pool, which reads shop_items.

alter table public.profiles add column if not exists replay_unlocked boolean not null default false;

update public.profiles set replay_unlocked = true
where not replay_unlocked and coalesce(login_best, 0) >= 5;

create or replace function public.pin_replay_unlocked() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- current_user, never the JWT: see "The pin trigger's escape hatch".
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then new.replay_unlocked := false;
    else new.replay_unlocked := old.replay_unlocked; end if;
  end if;
  return new;
end $$;
drop trigger if exists pin_replay_unlocked_trg on public.profiles;
create trigger pin_replay_unlocked_trg before insert or update on public.profiles
  for each row execute function public.pin_replay_unlocked();

create or replace function public.wallet_daily_login()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_today  date := (now() at time zone 'utc')::date;
  v_gap    integer;
  v_earn   integer := 0;
  v_pick   boolean := false;
  v_first  boolean := false;
  v_pos    integer;
  v_cycle  integer;
  v_kind   text := 'discs';
  v_label  text;
  v_tag    text;
  v_roll   integer;
  v_picks  integer := 0;
  -- Disc days. Days 5 and 7 are not Discs in either week; 0 there.
  v_ladder integer[] := array[1500, 2000, 2500, 3000, 0, 25000, 0];
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.login_last_date = v_today then
    return jsonb_build_object(
      'earned', 0, 'claimed_already', true, 'album_pick', false,
      'login_streak', p.login_streak, 'login_best', p.login_best,
      'login_last_date', p.login_last_date, 'replay_unlocked', p.replay_unlocked,
      'album_picks', p.album_picks, 'discs', p.discs);
  end if;

  v_first := p.login_last_date is null;
  v_gap := case when p.login_last_date is null then null else v_today - p.login_last_date end;

  if v_gap = 1 then p.login_streak := p.login_streak + 1; else p.login_streak := 1; end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  v_pos   := ((p.login_streak - 1) % 7) + 1;
  v_cycle := (p.login_streak - 1) / 7;          -- 0 = the first week of this run
  v_earn  := v_ladder[v_pos];

  if v_pos = 5 then
    if v_cycle = 0 then
      v_kind := 'wrapped'; v_label := 'VINALL Wrapped';
      p.replay_unlocked := true;
    elsif not ('profit' = any(coalesce(p.owned_tags, '{}'::text[]))) then
      v_kind := 'tag'; v_tag := 'profit'; v_label := 'I GOT TOO MUCH PROFIT';
      p.owned_tags := array_append(coalesce(p.owned_tags, '{}'::text[]), 'profit');
    else
      v_kind := 'discs'; v_earn := 10000; v_label := '10,000 Discs';
    end if;
  elsif v_pos = 7 then
    if v_cycle = 0 then
      v_kind := 'grand'; v_label := 'Album of your choice + IT''S VIRJI ISN''T IT';
      v_picks := 1;
      if not ('virji' = any(coalesce(p.owned_tags, '{}'::text[]))) then
        p.owned_tags := array_append(coalesce(p.owned_tags, '{}'::text[]), 'virji');
        v_tag := 'virji';
      end if;
    else
      -- The box. 1000 slots: 400 15k · 250 30k · 150 one record · 120 a tag
      -- you do not own · 60 60k · 20 three records. Expected Discs-equivalent
      -- is well under a week of play, and it lands once a week at most.
      v_kind := 'mystery';
      v_roll := floor(random() * 1000)::int;
      if v_roll < 400 then v_earn := 15000; v_label := '15,000 Discs';
      elsif v_roll < 650 then v_earn := 30000; v_label := '30,000 Discs';
      elsif v_roll < 800 then v_picks := 1; v_label := 'An album of your choice';
      elsif v_roll < 920 then
        select s.key, s.name into v_tag, v_label from public.shop_items s
        where s.kind = 'tag' and not (s.key = any(coalesce(p.owned_tags, '{}'::text[])))
        order by random() limit 1;
        if v_tag is null then v_earn := 30000; v_label := '30,000 Discs';
        else p.owned_tags := array_append(coalesce(p.owned_tags, '{}'::text[]), v_tag); end if;
      elsif v_roll < 980 then v_earn := 60000; v_label := '60,000 Discs';
      else v_picks := 3; v_label := 'Three albums of your choice';
      end if;
    end if;
  end if;

  if v_picks > 0 then
    v_pick := true;
    p.album_picks := coalesce(p.album_picks, 0) + v_picks;
  end if;

  update public.profiles set
    discs           = coalesce(discs, 0) + v_earn,
    login_streak    = p.login_streak,
    login_best      = p.login_best,
    login_last_date = p.login_last_date,
    album_picks     = p.album_picks,
    owned_tags      = p.owned_tags,
    replay_unlocked = p.replay_unlocked
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'claimed_already', false, 'album_pick', v_pick, 'picks', v_picks,
    'first_ever', v_first, 'day', v_pos, 'cycle', v_cycle,
    'granted', jsonb_build_object('kind', v_kind, 'label', v_label, 'tag', v_tag, 'picks', v_picks, 'discs', v_earn),
    'login_streak', p.login_streak, 'login_best', p.login_best,
    'login_last_date', p.login_last_date, 'replay_unlocked', p.replay_unlocked,
    'album_picks', p.album_picks, 'discs', p.discs,
    'owned_tags', p.owned_tags,
    'owned_banners', p.owned_banners, 'owned_themes', p.owned_themes,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $function$;

-- Guards: the box's tag draw must stay inside shop_items, and the exclusive
-- tag must never become buyable.
do $$
begin
  if exists (select 1 from public.shop_items where key = 'virji') then
    raise exception 'virji is a ladder exclusive and must not be a shop_items row';
  end if;
  if not exists (select 1 from public.shop_items where kind = 'tag' and key = 'profit') then
    raise exception 'expected the profit tag in shop_items';
  end if;
end $$;
