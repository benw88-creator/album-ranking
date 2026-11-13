-- Community Choice: accept Apple track ids (assets/apple.js).
--
-- The iOS build's catalogue is Apple's, and an Apple id is written `am<digits>`
-- so it can never be mistaken for a Deezer id (both are numeric; CLAUDE.md
-- trap 4). `moments.track_id` only allowed bare digits, so every pick made in
-- the app was refused. Bare digits (Deezer, the web build) still pass.
--
-- Idempotent: drop-if-exists, then add. Apply by hand in the SQL editor.

alter table public.moments drop constraint if exists moments_track_id_check;
alter table public.moments add constraint moments_track_id_check
  check (track_id ~ '^(am)?[0-9]{1,20}$');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'moments_track_id_check'
                 and pg_get_constraintdef(oid) like '%(am)?%') then
    raise exception 'moments_track_id_check did not take the Apple id form';
  end if;
end $$;
