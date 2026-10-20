# VINALL launch technical fixes

## Sixth pass: free-tier efficiency and write limits (2026-10-20)

- **Tab return no longer re-downloads the account.** `pullAndMerge` ran on every return to
  the tab (at most once a minute) and fetched every `app_state` blob (25KB typical, 300KB
  heavy). It now asks `key, updated_at` first (~1KB) and only pulls when another device
  changed something; local edits whose push failed still go up without a download. Our
  own pushes record their timestamp, so they do not count as a change. Test:
  `launch-sync.spec.mjs` "tab return probes timestamps".
- **`20261020120000_write_limits.sql` applied and recorded.** Daily new-row caps on ten
  client-writable tables, size checks on `app_state` (2MB, 100 keys), `ratings.data`,
  `lists.items`, `analytics_events.props`, a 120,000-row ceiling and date range on
  `listening_days_put`, and crash reports capped at 120 a minute globally and trimmed.
  Every limit sits far above the busiest real use measured the same day. Verified in a
  rolled-back production transaction first.

## Fifth pass: ratings cap, Spotify removed, live moderation test (2026-10-20)

- **Live moderation test passed on production** (rolled-back transaction, synthetic
  users): non-admin refused the queue; each report alerts every admin; Remove deletes
  the post and actions the report; reporter and author both notified; suspend and
  unsuspend work. Nothing persisted.
- **`20261020100000_rating_daily_cap.sql` applied and recorded.** New rating rows past
  150 albums / 400 songs a UTC day are skipped (never refused, so chunked syncs and
  imports still land the rest and trickle in later). Re-rates never count. Busiest real
  day before: 129 / 263. Verified first in a rolled-back transaction (160 → 150 kept,
  re-rate at cap works, 410 songs → 400).
- **Spotify Web API removed entirely.** `_streams.js` maps the Deezer artist id to the
  Spotify artist id kworb needs via Wikidata (P2722 → P1902), MusicBrainz as fallback;
  legacy base62 album ids resolve through `crate_feed` to Deezer. Verified live: Blonde,
  IGOR, In Rainbows, SOS, MBDTF (legacy) and ICEMAN (legacy) value with the documented
  match rates. Privacy policy and store notes updated. `SPOTIFY_CLIENT_*` can be deleted.

## Fourth pass: API hardening, moderation, economy races (2026-10-16)

**Deployed (app-level):**

| Finding | Fix |
| --- | --- |
| `GET /api/collection-prices` accepted any bearer string (`Bearer x`) and priced records on the caller's own sealed Bid War board | Real session required; sealed records are priced `null`, failing closed like POST |
| `/api/app-token` handed a working Spotify credential to anyone; the client only used it as a gate | Route deleted, gate removed (11 of 12 functions now used) |
| `spotify-match` was open: one call = up to 30 Deezer searches on the shared IP plus service-role cache writes | Signed-in only; the import UI already required an account |
| `/api/album-market` (parked debug route) spent the Discogs token for anyone | Signed-in only |
| Most upstream `fetch` calls had no timeout (a hung kworb/Deezer call held a function until the 300s limit) | `AbortSignal.timeout` on Deezer, Supabase (share), Spotify, kworb, Discogs |
| `youtube.js` returned Google's raw error text | Generic message |
| Notification-dot poll ran in hidden tabs | Skipped when hidden; refreshed on return |
| **Moderation:** pressing Remove without typing a reason cancelled silently (the shared `ask()` treats an empty box as cancel) | `ask({ optional: true })`; the reason is labelled optional; unsuspend errors surface |

**Applied with approval 2026-10-20 and recorded in history:** `20261016130000_economy_races.sql`.
Drift check first (the live lore body was the old unlocked one; the Completionist cap had
no lock). Then verified in a rolled-back transaction against production, applied twice:
a forged profile insert came back `null/classic/null`, an upsert of an owned theme kept
it, 22 lore answers paid exactly 5,000 (count 20), and a third comp claim was refused.
Nothing persisted. Lore's
20-a-day cap and the two-a-day Completionist cap could both be raced with parallel
requests (estimated ~250k and ~600k Discs a day), and a client-created profile row
could arrive wearing unowned cosmetics, including the not-for-sale `virji` tag.

**Checks:** `npm run check` all groups. The production-schema harness
(`scripts/audit-artifacts/safety-review.mjs`, gitignored) now also applies
20261016110000, 20261016120000 and the draft. 16 groups pass: admins alerted on
report, the reporter notified past the notification guard, the guard refusing
moderation types, slurs, blocked senders and the 61st notification in an hour,
plus the draft's rules. Races are reasoned, not reproduced: PGlite has one
connection. Playwright adds a queue test (empty-reason removal).

**Live moderation test not run:** production reads and writes were blocked by
this session's permission classifier. Run it with the two test accounts and
Ben's admin account (see the summary in the session).

## Third pass — UK compliance and moderation (2026-10-15)

