-- ============================================================================
-- Reach — referrals
--
-- Apply this by hand in the SQL editor, like the others. Idempotent throughout,
-- because "applied by hand and not recorded" is the normal case on this project.
--
-- The shape is the one every other paying thing here has: **the client names a
-- code and never an amount**, the same rule as wallet_buy taking a key and never
-- a price and wallet_award_game naming a game and never a number. Every figure
-- below lives in this file and nowhere a browser can reach.
--
-- WHY THE GATES ARE WHERE THEY ARE
--
-- A referral bonus is the one faucet in this economy that anybody can open as
-- many times as they have email addresses, and accounts here are free
-- email+password. At 20,000 a side with no gate, ten burner accounts print
-- 400,000 Discs — more than four times what a week of realistic play pays, and
-- the whole shop is ~4.95M. So the defence is not a cap alone; it is that a
-- referral only pays once the referred account has done something a farm will
-- not bother doing:
--
--   * the email must be CONFIRMED (auth.users.email_confirmed_at)
--   * the account must have rated REQ_ALBUMS albums — real work, and the exact
--     work the app exists for
--   * the referrer is paid at most MAX_PAID times, ever
--   * a referred account can be referred once, ever — enforced by the primary
--     key on referred_id, not by a check somebody has to remember to write
--
-- Ten rated albums against 20,000 Discs is deliberately a good deal for a real
-- person and a bad one for a farm: it is fifteen minutes of genuine use per
-- account, and it caps out after five. Compare the collusion sum in the Bid War
-- section — the test there is that manufacturing pays less than honest play,
-- and five referrals at 20,000 is 100,000 lifetime, against ~70,000 for one
-- realistic WEEK. It is a real reward and it runs out.
--
-- WHAT "NEW" MEANS, AND WHY IT IS A WINDOW AND NOT A FLAG
--
-- The brief asks that only a genuinely new user counts. There is no onboarding
-- step in this app to hang that on, so the honest test is the account's own
-- age: a code may only be claimed within NEW_WINDOW of sign-up. That stops an
-- established account claiming a friend's code for a free 20,000, without
-- inventing a completion event that does not exist.
-- ============================================================================

-- ---------------------------------------------------------------- columns
alter table public.profiles add column if not exists referral_code       text;
alter table public.profiles add column if not exists referred_by         uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists referral_paid_count integer not null default 0;

create unique index if not exists profiles_referral_code_idx
  on public.profiles (referral_code) where referral_code is not null;

-- ---------------------------------------------------------------- table
-- One row per REFERRED user, ever. The primary key is the anti-farm rule:
-- leaving and rejoining cannot produce a second row, because the row is keyed
-- by the person who was referred and nothing deletes it.
create table if not exists public.referrals (
  referred_id      uuid primary key references auth.users(id) on delete cascade,
  referrer_id      uuid not null        references auth.users(id) on delete cascade,
  code             text not null,
  claimed_at       timestamptz not null default now(),
  paid_at          timestamptz,
  referrer_award   bigint,
  referred_award   bigint
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, paid_at);

alter table public.referrals enable row level security;

-- Readable by the two people it is about and nobody else: a referral row names
-- who brought whom, which is a fact about two accounts. Writing is through the
-- definer functions only — there is deliberately no insert or update policy.
drop policy if exists "referrals visible to both sides" on public.referrals;
create policy "referrals visible to both sides" on public.referrals
  for select using (auth.uid() = referred_id or auth.uid() = referrer_id);

-- ---------------------------------------------------------------- the numbers
create or replace function public.referral_spec()
returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'award',       20000,   -- each side, once
    'req_albums',  10,      -- the referred account must have rated this many
    'max_paid',    5,       -- lifetime paid referrals per referrer
    'new_days',    14       -- how new an account must be to claim a code
  );
$$;
grant execute on function public.referral_spec() to anon, authenticated;

