# VINALL — App Store submission checklist (EXCUS LTD)

Verified against the actual codebase on 2026-11-02. Legend: ✅ verified · ⏳ needs you · ❌ issue to fix.

## 0. Local changes not yet committed (re-checked, still true)

Not a problem by itself — flagging it because it changes what "ready to submit" means for the native build specifically.

- `git status` still shows the same 8 modified files (`index.html`, `assets/interactions.{css,js}`, `privacy.html`, `terms.html`, `scripts/serve.mjs`, `scripts/tests/polish.spec.mjs`, `sw.js`), uncommitted, on top of the last commit (`20c5a4c`, 2026-10-11). This is the animation/account-reliability pass described in `PRELAUNCH-POLISH.md` — 123 tests passed locally, but that's the working tree, not a shipped build.
- **Why it matters for the native app specifically**: `npm run sync` (in `app/`) copies `index.html` and friends into `app/www` from whatever's on disk *right now* — committed or not. So the native build you archive in Xcode already includes these changes whether or not you've pushed to `main`/Vercel. The web (vinall.xyz) and the native app are **two separate deploy targets** that can drift from each other if you sync the native build without also pushing the web one.
- ⏳ **Your call, not a blocker**: if you're happy with what's in `index.html` right now, just make sure you (a) `git commit` it so it isn't lost, and (b) push to `main` so the website matches what reviewers may also poke at from the web, before or around the same time as submitting the native build.

---

## 1. Demo account

- ✅ **You've created and populated it** — rated, onboarding done, per your confirmation. I can't see into Supabase from here, so I can't independently verify row counts or flags — three things worth a 30-second manual check on your end before you paste credentials into App Store Connect:
  1. **`profiles.is_admin` must be `false`** on this account. If it's `true` (e.g. because you tested it while signed in as yourself/admin and it inherited that), it shows balance as `∞`, unlocks every Buy button regardless of cost, and exposes the admin analytics panel — directly contradicting "Discs are earned only, no purchase path" in the review notes. This is the one thing in the whole checklist that would actively mislead a reviewer if wrong, so it's worth a direct look at that row rather than trusting memory.
  2. Higher or Lower unlocks at 25 rated albums exactly (`GATES`) — worth a glance that it shows unlocked, not "Rate 0 more" (off-by-one gates are an easy thing to ship wrong).
  3. The Shop shows at least one owned/equipped cosmetic, so a reviewer doesn't land on an empty-looking shelf.
- ⏳ **Age "18+"**: confirmed there's no date-of-birth/age field anywhere in `index.html` — this isn't something the app asks for, so there's nothing for me to verify in code. If you mean the account holder is an adult, that's just true of the account you made; if you meant something else, let me know what it needs to satisfy.
- ⏳ **Keep it alive** — Apple re-reviews on every future update using the same credentials.

---

## 2. App Store screenshots

- ⏳ **You say these are done.** I searched the repo for them (`*.png`/`*.jpg` outside icons/assets) and found nothing, so they must live outside the project folder — point me at the folder/path and I'll actually check sizes, clipping and content against the five-shot list below rather than take it on trust. Until I've looked, I'm not marking this ✅.
- Shot list, for reference (from `STORE-SUBMISSION.md`): Home/Today question card · album page with rating+note+player bar · Taste match with evidence · Cover Fire mid-run · The Collection shelf.
- Required sizes if not already matched: 6.9" iPhone (1320×2868px) is the current required set; 13" iPad (2064×2752px) only if iPad is a supported device.
- Quick self-check if I can't see them: no clipped text at the notch/safe-area, no placeholder content, no admin-only UI or debug overlays visible, not the Spotify-import file picker.

---

## 3. App Store Connect information

All copy is in [`APP-STORE-CONNECT-COPY.md`](./APP-STORE-CONNECT-COPY.md) in this folder, ready to paste. Summary of what's settled vs. open:

