# Store submission — prepared answers

Everything here is filled in from what the code actually does, so it matches the
privacy policy and the database. Copy it into App Store Connect / Play Console.

Verify against the code before submitting if time has passed — the truthful
answer is whatever `analytics_events`, `client_errors`, `profiles`, `reports`,
`blocks` and `listening_plays` actually hold on the day you submit.

**This file was wrong for a while and that is worth knowing about.** The App
Review notes said VINALL used the Spotify Web API for its catalogue and that
"there is no audio playback of any kind". Both had stopped being true months
earlier — the catalogue moved to Deezer, and the app grew a player with its own
`<audio>` element and lock-screen controls. Neither was a lie when it was
written and both would have been one when submitted. **Re-read this file against
the code every time, not once.**

---

## What is actually being submitted

The same `index.html` that serves wildcrate.xyz, bundled inside a Capacitor
wrapper (`app/`). Not a webview pointed at the live site — the assets ship
inside the binary. See **Guideline 4.2** below, which is the one this decision
exists to answer.

---

## App Privacy ("nutrition label")

Apple asks, per data type: do you collect it, is it linked to identity, and why.
VINALL does **no** tracking across other companies' apps or sites, so answer
**No** to "Used for Tracking" for every single type. There is no ad SDK, no
analytics SDK, and no third-party script in `index.html` beyond the Supabase
client itself.

| Data type | Collected | Linked to identity | Purpose |
|---|---|---|---|
| Email address | Yes | Yes | App Functionality (account, login, password reset) |
| Name | No | — | — |
| Phone number | No | — | — |
| Physical address | No | — | — |
| Precise / coarse location | No | — | — |
| Photos or videos | Yes | Yes | App Functionality (profile avatar, if the user uploads one) |
| User content — other | Yes | Yes | App Functionality (ratings, notes, lore answers, comments, reports, imported listening history) |
| Search history | No | — | — |
| Browsing history | No | — | — |
| User ID | Yes | Yes | App Functionality |
| Device ID | No | — | — |
| Product interaction | Yes | Yes | Analytics *and* App Functionality (`analytics_events`; and `listening_plays`, which now records previews played inside the app) |
| Crash data | Yes | No | Analytics (`client_errors` — logged-out crashes are stored with no user id) |
| Performance data | No | — | — |
| Diagnostic data — other | No | — | — |
| Purchases | No | — | — |
| Financial info | No | — | — |
| Contacts | No | — | — |
| Health / fitness | No | — | — |
| Sensitive info | No | — | — |

Notes for the form:

- **Photos**: only if avatar upload is still enabled at submission. It is, as of
  this writing — `Cloud.uploadAvatar` and the `avatars` bucket. If you strip
  avatars, answer No.
- **Crash data is not linked to identity** — `client_errors` accepts inserts from
  logged-out visitors precisely so that anonymous crashes get reported.
- **Product interaction** genuinely serves two purposes; declare both. Declaring
  only Analytics understates it, and Apple treats an understatement as the
  problem, not an overstatement.
- **`listening_plays` now has two sources and that is new.** It was built for the
  optional import below, and the in-app player now writes to it as well: playing
  twenty seconds of a thirty-second preview counts one play of that track. It is
  the user's own row, RLS is own-rows-only, it is never read to build anybody
  else's profile, and it goes with the account on deletion. It is *Product
  interaction*, not *Browsing history* — Apple means browsing outside the app by
  that.
- **Imported listening history** falls under *User content — other*, which is
  already Yes / linked / App Functionality, so the table needs no new row. Say so
  in the review notes anyway: it is optional, the user supplies the file
  themselves, the per-play events are aggregated in the browser and never
  uploaded, only per-track totals are stored, and it is private to the account.

### Google Play Data Safety

Same substance, different form. The two answers that trip people up:

- **Is data encrypted in transit?** Yes — Supabase and Vercel are HTTPS only.
- **Can users request deletion?** Yes, **in-app** — Settings → Delete my account,
  which calls `/api/delete-account`. Give that as the deletion method, plus the
  support email as the alternative route.

---

## Age rating

VINALL carries user-generated content (comments, notes, usernames, reports) and
social features (following, Grooves, Bid Wars, head-to-head Cover Fire). Answer
honestly:

