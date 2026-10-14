-- Community Choice: Beat drops, a fifth category beside Verse, Feature, Hook
-- and Beat switch. Apply by hand in the SQL editor, like the others.
-- Idempotent: safe to run twice, and safe on a database where it already ran.
--
-- The category list lives in ONE check constraint. 20261002120000 declared it
-- inline on the column, so Postgres named it moments_category_check — the same
-- naming 20261002180000 relied on to drop moments_start_ms_check. Rather than
-- trust the name, every check on public.moments whose definition is the
-- category LIST (it names 'verse') is dropped and one named constraint is put
-- back. moments_feature mentions category too ("category <> 'feature'") and
-- does not name 'verse', so it is left exactly as it is.
--
-- Nothing else changes. Beat drops use the same table, the same RLS, the same
-- insert trigger (stamped user, zeroed likes, 20 picks a day), the same
-- moment_likes count trigger and the same one-pick-per-song-per-category rule —
-- which means one song may carry both a beat switch and a beat drop from the
-- same person, because they are different moments.
--
-- Before this lands the client still reads drops (the filter returns nothing)
-- and a post is refused by the old constraint; the picker reports that as "not
-- switched on yet" rather than as a failure.

do $$
declare
  r record;
begin
  if to_regclass('public.moments') is null then
    raise exception 'public.moments does not exist — apply 20261002120000_community_choice.sql first';
  end if;

  for r in
    select conname from pg_constraint
     where conrelid = 'public.moments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'category'
       and pg_get_constraintdef(oid) ~ '''verse'''
  loop
    execute format('alter table public.moments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.moments add constraint moments_category_check
  check (category in ('verse', 'feature', 'hook', 'beat', 'drop'));

-- Guards: the widened list landed and is the only list; the ranking column is
-- still out of every client's reach.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.moments'::regclass and conname = 'moments_category_check'
       and pg_get_constraintdef(oid) ~ '''drop'''
  ) then
    raise exception 'moments_category_check did not land with drop in it';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.moments'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) ~ '''verse''') <> 1 then
    raise exception 'more than one category list on public.moments';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.moments'::regclass and conname = 'moments_feature') then
    raise exception 'moments_feature went missing — it must not be touched by this migration';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'moments' and cmd in ('UPDATE', 'ALL')) then
    raise exception 'moments must have no UPDATE policy — likes would become client-writable';
  end if;
end $$;
