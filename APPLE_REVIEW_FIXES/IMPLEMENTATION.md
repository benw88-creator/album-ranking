# Strategy B — what is built in Lab (13 Nov 2026)

Branch `lab` in `vinal-lab`, deployed to vinall-lab.vercel.app. Nothing on production, nothing sent to Apple.

## The switch

`assets/apple.js` defines `window.Rights`. `Rights.ON` is **true in the native app, false on the website**. To see the Apple build in a browser: `/?rights=apple` (remembered on that device; `?rights=deezer` switches back).

## What the Apple build does

| Area | Behaviour | Where |
|---|---|---|
| Catalogue | Search, album pages, tracklists, discographies, artist lookups and 30-second previews from Apple's iTunes Search API, called **on the device** (Apple allows ~20 calls a minute per IP; a rolling limiter holds it; metadata cached a day; preview audio streamed only, never downloaded or decoded). The app's ~40 call sites are unchanged: `apple.js` answers `/api/catalogue` and `/api/preview` in the routes' own shapes. UK chart from Apple's public RSS via `/api/catalogue?source=apple`. | `assets/apple.js`, `api/catalogue.js` |
| Ids | Apple ids are `am<digits>`, never confused with Deezer's numeric ids. Older ids resolve by name and artist. Nothing stored is re-keyed. | `assets/apple.js` |
| Badge and attribution | Apple's official "Listen on Apple Music" badge (unaltered, from tools.applemediaservices.com) on the album page, linking to the album, and on every For You card. Every preview is credited "provided courtesy of iTunes" (the Search API terms' wording) beside a link to the track: For You cards, the player bar, and a pill for any other preview. | `apple.js`, `index.html` |
| Artwork | No altered sleeves (For You's blurred copies are not drawn). No Deezer image is ever requested: a Deezer URL becomes VINALL's blank sleeve before it loads. | `apple.js` |
| Games | Recall, Guess the Cover and Cover EXTREME are hidden and unreachable. No third-party sleeve inside any game sheet; Cover Fire answers by name. The tutorial skips its Recall beat. | `apple.js`, `index.html`, `boards.js`, `discover.js` |
| Community Choice | YouTube-only picks; playback stops on YouTube's own `end` parameter; older Deezer picks open on YouTube. | `index.html` |
| Spotify import | Matched on the device against Apple, with the same rules as the server (`assets/match.js`, re-exported by `api/_match.js`). The album's real tracklist is tried first. Measured: 7 of 7 real tracks automatic (Nikes, HOLD UP, Dreams 2004 Remaster, Money Trees Deluxe, Paranoid Android OKNOTOK, Come As You Are, the live Blinding Lights kept apart from the studio cut). | `apple.js` |
| Background audio | `audio` removed from `UIBackgroundModes`; the player pauses when the app goes to the background. | `Info.plist`, `AppDelegate.swift` |
| Screenshots | 5 new screenshots, invented records, original art. | `store-screenshots/` |

## VINALL Value (replaces kworb, for both builds)

Value = readers of the album's Wikipedia article over the last 12 months (Wikimedia pageviews, CC0) × (1 + up to 20% for people on VINALL who rated it). No article: a floor of 1,000. Price = value ÷ 4.5, minimum 200, ceiling 100,000, anchored so Views keeps its price.

| Record | Readers a year | Discs |
|---|---|---|
| Views (Drake) | 233,763 | 51,947 (was 51,240) |
| Blonde | 284,642 | 63,254 |
| In Rainbows | 316,283 | 70,285 |
| IGOR | 189,586 | 42,130 |
| SOS | 162,078 | 36,017 |
| Utopia | 117,066 | 26,015 |
| The Money Store | 64,637 | 14,364 |
| French Exit | 32,015 | 7,114 |
| Sweet Boy | 26,577 | 5,906 |
| Thriller, Rumours | 2.05M, 0.88M | 100,000 (ceiling) |
| Demos Before Prom (no article) | — | 222 |

No kworb, Deezer, Wikidata or MusicBrainz call is left in valuation. Records are named from the caller's own crate, the public feed, or Apple for `am` ids. Wording changed throughout: "Highest VINALL Value wins", Higher or Lower's "Value" mode, the admin "VINALL Value health" check, terms and privacy. Code: `api/_streams.js`, `priceFromValue` in `api/collection-buy.js`. Stored collection prices are untouched.

## Database (lab only)

- `20261113120000_moments_apple_ids.sql` and `20261113140000_vinall_value.sql` applied to the lab project and verified. The lab database has no migration-history table, so there was nothing to record.
- `scripts/backfill-apple-art.mjs --ref <ref> [--apply]` rewrites stored Deezer sleeves to Apple's, in every column that holds one, plain or JSON, in one transaction. The dry run applies everything inside a rolled-back transaction and reports what would remain. Run on lab: 4 sleeves, 14 rows, 0 left. The sync merge now keeps the Apple sleeve when a device's older copy ties with the cloud's, so a phone cannot push the Deezer URL back.

## Checks

`npm run check` (12 Collection selfcheck groups on the new valuation), the lab leak check, the traps script, and `scripts/tests/rights.spec.mjs` (4 tests: catalogue shapes, held-back games and no Deezer requests, the website untouched, Spotify matching through Apple).

## Still open

1. **Artist photos.** Apple's Search API has none; artist pages and the Popular picker show a placeholder.
2. **Apple's chart feed is sometimes slow** (one timeout in three on the first test). A success is cached at the edge for a day; a failure shows "Couldn't load the chart" and For You uses its other sources.
3. **Native build and device run** (Mac).
4. **Production:** the two migrations and the artwork backfill, with a backup first and the owner's approval; then the cherry-pick promotion in `LAB-ONLY.md`.

## Open questions only Apple can answer

The §12 message in `APP-STORE-SURVIVAL-PLAN.md`, plus (d) and (e) from `COVERS-AND-ESTIMATE.md`: grids and profile tiles, the Collection shelf, quiz reveal screens. The build shows Apple artwork on grids, profiles and the Collection (each tile opens the badged album page). If Apple says no, one rule in `apple.js` switches those to the blank sleeve.