-- ---------------------------------------------------------------- your code
-- Created on demand rather than by a trigger, so existing accounts get one the
-- first time they open Reach and nothing had to be backfilled.
--
-- Eight characters from an unambiguous alphabet: no O/0, no I/1/L. This code
-- gets read off a phone screen and typed into another one, and a code that
-- cannot be transcribed is a code nobody uses.
create or replace function public.referral_my_code()
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_code  text;
  v_try   text;
  v_i     integer := 0;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select referral_code into v_code from public.profiles where id = v_me;
  if v_code is not null then return v_code; end if;

  loop
    v_i := v_i + 1;
    if v_i > 40 then raise exception 'Could not allocate a code'; end if;
    v_try := '';
    for _j in 1..8 loop
      v_try := v_try || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = v_try);
  end loop;

  update public.profiles set referral_code = v_try where id = v_me;
  return v_try;
end $$;
grant execute on function public.referral_my_code() to authenticated;

-- ---------------------------------------------------------------- claiming
-- The referred user calls this, once, with the code they arrived on.
--
-- Everything that could make this wrong is refused with a NAMED reason rather
-- than a silent no-op, because the client has to be able to tell "you already
-- used a code" from "that code does not exist" from "your account is too old" —
-- three completely different things to say to somebody.
create or replace function public.referral_claim(p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_spec   jsonb := public.referral_spec();
  v_ref    uuid;
  v_born   timestamptz;
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if v_code = '' then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;

  if exists (select 1 from public.referrals where referred_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  select id into v_ref from public.profiles where referral_code = v_code;
  if v_ref is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if v_ref = v_me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;

  -- "Verified as new, not an existing account." There is no onboarding event
  -- in this app, so account age is the honest test.
  select created_at into v_born from auth.users where id = v_me;
  if v_born is null then raise exception 'No account'; end if;
  if v_born < now() - ((v_spec ->> 'new_days')::int * interval '1 day') then
    return jsonb_build_object('ok', false, 'reason', 'not_new');
  end if;

  insert into public.referrals (referred_id, referrer_id, code)
  values (v_me, v_ref, v_code)
  on conflict (referred_id) do nothing;

  update public.profiles set referred_by = v_ref where id = v_me;

  return jsonb_build_object('ok', true, 'reason', 'claimed');
end $$;
grant execute on function public.referral_claim(text) to authenticated;

-- ---------------------------------------------------------------- settling
-- Called by the REFERRED user on load. Cheap and safe to call every time: it
-- returns 'nothing' and changes nothing in every case but the one.
--
-- Both awards land in one transaction, and `paid_at` is set inside the same
-- one, under a row lock. Without that lock two tabs finishing the tenth rating
-- at once could both pass the gate and both pay — the same shape as the free
-- spin, which stamps its date in the transaction that grants the prize.
create or replace function public.referral_settle()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_spec    jsonb := public.referral_spec();
  v_award   bigint := (v_spec ->> 'award')::bigint;
  v_req     integer := (v_spec ->> 'req_albums')::int;
  v_max     integer := (v_spec ->> 'max_paid')::int;
  v_row     public.referrals;
  v_albums  integer;
  v_conf    timestamptz;
  v_paid    integer;
  v_discs   bigint;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.referrals
   where referred_id = v_me for update;
  if v_row.referred_id is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing');
  end if;
  if v_row.paid_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;

  select email_confirmed_at into v_conf from auth.users where id = v_me;
  if v_conf is null then
    return jsonb_build_object('ok', false, 'reason', 'unconfirmed');
  end if;

  select count(*) into v_albums
    from public.ratings where user_id = v_me and kind = 'album';
  if v_albums < v_req then
    return jsonb_build_object('ok', false, 'reason', 'not_yet',
                              'have', v_albums, 'need', v_req);
  end if;

  -- The referrer's lifetime cap. The referred side is still paid when the
  -- referrer is capped out: they did the work, and the cap is about the person
  -- doing the inviting.
  select coalesce(referral_paid_count, 0) into v_paid
    from public.profiles where id = v_row.referrer_id for update;

  -- The referrer is paid only while under the cap. The referred side is paid
  -- either way: they did the ten albums, and the cap is a rule about how many
  -- times one person may be paid for inviting, not a reason to punish the
  -- person who turned up.
  if coalesce(v_paid, 0) < v_max then
    update public.profiles
       set discs = coalesce(discs, 0) + v_award,
           referral_paid_count = coalesce(referral_paid_count, 0) + 1
     where id = v_row.referrer_id;
  end if;

  update public.profiles set discs = coalesce(discs, 0) + v_award
   where id = v_me returning discs into v_discs;

  update public.referrals
     set paid_at = now(),
         referrer_award = case when coalesce(v_paid, 0) < v_max then v_award else 0 end,
         referred_award = v_award
   where referred_id = v_me;

  return jsonb_build_object(
    'ok', true, 'reason', 'paid',
    'award', v_award,
    'referrer_paid', (coalesce(v_paid, 0) < v_max),
    'discs', v_discs);
end $$;
grant execute on function public.referral_settle() to authenticated;

-- ---------------------------------------------------------------- the panel
-- One round trip for everything Reach draws: your code, how many you have
-- brought, how many paid, and — if you arrived on somebody's code yourself —
-- exactly how far off the reward you are. That last part is why the screen can
-- say "4 of 10 albums" instead of "pending", which is the difference between a
-- reward somebody is working towards and one they have given up on.
create or replace function public.referral_state()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_spec   jsonb := public.referral_spec();
  v_code   text;
  v_paid   integer;
  v_inv    integer;
  v_done   integer;
  v_mine   public.referrals;
  v_albums integer;
  v_conf   timestamptz;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select referral_code, coalesce(referral_paid_count, 0)
    into v_code, v_paid from public.profiles where id = v_me;

  select count(*), count(paid_at) into v_inv, v_done
    from public.referrals where referrer_id = v_me;

  select * into v_mine from public.referrals where referred_id = v_me;
  select count(*) into v_albums from public.ratings where user_id = v_me and kind = 'album';
  select email_confirmed_at into v_conf from auth.users where id = v_me;

  return jsonb_build_object(
    'spec',        v_spec,
    'code',        v_code,
    'invited',     coalesce(v_inv, 0),
    'paid',        coalesce(v_done, 0),
    'paid_count',  coalesce(v_paid, 0),
    'capped',      coalesce(v_paid, 0) >= (v_spec ->> 'max_paid')::int,
    'mine',        case when v_mine.referred_id is null then null else jsonb_build_object(
                     'claimed', true,
                     'settled', v_mine.paid_at is not null,
                     'confirmed', v_conf is not null,
                     'albums', coalesce(v_albums, 0),
                     'need',   (v_spec ->> 'req_albums')::int) end);
end $$;
grant execute on function public.referral_state() to authenticated;

-- ---------------------------------------------------------------- badges
-- The pin trigger below reads and writes profiles.badges, and it is the single
-- most load-bearing object in this database — it guards the whole economy. So
-- the column's type is checked HERE, before anything is replaced: a mismatch
-- stops the migration cleanly rather than installing a trigger that raises on
-- every profile write.
alter table public.profiles add column if not exists badges text[] not null default '{}'::text[];

do $$
declare v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attname = 'badges' and a.attnum > 0 and not a.attisdropped;
  if v_type is distinct from 'text[]' then
    raise exception 'profiles.badges is % — expected text[]; fix the column before installing the pin trigger', coalesce(v_type, 'missing');
  end if;
end $$;

-- ---------------------------------------------------------------- pin
-- referral_paid_count is a counter the economy pays off, so it belongs in the
-- trigger beside game_awards for exactly the reason the free-spin date does:
-- without this line a client resets it to zero and collects the fifth award
-- again on every reload. referral_code is pinned too — a client that could
-- rewrite its own code could take somebody else's.
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' and coalesce(new.discs, 0) > coalesce(old.discs, 0) then
      new.lifetime_xp := coalesce(old.lifetime_xp, 0) + (coalesce(new.discs, 0) - coalesce(old.discs, 0));
      new.level := public.level_for_xp(new.lifetime_xp);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin            := false;
    new.discs               := 0;
    new.streak_current      := 0;
    new.streak_best         := 0;
    new.streak_last_date    := null;
    new.streak_freezes      := 1;
    new.owned_themes        := '{classic}'::text[];
    new.owned_banners       := '{}'::text[];
    new.owned_tags          := '{}'::text[];
    new.owned_flairs        := '{}'::text[];
    new.owned_frames        := '{}'::text[];
    new.rating_awards_count := 0;
    new.lore_awards_count   := 0;
    new.game_awards_date    := null;
    new.game_awards         := '{}'::jsonb;
    new.game_plays_date     := null;
    new.game_plays          := '{}'::jsonb;
    new.spin_free_date      := null;
    new.login_streak        := 0;
    new.login_best          := 0;
    new.login_last_date     := null;
    new.banner_picks        := 0;
    new.album_picks         := 0;
    new.lifetime_xp         := 0;
    new.level               := 1;
    new.referral_code       := null;
    new.referred_by         := null;
    new.referral_paid_count := 0;
    -- Every account is an OG. Awarded here rather than by the client, because
    -- `badges` is what CEO and Verified live in — see the badge migration.
    new.badges              := array(select distinct unnest(coalesce(new.badges, '{}'::text[]) || array['og']));
    return new;
  end if;

  new.is_admin            := old.is_admin;
  new.discs               := old.discs;
  new.streak_current      := old.streak_current;
  new.streak_best         := old.streak_best;
  new.streak_last_date    := old.streak_last_date;
  new.streak_freezes      := old.streak_freezes;
  new.owned_themes        := old.owned_themes;
  new.owned_banners       := old.owned_banners;
  new.owned_tags          := old.owned_tags;
  new.owned_flairs        := old.owned_flairs;
  new.owned_frames        := old.owned_frames;
  new.rating_awards_date  := old.rating_awards_date;
  new.rating_awards_count := old.rating_awards_count;
  new.lore_awards_date    := old.lore_awards_date;
  new.lore_awards_count   := old.lore_awards_count;
  new.game_awards_date    := old.game_awards_date;
  new.game_awards         := old.game_awards;
  new.game_plays_date     := old.game_plays_date;
  new.game_plays          := old.game_plays;
  new.spin_free_date      := old.spin_free_date;
  new.login_streak        := old.login_streak;
  new.login_best          := old.login_best;
  new.login_last_date     := old.login_last_date;
  new.banner_picks        := old.banner_picks;
  new.album_picks         := old.album_picks;
  new.lifetime_xp         := old.lifetime_xp;
  new.level               := old.level;
  new.referral_code       := old.referral_code;
  new.referred_by         := old.referred_by;
  new.referral_paid_count := old.referral_paid_count;
  -- Badges are AWARDED, never written by the browser. This column already held
  -- CEO, OG, Beta Tester and Verified and was not pinned at all, so any signed-in
  -- client could have written itself Verified — the one marker a verification
  -- badge can never be allowed to be.
  new.badges              := old.badges;

  if new.active_theme is not null
     and new.active_theme <> 'classic'
     and not (new.active_theme = any(coalesce(new.owned_themes, '{}'::text[]))) then
    new.active_theme := old.active_theme;
  end if;
  if new.active_banner is not null
     and not (new.active_banner = any(coalesce(new.owned_banners, '{}'::text[]))) then
    new.active_banner := old.active_banner;
  end if;
  if new.active_tag is not null
     and not (new.active_tag = any(coalesce(new.owned_tags, '{}'::text[]))) then
    new.active_tag := old.active_tag;
  end if;
  if new.active_flair is not null
     and not (new.active_flair = any(coalesce(new.owned_flairs, '{}'::text[]))) then
    new.active_flair := old.active_flair;
  end if;
  if new.active_frame is not null
     and not (new.active_frame = any(coalesce(new.owned_frames, '{}'::text[]))) then
    new.active_frame := old.active_frame;
  end if;

  return new;
end $$;

drop trigger if exists pin_profile_economy_trg on public.profiles;
create trigger pin_profile_economy_trg
  before insert or update on public.profiles
  for each row execute function public.pin_profile_economy();

-- ---------------------------------------------------------------- back-award
-- Everybody who already has an account is an OG too — the badge is for being
-- here early, and the people here now are the earliest there will ever be.
update public.profiles
   set badges = array(select distinct unnest(coalesce(badges, '{}'::text[]) || array['og']))
 where not ('og' = any(coalesce(badges, '{}'::text[])));

-- ---------------------------------------------------------------- guards
do $$
begin
  -- The client must never be able to name an amount. If referral_claim or
  -- referral_settle ever grows a numeric parameter, this stops the migration.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('referral_settle', 'referral_claim')
       and p.pronargs > 1)
  then
    raise exception 'referral functions must not take more than a code — the server owns the amount';
  end if;

  -- referrals must have no client write path: the only way a row appears or is
  -- marked paid is through the definer functions above.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'referrals'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
  then
    raise exception 'referrals must have no write policy — awards come from referral_settle only';
  end if;
end $$;
