-- Adds profiles.birth_year: a self-declared, unverified birth year, asked
-- once at the end of onboarding. Not an age gate — nothing reads it to block
-- anything. It exists so there is an answer on record for "is this service
-- likely to be accessed by children" rather than nothing, same posture every
-- app store already holds itself to.
--
-- Nullable, no default: existing accounts simply have none, same as
-- fav_artist before anyone set one. Not part of the economy, so it is not
-- added to pin_profile_economy.

alter table public.profiles
  add column if not exists birth_year integer;