Deployed: terms/privacy v1.5, reports queue (priority, overdue, photo, history,
avatar file deletion), grooming report reason, support signposting, YouTube
SafeSearch, real sender names on pushes. Applied with approval: DMs closed and
birth years cleared (`20261016100000`, recorded in history); Ben made admin.
**Applied with approval and recorded in history:** `20261016110000` (notifications
had failed since 3 Oct, blocking every moderation action) and `20261016120000`
(retention jobs, report alerts, notification guard). They were verified live
inside rolled-back transactions: the guard refuses bad types and abusive text and
rewrites names; a report reaches the queue and alerts the admin; resolving
notifies the reporter. Checks: `npm run check` all
groups; Playwright 39/39.

## Second pass — safety, UK compliance, moderation, abuse (2026-10-14)

**Released 2026-10-15** with owner approval: both migrations applied to production via
`supabase db query --linked -f` (read-only drift check first: schema unchanged; harness 10/10),
verified through the live Data API, then commits 11f1954 and ac8078a pushed and confirmed
served. Migration HISTORY for 20261015000000/100000/200000 is still unrecorded; repair is a
separate, approval-only step. Live verification found and fixed one pre-existing bug: the
album sheet's ratings list embedded `profiles(...)` with no FK and always 400'd.

(Historical, pre-release:) two migrations waited for approval, in
order: `20261015100000_ratings_visibility_policy.sql` then
`20261015200000_launch_safety_and_moderation.sql`. The client changes are
safe to ship before them (each degrades: the moderation queue says "not
switched on", album comments keep failing as they do today). Ship the client
**after** the second migration if you want album comments to work on release.

| Finding (verified against live definitions, read-only) | Fix | Where |
| --- | --- | --- |
| Anon can read private/friends ratings (`ratings are public to read`) | Drop the policy; guards | migration ...100000 |
| "Just me"/"Friends" still published every score and note to the public `crate_feed`, reviews and `rated_too` notifications | Client skips; server refuses non-public authors' rows and unpublishes on leaving public | index.html, migration ...200000 §6 |
| `crate_feed.username/avatar_url` were client-supplied: anyone could post as anyone | Server sets them from `profiles`, and resyncs on rename | §6 |
| `collection_sell` refunded on every concurrent call (unlocked read, unchecked DELETE) | Row lock; only the call that deletes is paid | §1 |
| Completionist milestones minted 12,000 Discs per invented `artistId`, without limit | Two comp claims per UTC day (trigger, no retyped function) | §2 |
| `badges` and referral columns stopped being pinned (20260921140000 rebuilt the economy trigger from an older copy); 4 accounts never got OG | Separate invoker pin trigger; OG re-granted. No forged badges or referral counts found in production | §3 |
| Higher or Lower accepted any streak to 2,000 | Bounded by the player's rated albums, 0.7s/guess floor | §4 |
| Album-page comments could never save: `feed_id` is a uuid FK, the client wrote `album:<id>` | `feed_comments.album_id`; client reads/writes it | §4b, index.html |
| Slur filter was client-only (bypassable) except song comments, and substring-based ("Scunthorpe", "conspicuous" rejected) | `is_abusive_text()` on comments, lists, grooves, moments, suggestions, profiles; feed notes dropped not refused (bulk import); client `hasSlur` mirrors it | §5, index.html |
| No admin way to see or act on reports, no suspension, reporters never heard back | `admin_reports`, `admin_resolve` (dismiss/remove/suspend), `admin_unsuspend`; queue on the admin's own profile; reporter and author notified | §7, assets/safety.js |
| Report only on profiles and song comments | Also reviews, Crate feed posts, album comments, Community Choice picks; child-safety, threats/self-harm and illegal-content reasons | index.html, safety.js |
| No delete for your own album comments | Delete control | safety.js |
| Blocked users still appeared in album-page ratings | Filtered | index.html |
| No age question anywhere (email or Apple/Google sign-in) | One-time 13+ age-band question per account; under-13 signed out; 13–17 start friends-only | assets/safety.js |
| YouTube embed/probe loaded youtube.com (cookies) before any choice | One-time consent before anything loads from YouTube; decline keeps Deezer | index.html |
| `/api/youtube` open: ~99 anonymous requests exhaust the day's quota | Requires a signed-in session | api/youtube.js |
| `/u/<name>` share pages: `_` was a LIKE wildcard | Escaped | api/share.js |

Checks: `npm run check` (all groups), Playwright chrome 37/37 including the
new `tests/safety.spec.mjs` (age bands). Migration ...200000 was run twice in
PGlite against a read-only snapshot of the production schema
(`scripts/audit-artifacts/snapshot-safety.mjs` + `safety-review.mjs`,
gitignored with the snapshot): 10 groups pass. Live ratings check:
`node scripts/verify-ratings-privacy.mjs` (read-only) passes; `--accounts`
runs the full matrix after approval with two dedicated test accounts.

Legal pages are v1.4 (age question, visibility effect, YouTube consent,
moderation, appeals). They promise a **48-hour** review target and a 14-day
appeal reply — operational commitments; change the numbers if they cannot be
kept.

**Previous review: NO-GO — one confirmed production ratings-privacy policy
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
