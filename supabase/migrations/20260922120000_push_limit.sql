-- Ten pushes a day, counted by the server.
--
-- Apply by hand in the SQL editor, like the others. Idempotent.
--
-- ---------------------------------------------------------------------------
-- WHY THE COUNT IS OF ROWS CREATED TODAY AND NOT OF TAPS
-- ---------------------------------------------------------------------------
-- `suggestions` is keyed (kind, user_id, key), so pushing the same record
-- again has always been an upsert rather than a second row — that is what makes
-- the backer count a count of PEOPLE. The daily limit has to inherit the same
-- property, or backing something you pushed last week would silently spend
-- today's allowance.
--
-- So `created_at` STOPS BEING BUMPED on conflict. It was being set to now()
-- every time, which is fine for "most recent activity" ordering and fatal for a
-- daily quota: re-backing an old suggestion would move it into today and cost a
-- slot. It now means what it says — when this person first put this thing
-- forward — and the quota counts rows whose created_at falls today.
--
-- A consequence worth knowing: `suggestion_list` orders by backer count and
-- then by max(created_at), so a re-back no longer floats an old suggestion to
-- the top of the tie-break. That is the better reading anyway — the count is
-- what moved, and the count is what it sorts by first.
--
-- ---------------------------------------------------------------------------
-- WHY TEN, AND WHY IT IS NOT A DISC FAUCET
-- ---------------------------------------------------------------------------
-- Ten is enough to push everything you played this morning and not enough to
-- paste a discography into everybody else's feed. Pushing still pays nothing —
-- see the header of ..._20260921120000: the moment a suggestion is worth
-- currency it is a thing to farm from burner accounts. The limit here is about
-- the FEED's quality, not about money, which is why it can be this simple.
--
-- Tags are deliberately NOT capped. A tag suggestion is a request for something
-- to be made and there are only so many real ones; a song push goes into what
-- other people see, which is the thing worth rationing.
-- ---------------------------------------------------------------------------

create or replace function public.suggestion_add(
  p_kind text,
  p_label text,
  p_artist text default null,
  p_album text default null,
  p_album_id text default null,
  p_art text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_key    text;
  v_label  text;
  v_n      integer;
  v_today  integer;
  v_limit  constant integer := 10;
  v_isnew  boolean;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('song', 'tag') then raise exception 'Unknown suggestion kind %', p_kind; end if;

  v_label := btrim(coalesce(p_label, ''));
  if p_kind = 'tag' then v_label := left(v_label, 40); else v_label := left(v_label, 160); end if;
  v_key := public.suggestion_key(v_label);
  if v_key is null then raise exception 'That is empty once punctuation is taken off it'; end if;

  if p_kind = 'song' and coalesce(p_artist, '') <> '' then
    v_key := v_key || '|' || public.suggestion_key(p_artist);
  end if;

  -- Is this a NEW push, or a re-back of something already put forward? Only
  -- the first costs a slot, and the check has to happen before the insert.
  select not exists (
    select 1 from public.suggestions
     where kind = p_kind and user_id = v_me and key = v_key
  ) into v_isnew;

  if p_kind = 'song' and v_isnew then
    select count(*) into v_today
      from public.suggestions
     where kind = 'song' and user_id = v_me
       and created_at >= (now() at time zone 'utc')::date;
    if v_today >= v_limit then
      raise exception 'You have pushed % records today. More tomorrow.', v_limit;
    end if;
  end if;

  insert into public.suggestions (kind, user_id, key, label, artist, album, album_id, art, note)
  values (p_kind, v_me, v_key, v_label,
          nullif(btrim(coalesce(p_artist, '')), ''),
          nullif(btrim(coalesce(p_album, '')), ''),
          nullif(btrim(coalesce(p_album_id, '')), ''),
          nullif(btrim(coalesce(p_art, '')), ''),
          nullif(left(btrim(coalesce(p_note, '')), 140), ''))
  on conflict (kind, user_id, key) do update set
    label      = excluded.label,
    artist     = coalesce(excluded.artist, public.suggestions.artist),
    album      = coalesce(excluded.album, public.suggestions.album),
    album_id   = coalesce(excluded.album_id, public.suggestions.album_id),
    art        = coalesce(excluded.art, public.suggestions.art),
    note       = coalesce(excluded.note, public.suggestions.note);
    -- created_at deliberately NOT touched. See the header.

  select count(*) into v_n from public.suggestions where kind = p_kind and key = v_key;

  select count(*) into v_today
    from public.suggestions
   where kind = 'song' and user_id = v_me
     and created_at >= (now() at time zone 'utc')::date;

  return jsonb_build_object(
    'ok', true, 'key', v_key, 'label', v_label, 'backers', v_n,
    'pushed_today', v_today, 'push_limit', v_limit,
    'pushes_left', greatest(0, v_limit - v_today));
end $$;

revoke all on function public.suggestion_add(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.suggestion_add(text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------- read
-- What is left today, so the button can say so before it is pressed rather
-- than only refusing afterwards. A limit you find by hitting it is a
-- disappointment; a limit on the control is a rule — the same line the Higher
-- or Lower run cap draws.
create or replace function public.suggestion_quota()
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'used', c.n,
    'limit', 10,
    'left', greatest(0, 10 - c.n))
  from (
    select count(*)::int as n
      from public.suggestions
     where kind = 'song' and user_id = auth.uid()
       and created_at >= (now() at time zone 'utc')::date
  ) c;
$$;

revoke all on function public.suggestion_quota() from public, anon;
grant execute on function public.suggestion_quota() to authenticated;

-- ------------------------------------------------------------------- guards
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'suggestion_add';

  -- The cap has to be in the function, not on the button.
  if v_src not like '%pushed % records today%' then
    raise exception 'suggestion_add does not enforce a daily push limit';
  end if;

  -- If created_at is bumped again, re-backing an old push spends a slot.
  if v_src like '%created_at = now()%' then
    raise exception 'suggestion_add bumps created_at on conflict — a re-back would cost a daily slot';
  end if;

  -- The caller must never be able to name the limit.
  if v_src like '%p_limit%' then
    raise exception 'suggestion_add takes a limit from the caller';
  end if;

  raise notice 'Song pushes capped at 10 a day. Tags are uncapped, deliberately.';
end $$;
