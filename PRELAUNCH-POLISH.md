# VINALL animation and account reliability pass

Development changes only. This pass does not deploy production, run migrations,
write live database rows, or push GitHub changes. Push awaits the owner's approval.

| Area | Result |
| --- | --- |
| Daily spin | Locks before loading; coalesces prize-pool requests; blocks stale rerenders and free-spin replies; prevents delayed profiles overwriting awards; shows the server award when the reel finishes; centres from actual tile geometry; preserves results on return; handles resize, errors, reduced motion and account changes. |
| Desktop hover | Card entrances use independent translate/scale properties so hover owns `transform` even during arrival; subtle scales/lifts use shared easing. Pointer lighting reads geometry once per frame. Touch and reduced motion retain restrained feedback; Today answer entrances release their existing small press effect. |
| For You | Warms two initial cards after account readiness, skips hidden/save-data/slow-connection warming, retains a five-minute cache, invalidates changed library inputs, awaits listening signals, and defers top-ups until visible. Preloading neither consumes unseen songs nor starts/stops background audio. Served-song history uses the debounced account mirror. |
| Loaders | Shared animated busy labels, existing shimmer skeletons and the feed placeholder use VINALL colours. Import progress remains based on actual completed matches; history failures are explicitly reported. |
| Album hover edge | Removed the artwork wrapper's nested paint containment and forced compositor clip; reduced permanent card/art layers. Hover screenshots and keyboard activation are exercised in all three engines. The referenced owner screenshot was unavailable, so exact screenshot comparison remains unverified. |
| Page navigation | Synchronous history/state changes, cancellable fades and subtle horizontal reveals. Shared navigation remains outside Home's artist banner. Large lists use visible-card and navigation motion to avoid a whole-list compositor surface. |
| Favourite artist | Home reserves a fixed slot below navigation; late images cannot move the Island. Desktop displays the complete photo with its aspect ratio and fills the sides with a blurred treatment of the same image. Accounts without a favourite get a useful picker in the reserved slot. |
| GO | Preserves the rotating record's phase while smoothly ramping its speed. Desktop flight uses scale/translation without a full-disc blur repaint and adapts to the desktop mark's measured size. |
| Favicon | Official PNG artwork with a transparent matte, trimmed margins and antialiased edges; 16/32/48px PNGs and a matching multiresolution ICO. Apple/maskable icons retain their platform backgrounds. All document/manifest/share references and service-worker versions were refreshed. |
| Large desktop libraries | One delegated album handler, accessibility attributes emitted in markup, lazy off-screen covers, bounded card entrances, unchanged-input rendering cache and nav geometry cached until font/viewport changes. |
| Spotify across devices | Completed status, mapping and summary now live in the existing user-owned `app_state` mirror. Streaming aggregates remain in `listening_plays`. Local resume jobs stay on their device. Migrates correctly owned legacy flags and recovers old import status from existing Spotify-export rows. Refresh/resume recognises an import made elsewhere. |
| Account/feature parity | Logout/account changes clear feed, import, listening, collection, Today, artist and Recall caches; stale async results cannot repopulate the wrong account. Header avatar requests reject superseded responses, Today handles empty queues and obsolete advance timers, and listening reads page past the Data API cap. Existing ranking, profile, games, collection, achievements and feed destinations are exercised at phone/tablet/desktop sizes with the same data paths. |

## Verification

Run from `scripts/`: `npm run check` and `npm test`. The browser fixture intercepts
all remote traffic, including auth and telemetry. The added persistent fake
Supabase backend exercises the real client/session flow, status upload/download,
new-device storage, reload, logout, account switching, legacy recovery and import
history queries. Tests also cover delayed profiles, double spin events, rerenders,
resize, reduced motion, errors, hover release, preloading without media requests,
rapid navigation/history and a 600-album library.

The viewport audit covers 320, 375, 768, 1024, 1440 and 2560px. Chrome runs actual
injected touch flicks. Windows WebKit uses a deterministic audio-provider fixture;
its native touch-injection case is intentionally skipped. Screenshots, timings
and failure evidence are under the ignored `scripts/test-results/` directory.

Static production checks parse all 41 inline scripts, the shared interaction
script, service worker and API JavaScript; repository traps and four service-worker
lifecycle tests run. The website has no compilation build step. The native web
asset bundle is checked with `npm run sync:web` in `app/`.

Recorded final full-suite result: **123 passed, 1 intentionally skipped (124 cases)**
across Chrome, WebKit and Firefox. The focused large-library/resume checks also
passed 6/6; final artist/account checks passed 6/6 and interaction/rating checks
passed 9/9. Additional header/wallet/pagination checks passed 9/9 and preload
checks passed 3/3. Chrome's repeated-navigation sample recorded maximum next-frame
latency 17.4ms, frame p95 6.2ms, layout-shift score 0 and no observed long tasks.
The WebKit stress sample recorded 35ms processing / 253ms first paint, and 1ms
processing / 215ms on cached return to 600 albums. These are local measurements.

## Limits

Mocked Supabase tests do not establish live RLS, server payouts or production
integration health. No schema change is required by these fixes. Physical Safari,
iPhone/Android and native store builds still need device acceptance testing.

Windows WebKit's software renderer is slower on the first 600-card paint than
Chrome/Firefox. The large-library test separates input-processing time (under
100ms) from first paint (350ms WebKit / 250ms other engines) and cached navigation
(250ms). These are regression budgets for this machine, not a universal 60fps
claim. Existing listening-history limits remain: import stores the 4,000 most
played track aggregates and overlapping exports preserve their larger counts;
disjoint exports are not summed as raw per-event history.
