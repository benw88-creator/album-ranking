-- ============================================================================
-- Suggestions — what people push to the feed, and what people want made
--
-- Apply this by hand in the SQL editor, like the others. Idempotent throughout,
-- because "applied by hand and not recorded in Supabase's migration history" is
-- the normal case on this project rather than the exception.
--
-- ---------------------------------------------------------------------------
-- WHY THESE TWO THINGS SHARE A TABLE
-- ---------------------------------------------------------------------------
-- Two features were asked for and they are the same shape:
--
--   * push a song to For You, so other people see it
--   * suggest a producer tag, and see what other people are suggesting
--
-- Both are "one person puts a short thing forward, everybody can see it, and
-- the interesting number is how many people put the same thing forward". One
-- table with a `kind` column, one uniqueness rule, one set of policies. Two
-- tables would be two sets of RLS to keep in step for no difference in
-- behaviour, and a third suggestion type later would be a third.
--
-- ---------------------------------------------------------------------------
-- THE UNIQUENESS RULE IS THE WHOLE DEFENCE
-- ---------------------------------------------------------------------------
-- (kind, user_id, key) is the primary key. One person may back a given thing
-- ONCE, ever — so the count under a suggestion is a count of PEOPLE and not a
-- count of taps, and nothing in the client has to remember to check. Pressing
-- it again is an upsert that changes the timestamp and nothing else.
--
-- It is not a vote, deliberately. There is no down-vote and no score, because
-- the useful question here is "who else wants this" and a score invites
-- brigading a table that has no moderation behind it. Rows can be withdrawn by
-- the person who wrote them and by nobody else.
--
-- `key` is a NORMALISED form and `label` is what to print. The key is what
-- makes two people who typed "TRAVIS" and "travis " the same suggestion; the
-- label is the first spelling anybody used, so the chip reads like a tag and
-- not like a slug. Normalising is done HERE, in suggestion_add, and not in the
-- browser — two copies of a fold rule is how album_match_key and the client
-- disagreed about every accented title.
--
-- ACCENTS FOLD, THEY NEVER STRIP. `translate()` rather than the `unaccent`
-- extension, because an extension that is not installed is a migration that
-- fails. Stripping instead of folding turns Beyonce' into `beyonc` and JAY-Z
-- into `jaz`, which match nothing — the same bug this project has now shipped
-- twice, once in JavaScript and once in SQL.
--
-- ---------------------------------------------------------------------------
-- NOTHING HERE PAYS ANYTHING
-- ---------------------------------------------------------------------------
-- No Discs, no XP, no counter on `profiles`, no pin-trigger change. That is
-- deliberate and it is what keeps this cheap: the moment a suggestion is worth
-- currency it becomes a thing to farm with burner accounts, and it would need
-- the whole apparatus the referral gates needed. A suggestion is worth making
-- because other people see it.
-- ============================================================================

create table if not exists public.suggestions (
  kind        text        not null check (kind in ('song', 'tag')),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  key         text        not null,
  label       text        not null,
  -- Only meaningful for kind='song'. Kept as plain columns rather than jsonb
  -- because the feed reads every one of them on every card and a jsonb
  -- extraction per field per row is a cost for no flexibility anybody wants.
  artist      text,
  album       text,
  album_id    text,
  art         text,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (kind, user_id, key)
);

create index if not exists suggestions_kind_key_idx  on public.suggestions (kind, key);
create index if not exists suggestions_kind_time_idx on public.suggestions (kind, created_at desc);

alter table public.suggestions enable row level security;

-- Public to read: the entire point is that other people see what you put
-- forward. Same posture as crate_feed, and for the same reason.
drop policy if exists "suggestions are public" on public.suggestions;
create policy "suggestions are public" on public.suggestions
  for select using (true);

