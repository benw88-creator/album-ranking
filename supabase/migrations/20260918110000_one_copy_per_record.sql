-- ============================================================================
-- One owned copy per record, per person — across EVERY purchase path.
--
-- Apply by hand in the SQL editor, like the others. Idempotent: both functions
-- are `create or replace` and the helper is too.
--
-- WHAT WAS ACTUALLY BROKEN
--
-- Not the limit. `collection` has `primary key (user_id, album_id)`, and both
-- `collection_buy_from` and `collection_claim_pick_from` already raise
-- "You already own that one" on it. A second copy could never be written under
-- one id and never was.
--
-- What happened is that ONE RECORD HAD TWO IDS. A record bought before the
-- catalogue moved to Deezer carries a Spotify base62 id; the Market now offers
-- the same record under Deezer's numeric one. Different ids, so the primary
-- key is satisfied, the check passes, and the shelf grows a second Blonde.
--
-- Exactly the shape of the Crate's "Your call" bug, where `myScoreFor` looked a
-- record up by id and offered the rate-it button on albums people had
-- definitely rated — same record, two keys, no match. Same answer here: fall
-- back to the NAME when the id does not match.
--
-- WHY THIS BELONGS IN SQL AND NOT ONLY IN THE BUTTON
--
-- The client half of this is a read that hides a button. That is worth having,
-- because a button you cannot press is better than an error you have to read.
-- But it is not the limit — the limit has to be somewhere a request cannot get
-- past, for the same reason `wallet_buy` takes a key and never a price. There
-- are two purchase paths and a third could be added tomorrow; putting the rule
-- in the two definer functions puts it under all of them.
--
-- NOTHING IS RE-KEYED AND NOTHING EXISTING IS DELETED. Anybody already holding
-- two copies keeps both — this stops a third from being created, and merging
-- rows would mean choosing which price and which bought_at are the real ones,
-- which is a decision with no right answer and is not one to make on somebody's
-- behalf inside a bug fix.
-- ============================================================================

