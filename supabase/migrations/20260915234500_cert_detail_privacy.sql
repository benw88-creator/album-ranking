-- `collection_marks` handed its private half to anonymous callers.
--
-- ---------------------------------------------------------------------------
-- The bug
-- ---------------------------------------------------------------------------
--   v_self boolean := (p_user = auth.uid());
--   ...
--   if not v_self then return <public shape>; end if;
--   return <full shape, with detail>;
--
-- For a signed-in caller looking at somebody else that is correct. For an
-- anonymous one `auth.uid()` is NULL, so `p_user = auth.uid()` is **NULL and
-- not false**, `not NULL` is NULL, the `if` does not fire, and execution falls
-- through to the full return. Every logged-out visitor got the breakdown:
-- whether a note was written, how many Lore questions were answered about the
-- record, how many of its songs were rated, how long it has been held.
--
-- Caught by calling the function from a logged-out browser against a real
-- shelf, which is worth doing to anything with a `v_self` in it.
--
-- **Three-valued logic is the failure mode to expect here**, not a typo. The
-- guard read correctly in English and is wrong only for the one caller nobody
-- pictures while writing it. Anywhere a boolean gates a privacy branch, decide
-- what NULL means and say so — `coalesce(..., false)` or an explicit null test,
-- never a bare comparison against `auth.uid()`.
--
-- The tier, the finish, the inscription and the Master flag stay public, which
-- is the design: the award is meant to be seen, the workings are not.
--
-- Everything below is ..._20260915220000_certification.sql's function verbatim
-- with the one declaration changed.

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
  -- An anonymous caller is not you. `p_user = auth.uid()` alone is NULL here,
  -- and `not NULL` does not take the branch it looks like it takes.
  v_self   boolean := (auth.uid() is not null and p_user = auth.uid());
begin
  if p_user is null or p_album is null then
    return jsonb_build_object('marks', 0, 'tier', null, 'owned', false);
  end if;

  select * into v_row from public.collection
   where user_id = p_user and album_id = p_album;
  v_owned := v_row.user_id is not null;

  -- Cast, because `data` may be json rather than jsonb depending on how the
  -- core table was made by hand in the dashboard.
  select r.data::jsonb into v_data from public.ratings r
   where r.user_id = p_user and r.kind = 'album' and r.item_id = p_album;

  if v_data is not null then
    if (v_data ->> 'score') is not null then v_marks := v_marks + 1; end if;
    if coalesce(btrim(v_data ->> 'note'), '') <> '' then v_marks := v_marks + 1; end if;

    v_hist := v_data -> 'history';
    if v_hist is not null and jsonb_typeof(v_hist) = 'array' then
      v_len := jsonb_array_length(v_hist);
      if v_len >= 2 then
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

  select count(*) into v_songs from public.ratings r
   where r.user_id = p_user and r.kind = 'song' and (r.data::jsonb) ->> 'albumId' = p_album;
  if v_songs >= 3 then v_marks := v_marks + 1; end if;
  if v_songs >= 8 then v_marks := v_marks + 1; end if;

  v_tier := public.cert_tier_for(v_marks, v_owned);

  -- The award is public, the workings are not.
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

revoke all on function public.collection_marks(uuid, text) from public, anon;
grant execute on function public.collection_marks(uuid, text) to authenticated, anon;

do $$
begin
  -- auth.uid() is null in the SQL editor, so this asserts the exact case that
  -- was broken: a caller with no session must not get `detail`.
  if (public.collection_marks('00000000-0000-0000-0000-000000000000'::uuid, 'x')) ? 'detail' then
    raise exception 'collection_marks still returns detail to a caller with no session';
  end if;
  raise notice 'collection_marks: detail is owner-only.';
end $$;