- ✅ **Name, subtitle, keywords, description, promotional text** — drafted in `STORE-SUBMISSION.md`, copied and lightly checked for char limits in the copy file. Re-read before pasting; it describes features (Lore, Liner Notes-adjacent "Today") that are live, and omits Liner Notes/year-grid correctly (switched off, `DIARY_ON = false`).
- ✅ **Support URL** — `https://excus.co.uk/vinall/support`, checked live: real page, accurate to the app (covers accounts, ratings, minigames/Discs, reporting/blocking, deletion, correctly says Discs can't be bought). Use this as the App Store Connect Support URL.
- ⏳ **Support email mismatch (not a blocker).** Support page says `hello@excus.co.uk`, `privacy.html`/`terms.html`/in-app say `vinall.support@gmail.com`. Doesn't affect submission or review — Apple doesn't cross-check these — it's only a minor polish/trust issue for a user who reads both. Fix whenever; not before launch.
- ✅ **Privacy Policy URL** — `https://vinall.xyz/privacy.html`, live, dated, names EXCUS LTD as controller.
- ✅ **Age rating questionnaire answers** — table drafted in `STORE-SUBMISSION.md`, reproduced in the copy file. Expected outcome **12+** (UGC + moderation + social features, no gambling since Discs can't be bought, no explicit content).
- ✅ **App Privacy ("nutrition label") answers** — full table in `STORE-SUBMISSION.md`, reproduced in copy file, cross-checked against what the code actually collects (Supabase auth email, avatar photos, ratings/notes/comments as "User content," `analytics_events`, `client_errors` crash data, `listening_plays`).
- ❌ **Category** — not decided anywhere in the repo. ⏳ **Your action**: primary category should be **Music** (self-evident); App Store also wants a secondary — **Lifestyle** or **Entertainment** both fit, pick one. No code decision needed, just pick on the Connect form.
- ⏳ **Apple Developer Program enrolment under EXCUS LTD** — this has to be done by you directly with Apple (D-U-N-S number, legal entity verification, £79/yr). The company's registered details (number 17517058, Covent Garden address) are already correct in `privacy.html`/`terms.html`, so whatever you enter in Apple's enrolment form should match those exactly or the identity check will stall.
- ⏳ **Bundle ID**: `xyz.wildcrate.vinall`, unchanged since the domain moved to vinall.xyz. `CLAUDE.md` notes this is deliberate — an appId is the app's identity in both stores and changing it is a decision, not a rename. **Confirm you're happy shipping under the old domain's bundle ID before first submission** — it's much harder to change later (a new bundle ID means a new app listing, losing reviews/rank).

---

## 4. Reviewer credentials and notes

- ✅ **App Review notes are already drafted** in `STORE-SUBMISSION.md` and reproduced verbatim in [`REVIEWER-NOTES.md`](./REVIEWER-NOTES.md). I checked them against the current code rather than trusting the file:
  - **Deezer claim verified**: catalogue (`api/catalogue.js`), previews (`api/preview.js`), and attribution (Deezer logo in footer/Settings/album page, linking back to the record) all check out against `CLAUDE.md`'s own description of the switch.
  - **No Spotify sign-in verified**: `Shape` section of `CLAUDE.md` confirms `api/login.js`/`api/callback.js` were removed; grepped `index.html` for OAuth and found none wired to Spotify.
  - **YouTube claim**: the pasted brief asked me to be accurate about YouTube — `CLAUDE.md`'s Community Choice section describes YouTube-sourced "whole-song picks" via `api/youtube.js`, playing through the visible embedded YouTube player (not downloaded/proxied), gated by a bot-check probe, with Deezer preview as fallback. **This needs a line in the reviewer notes** that the original draft in `STORE-SUBMISSION.md` doesn't have (it predates Community Choice). I've added it in the updated notes file.
  - **The Draw / odds panel / Discs can't be bought**: verified against `CLAUDE.md`'s "The Draw" section — no purchase path for Discs anywhere, odds panel computed live from `spin_items`.
- ⏳ **Your action**: fill in the demo account's actual email/password into `REVIEWER-NOTES.md` locally before pasting into App Store Connect — **I have not generated or guessed credentials**, and won't; that account doesn't exist yet (§1).
- ⏳ Paste the notes from `REVIEWER-NOTES.md` into **App Store Connect → App Review Information → Notes**.

---

## 5. Final compliance checks

- ✅ **Privacy policy** — live, dated, names EXCUS LTD, UK/EU legal bases stated. Confirmed directly (not just from `CLAUDE.md`'s description) that `privacy.html` names YouTube: "Plays Community Choice moments, through YouTube's own embedded player... the song and artist name are sent to YouTube to find the video, with nothing that identifies you." Accurate to `api/youtube.js`'s actual behaviour.
- ✅ **Terms** — live, dated, names EXCUS LTD, covers music/artwork licensing position and governing law per `CLAUDE.md`.
- ✅ **Support page** — `https://excus.co.uk/vinall/support`, live and accurate (verified in §3).
- ✅ **Support email routing works for submission** — split between `hello@excus.co.uk` (support page) and `vinall.support@gmail.com` (app/legal pages) is a post-launch polish item, not a review/submission concern (§3).
- ✅ **Reporting/blocking** — `reports` and `blocks` tables exist per `CLAUDE.md`'s Analytics and safety section; blocks are applied across People, feed, comments, notifications, follow lists, username search and groove member lists, with the load-order bug (filtering before `loadBlocks()` resolves) already fixed per that doc. I did not re-test this live.
- ✅ **Account deletion** — `api/delete-account.js` read directly: requires `confirm: 'DELETE'` in the body, verifies the caller's JWT, calls `delete_my_data()` as the user (RLS-scoped), then removes the auth.users row via the Admin API. In-app, immediate, no waiting period — satisfies Apple's June 2022 requirement.
- ⏳ **Content permissions / licensing** — Deezer's non-commercial terms are satisfied *as long as the app stays free with no ads/IAP/paid tier* (confirmed: no IAP code anywhere, Discs can't be bought). This is a standing constraint, not a one-time check — don't add monetisation without re-reading `CLAUDE.md`'s Deezer terms section first.
- ✅ **Camera/photo library usage strings** — checked `app/ios/App/App/Info.plist` directly: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` and `ITSAppUsesNonExemptEncryption = false` are all present with real descriptions, not placeholders.
- ✅ **`UIBackgroundModes: audio`** — per `CLAUDE.md`'s native section, present and justified (lock-screen playback controls), with review notes already covering why.
- ⏳ **Guideline 4.2 (minimum functionality)** — the argument is solid (bundled assets, haptics, lock-screen controls, accounts/economy/games) and is already written into the reviewer notes file. Nothing to fix, just be ready to repeat it if flagged.

---

## What's genuinely done vs. what's on you

**Done / verified from the code (and live pages):**
Listing copy drafted and checked · privacy/terms live, naming EXCUS LTD correctly, confirmed to name YouTube/Deezer accurately · support page live and checked against the app's real behaviour · account deletion correct and immediate · Deezer/YouTube/Spotify claims in review notes checked against actual code · App Privacy and age-rating tables drafted from real data flows · blocking/reporting wired up · iOS usage-description strings present and real · demo account created and populated (your confirmation).

**On you, in priority order for actually submitting:**
1. Confirm the demo account's `profiles.is_admin` is `false` (§1)
2. Point me at the screenshots folder so I can actually check them, or confirm sizes yourself (§2)
3. Pick secondary category, fill in demo credentials in `REVIEWER-NOTES.md`, submit

**Not needed for launch, fix whenever:** unify the support email (§3/§5).