| Question | Answer |
|---|---|
| Users can create or upload content | **Yes** |
| Content is moderated | **Yes** — slur filter (`hasSlur`), report path, block, contact address |
| App has social features / user interaction | **Yes** |
| Unrestricted web access | **No** — no in-app browser. External links (Deezer, the privacy policy) hand off to the system browser |
| Gambling, contests | **No** — see The Draw below |
| Profanity or crude humour | **Infrequent/Mild** (users can type; there is a filter) |
| Alcohol, tobacco, drug references | **None** by the app; user content is filtered and reportable |
| Violence, horror, sexual content | **None** |

Expected outcome: **12+** on the App Store, **Teen** on Play. The privacy policy
says 13 or over, which is consistent — do not set 4+ and hope.

**Discs are not an in-app purchase.** They are earned only, cannot be topped up,
and buy nothing outside the app. If that ever changes, the rating, the purchase
declarations, the gambling answer and the Deezer licence all change with it.

---

## Guideline 4.2 — why this is not a thin wrapper

The rejection this invites is "minimum functionality": an app that only loads a
website. Three things answer it, and they are in the build rather than in an
argument:

- **The web assets are bundled, not fetched.** The app does not point a webview
  at wildcrate.xyz. `index.html`, the artwork and the fonts are in the binary,
  which is also why it opens with no connection.
- **It uses the device.** Haptics on every tap, correct guess and win; the system
  share sheet for results and invite links; lock-screen media controls and
  background audio for the player; safe-area layout; the hardware back button on
  Android.
- **It is not a brochure.** Accounts, a rating system with history, five games,
  an economy, social features and an audio player.

If a reviewer still raises 4.2, the answer is the haptics and the lock-screen
controls: neither exists in the browser version, and the second is something no
web page can do at all.

---

## Guideline 3.1.1 — The Draw, and published odds

The Draw is loot-box shaped: you spend an in-app currency on a randomised
reward. Apple wants the odds published, so **they are** — an "Odds" panel under
the reel, listing every tier and every prize with its exact percentage, computed
live from the same `spin_items` table the server draws from.

Two things to be able to say without hesitating:

- **Discs cannot be bought.** There is no purchase path, no IAP, no top-up. They
  are earned by using the app. This is what keeps The Draw out of both the IAP
  rules and UK gambling regulation, and the panel says it on screen.
- **Nothing it awards has cash value or leaves the app.**

**The odds panel is behind login**, because the whole Discs page is. The reviewer
needs the demo account (below) to see it. Say so in the notes.

---

## Deezer's terms are a standing constraint on monetising

The catalogue — every album name, artist, tracklist, cover, search result and
preview clip — comes from Deezer. Their terms restrict use to a
"**non-commercial purpose and in a non-commercial environment**", and forbid
deriving "any moneys, incomes, revenues, data or any other consideration" from
the service or its content.

