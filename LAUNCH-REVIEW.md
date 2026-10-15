# Independent launch review — blocker since resolved

> **Status 2026-10-15:** the ratings-privacy blocker below is fixed in production
> (`ratings are public to read` dropped by 20261015100000; read-only re-check passes).
> The NO-GO verdict is historical. Still open: the two-account matrix
> (`verify-ratings-privacy.mjs --accounts`). Migration history was repaired the same day:
> all 65 unrecorded versions were verified present (objects, function bodies, data
> sentinels) and recorded with `migration repair --status applied`; no SQL was run.

Reviewed commit `ad65b5fc1abcd9e2ea45b9cc0745ca0376f1da2d`, the launch migration,
application changes, tests and read-only production schema metadata. This review
did not deploy, apply migrations, modify production data/configuration, push or
commit anything. All write-based reproductions used synthetic data in local,
in-memory PostgreSQL.

## One confirmed launch blocker

Production `public.ratings` has a permissive SELECT policy named
`ratings are public to read`, applying to PUBLIC, with `USING (true)`.
It coexists with owner and public/mutual-friends policies. Permissive policies
combine with OR: this unconditional policy overrides private/friends visibility.
See [PostgreSQL RLS semantics](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

The application exposes the setting through `Cloud.setRatingsVisibility()` and
profile editing. The launch migration does not remove the unconditional policy.
This is a real access-control defect, not a hypothetical attack.

An isolated reproduction copied the actual production table types/defaults,
constraints, policies, grants and relevant function/trigger definitions, then
created only synthetic accounts and ratings. An anonymous caller could SELECT
the synthetic private rating. Removing only the unconditional policy locally
hid it. Owner access, public anonymous access and mutual-friend access continued
to work. Production currently has zero private/friends profiles and zero rating
rows belonging to them, so this review did not establish an existing private
data disclosure. The policy still must be corrected before launch.

**Minimum correction to review and approve separately:** a new migration that
removes the redundant unconditional policy while retaining and testing the
existing owner/public/mutual-friends policies. No corrective production action
was taken, and no new corrective migration was applied or silently implemented.

## Verified fixes and safety

- Production already contains the launch tables, caller-executed economy/boost
  triggers, deletion guards, authenticated-only deletion/push/message helpers,
  and verified-only Recall daily scoring. These were already present when this
  review connected. They were not installed by this review.
- Relevant SECURITY DEFINER functions are owned by `postgres`; caller identity
  is checked inside the write RPCs. Trigger-only functions are not executable
  by anon/authenticated. The public schema grants those roles USAGE, not CREATE.
- `rating_deletions` permits authenticated owner-scoped SELECT but no client
  writes. `catalogue_matches` denies anon/authenticated access. The message
  helper sees both block directions without exposing the underlying block rows.
- With actual production function definitions and column types, direct admin,
  disc, cosmetic and counter writes were pinned. Rating awards and once-daily
  login rewards continued to work in local PostgreSQL.
- Applying the launch migration twice locally preserved seeded existing
  profiles, balances, ratings and state byte-for-byte. It contains no bulk
  historical-data rewrite. It does not retrospectively certify old balances or
  determine which existing administrators are legitimate.
- Existing `npm run check` passed: script parsing, trap checks, service-worker,
  Replay/Passport and 17 targeted API/sync/database test groups.
- The independent production-schema reproduction passed six groups covering
  data preservation, real economy functions, cross-user restrictions, grants,
  privacy failure and the minimal local policy correction.

The standard launch database test uses simplified owner-only policies; it could
not detect production's redundant public policy. Its passing result alone was
not sufficient to certify the full production access model.

Advisor warnings about intentionally private tables without policies, trigger
functions, legitimate authenticated RPCs and immutable helpers were reviewed;
they are not additional demonstrated launch blockers.

## Git and currently served application

There are no unmerged index entries. Merge commit `ad65b5f` has both original
parents, `20a8796` and `18b63ce`. The Charades/Passport styles and scripts from
one side and artist stylesheet from the other remain. All new documentation
headings from both parents remain (1/1 and 3/3 respectively). No reset, checkout,
discard, restaging or new commit was necessary.

The live `https://www.vinall.xyz/` returned HTTP 200 and its HTML matched HEAD
after normalizing line endings. SHA-256 for both:
`d883ae1e827ec9f4488c9cf57db7c71df17f40653af69d25fcf2429dc730890c`.
This establishes the served frontend source, not a physical iOS binary or the
runtime contents of every serverless deployment.

The launch migration version `20261015000000` is absent from Supabase's recorded
migration history, despite its objects being installed. This is bookkeeping
drift, not proof that the changes are absent. Do not replay the entire historical
migration directory or automatically reapply the launch migration.

## Safe sequence after the blocker is corrected and approval is given

This sequence is prepared for review; no command below was executed against
production. Target project: `cqfxyebejpkyhswolrwi`; application:
`https://www.vinall.xyz/`. The current launch changes are already installed.

1. Create/review a separate corrective migration and extend the regression
   suite with the production-policy reproduction. Minimum policy change:

   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   SET LOCAL statement_timeout = '30s';
   DROP POLICY IF EXISTS "ratings are public to read" ON public.ratings;
   COMMIT;
   ```

   **Drafted, not applied:** `supabase/migrations/20261015100000_ratings_visibility_policy.sql`
   (refuses if the owner or public/friends SELECT policy is missing; fails if any
   unconditional read remains). The local production-schema reproduction now runs
   it twice and covers anon, owner, one-way follower, mutual friend and public.
   The new migration must follow the launch migration's version. Review all
   remaining ratings SELECT/ALL policies immediately before execution. Validate
   anon, owner, stranger, one-way follower and mutual-friend cases on a separate
   approved staging database. Do not test writes by impersonating production
   accounts, even inside a transaction intended to roll back: attached triggers
   may enqueue external effects.

2. Before approved production execution, capture current policy definitions and
   grants, check backup/restore availability, confirm the target project and
   reviewed SQL checksum, and save the current secure application deployment
   reference. No full data restore should be needed for a policy-only change.
   The SQL above changes no records. Its short lock/statement timeouts cause an
   unsuccessful attempt to roll back rather than wait indefinitely.

3. After explicit approval, execute only the reviewed corrective migration as
   one transaction on the target project. Use the approved Supabase migration
   workflow so its history entry is recorded. Do not use a blanket `db push`
   while the historical migrations are incompletely recorded.

4. Independently inspect the committed policies/grants and run permission tests
   with dedicated, approved test accounts through Supabase's real Data API:
   private owner succeeds, anon/stranger private access returns no rows;
   friends access requires mutual following; public ratings remain accessible.
   Exercise rating delete/re-rate, stale-device sync and wallet awards with
   those test accounts. No historical user data should change.

5. Reconcile the old launch migration's history only after confirming all of
   its effects, with separate approval. The discovered CLI syntax is:

   ```powershell
   supabase migration repair 20261015000000 --status applied --project-ref cqfxyebejpkyhswolrwi
   ```

   This records history; it does not apply SQL. Do not label absent effects as
   applied. Other historical gaps require their own review, not blanket repair.

6. A database-policy correction requires no frontend redeploy. If additional
   application changes are approved, test the exact candidate commit, release
   only after its required DB changes are present, and verify the served source
   and serverless runtime afterward. Pushing to this repository's production
   branch is a release action, not a harmless Git backup.

7. Before native submission, regenerate local web assets with
   `node app/scripts/sync-web.mjs`, perform Capacitor sync in the native project,
   and verify the actual bundled build's login/recovery, privacy, deletion,
   playback and persistence on devices. Backend requests must continue using
   `https://www.vinall.xyz`, not the redirecting apex for CORS preflights.

## Second pass (2026-10-14): what to approve, in order

1. `20261015100000_ratings_visibility_policy.sql` (privacy blocker), then
   `node scripts/verify-ratings-privacy.mjs --accounts` with two dedicated test
   accounts (VERIFY_A_EMAIL/PASSWORD, VERIFY_B_EMAIL/PASSWORD). It writes only
   those accounts' own rows and restores them.
2. `20261015200000_launch_safety_and_moderation.sql`. Only data change: OG
   badge for the 4 accounts with `[]`. Re-run `safety-review.mjs` against a
   fresh `snapshot-safety.mjs` immediately before, in case production moved.
3. Push the client (`main` deploys). Then, as the admin account, open your
   profile: the Reports queue should say "Nothing waiting".
4. Separately: `migration repair` for 20261015000000, 20261015100000 and
   20261015200000 only if applied outside the migration workflow.

## Rollback boundaries

- If the policy migration fails before COMMIT, its transaction rolls back;
  inspect the error and retry only the reviewed corrective change.
- After COMMIT, prefer a narrowly corrected restrictive policy if a flow fails.
  Reinstating `USING (true)` would intentionally reopen the confirmed privacy
  defect and is not a safe rollback.
- Keep economy protections, deletion tombstones/guards and protected cache
  tables when rolling back application code. Do not drop accumulated tombstones,
  wipe accounts/balances, or restore the old definer economy trigger.
- An application rollback must use a known compatible, secure deployment.
  Returning to a pre-security build can restore the push/cache vulnerabilities;
  database protections alone do not fix an old vulnerable API implementation.
- Physical-device and provider-runtime acceptance remains a release check.
  Unresolved music permissions and operational legal questions are separate;
  they were not used to manufacture additional technical blockers here.

**Recommendation: NO-GO until the confirmed ratings-privacy policy defect is
corrected and verified through the real Data API. The reviewed launch fixes
otherwise passed the independent checks performed.**
