# Store submission — prepared answers

Everything here is filled in from what the code actually does, so it matches the
privacy policy and the database. Copy it into App Store Connect / Play Console.

Verify against the code before submitting if time has passed — the truthful
answer is whatever `analytics_events`, `client_errors`, `profiles`, `reports`
and `blocks` actually hold on the day you submit.

---

## App Privacy ("nutrition label")

Apple asks, per data type: do you collect it, is it linked to identity, and why.
VINALL does **no** tracking across other companies' apps or sites, so answer
**No** to "Used for Tracking" for every single type. There is no ad SDK, no
analytics SDK, and no third-party script of any kind in `index.html`.

| Data type | Collected | Linked to identity | Purpose |
|---|---|---|---|
| Email address | Yes | Yes | App Functionality (account, login, password reset) |
| Name | No | — | — |
| Phone number | No | — | — |
| Physical address | No | — | — |
| Precise / coarse location | No | — | — |
| Photos or videos | Yes | Yes | App Functionality (profile avatar, if the user uploads one) |
| User content — other | Yes | Yes | App Functionality (ratings, notes, diary entries, lore answers, comments, reports) |
| Search history | No | — | — |
| Browsing history | No | — | — |
| User ID | Yes | Yes | App Functionality |
| Device ID | No | — | — |
| Product interaction | Yes | Yes | Analytics *and* App Functionality (`analytics_events`: which questions were shown, answered, skipped) |
| Crash data | Yes | No | Analytics (`client_errors` — logged-out crashes are stored with no user id) |
| Performance data | No | — | — |
| Diagnostic data — other | No | — | — |
| Purchases | No | — | — |
| Financial info | No | — | — |
| Contacts | No | — | — |
| Health / fitness | No | — | — |
| Sensitive info | No | — | — |

Notes for the form:

- **Photos**: only if avatar upload is still enabled at submission. If you strip
  avatars, answer No.
- **Crash data is not linked to identity** — `client_errors` accepts inserts from
  logged-out visitors precisely so that anonymous crashes get reported.
- **Product interaction** genuinely serves two purposes; declare both. Declaring
  only Analytics understates it, and Apple treats an understatement as the
  problem, not an overstatement.
- **Imported listening history** falls under *User content — other*, which is
  already Yes / linked / App Functionality, so the table needs no new row. Say so
  in the review notes anyway: it is optional, the user supplies the file
  themselves, the per-play events are aggregated in the browser and never
  uploaded, only per-track totals are stored, and it is private to the account.
  It is **not** *Browsing history* — that means browsing within the app — and it
  is not *Purchases*. If avatars are stripped before submission, this is then the
  only user-supplied file the app accepts.

### Google Play Data Safety

Same substance, different form. The two answers that trip people up:

- **Is data encrypted in transit?** Yes — Supabase and Vercel are HTTPS only.
- **Can users request deletion?** Yes, **in-app** — profile → Delete my account,
  which calls `/api/delete-account`. Give that as the deletion method, plus the
  support email as the alternative route.

---

## Age rating

VINALL carries user-generated content (comments, notes, usernames, reports) and
social features (following, Grooves, Bid Wars). Answer honestly:

| Question | Answer |
|---|---|
| Users can create or upload content | **Yes** |
| Content is moderated | **Yes** — slur filter (`hasSlur`), report path, block, contact address |
| App has social features / user interaction | **Yes** |
| Unrestricted web access | **No** — no in-app browser or arbitrary URL loading |
| Gambling, contests | **No** — Bid Wars uses Discs, which cannot be bought and have no cash value |
| Profanity or crude humour | **Infrequent/Mild** (users can type; there is a filter) |
| Alcohol, tobacco, drug references | **None** by the app; user content is filtered and reportable |
| Violence, horror, sexual content | **None** |

Expected outcome: **12+** on the App Store, **Teen** on Play. The privacy policy
says 13 or over, which is consistent — do not set 4+ and hope.

