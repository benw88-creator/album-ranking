-- Certification: a record you own can be earned up to Silver, Gold, Platinum
-- or Diamond, and then plated.
--
-- ---------------------------------------------------------------------------
-- The metaphor, and why it is not a level
-- ---------------------------------------------------------------------------
-- Records already have a certification ladder and everybody already knows how
-- to read it: the BPI awards Silver, Gold, Platinum and Diamond, and a record
-- carries the award on its sleeve for the rest of its life. It is the one
-- progression system that is genuinely about music rather than borrowed from a
-- game, it needs no explaining, and "gold" is what anybody would call the good
-- version of an owned record without being told.
--
-- So no XP, no levels, no bars filling up. A record gets **marks**, the marks
-- add up to a certification, and the certification is a thing you display.
--
-- ---------------------------------------------------------------------------
-- Two axes, and the separation is the whole design
-- ---------------------------------------------------------------------------
-- **Certification is earned and can never be bought.** Discs cannot buy a mark
-- and there is no path in this file that grants one for money.
--
-- **Finishes are bought, and gated by certification.** Once a record is Gold
-- you may spend Discs having it gold-plated. The Discs buy the *plating*, not
-- the *award* — same relationship as a real record: nobody sells you the Gold
-- disc, you pay for the frame it goes in.
--
-- That split is what stops this being pay-to-win while still making it a sink,
-- and it is a sink of the only kind that matters here: **bottomless**. Every
-- cosmetic in the Shop can be finished; an account that owns them all has
-- nowhere to put Discs. There is no last record to plate.
--
-- ---------------------------------------------------------------------------
-- The marks, and why every one of them is server-verifiable
-- ---------------------------------------------------------------------------
--   rated it                                 1
--   wrote a note on it                       1
--   changed your mind, 30+ days apart        2
--   changed it again (3+ distinct scores)    1
--   own it                                   2
--   held it 90 days                          1
--   held it a year                           2
--   answered a question about it (Lore)      1 each, capped at 2
--   rated 3 of its songs                     1
--   rated 8 of its songs                     1
--                                     max   14
--
--   Silver 4   Gold 6   Platinum 9   Diamond 13
--
-- **Ownership is a gate, not just a mark.** Without a `collection` row the tier
-- is null however many marks the record has, because the progression this
-- extends is Rank -> Acquire -> Own and certification is the step after own.
--
-- Diamond needs 13 of 14, which means a note, two changes of mind a month
-- apart, two Lore answers, eight rated songs, and **a year of holding it**.
-- There is no way to hurry it and that is the point: it should be possible to
-- look at somebody's Diamond record and know they did not get it this month.
--
-- Nothing here is taken on trust. Every input already lives on the server —
-- `collection.bought_at` for the holding, `ratings.data` for the score, the
-- note and the score history, `ratings` again for songs by their `albumId`,
-- and `lore_answers` for the questions — so `collection_marks()` computes the
-- tier itself rather than believing a number the browser sends. That matters
-- because the tier gates a purchase, and a client that could name its own tier
-- could press a Diamond finish onto a record it had rated once.
--
-- ---------------------------------------------------------------------------
-- What the columns hold
-- ---------------------------------------------------------------------------
--   finish          the treatment currently on the record, or null
--   owned_finishes  every treatment bought for THIS record; switching between
--                   ones you already own is free, because charging twice for
--                   a thing you own would make people leave it alone rather
--                   than play with it
--   inscription     one line of your own on the plaque, Gold and up. Free:
--                   it is writing, not buying, and it is the most on-thesis
--                   part of the feature
--   is_master       one of at most three records that represent you
--
-- `collection` is already publicly readable, so all of this is visible on
-- somebody else's shelf, which is the point — a plated record nobody else can
-- see is a screensaver.

-- ------------------------------------------------------------------ columns
alter table public.collection
  add column if not exists finish         text,
  add column if not exists owned_finishes text[] not null default '{}'::text[],
  add column if not exists inscription    text,
  add column if not exists is_master      boolean not null default false;

