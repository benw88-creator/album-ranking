-- NOT APPLIED. Review, then paste into the SQL editor and record with
-- `supabase migration repair --status applied 20261023180000`.
--
-- ratings had six policies, written in the dashboard and never in a migration:
--   SELECT "ratings select own"                (auth.uid() = user_id)
--   SELECT "ratings select friends or public"  public, or mutual follow when 'friends'
--   INSERT "ratings insert own"                 check (auth.uid() = user_id)
--   UPDATE "ratings update own"                 using (auth.uid() = user_id)
--   DELETE "ratings delete own"                 using (auth.uid() = user_id)
--   ALL    "users write own ratings"            using + check (auth.uid() = user_id)
-- Every permissive policy for a command is evaluated, so reads paid for two and
-- writes for two, and auth.uid() was re-evaluated on every row. This keeps
-- exactly the same rules as one policy per command, with auth.uid() wrapped in
-- a scalar subquery so Postgres evaluates it once per statement (Supabase's
-- auth_rls_initplan advice). Verified equivalent, row for row, in PGlite:
-- scripts/rls.selfcheck.mjs.
--
-- Behaviour that is deliberately UNCHANGED (worth knowing, not fixing here):
--   * ratings_visibility NULL or anything but 'public'/'friends' hides the
--     rows from everybody but the owner. The client treats a missing value as
--     'public', so a NULL there would read as public in the UI and private in
--     the database. Production should have no NULLs; check before applying:
--       select ratings_visibility, count(*) from public.profiles group by 1;
--   * 'friends' means a MUTUAL follow.
--   * Logged-out readers see public ratings only.

begin;

drop policy if exists "ratings select own" on public.ratings;
drop policy if exists "ratings select friends or public" on public.ratings;
drop policy if exists "ratings insert own" on public.ratings;
drop policy if exists "ratings update own" on public.ratings;
drop policy if exists "ratings delete own" on public.ratings;
drop policy if exists "users write own ratings" on public.ratings;
drop policy if exists "ratings read" on public.ratings;
drop policy if exists "ratings insert" on public.ratings;
drop policy if exists "ratings update" on public.ratings;
drop policy if exists "ratings delete" on public.ratings;

create policy "ratings read" on public.ratings for select using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.profiles p
    where p.id = ratings.user_id
      and (p.ratings_visibility = 'public'
        or (p.ratings_visibility = 'friends'
          and exists (select 1 from public.follows a
                      where a.follower_id = (select auth.uid()) and a.following_id = ratings.user_id)
          and exists (select 1 from public.follows b
                      where b.follower_id = ratings.user_id and b.following_id = (select auth.uid()))))));
create policy "ratings insert" on public.ratings for insert
  with check ((select auth.uid()) = user_id);
create policy "ratings update" on public.ratings for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ratings delete" on public.ratings for delete
  using ((select auth.uid()) = user_id);

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ratings') <> 4 then
    raise exception 'ratings should have exactly four policies after this migration';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ratings'::regclass) then
    raise exception 'RLS is off on ratings';
  end if;
end $$;

commit;
