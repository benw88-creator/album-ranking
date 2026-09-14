-- A leader can see the invites they have sent.
--
-- ---------------------------------------------------------------------------
-- The bug this is half of
-- ---------------------------------------------------------------------------
-- The Groove invite list offered an identical Invite button for everyone you
-- follow and then found out the truth by failing: a clash on the unique key
-- came back to the client as "Already in". That is the wrong words for the
-- common case, which is not a member at all — it is somebody who was invited
-- on a previous visit and has not answered yet. Three people showing
-- "Already in" on a two-member groove is exactly that, and it is what it
-- looked like from the outside.
--
-- The client half of the fix reads the roster before rendering and labels
-- each person Member / Invited / Invite. That only tells the truth if a
-- leader can actually see the `invited` rows. The select policies on
-- groove_members are not recorded in any migration in this repo, so whether
-- they already allow it is unknown — this adds a permissive policy that does,
-- which is additive either way. A permissive policy ORs with the existing
-- ones, so the worst case is that it is redundant.
--
-- It widens nothing else: a groove's own leader could already read the
-- membership through grooveMembers(), and your own row is yours.

drop policy if exists groove_members_select_leader_or_self on public.groove_members;
create policy groove_members_select_leader_or_self
  on public.groove_members for select
  to authenticated
  using (
    user_id = auth.uid()                    -- your own membership or invite
    or public.groove_is_leader(groove_id)   -- a leader reading their roster
  );