-- ------------------------------------------------------------- the ladder
-- One place for the thresholds so the badge, the gate and the client cannot
-- disagree about what Gold means.
create or replace function public.cert_tier_for(p_marks integer, p_owned boolean)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when not p_owned      then null
    when p_marks >= 13    then 'diamond'
    when p_marks >= 9     then 'platinum'
    when p_marks >= 6     then 'gold'
    when p_marks >= 4     then 'silver'
    else null end;
$$;

create or replace function public.cert_rank(p_tier text)
returns integer
language sql immutable
set search_path = public, pg_temp
as $$
  select case p_tier
    when 'diamond'  then 4
    when 'platinum' then 3
    when 'gold'     then 2
    when 'silver'   then 1
    else 0 end;
$$;

-- Finish prices and the tier each one needs. The browser names a key and never
-- a price, exactly as wallet_buy does.
create or replace function public.finish_spec(p_key text)
returns table (cost integer, needs text)
language sql immutable
set search_path = public, pg_temp
as $$
  select * from (values
    ('silverleaf',   8000, 'silver'),
    ('goldplate',   25000, 'gold'),
    ('platinum',    60000, 'platinum'),
    ('holo',        75000, 'platinum'),
    ('prism',      150000, 'diamond')
  ) as f(key, cost, needs) where f.key = p_key;
$$;

-- --------------------------------------------------------------- the marks
-- `stable` rather than `volatile`: it writes nothing and the client calls it
-- for every record on a shelf.
create or replace function public.collection_marks(p_user uuid, p_album text)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_row    public.collection;
  v_data   jsonb;
  v_hist   jsonb;
  v_len    integer := 0;
  v_marks  integer := 0;
  v_songs  integer := 0;
  v_lore   integer := 0;
  v_days   numeric := 0;
  v_span   numeric := 0;
  v_owned  boolean := false;
  v_tier   text;
  v_self   boolean := (p_user = auth.uid());
begin
  if p_user is null or p_album is null then
    return jsonb_build_object('marks', 0, 'tier', null, 'owned', false);
  end if;

  select * into v_row from public.collection
   where user_id = p_user and album_id = p_album;
  v_owned := v_row.user_id is not null;

  -- The album's own rating row. Cast, because `data` may be json rather than
  -- jsonb depending on how the core table was made by hand in the dashboard.
  select r.data::jsonb into v_data from public.ratings r
   where r.user_id = p_user and r.kind = 'album' and r.item_id = p_album;

  if v_data is not null then
    if (v_data ->> 'score') is not null then v_marks := v_marks + 1; end if;
    if coalesce(btrim(v_data ->> 'note'), '') <> '' then v_marks := v_marks + 1; end if;

    v_hist := v_data -> 'history';
    if v_hist is not null and jsonb_typeof(v_hist) = 'array' then
      v_len := jsonb_array_length(v_hist);
      if v_len >= 2 then
        -- History is [{s, t}, ...] oldest first, t in JS milliseconds. A change
        -- of mind only counts once time has passed between the two opinions,
        -- or dragging a slider twice would outrank holding a record for a year.
        v_span := ((v_hist -> (v_len - 1) ->> 't')::numeric - (v_hist -> 0 ->> 't')::numeric) / 86400000.0;
        if v_span >= 30 then v_marks := v_marks + 2; end if;
      end if;
      if v_len >= 3 then v_marks := v_marks + 1; end if;
    end if;
  end if;

  if v_owned then
    v_marks := v_marks + 2;
    v_days := extract(epoch from (now() - v_row.bought_at)) / 86400.0;
    if v_days >= 90  then v_marks := v_marks + 1; end if;
    if v_days >= 365 then v_marks := v_marks + 2; end if;
  end if;

  select count(*) into v_lore from public.lore_answers
   where user_id = p_user and item_id = p_album and coalesce(skipped, false) = false;
  v_marks := v_marks + least(v_lore, 2);

  -- Songs carry their album on the rating object, which is what makes "you
  -- have rated eight tracks off this" answerable without a tracklist.
  select count(*) into v_songs from public.ratings r
   where r.user_id = p_user and r.kind = 'song' and (r.data::jsonb) ->> 'albumId' = p_album;
  if v_songs >= 3 then v_marks := v_marks + 1; end if;
  if v_songs >= 8 then v_marks := v_marks + 1; end if;

  v_tier := public.cert_tier_for(v_marks, v_owned);

  -- The award is public, the workings are not. Somebody else's shelf shows
  -- what a record is certified at; how close they are to the next one is
  -- theirs, the same way Standing is.
  if not v_self then
    return jsonb_build_object('marks', v_marks, 'tier', v_tier, 'owned', v_owned,
                              'finish', v_row.finish, 'inscription', v_row.inscription,
                              'master', coalesce(v_row.is_master, false));
  end if;

  return jsonb_build_object(
    'marks', v_marks, 'tier', v_tier, 'owned', v_owned,
    'finish', v_row.finish, 'owned_finishes', coalesce(v_row.owned_finishes, '{}'::text[]),
    'inscription', v_row.inscription, 'master', coalesce(v_row.is_master, false),
    'held_days', floor(v_days),
    'detail', jsonb_build_object(
      'rated',   (v_data ->> 'score') is not null,
      'note',    coalesce(btrim(v_data ->> 'note'), '') <> '',
      'turns',   greatest(v_len - 1, 0),
      'aged',    v_span >= 30,
      'owned',   v_owned,
      'held90',  v_days >= 90,
      'held365', v_days >= 365,
      'lore',    v_lore,
      'songs',   v_songs));