A free app with no ads, no IAP and no paid tier satisfies that, which is what is
being submitted. **The constraint is on the future**, and it is hard: the moment
VINALL carries advertising, charges for anything, or sells Discs, the catalogue
has to move first. Spotify's terms are the mirror image — they permit commercial
use and ban games outright — so there is no streaming API that allows games *and*
money. `CLAUDE.md` has the route that would (MusicBrainz + Cover Art Archive for
metadata, Apple's iTunes Search API for previews) and it is a third catalogue
move, not a switch.

Nothing here reaches App Review. It is written down so nobody discovers it after
adding a paywall.

---

## Attribution — Deezer's logo is mandatory, Spotify's marks are gone

> "Each application using Deezer API/SDKs must have to include a clearly visible
> Deezer Logo... The respect of these logo guidelines is mandatory."

So the full Deezer wordmark is in the footer and in Settings, and the square
Deezer icon is on the two controls that link out to Deezer (the album page and
the player bar). Both files are Deezer's own, taken unaltered from their CDN and
never redrawn.

**Every Spotify mark was removed at the same time**, for two reasons that agree:
Spotify supplies none of this app's content any more, so their attribution has
nothing left to attach to; and Deezer's terms say their content "shall not be
associated, directly or indirectly with any trademark, brand name, or logo",
which another streaming service's mark on the same screen is the clearest case
of. Do not put it back.

---

## Listing copy (draft — edit freely)

**Name:** VINALL

**Subtitle (30 chars max):**
`Rate music. Remember why.` — 25 characters.

VINALL is not a term anyone searches, so the subtitle has to carry the pitch and
the keywords have to carry discovery.

**Keywords (100 chars, comma-separated, no spaces after commas, don't repeat the
name):**

```
album,ratings,rank,vinyl,records,review,collection,listening,taste,history,music quiz,crate
```

91 characters. Do not add the name, and do not add plurals of words already
there — Apple stems them.

**Description:**

```
VINALL is where your relationship with music accumulates.

Rate the albums and songs you love, and VINALL starts noticing things — a record
you rated 82 in March and 94 in September, an artist you rated highly and never
went back to, two ratings that contradict each other. Then it asks you something
small about it. One tap is a complete answer.

Nothing else can know how your opinion of a record moved. Spotify knows what you
played. Every rating site knows what you think today. This is the one that
remembers what you used to think.

Play any track while you rate it — thirty seconds, in the app, with proper
controls on your lock screen.

- Rate albums and songs out of 100, with notes
- Today: one question at a time, drawn from your own crate
- Taste match: how close you and somebody else really are, and the records you
  disagree on most
- Build a collection, and watch what it is worth
- Recall: one second of a record. Name it before it gets easier
- Cover Fire: ten sleeves, one minute, same ten for everybody
- Earworm: spell the record, letter by letter
- Daily Drop: guess the day's album and song in six
- Bid Wars: outbid a friend on five records, blind
- Grooves: private groups for you and your mates
- Import your Spotify listening history if you have it — years of it, added up
  on your own device and never uploaded

No ads. No selling your data. Delete everything from inside the app whenever you
like.
```

Two things deliberately removed from the previous draft: **Liner Notes and the
year grid**, which are switched off (`DIARY_ON = false`), and the import as a
headline feature — almost nobody requests a Spotify export, so leading with it
sold something most installs will never do. It is still listed, last, honestly.

The import line carries the privacy claim in the same breath as the feature, on
purpose. "We read your entire listening history" loses people unless the answer
to "and send it where" is in the next clause.

**Promotional text (170 chars, changeable without review):**

```
New: play a track without leaving VINALL — thirty seconds, lock-screen controls, and your rating one tap away from the record you are actually hearing.
```

149 characters. Swap this for whatever shipped most recently; it changes without
review, so it is the one piece of copy worth keeping current.

---

## Screenshots

Needed per device class; one set is not accepted. Shoot these five, in this
order, because the order is the pitch:

1. **Home with Today** — a question card mid-answer, with the counter showing.
   A second-thoughts card is the best one to catch: "You gave this 82 in
   November" is the product doing the thing nothing else can do
2. **An album page** — a rating, a note, and the player bar at the bottom
   mid-track, so the playback is visible rather than claimed
3. **Taste match on somebody's profile** — the percentage with the evidence
   under it, which is the most convincing single screen in the app
4. **Cover Fire** — mid-run, the streak multiplier and the clock draining
5. **The Collection** — a shelf with prices and a provenance line

Use a real populated account, not an empty one. An empty crate is the worst
possible first screenshot.

Do not shoot the import screen. It is a file picker, and a file picker reads as
homework rather than a feature.

---

## App Review notes

Paste this into **App Store Connect → App Review Information → Notes**.

```
VINALL is a music rating and journalling app. Four notes.

1. Sign-in is required for most of the app, so please use the demo account in
the fields above. Accounts are email and password, handled by Supabase. There
is no third-party sign-in of any kind and no OAuth flow, so no other
credentials are needed.

2. Catalogue and audio. Album names, artwork, tracklists and search results
come from Deezer's public API, credited with the Deezer logo in the footer, in
Settings and on each album page, which also links to the record on Deezer. The
app plays Deezer's official 30-second preview clips, which are public and
supplied for this purpose; it plays no full tracks and hosts no audio of its
own. There is no Spotify sign-in and the app requests no Spotify user scopes.

3. "The Draw" is a randomised in-app reward. Full odds for every prize are
published in the app, under the reel on the Discs screen (open Discs, scroll to
The Draw, expand "Odds"). "Discs" are an in-app points score, earned only. They
cannot be bought, there is no in-app purchase and no advertising anywhere in the
app, and they cannot be exchanged for anything outside it.

4. Imported listening history is optional. A user may upload the JSON file that
Spotify provides them on request under GDPR. This is the user's own copy of
their own data, supplied by them, not obtained from any API. The per-play
events are aggregated in the browser and only per-track totals are stored.

Account deletion is in-app: Settings -> Delete my account. It removes all
stored rows, the uploaded avatar, any listening history, and the login itself,
with no waiting period.
```

Three things this deliberately says out loud:

- **The demo account, first.** Most of VINALL is behind login, and a reviewer who
  hits a wall files it as a bug in your app.
- **The previews are Deezer's own and are meant to be played.** A music app that
  plays audio invites the "do you have the rights" question, and the answer is
  that these are the public preview clips Deezer publishes on its API.
- **The odds have a location, not just an existence.** "Published in the app" with
  no directions is a reviewer hunting for them and not finding them.

### The three outside dependencies, decided

**Spotify — still there, but it is one lookup now.** The catalogue moved to
Deezer; the only thing still asked of Spotify is *what is this artist's id*,
because kworb indexes its stream tables by Spotify artist id. One search per
artist, cached, no album metadata read or stored.

The old worry was the 5-user Development Mode cap, and it does not apply: it caps
*authenticated* users, and since the Spotify OAuth routes were removed there are
none. Every request uses one app-level Client Credentials token, rate-limited
rather than user-limited. **Do not apply for Extended Quota** as part of
submission — it needs 250k MAU, it is unreachable, and the application invites
questions you cannot answer yet.

**kworb — keep it, with eyes open.** It powers the stream valuation behind Bid
Wars, the Collection's prices and Higher or Lower, and it is scraped HTML from a
fan-run stats site with no API and no uptime promise. There is no better source:
Spotify publishes no stream counts at any tier, and the Last.fm alternative was
wrong by three orders of magnitude.

So: keep it, and accept that those three can break, with three things making that
survivable — totals are cached in `album_plays` for 14 days, so an outage is
invisible for a fortnight; the admin panel's **kworb health** button says whether
the scrape is alive; and a war's values freeze at creation, so a break cannot
corrupt one in progress.

**Deezer — the real dependency, and the one with a clause.** Their terms let them
revoke access "at any time for any reason" with no notice, and bar commercial use
(above). Nothing about either reaches App Review.

---

## Still needed from you

- [ ] **A real support address** to replace `spam30492@gmail.com` in
      `privacy.html`, `terms.html` and the store listing. Apple emails this during
      review and a bounce or an unread mailbox is a rejection, so it has to be one
      you actually open — a Gmail alias is fine, a dead one is not. **This blocks
      submission.**
- [ ] **A demo account for App Review**, with a populated crate. Create it, put
      the email and password in App Store Connect → App Review Information, and
      make sure it stays alive. Most of the app is behind login, so without this
      the reviewer sees a login wall and rejects. **This blocks submission.**
- [ ] **Apple Developer Program enrolment** — £79/year in the UK, identity check,
      has a lead time. Google Play is a one-off $25 (about £20).
- [ ] Answer the age-rating questionnaire using the table above
- [ ] Fill App Privacy / Data Safety using the table above
- [ ] Paste the App Review notes above
- [ ] Take the screenshots, from the populated demo account
- [ ] Apply `20260916230000_listening_note_play.sql` by hand in the SQL editor.
      Until it is, the player observes plays and writes nothing — no error, just
      a table that never fills.

### Done

- [x] Apply `20260908120000_groove_roles.sql` — applied by hand, 2026-09-09
- [x] Apply `20260909120000_listening_history.sql` — applied by hand, 2026-09-09
- [x] Supabase **Authentication → URL Configuration** — Site URL and redirect
      allow-list corrected, so password reset works
- [x] Delete `REDIRECT_URI` from Vercel
- [x] Decide the Spotify, kworb and Deezer questions — written up above
- [x] Publish The Draw's odds in-app, for guideline 3.1.1
- [x] Deezer's logo on every surface that needs it; every Spotify mark removed
- [x] Wrap the app with Capacitor, with the assets bundled — see Guideline 4.2

Neither hand-applied migration is recorded in Supabase's migration history, same
as `protect_is_admin`. Both are idempotent, so a future `supabase db push` that
re-runs them is harmless.
