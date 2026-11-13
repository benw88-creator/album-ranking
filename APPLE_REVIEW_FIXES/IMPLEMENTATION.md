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

Value = readers of the album's Wikipedia article over the last 12 months (Wikimedia pageviews, CC0) × (1 + up to 20% for people on VINALL who rated it). No article: a floor of 1,000.

Price is a curve, not a straight line (`priceFromValue`): MAX · x / (1 + x) with x = (value / 858,000)^1.3 and MAX = 400,000, minimum 200. It rises steeply at the bottom so obscure, cult and popular records separate, and bends over smoothly at the top so iconic records stay ordered instead of tying at a cap. The first straight-line version put 9 of 43 sampled albums on its 100,000 ceiling. Measured on 43 real albums:

| Tier | Record (readers a year → Discs) |
|---|---|
| No article | Demos Before Prom, Bliss Release → 200 |
| Obscure | Bon Iver, Bon Iver 8,312 → 960 · Process 12,106 → 1,570 |
| Cult | Sweet Boy 26,578 → 4,320 · French Exit 32,012 → 5,490 · The Money Store 64,640 → 13,410 |
| Popular | Ctrl 93,721 → 21,290 · Currents 113,831 → 27,000 · SOS 162,076 → 41,120 · Views 233,763 → 62,290 · Blonde 284,642 → 76,970 |
| Classic | To Pimp a Butterfly 335,564 → 91,140 · Purple Rain 449,036 → 120,470 · Nevermind 645,657 → 163,450 · Rumours 880,907 → 203,420 |
| Iconic | Abbey Road 1,277,215 → 250,600 · Thriller 2,050,995 → 302,550 |

Against a realistic week of ~70,000 Discs: a cult record is an afternoon, a modern classic a week, an all-time one a month. Stored collection prices and every balance are untouched (a sale refunds 70% of what was paid).

No kworb, Deezer, Wikidata or MusicBrainz call is left in valuation. Records are named from the caller's own crate, the public feed, or Apple for `am` ids. Wording changed throughout: "Highest VINALL Value wins", Higher or Lower's "Value" mode, the admin "VINALL Value health" check, terms and privacy. Code: `api/_streams.js`, `priceFromValue` in `api/collection-buy.js`. Stored collection prices are untouched.

## Database (lab only)

- `20261113120000_moments_apple_ids.sql` and `20261113140000_vinall_value.sql` applied to the lab project and verified. The lab database has no migration-history table, so there was nothing to record.
- `scripts/backfill-apple-art.mjs --ref <ref> [--apply]` rewrites stored Deezer sleeves to Apple's, in every column that holds one, plain or JSON, in one transaction. The dry run applies everything inside a rolled-back transaction and reports what would remain. Run on lab: 4 sleeves, 14 rows, 0 left. The sync merge now keeps the Apple sleeve when a device's older copy ties with the cloud's, so a phone cannot push the Deezer URL back.

## Artist photos

Apple has none, so nothing pretends otherwise. The favourite-artist hero is led by the artist's best-known record, sliding out of its sleeve (a drawn record, never an altered copy of the art), with their next albums fanned beside it; ordered by Apple's own best-known-first listing. Artist search results and pickers show the sleeve of the artist's best-known album (one batch lookup). The game's Popular picker, where no sleeve may appear, is set as a numbered UK chart. A row with no picture has no picture slot. The website keeps real photos and gains the same album-led hero if one fails to load.

## Checks

`npm run check` (12 Collection selfcheck groups on the new valuation), the lab leak check, the traps script, and `scripts/tests/rights.spec.mjs` (4 tests: catalogue shapes, held-back games and no Deezer requests, the website untouched, Spotify matching through Apple).

## Still open

1. **Apple's chart feed is sometimes slow** (one timeout in three on the first test). A success is cached at the edge for a day; a failure shows "Couldn't load the chart" and For You uses its other sources.
2. **Native build and device run** (Mac).
3. **Production:** the two migrations and the artwork backfill, with a backup first and the owner's approval; then the cherry-pick promotion in `LAB-ONLY.md`.

## Open questions only Apple can answer

The §12 message in `APP-STORE-SURVIVAL-PLAN.md`, plus (d) and (e) from `COVERS-AND-ESTIMATE.md`: grids and profile tiles, the Collection shelf, quiz reveal screens. The build shows Apple artwork on grids, profiles and the Collection (each tile opens the badged album page). If Apple says no, one rule in `apple.js` switches those to the blank sleeve.
