-- Run this once in the Supabase SQL editor for the Vinal project.
-- Adds the columns the new Discs/streak/cosmetics system reads and writes
-- via the existing Cloud.fetchProfile / Cloud.saveProfile upsert — no new
-- table, no new RLS policy needed, since it's all on `profiles` which
-- already has RLS set up for the logged-in user to read/write their own row.

alter table profiles
  add column if not exists discs integer not null default 0,
  add column if not exists streak_current integer not null default 0,
  add column if not exists streak_best integer not null default 0,
  add column if not exists streak_last_date date,
  add column if not exists streak_freezes integer not null default 1,
  add column if not exists owned_themes text[] not null default '{classic}',
  add column if not exists active_theme text not null default 'classic',
  add column if not exists owned_banners text[] not null default '{}',
  add column if not exists active_banner text,
  add column if not exists is_admin boolean not null default false;

-- To give an account unlimited Discs and every cosmetic for free (e.g. your
-- own dev/owner account), run this separately, once, with your own login
-- email for Vinal:
--
--   update profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- This is a self-serve flag on your own database — nothing in the app code
-- hardcodes any specific account. Set it back to false the same way to
-- remove it.
