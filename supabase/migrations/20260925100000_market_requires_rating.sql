-- ============================================================================
-- The Market must only sell a record you have already rated.
--
-- Bug: the buy button was hidden for an unrated record client-side, but
-- collection_buy_from / collection_claim_pick_from never checked it — a
-- direct call (refresh mid-flow, or the route hit without the UI) could buy
-- anything. Checked here, under both purchase paths, the same place the
-- one-copy-per-record rule lives, for the same reason: a client-side hide is
-- not a limit.
--
-- Matched by id OR by album_match_key(name, artist) off ratings.data, same
-- fallback collection dedup already uses, for the same two-ids reason.
-- ============================================================================

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
  v_rated boolean;
begin
  if p_user is null or p_album_id is null then raise exception 'Missing album'; end if;
  if p_price is null or p_price < 0 then raise exception 'Bad price'; end if;

  select exists (
    select 1 from public.ratings r
     where r.user_id = p_user and r.kind = 'album'
       and (r.item_id = p_album_id
            or (v_key <> '' and public.album_match_key(r.data->>'name', r.data->>'artist') = v_key))
  ) into v_rated;
  if not v_rated then
    raise exception 'Rate a record before buying it';
  end if;

  if exists (select 1 from public.collection where user_id = p_user and album_id = p_album_id) then
    raise exception 'You already own that one';
  end if;

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
  v_rated boolean;
begin
  if p_user is null or p_album_id is null then raise exception 'Missing album'; end if;
  if p_price is null or p_price < 0 then raise exception 'Bad price'; end if;

  select exists (
    select 1 from public.ratings r
     where r.user_id = p_user and r.kind = 'album'
       and (r.item_id = p_album_id
            or (v_key <> '' and public.album_match_key(r.data->>'name', r.data->>'artist') = v_key))
  ) into v_rated;
  if not v_rated then
    raise exception 'Rate a record before buying it';
  end if;

  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'No profile'; end if;
  if coalesce(p.album_picks, 0) < 1 then raise exception 'You have no album picks left'; end if;

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
