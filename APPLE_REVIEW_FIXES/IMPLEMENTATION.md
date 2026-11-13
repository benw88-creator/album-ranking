# Strategy B — what is built in Lab (13 Nov 2026)

Uncommitted in `vinal-lab` (branch `lab`). Nothing pushed, deployed or sent.

## The switch

`assets/apple.js` defines `window.Rights`. `Rights.ON` is **true in the native app, false on the website**, so the website is unchanged until you decide otherwise. To test the Apple build in a browser: open `/?rights=apple` (remembered on that device; `?rights=deezer` switches back).

## Done

| Gameplan item | What the Apple build now does | Where |
|---|---|---|
| 1. Apple catalogue | Search, album pages, tracklists, discographies, artist lookups and 30-second previews come from Apple's iTunes Search API, called **from the device** (Apple limits it to ~20 calls a minute per IP, held by a rolling limiter; metadata cached a day, preview audio streamed only). The UK chart comes from Apple's public RSS feed through `/api/catalogue?source=apple`. The app's ~40 catalogue call sites are unchanged: `apple.js` answers `/api/catalogue` and `/api/preview` in the same shapes. | `assets/apple.js`, `api/catalogue.js` |
| | Apple ids are stored as `am<digits>` so they can never collide with Deezer's numeric ids. Older Deezer and Spotify ids resolve by name and artist, as they already did. Nothing stored is re-keyed. | |
| | Apple's album index is weak on mixed text ("frank ocean blonde" finds no Blonde), so albums are gathered from Apple's song results first. Measured: Blonde, In Rainbows, IGOR and Travis Scott's discography all resolve. | |
| Badge and attribution | Album page: Apple's official "Listen on Apple Music" badge (from tools.applemediaservices.com, unaltered) linking to the album. For You: badge plus "Preview provided courtesy of iTunes" on every card, linking to the track. Player bar: "Courtesy of iTunes ↗" linking to the track. Any other preview (song rows, Today, Your music) shows a small badge pill while it plays. | `apple.js`, `index.html` |
| No artwork alterations | For You's two blurred copies of the sleeve are not drawn in the Apple build. | `index.html` cardHtml |
| Deezer branding | No Deezer marks; footer and Settings credit iTunes. No Deezer image is requested: a Deezer sleeve URL is swapped for VINALL's own blank sleeve before it loads. | `apple.js` |
| 2. Recall and cover games | Recall, Guess the Cover and Cover EXTREME are hidden and unreachable (cards, links, `#recall`, leaderboards, unlock list, discovery prompts). The tutorial skips its Recall beat. | `apple.js`, `index.html`, `boards.js`, `discover.js` |
| Artwork inside games | No third-party sleeve is shown inside any game sheet (Apple's terms exclude "independent entertainment value"). Cover Fire's answers are the record names. | `apple.js`, `index.html` |
| Community Choice | New picks are YouTube only (no preview fallback, no waveform decoding of an Apple preview). Older Deezer-based moments open the song on YouTube. Playback relies on YouTube's own `end` parameter; VINALL no longer pauses the player itself. Needs migration `20261113120000_moments_apple_ids.sql` (lab DB). | `index.html` |
| 3. Background audio | Already done in Lab: `audio` removed from `UIBackgroundModes`; the player pauses when the app goes to the background. | `Info.plist`, `AppDelegate.swift` |
| Screenshots | Already made: 5 screenshots with invented records and original art. | `store-screenshots/` |
| Terms and privacy (v1.8) | Apple named as the iOS source with a link to Apple's privacy policy; users bound by the YouTube Terms of Service; Google Privacy Policy linked for the player. **Wants a legal read before release.** | `terms.html`, `privacy.html` |

## Not done — needed before the review response is true

1. **VINALL Value (replaces kworb).** Bid Wars, Higher or Lower (streams) and Collection prices still go through `/api/album-streams`, `/api/collection-*` and `/api/bid-war-create`, which use **kworb and Deezer tracklists on the server**. Until this lands, the app still uses Deezer's API indirectly, and the response must not say otherwise. The research plan (§5) has the design: Wikipedia pageviews + Wikidata certifications (CC0) + capped community signal, quantile-calibrated to today's prices, one idempotent migration.
2. **Stored artwork backfill.** Ratings, feed posts, lists and collections made on the web carry Deezer sleeve URLs. In the app they show VINALL's blank sleeve until rewritten to Apple's. This is a **production data change** (needs your approval and a backup first). The user's own new ratings in the app store Apple sleeves.
3. **Spotify export import** is matched against Deezer on the server, so the app says it is "not in the app yet" and points to the website. Moving the matcher to Apple is a separate job.
4. **Artist photos.** Apple's Search API has none; artist pages and the Popular picker show a placeholder.
5. **Native build and device run** (Mac): previews, lock/resume, Choice, and the 20-calls-a-minute limit under real For You use.
6. **Lab DB migration** `20261113120000_moments_apple_ids.sql` applied by hand.

## Open questions only Apple can answer

The §12 message in `APP-STORE-SURVIVAL-PLAN.md`, plus (d) and (e) from `COVERS-AND-ESTIMATE.md`: grids and profile tiles, the Collection shelf, and quiz reveal screens. The build currently shows Apple artwork on grids, profiles and the Collection (each tile opens the badged album page). If Apple says no, those switch to the blank sleeve with one rule in `apple.js`.
