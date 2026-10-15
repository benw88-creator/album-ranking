-- Two live child-safety/privacy defects found during the UK assessments
-- (2026-10-15). Approved by the owner. Idempotent.
--
-- 1. Direct messages. The DM screens left the client on 2026-10-14, but the
--    "send messages" policy still let any signed-in user insert a message to
--    anyone who had not blocked them, and the push trigger delivered its first
--    140 characters to the recipient's lock screen: unfiltered, unreportable,
--    invisible to moderation. The policy goes; existing rows, the read policy
--    and the push branch are left alone (harmless once nothing can insert).
--
-- 2. profiles.birth_year. Onboarding asked for a birth year and profiles are
--    publicly readable, so anyone could read it, including under-18s'. Nothing
--    reads the column and the age check keeps only a band. The values are
--    cleared and a constraint keeps it empty, so a stale cached client (the
--    service worker can be one load behind) cannot write one again. The column
--    is kept rather than dropped; dropping it is a separate decision.

begin;
set local lock_timeout = '5s';

drop policy if exists "send messages" on public.messages;

update public.profiles set birth_year = null where birth_year is not null;

alter table public.profiles drop constraint if exists profiles_birth_year_unused;
alter table public.profiles add constraint profiles_birth_year_unused check (birth_year is null);

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and cmd in ('INSERT', 'ALL')) then
    raise exception 'messages still has an insert-capable policy';
  end if;
  if exists (select 1 from public.profiles where birth_year is not null) then
    raise exception 'birth_year not cleared';
  end if;
end $$;

commit;