**Discs are not an in-app purchase.** They are earned only, cannot be topped up,
and buy nothing outside the app. If that ever changes, the rating and the
purchase declarations both change with it.

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
album,ratings,music diary,rank,vinyl,records,review,collection,listening,taste,history,journal
```

94 characters. `tracker` was swapped for `history`, same length, because
"listening history" is now a thing the app actually does and is a phrase people
type. Do not add the name, and do not add plurals of words already there —
Apple stems them.

**Description:**

```
VINALL is where your relationship with music accumulates.

Rate the albums and songs you love, and VINALL starts noticing things — a record
you played to death and abandoned, an artist you rated highly and never went
back to, two ratings that contradict each other. Then it asks you something
small about it. One tap is a complete answer.

Over time that becomes a record of what you were listening to and what was going
on, kept by day. Not a wrapped-up summary once a year. A diary.

Bring your own history if you want to. Spotify will send you every play you have
ever made, and VINALL will read it — so it can point at the track you played
three hundred times and never mentioned, or the one you wore out and quietly
stopped. Your plays are added up on your own device and never uploaded.

- Rate albums and songs out of 100, with notes
- Today: one question at a time, from your own listening
- Import your Spotify listening history — years of it, not just this year
- Liner Notes: a daily entry with the record, the mood and a line of your own
- The year: every day you wrote, coloured by how it sounded
- Earworm: spell the record, letter by letter
- Daily Drop: guess the day's album and song in six
- Bid Wars: outbid a friend on five records, blind
- Grooves: private groups for you and your mates

No ads. No selling your data. Delete everything from inside the app whenever you
like.
```

The import paragraph carries the privacy claim in the same breath as the feature,
deliberately. "We read your entire listening history" is the kind of sentence
that loses people unless the answer to "and send it where" is in the next clause.
It is also literally true — see the aggregation note under App Privacy — so it is
safe to say in the listing.

**Promotional text (170 chars, changeable without review):**

```
New: import your Spotify listening history, and VINALL starts asking about the records you played to death and quietly dropped.
```

127 characters. Swap this for whatever shipped most recently; it changes without
review, so it is the one piece of copy worth keeping current.

---

## Screenshots

Needed per device class; one set is not accepted. Shoot these five, in this
order, because the order is the pitch:

1. **Home with Today** — a question card mid-answer, with the counter showing.
   If your listening import has landed by then, shoot a `findRinsed` card
   specifically: "You have played X 312 times and never said a word about it" is
   a better first screenshot than any generic question, because it shows the
   product doing the one thing the description promises
2. **Liner Notes** — the year grid full of colour (needs a populated account)
3. **An album page** — a rating and a note
4. **Earworm** — a board part-solved, greens and ambers visible
5. **Bid Wars** — a resolved war showing the reveal

Use a real populated account, not an empty one. An empty year grid is the worst
possible first screenshot.

Don't shoot the import screen itself. It is a file picker, and a file picker in a
screenshot reads as homework rather than a feature — the *result* of the import
is what sells it, which is why it belongs in shot 1.

---

## App Review notes

Paste this into **App Store Connect → App Review Information → Notes**. It exists
because both of the app's outside dependencies look odd from the outside, and a
reviewer who has to guess tends to guess "rejected".

```
VINALL is a music rating and journalling app. Two notes on how it gets its data.

1. Spotify. VINALL uses the public Spotify Web API for album artwork and
catalogue information only, authorised with an app-level Client Credentials
token. Users do NOT sign in to Spotify and the app requests no Spotify user
scopes, so no reviewer account or test credentials are needed. Accounts are
email and password, handled by Supabase. Nothing is played back in the app;
there is no audio playback of any kind.

2. Imported listening history. A user may optionally upload the JSON file that
Spotify provides them on request under GDPR ("Extended streaming history").
This is the user's own copy of their own data, supplied by them, and it is not
obtained from any API. The per-play events are aggregated in the browser and
only per-track totals are stored. It is deletable on its own from the profile
screen, and is removed with the account.