-- Written only through suggestion_add, which normalises the key. A direct
-- insert could file "Travis" and "TRAVIS " as two different suggestions and
-- split the count, which is the one thing this table exists to avoid.
drop policy if exists "withdraw your own suggestion" on public.suggestions;
create policy "withdraw your own suggestion" on public.suggestions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- normalise
-- Mirrors normName() in api/_artists.js and the client's own fold. FOLD FIRST,
-- STRIP SECOND — the other order deletes the accented letter instead of
-- replacing it.
create or replace function public.suggestion_key(p_text text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select nullif(
    regexp_replace(
      lower(translate(coalesce(p_text, ''),
        'àáâãäåèéêëìíîïòóôõöùúûüçñýÿšžÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑÝŸŠŽ',
        'aaaaaaeeeeiiiiooooouuuucnyyszAAAAAAEEEEIIIIOOOOOUUUUCNYYSZ')),
      '[^a-z0-9]+', '', 'g'),
    '');
$$;

-- ---------------------------------------------------------------- add
-- The caller names the thing and never the count. Re-pressing is an upsert, so
-- there is no way to back the same thing twice and no way for a client to
-- inflate a number it can see.
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
  v_me    uuid := auth.uid();
  v_key   text;
  v_label text;
  v_n     integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('song', 'tag') then raise exception 'Unknown suggestion kind %', p_kind; end if;

  -- Trimmed and capped before anything else. A tag is a few words on a chip
  -- and a song title is a title; neither has any business being a paragraph,
  -- and the cap is here rather than in the browser because the browser is not
  -- what this table has to be safe against.
  v_label := btrim(coalesce(p_label, ''));
  if p_kind = 'tag' then v_label := left(v_label, 40); else v_label := left(v_label, 160); end if;
  v_key := public.suggestion_key(v_label);
  if v_key is null then raise exception 'That is empty once punctuation is taken off it'; end if;

  -- A song's key carries the artist, because two different records share a
  -- title constantly and folding them together would be the "two keys for one
  -- record" trap pointing the other way — one key for two records.
  if p_kind = 'song' and coalesce(p_artist, '') <> '' then
    v_key := v_key || '|' || public.suggestion_key(p_artist);
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
    note       = coalesce(excluded.note, public.suggestions.note),
    created_at = now();

  select count(*) into v_n from public.suggestions where kind = p_kind and key = v_key;
  return jsonb_build_object('ok', true, 'key', v_key, 'label', v_label, 'backers', v_n);
end $$;

revoke all on function public.suggestion_add(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.suggestion_add(text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------- read
-- One row per distinct suggestion with a count of people, newest activity
-- first, and a flag for whether the caller is one of them. That last field is
-- why this is a function rather than a view: a view would need a second query
-- per render to answer "have I already backed this", and the button's label
-- depends on it.
--
-- `p_q` filters, which is what makes the tag box able to say "here is what
-- other people are suggesting under TRAVIS" as somebody types.
--
-- SIGNED OUT IS A REAL CALLER. auth.uid() is NULL there, and `mine` must come
-- back FALSE and not NULL — the same three-valued-logic trap that published
-- every logged-out visitor's certification breakdown. coalesce, explicitly.
create or replace function public.suggestion_list(
  p_kind text,
  p_q text default null,
  p_limit integer default 40
) returns table (
  key text, label text, artist text, album text, album_id text, art text,
  note text, backers bigint, last_at timestamptz, mine boolean
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select
    s.key,
    -- The first spelling anybody used, so the chip reads like a tag rather
    -- than like the normalised key.
    (array_agg(s.label order by s.created_at))[1]              as label,
    (array_agg(s.artist order by s.created_at) filter (where s.artist is not null))[1]   as artist,
    (array_agg(s.album order by s.created_at) filter (where s.album is not null))[1]     as album,
    (array_agg(s.album_id order by s.created_at) filter (where s.album_id is not null))[1] as album_id,
    (array_agg(s.art order by s.created_at) filter (where s.art is not null))[1]         as art,
    (array_agg(s.note order by s.created_at desc) filter (where s.note is not null))[1]  as note,
    count(*)                                                    as backers,
    max(s.created_at)                                           as last_at,
    coalesce(bool_or(s.user_id = auth.uid()), false)            as mine
  from public.suggestions s
  where s.kind = p_kind
    and (p_q is null or public.suggestion_key(p_q) is null
         or s.key like public.suggestion_key(p_q) || '%')
  group by s.key
  -- Most-backed first, then most recent. A suggestion nobody else has made is
  -- still worth seeing, which is why this is not filtered on a minimum.
  order by count(*) desc, max(s.created_at) desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.suggestion_list(text,text,integer) from public;
grant execute on function public.suggestion_list(text,text,integer) to anon, authenticated;

-- ---------------------------------------------------------------- withdraw
create or replace function public.suggestion_remove(p_kind text, p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  delete from public.suggestions where kind = p_kind and key = p_key and user_id = v_me;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.suggestion_remove(text,text) from public, anon;
grant execute on function public.suggestion_remove(text,text) to authenticated;

-- ---------------------------------------------------------------- deletion
-- ADDING A TABLE THAT HOLDS USER ROWS MEANS ADDING IT TO THIS ARRAY IN THE
-- SAME MIGRATION. Missing that line is how app_state survived account deletion
-- for weeks. Re-declared in full from ..._20260917120000_recall.sql with one
-- pair added and nothing else touched.
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
    ['milestone_claims','user_id'], ['recall_results','user_id'],
    ['suggestions','user_id']
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
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

-- ------------------------------------------------------------------- guards
do $$
begin
  -- The uniqueness rule IS the feature. Without it the backer count is a count
  -- of taps and one person can run it up on their own.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.suggestions'::regclass and contype = 'p'
  ) then
    raise exception 'suggestions has no primary key — one person could back the same thing repeatedly';
  end if;

  -- No insert or update policy, ever. Everything goes through suggestion_add,
  -- which is what normalises the key; a direct insert could split one
  -- suggestion into two by spelling it differently.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'suggestions'
       and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception 'suggestions has a write policy — keys must be normalised by suggestion_add, never supplied by a client';
  end if;

  -- Folding, not stripping. If this ever comes back 'beyonc' the whole table
  -- silently splits accented entries in two.
  if public.suggestion_key('Beyoncé') <> 'beyonce' then
    raise exception 'suggestion_key strips accents instead of folding them: got %', public.suggestion_key('Beyoncé');
  end if;
  if public.suggestion_key('JAŸ-Z') <> 'jayz' then
    raise exception 'suggestion_key mangles JAY-Z: got %', public.suggestion_key('JAŸ-Z');
  end if;

  -- A logged-out reader must get false, not null.
  if (select prosrc from pg_proc where proname = 'suggestion_list') not like '%coalesce(bool_or%' then
    raise exception 'suggestion_list does not coalesce `mine` — it would be NULL for an anonymous caller';
  end if;

  if (select prosrc from pg_proc where proname = 'delete_my_data') not like '%suggestions%' then
    raise exception 'delete_my_data does not clear suggestions';
  end if;
end $$;
