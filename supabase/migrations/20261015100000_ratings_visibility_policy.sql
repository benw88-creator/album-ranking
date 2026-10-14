-- Ratings privacy. REVIEW/APPLY ONLY AFTER APPROVAL (see LAUNCH-REVIEW.md).
-- Production has a permissive SELECT policy "ratings are public to read"
-- USING (true). Permissive policies OR together, so it overrode
-- "ratings select friends or public" and anon could read private ratings.
-- Dropping it leaves owner + public + mutual-friends reads. Changes no rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Refuse rather than guess: the two policies that must carry reads afterwards
-- were created by hand in the dashboard and are recorded nowhere else.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ratings'
                   and policyname = 'ratings select own' and cmd = 'SELECT') then
    raise exception 'ratings: owner SELECT policy missing; review policies before dropping the public one';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ratings'
                   and policyname = 'ratings select friends or public' and cmd = 'SELECT') then
    raise exception 'ratings: public/friends SELECT policy missing; review policies before dropping the public one';
  end if;
end $$;

drop policy if exists "ratings are public to read" on public.ratings;

-- Guard: no unconditional read may remain or come back under another name.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ratings'
               and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL') and qual = 'true') then
    raise exception 'ratings: an unconditional permissive read policy still exists';
  end if;
end $$;

commit;
