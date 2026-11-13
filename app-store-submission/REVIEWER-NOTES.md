# App Review Information — reviewer credentials & notes

## Demo account
```
Email:    ⏳ fill in once created — see CHECKLIST.md §1
Password: ⏳ fill in once created
```
Not generated here — the account doesn't exist yet, and credentials for one that does exist should never be guessed or invented.

## Notes (paste into App Store Connect → App Review Information → Notes)

Rewritten 2026-11-13 for the second submission (the Apple build, `Rights.ON`).
Every line is checked against the Lab build; re-check it against the binary you
actually upload.

```
VINALL is a music rating and journalling app. Seven notes.

1. Sign-in is required for most of the app, so please use the demo account in
the fields above. Accounts are email and password, or Sign in with Apple, both
handled by Supabase. Sign in with Apple opens Apple's own system sheet
(ASWebAuthenticationSession) and returns to the app.

2. Catalogue and audio. Album names, artwork, track listings and 30-second
previews come from Apple's iTunes Search API, requested from the device. The
album page and each discovery card carry the unaltered "Listen on Apple Music"
badge linking to the record, and previews are credited "provided courtesy of
iTunes". Previews are streamed, never downloaded or stored. The app plays no
full tracks and hosts no audio. Playback stops when the app leaves the
foreground; the app declares no background audio mode.

3. Games. No game screen shows album artwork or plays a preview. Game modes
built on artwork or audio (Recall, Guess the Cover, Cover EXTREME) are not in
this version. RocketRun, the featured daily game, is answered from the
MusicBrainz database (core data under CC0; the early rarity estimate also
uses MusicBrainz rating counts, CC BY-NC-SA, credited in the game) and uses only its own
original pixel art and an open-licence font (Pixelify Sans, SIL OFL).

4. Community Choice (Discover → Moments) plays some picks through YouTube's own
visible embedded player, at a timestamp the user chose. Nothing from YouTube
loads until the user agrees. VINALL never downloads or proxies its audio.

5. "The Draw" is a randomised in-app reward. Full odds for every prize are
shown in the app under the reel (Profile → Shop → The Draw → Odds). "Discs" are
in-app points, earned only. They cannot be bought, there is no in-app purchase
and no advertising, and they cannot be exchanged for anything outside the app.

6. Imported listening history is optional: a user may add the data file
Spotify gives them on request. It is their own copy of their own data, matched
on the device; only per-track totals are stored. VINALL does not use Spotify's
API.

7. Native features. The interface ships inside the app bundle (it does not load
a remote website). It uses Sign in with Apple through
ASWebAuthenticationSession, Universal Links so confirmation emails open the
app, Taptic Engine haptics, the native share sheet, local notification
reminders for the daily game, and keyboard handling tied to the system
keyboard.

Account deletion is in-app: Profile → Settings → Delete my account. It removes
all stored rows, the uploaded avatar, any listening history and the login
itself, with no waiting period.
```

## If guideline 4.2 (minimum functionality) is raised
The app bundles its assets (it is not a webview pointed at a website), uses native sign-in, Universal Links, haptics, the share sheet and local notifications, and has accounts, a server-authoritative economy, original games (RocketRun among them) and social features. Do NOT cite lock-screen controls or background audio: both were removed for guideline 2.5.4.

## Verified before writing these notes (2026-11-13, Lab)
- Apple catalogue, badge and "courtesy of iTunes" wording: `assets/apple.js`; `scripts/tests/rights.spec.mjs` checks no Deezer request and no Deezer or website wording on any Apple-build view or legal page.
- Held-back games (Recall, Guess the Cover, Cover EXTREME): `Rights.gameOff`, hidden cards, unreachable from `#recall`, the Arcade badge, Discover prompts and the native reminder; the app ignores `?rights=deezer` (test).
- No background audio: `app/ios/App/App/Info.plist` has no `UIBackgroundModes`.
- RocketRun data: MusicBrainz only (`arcade/rocketrun/net.js`, `api/rocketrun.js`); art drawn in-house; Pixelify Sans OFL (`arcade/rocketrun/fonts/OFL.txt`).
- Account deletion: `api/delete-account.js`.

## Not verified in this pass (needs you or a live check)
- That the demo account, once created, actually clears every gate described above — test it yourself after creation.
