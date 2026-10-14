# VINALL launch technical fixes

**Current review: NO-GO — one confirmed production ratings-privacy policy
defect.** See `LAUNCH-REVIEW.md` for independent verification and the safe,
approval-dependent correction/release sequence. Production already contains
the launch migration's objects and serves the merged HEAD frontend; this was
observed read-only, not deployed by the review. Git has no unmerged entries.

The implementation record below describes the earlier local fix work; its
unapplied-migration/unmerged-index notes are superseded by the current review.

Local implementation only. No live database changes, production configuration
changes, push, commit, or deployment were performed for this work.

## Implemented

| Finding | Focused correction | Verification |
| --- | --- | --- |
| Admin/disc protection bypass | Economy trigger runs as its caller; direct API writes stay pinned while privileged wallet functions work. Removes the duplicate economy trigger. | Actual old exploit reproduced and then blocked in in-memory PostgreSQL; insert/update, cosmetics, counter reset and wallet cap checks. |
| Push SSRF | Known Apple/Google/Mozilla/Microsoft push destinations only, checked at registration and delivery. No redirects; bounded delivery timeout; validated keys and ten subscriptions per account. | SQL and mocked HTTP rejection tests, plus existing Web Push crypto vectors. |
| Shared import cache poisoning | Separate cache keyed by a hash of the exact searched metadata. Caller-supplied Spotify URIs are never trusted as shared identity; old URI cache is ignored. | Same URI with conflicting metadata cannot contaminate a correct import; matching metadata is still shared. |
| Recipient block bypass | Narrow security-definer policy helper checks blocks in both directions without exposing block rows. | RLS tests cover blocked and permitted inserts. |
| Deleted ratings return | Durable owner-scoped deletion timestamps, server guards on rating rows and state blobs, offline retry, local merge filtering and account-aware write queues. Old-client direct deletes also record deletions. | SQL tests, including JSON/JSONB schemas, stale upserts, absent rows, retries and re-rating; authenticated browser reload/retry flow. |
| Unverified Recall results on public boards | Daily public scoring requires a verified result. Private fallback results remain playable when the scheduled preview is unavailable. | Actual submission/scoring functions reject a forged claim for the public board and accept a verified answer. |
| Account deletion claims success after avatar failure | Remove and verify every avatar page before purging rows/login. Storage failures retain an account that can retry. | Listing/removal failures, multiple pages and purge failures are tested without live requests. |
| Apple fallback loses attribution | Retains the exact track store URL and provider identity alongside the preview; refreshes old Apple cache entries that lost attribution. | Source resolution test; existing playback/browser checks. |
| Merge markers in release source | Preserves both sides' additions and removes markers; adds a regression trap. | Parser/trap checks and local Capacitor asset copy. Git still contains the owner's pre-existing unmerged index entries; nothing was staged or committed. |

## Migration and release order — requires approval

Review `supabase/migrations/20261015000000_launch_security_and_integrity.sql`.
The CLI generated the migration initially; its filename was moved after this
branch's already forward-dated migrations so it runs last. Do not replay the
entire historical migration directory against production: the base schema and
parts of its history were maintained manually.

1. Review the installed economy/scoring definitions, policies, owners, grants,
   existing subscriptions and any evidence of prior balance/admin manipulation.
   This migration does not guess which historical balances or admins are valid.
2. Apply this migration to an approved staging database and verify actual
   Supabase Data API/RLS behavior and concurrent clients. The migration is
   transactional, repeatable and raises on unexpected installed definitions.
3. With explicit approval, apply the reviewed migration to production before
   releasing the new web/native client. Without it, rating-deletion sync stays
   pending; new matching-cache requests still work without cached answers.
4. After approval for release, verify actual account/avatar deletion, wallet
   awards, stale-device synchronization, push providers and the submitted native
   bundle on iPhone/iPad. Local asset copying is not an Xcode build/device test.

## Reproduce local checks

`npm run check` from `scripts/` includes isolated PostgreSQL, mocked API and
client-sync regression checks. The test-only PGlite dependency is pinned and
neither bundled nor deployed. Browser fixtures intercept external HTTP and
WebSocket traffic, including telemetry.

The configured Chrome executable is absent on this machine; browser checks used
installed Edge with `CHROME_PATH` set for that test process only. Existing
rating/navigation/Recall/Replay cases and the new authenticated deletion case
passed. `node app/scripts/sync-web.mjs` successfully copied local native assets.

## Remaining, separate from these fixes

- Spotify/Deezer authorization and permitted music/artwork usage remain legal
  questions. No provider integration was removed or redesigned based on them.
- Children's privacy/safety assessments and timely human moderation require
  operational/external evidence.
- Other games still report correctness from the client. Payout caps remain;
  server-owned questions would be a separate anti-cheat project. Known daily
  answers can also be discovered from a browser that must fetch their clips.
- Shared API throttling, provider quotas (notably YouTube search), infrastructure
  capacity, Kworb reliability and physical-device performance need staging/load
  evidence. This patch does not claim substantial-growth certification.
- Live core-table/storage policies and grants were not available as a complete
  schema snapshot. Local fixtures validate the corrected boundaries, not the
  complete production database or historical integrity of existing accounts.