Account deletion is in-app: Profile -> Delete my account. It removes all stored
rows, the uploaded avatar, any imported listening history, and the login itself,
with no waiting period.

There are no in-app purchases and no advertising. "Discs" are an in-app points
score, earned only, cannot be bought, and cannot be exchanged for anything
outside the app.
```

Two things this deliberately says out loud:

- **No reviewer test account for Spotify.** Reviewers reject apps that appear to
  need a third-party login they were not given. Saying "no Spotify sign-in
  exists" pre-empts the whole thread.
- **The export is the user's own data, not scraped.** An uploaded file full of
  another company's listening data looks alarming until you say the user asked
  for it and handed it over.

### The two tier-5 questions, decided

**Spotify quota — not a blocker, and here is why.** The concern was the 5-user
Development Mode cap. It does not apply: it caps *authenticated* users, and
since the Spotify OAuth routes were removed there are none. Every catalogue
request uses one app-level Client Credentials token, which is rate-limited
rather than user-limited.

What is actually worth watching is that rate limit, because one shared token
means all users draw on the same bucket — a burst is an app-wide outage, not one
person's. If catalogue requests start failing under load, the fix is caching, not
Extended Quota (which needs 250k MAU and is unreachable). Do **not** apply for
Extended Quota as part of submission; it is not required and the application
invites questions you cannot answer yet.

One real obligation: Spotify's Developer Policy requires attribution when you
display their content. `privacy.html` names them, which covers the data
disclosure, but the app should also credit Spotify where artwork is shown. That
is a small UI change, not a submission blocker, and Apple will not raise it —
Spotify might.

**kworb — keep it, with eyes open.** It powers exactly one thing, the Bid Wars
valuation, and it is scraped HTML from a fan-run stats site with no API and no
uptime promise. There is no better source: Spotify publishes no stream counts at
any tier, and the Last.fm alternative was wrong by three orders of magnitude.

So the decision is to keep it and accept that Bid Wars can break, with three
things making that survivable: totals are cached in `album_plays` for 14 days,
so a kworb outage is invisible for a fortnight; the admin panel's **kworb
health** button says whether the scrape is alive; and a war's values freeze at
creation, so a break cannot corrupt a war in progress. If it does die
permanently, Bid Wars loses its valuation and would need to fall back to rating
count — which is what it used before, and is worse but not broken.

Nothing about this reaches App Review. It is server-side, it sends no personal
data (already stated in `privacy.html`), and a reviewer cannot see it.

---

## Still needed from you

- [ ] A real support address to replace `spam30492@gmail.com` in `privacy.html`,
      `terms.html` and the store listing. Apple emails this address during review
      and a bounce or an unread mailbox is a rejection, so it has to be one you
      actually open — a Gmail alias is fine, a dead one is not. **This is the
      last thing on the list that blocks submission.**
- [ ] Apple Developer Program enrolment (99 USD/yr, identity check, has a lead time)
- [ ] Answer the age-rating questionnaire using the table above
- [ ] Fill App Privacy / Data Safety using the table above
- [ ] Paste the App Review notes above
- [ ] Take the screenshots (shot 1 wants a listening card, so this is easiest
      after your Spotify export arrives)

### Done

- [x] Apply `20260908120000_groove_roles.sql` — applied by hand, 2026-09-09
- [x] Apply `20260909120000_listening_history.sql` — applied by hand, 2026-09-09
- [x] Supabase **Authentication → URL Configuration** — Site URL and redirect
      allow-list corrected, so password reset works
- [x] Delete `REDIRECT_URI` from Vercel
- [x] Decide the Spotify quota and kworb questions — written up above

Neither hand-applied migration is recorded in Supabase's migration history, same
as `protect_is_admin`. Both are idempotent, so a future `supabase db push` that
re-runs them is harmless.
