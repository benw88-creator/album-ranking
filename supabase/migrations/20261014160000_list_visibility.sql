-- ============================================================================
-- Profile list visibility.
--
-- profiles.hidden_lists holds the keys of the lists an account has chosen not
-- to show on its profile: 'now' (Top 5 right now), 'alltime' (Top 10 of all
-- time), 'liked' (Liked songs), a lists.id uuid for one of the user's own
-- lists, or '*' for all of them. The client filters on it for every viewer.
--
-- It is a PRESENTATION preference, not access control: the lists table and the
-- top_songs_* columns stay as readable as before. It needs no new policy —
-- profiles is already written only by its owner — and it is deliberately NOT
-- in pin_profile_economy, because it is the owner's to change.
--
-- Until this is applied the column is absent, nothing is hidden, and the eye
-- control says "not switched on yet". Idempotent: safe to run twice.
-- ============================================================================

alter table public.profiles
  add column if not exists hidden_lists text[] not null default '{}'::text[];

-- A preference list, not a store: bound it so nobody can park megabytes on a
-- publicly readable row.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'profiles_hidden_lists_len'
                   and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_hidden_lists_len
      check (coalesce(array_length(hidden_lists, 1), 0) <= 200);
  end if;
end $$;