end $$;

-- Every certification on one shelf in a single call, so the Collection and a
-- profile do not make one round trip per record.
create or replace function public.collection_certs(p_user uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_out jsonb := '{}'::jsonb;
  r     record;
begin
  if p_user is null then return v_out; end if;
  for r in select album_id from public.collection where user_id = p_user loop
    v_out := v_out || jsonb_build_object(r.album_id, public.collection_marks(p_user, r.album_id));
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------- the plating
-- Charges Discs and applies the finish. The tier is recomputed here rather
-- than accepted from the caller: this is the one place certification gates a
-- purchase, so it is the one place a forged tier would buy something.
create or replace function public.collection_press(p_album text, p_finish text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_row   public.collection;
  v_cost  integer;
  v_needs text;
  v_cert  jsonb;
  v_tier  text;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select cost, needs into v_cost, v_needs from public.finish_spec(p_finish);
  if v_cost is null then raise exception 'No such finish'; end if;

  select * into v_row from public.collection where user_id = v_me and album_id = p_album for update;
  if v_row.user_id is null then raise exception 'You do not own that record'; end if;

  if p_finish = any(coalesce(v_row.owned_finishes, '{}'::text[])) then
    raise exception 'That finish is already on this record';
  end if;

  v_cert := public.collection_marks(v_me, p_album);
  v_tier := v_cert ->> 'tier';
  if public.cert_rank(v_tier) < public.cert_rank(v_needs) then
    raise exception 'That finish needs %, and this record is %', v_needs, coalesce(v_tier, 'uncertified');
  end if;

  select * into p from public.profiles where id = v_me for update;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'That costs % Discs', v_cost;
  end if;

  update public.profiles set
    discs = case when coalesce(is_admin, false) then discs else coalesce(discs, 0) - v_cost end
  where id = v_me
  returning * into p;

  update public.collection set
    owned_finishes = array_append(coalesce(owned_finishes, '{}'::text[]), p_finish),
    finish         = p_finish
  where user_id = v_me and album_id = p_album
  returning * into v_row;

  return jsonb_build_object('ok', true, 'finish', v_row.finish,
                            'owned_finishes', v_row.owned_finishes,
                            'spent', v_cost, 'discs', p.discs,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

-- Free: switching between finishes already bought for this record, or taking
-- one off. Charging again for something owned makes people leave it alone.
create or replace function public.collection_set_finish(p_album text, p_finish text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.collection;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_row from public.collection where user_id = v_me and album_id = p_album;
  if v_row.user_id is null then raise exception 'You do not own that record'; end if;
  if p_finish is not null and not (p_finish = any(coalesce(v_row.owned_finishes, '{}'::text[]))) then
    raise exception 'You have not pressed that finish onto this record';
  end if;

  update public.collection set finish = p_finish
   where user_id = v_me and album_id = p_album
   returning * into v_row;
  return jsonb_build_object('ok', true, 'finish', v_row.finish);
end $$;

-- ---------------------------------------------------------- the inscription
-- Gold and up, and free. One line, and it is the only part of a plated record
-- that could not have been bought.
create or replace function public.collection_inscribe(p_album text, p_text text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_row  public.collection;
  v_tier text;
  v_txt  text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_row from public.collection where user_id = v_me and album_id = p_album;
  if v_row.user_id is null then raise exception 'You do not own that record'; end if;

  if v_txt is not null then
    v_tier := public.collection_marks(v_me, p_album) ->> 'tier';
    if public.cert_rank(v_tier) < public.cert_rank('gold') then
      raise exception 'An inscription needs Gold';
    end if;
    v_txt := left(v_txt, 80);
  end if;

  update public.collection set inscription = v_txt
   where user_id = v_me and album_id = p_album;
  return jsonb_build_object('ok', true, 'inscription', v_txt);
end $$;

-- --------------------------------------------------------------- the Masters
-- At most three, Diamond only. The cap is the feature: a showcase of everything
-- is a shelf, and the question this answers is which records ARE you.
create or replace function public.collection_set_master(p_album text, p_on boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_row  public.collection;
  v_tier text;
  v_n    integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_row from public.collection where user_id = v_me and album_id = p_album for update;
  if v_row.user_id is null then raise exception 'You do not own that record'; end if;

  if p_on then
    v_tier := public.collection_marks(v_me, p_album) ->> 'tier';
    if v_tier is distinct from 'diamond' then
      raise exception 'Only a Diamond record can be one of your Masters';
    end if;
    select count(*) into v_n from public.collection
     where user_id = v_me and is_master and album_id <> p_album;
    if v_n >= 3 then raise exception 'You already have three Masters. Retire one first.'; end if;
  end if;

  update public.collection set is_master = coalesce(p_on, false)
   where user_id = v_me and album_id = p_album;

  select count(*) into v_n from public.collection where user_id = v_me and is_master;
  return jsonb_build_object('ok', true, 'master', coalesce(p_on, false), 'masters', v_n);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.cert_tier_for(integer, boolean)        from public, anon;
revoke all on function public.cert_rank(text)                        from public, anon;
revoke all on function public.finish_spec(text)                      from public, anon;
revoke all on function public.collection_marks(uuid, text)           from public, anon;
revoke all on function public.collection_certs(uuid)                 from public, anon;
revoke all on function public.collection_press(text, text)           from public, anon;
revoke all on function public.collection_set_finish(text, text)      from public, anon;
revoke all on function public.collection_inscribe(text, text)        from public, anon;
revoke all on function public.collection_set_master(text, boolean)   from public, anon;

grant execute on function public.cert_tier_for(integer, boolean)      to authenticated, anon;
grant execute on function public.cert_rank(text)                      to authenticated, anon;
grant execute on function public.finish_spec(text)                    to authenticated, anon;
-- Readable without a session: a plated shelf is worth seeing logged out, the
-- same reasoning as the score spread on a Crate card.
grant execute on function public.collection_marks(uuid, text)         to authenticated, anon;
grant execute on function public.collection_certs(uuid)               to authenticated, anon;
grant execute on function public.collection_press(text, text)         to authenticated;
grant execute on function public.collection_set_finish(text, text)    to authenticated;
grant execute on function public.collection_inscribe(text, text)      to authenticated;
grant execute on function public.collection_set_master(text, boolean) to authenticated;

-- ------------------------------------------------------------------ guards
do $$
begin
  if public.cert_tier_for(13, true)  is distinct from 'diamond'  then raise exception 'ladder: 13 is not diamond'; end if;
  if public.cert_tier_for(12, true)  is distinct from 'platinum' then raise exception 'ladder: 12 is not platinum'; end if;
  if public.cert_tier_for(6,  true)  is distinct from 'gold'     then raise exception 'ladder: 6 is not gold'; end if;
  if public.cert_tier_for(3,  true)  is not null                 then raise exception 'ladder: 3 marks should certify nothing'; end if;
  -- Ownership is a gate, not a mark you can make up for elsewhere.
  if public.cert_tier_for(14, false) is not null then raise exception 'ladder: an unowned record must never certify'; end if;
  raise notice 'Certification: Silver 4 / Gold 6 / Platinum 9 / Diamond 13, max 14 marks, ownership required.';
end $$;