-- ---------------------------------------------------------------- the key
-- Deliberately the same rule the browser uses in colKey(): fold accents, drop
-- anything bracketed, strip to letters and digits. It is duplicated across the
-- two languages and that is unavoidable — but it is written out in both places
-- as the same four steps so a change to one is visibly a change the other
-- needs, the same arrangement as LADDER against v_ladder.
--
-- ACCENTS ARE FOLDED, NOT STRIPPED, and the first draft of this stripped them.
-- JavaScript's NFD normalise turns Beyoncé into "beyonce"; a bare
-- `[^a-z0-9]` strip in SQL turns it into "beyonc", so the two languages
-- disagreed about every accented title in the catalogue — and this is exactly
-- the bug that cost five covers in the artwork pass, in the other language.
-- `translate` rather than the unaccent extension, because translate is always
-- there and an extension that is not installed is a migration that fails.
create or replace function public.album_match_key(p_name text, p_artist text)
returns text
language sql immutable
as $$
  select case when n = '' then '' else n || '|' || a end
  from (
    select
      regexp_replace(translate(lower(regexp_replace(coalesce(p_name, ''),   '\([^)]*\)|\[[^\]]*\]', '', 'g')), 'áàâäãåÁÀÂÄÃÅéèêëÉÈÊËíìîïÍÌÎÏóòôöõÓÒÔÖÕúùûüÚÙÛÜñÑçÇýÿŷ', 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy'), '[^a-z0-9]', '', 'g') as n,
      regexp_replace(translate(lower(regexp_replace(coalesce(p_artist, ''), '\([^)]*\)|\[[^\]]*\]', '', 'g')), 'áàâäãåÁÀÂÄÃÅéèêëÉÈÊËíìîïÍÌÎÏóòôöõÓÒÔÖÕúùûüÚÙÛÜñÑçÇýÿŷ', 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy'), '[^a-z0-9]', '', 'g') as a
  ) t;
$$;
grant execute on function public.album_match_key(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- buying
create or replace function public.collection_buy_from(
  p_user uuid, p_album_id text, p_name text, p_artist text, p_art text, p_price bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles;
  v_key text := public.album_match_key(p_name, p_artist);
  v_dupe text;
begin
  if p_user is null or p_album_id is null then raise exception 'Missing album'; end if;
  if p_price is null or p_price < 0 then raise exception 'Bad price'; end if;

  if exists (select 1 from public.collection where user_id = p_user and album_id = p_album_id) then
    raise exception 'You already own that one';
  end if;

  -- The same record under another id. See the header: this is what actually
  -- put a second copy on a shelf.
  if v_key <> '' then
    select name into v_dupe from public.collection
     where user_id = p_user and public.album_match_key(name, artist) = v_key
     limit 1;
    if v_dupe is not null then
      raise exception 'You already own % — it is on your shelf under its old catalogue id', v_dupe;
    end if;
  end if;

  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'No profile'; end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < p_price then
    raise exception 'That costs % Discs and you have %', p_price, coalesce(p.discs, 0);
  end if;

  insert into public.collection (user_id, album_id, name, artist, art, price)
  values (p_user, p_album_id, coalesce(p_name, 'Unknown'), p_artist, p_art, p_price);

  if not coalesce(p.is_admin, false) then
    update public.profiles set discs = discs - p_price where id = p_user returning * into p;
  end if;

  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'price', p_price,
    'discs', p.discs,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = p_user),
    'owned', (select count(*) from public.collection where user_id = p_user));
end $$;

revoke all on function public.collection_buy_from(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.collection_buy_from(uuid, text, text, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------- picks
-- The reported path. A Mythic pick costs no Discs, so a duplicate here is a
-- wasted prize rather than a wasted balance — which is worse, because the
-- prize is the rare one.
create or replace function public.collection_claim_pick_from(
  p_user uuid, p_album_id text, p_name text, p_artist text, p_art text, p_price bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles;
  v_key text := public.album_match_key(p_name, p_artist);
  v_dupe text;
begin
  if p_user is null or p_album_id is null then raise exception 'Missing album'; end if;
  if p_price is null or p_price < 0 then raise exception 'Bad price'; end if;

  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'No profile'; end if;
  if coalesce(p.album_picks, 0) < 1 then raise exception 'You have no album picks left'; end if;

  -- Checked BEFORE the pick is spent, and before the row is written. The
  -- ordering is the whole point: a pick decremented and then refused would
  -- cost somebody a Mythic prize for a record they already have.
  if exists (select 1 from public.collection where user_id = p_user and album_id = p_album_id) then
    raise exception 'You already own that one — your pick is untouched';
  end if;
  if v_key <> '' then
    select name into v_dupe from public.collection
     where user_id = p_user and public.album_match_key(name, artist) = v_key
     limit 1;
    if v_dupe is not null then
      raise exception 'You already own % — your pick is untouched', v_dupe;
    end if;
  end if;

  insert into public.collection (user_id, album_id, name, artist, art, price, via_pick)
  values (p_user, p_album_id, coalesce(p_name, 'Unknown'), p_artist, p_art, p_price, true);

  update public.profiles set album_picks = album_picks - 1
   where id = p_user returning * into p;

  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'price', p_price, 'via_pick', true,
    'discs', p.discs, 'album_picks', p.album_picks,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = p_user),
    'owned', (select count(*) from public.collection where user_id = p_user));
end $$;

revoke all on function public.collection_claim_pick_from(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.collection_claim_pick_from(uuid, text, text, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------- guards
do $$
begin
  -- The key must fold case, accents-adjacent punctuation and brackets, or the
  -- fallback does not fire on the records it exists for.
  if public.album_match_key('Blonde', 'Frank Ocean')
     is distinct from public.album_match_key('blonde (Deluxe)', 'FRANK OCEAN') then
    raise exception 'album_match_key does not normalise — the duplicate check will not fire';
  end if;
  -- Accents FOLD to their base letter. Stripping them instead is what made
  -- SQL and JavaScript disagree about Beyoncé.
  if public.album_match_key('Renaissance', 'Beyoncé')
     is distinct from public.album_match_key('Renaissance', 'Beyonce') then
    raise exception 'album_match_key strips accents instead of folding them — it will not agree with the browser';
  end if;
  -- ...and must NOT collapse two different records into one.
  if public.album_match_key('Blonde', 'Frank Ocean')
     = public.album_match_key('Blond', 'Frank Ocean') then
    raise exception 'album_match_key is too loose';
  end if;
  -- An empty name must not match every other empty name, or one bad row on a
  -- shelf would block every future purchase.
  if public.album_match_key('', '') <> '' then
    raise exception 'album_match_key must return empty for an empty name';
  end if;

  -- Still no client write path to the table.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'collection'
       and cmd in ('INSERT', 'UPDATE', 'ALL'))
  then
    raise exception 'collection must have no client write policy — buying goes through the definer functions';
  end if;
end $$;
