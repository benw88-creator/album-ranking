# App Review Information — reviewer credentials & notes

## Demo account
```
Email:    ⏳ fill in once created — see CHECKLIST.md §1
Password: ⏳ fill in once created
```
Not generated here — the account doesn't exist yet, and credentials for one that does exist should never be guessed or invented.

## Notes (paste into App Store Connect → App Review Information → Notes)

```
VINALL is a music rating and journalling app. Six notes.

1. Sign-in is required for most of the app, so please use the demo account in
the fields above. Accounts are email and password, or Sign in with Apple, both
handled by Supabase. Sign in with Apple opens Apple's own system sheet
(ASWebAuthenticationSession) and returns to the app. No other third-party
sign-in is offered, so no other credentials are needed.

2. Catalogue and audio. Album names, artwork, tracklists and search results
come from Deezer's public API, credited with the Deezer logo in the footer, in
Settings and on each album page, which also links to the record on Deezer. The
app plays Deezer's official 30-second preview clips, which are public and
supplied for this purpose; it plays no full tracks and hosts no audio of its
own. There is no Spotify sign-in and the app requests no Spotify user scopes.

3. Community Choice (a feature under the Crate tab) lets a user mark a moment
inside a song and share it. Most picks use the same Deezer preview clip above.
A small number of picks ("whole-song" moments) instead play through YouTube's
own embedded player (youtube.com, not an app-hosted player), at a timestamp the
user chose, using the YouTube Data API. No audio is downloaded, proxied or
stored by VINALL; playback happens entirely inside the visible YouTube embed,
exactly as it would on any website that embeds a YouTube video.

4. "The Draw" is a randomised in-app reward. Full odds for every prize are
published in the app, under the reel on the Discs screen (open Discs, scroll to
The Draw, expand "Odds"). "Discs" are an in-app points score, earned only. They
cannot be bought, there is no in-app purchase and no advertising anywhere in the
app, and they cannot be exchanged for anything outside it.

5. Imported listening history is optional. A user may upload the JSON file that
Spotify provides them on request under GDPR. This is the user's own copy of
their own data, supplied by them, not obtained from any API. The per-play
events are aggregated in the browser and only per-track totals are stored.

6. Native features. VINALL's interface ships inside the app bundle (it does not
load a remote website) and it uses iOS directly: Sign in with Apple through
ASWebAuthenticationSession, Universal Links so confirmation emails open the app,
lock-screen Now Playing controls for previews (AVAudioSession playback and Now
Playing info), Taptic Engine haptics throughout, the native share sheet, local
notification reminders for the daily game, and keyboard handling tied to the
system keyboard. The core features (rating, the 11 Arcade games, the record
collection) all run in-app.

Account deletion is in-app: Settings -> Delete my account. It removes all
stored rows, the uploaded avatar, any listening history, and the login itself,
with no waiting period.
```

## If guideline 4.2 (minimum functionality) is raised
The app bundles its assets (not a webview pointed at vinall.xyz), uses haptics on every interaction, provides lock-screen media controls and background audio for the player (none of which a website can do), and has accounts, a server-authoritative economy, five original games and social features.

## Verified before writing these notes
- Deezer catalogue/preview/attribution: checked against `api/catalogue.js`, `api/preview.js`, and the attribution description in `CLAUDE.md`.
- No Spotify OAuth: `api/login.js`/`api/callback.js` confirmed removed per `CLAUDE.md`'s Shape section; no Spotify auth call wired in `index.html`.
- YouTube: confirmed via `CLAUDE.md`'s Community Choice section (`api/youtube.js`, visible `youtube.com` embed, bot-check probe, Deezer fallback) — not present in the original `STORE-SUBMISSION.md` draft, added here.
- The Draw / Discs: no purchase path found anywhere in the client or API routes for Discs; odds panel computed from `spin_items` per `CLAUDE.md`.
- Account deletion: read `api/delete-account.js` directly — confirm/DELETE required, JWT-verified, calls `delete_my_data()` then the Admin API.

## Not verified in this pass (needs you or a live check)
- That the demo account, once created, actually clears every gate described above — test it yourself after creation.
