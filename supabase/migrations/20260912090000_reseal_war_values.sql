-- Bid War values go back to being hidden — and this time actually are.
--
-- ---------------------------------------------------------------------------
-- Why this reverses ..._20260911170000_war_modes_open_values.sql
-- ---------------------------------------------------------------------------
-- Opening the values turned the game into pure chip allocation. Both players
-- staring at the same five numbers removes the thing Bid Wars was for, which
-- is backing your own read of which record the world actually listens to.
-- Colonel Blotto is a fine game; it is not this one.
--
-- The argument for opening them was that /api/album-streams is public and
-- returns the same figure, so the seal was decorative and only handicapped the
-- player who did not think to check. That argument was right about the leak
-- and wrong about the remedy: the fix is to close the endpoint, not to give up
-- on the seal. `api/album-streams.js` now requires a Supabase JWT and refuses
-- any album sitting on one of the caller's own pending boards.
--
-- So: seal without leak, rather than seal with leak or leak without seal.
--
-- Existing pending wars created while values were open still carry `value`
-- inside `records`. The client omits it from the bidding board unconditionally
-- rather than checking whether the field is there, so those wars are covered
-- too without a data migration.

-- p_records: [{album_id,name,artist,art,value}] — `value` is stripped again.
create or replace function public.bid_war_create_from(
  p_initiator uuid, p_opponent uuid, p_records jsonb, p_mode text default 'streams')
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_war public.bid_wars;
begin
  if p_initiator is null or p_opponent is null then raise exception 'Missing player'; end if;
  if p_initiator = p_opponent then raise exception 'You cannot challenge yourself'; end if;
  if p_mode not in ('streams', 'market') then raise exception 'Unknown mode: %', p_mode; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then
    raise exception 'That player does not exist';
  end if;
  if jsonb_array_length(p_records) <> 5 then raise exception 'A war needs five records'; end if;

  if exists (
    select 1 from public.bid_wars
    where status = 'pending'
      and ((initiator_id = p_initiator and opponent_id = p_opponent)
        or (initiator_id = p_opponent and opponent_id = p_initiator))
  ) then
    raise exception 'You already have a war running with them';
  end if;

  -- The one line that matters. bid_war_values keeps the real figures where no
  -- client policy can reach them, and bid_war_submit folds them back into
  -- `records` at resolution — which is exactly when revealing them is the
  -- point.
  insert into public.bid_wars (initiator_id, opponent_id, records, mode)
  values (p_initiator, p_opponent,
          (select jsonb_agg(r - 'value') from jsonb_array_elements(p_records) r),
          p_mode)
  returning * into v_war;

  insert into public.bid_war_values (war_id, album_id, value)
  select v_war.id, r->>'album_id', (r->>'value')::bigint
  from jsonb_array_elements(p_records) r;

  insert into public.notifications (user_id, actor_id, type, data)
  select p_opponent, p_initiator, 'bid_war_challenge',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', v_war.id,
                            'mode', p_mode)
  from public.profiles p where p.id = p_initiator;

  return v_war;
end;
$$;

revoke all on function public.bid_war_create_from(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.bid_war_create_from(uuid, uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- Which albums is this person currently forbidden from pricing?
-- ---------------------------------------------------------------------------
-- Used by api/album-streams.js to refuse a lookup for a record sitting on one
-- of the caller's own pending boards. Returns album ids only — never values —
-- so it leaks nothing even though the caller can read its output.
create or replace function public.my_sealed_albums()
returns table (album_id text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select distinct r->>'album_id'
  from public.bid_wars w,
       lateral jsonb_array_elements(w.records) r
  where w.status = 'pending'
    and (w.initiator_id = auth.uid() or w.opponent_id = auth.uid());
$$;

revoke all on function public.my_sealed_albums() from public, anon;
grant execute on function public.my_sealed_albums() to authenticated;
