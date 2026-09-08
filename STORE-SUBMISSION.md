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
album,ratings,music diary,rank,vinyl,records,review,collection,listening,taste,tracker,journal
```

**Description:**

```
VINALL is where your relationship with music accumulates.

Rate the albums and songs you love, and VINALL starts noticing things — a record
you played to death and abandoned, an artist you rated highly and never went
back to, two ratings that contradict each other. Then it asks you something
small about it. One tap is a complete answer.

Over time that becomes a record of what you were listening to and what was going
on, kept by day. Not a wrapped-up summary once a year. A diary.

- Rate albums and songs out of 100, with notes
- Today: one question at a time, from your own listening
- Liner Notes: a daily entry with the record, the mood and a line of your own
- The year: every day you wrote, coloured by how it sounded
- Earworm: spell the record, letter by letter
- Daily Drop: guess the day's album and song in six
- Bid Wars: outbid a friend on five records, blind
- Grooves: private groups for you and your mates

No ads. No selling your data. Delete everything from inside the app whenever you
like.
```

**Promotional text (170 chars, changeable without review):**

```
New: Today and Liner Notes now live on one screen — answer a question, and it moves on by itself.
```

---

## Screenshots

Needed per device class; one set is not accepted. Shoot these five, in this
order, because the order is the pitch:

1. **Home with Today** — a question card mid-answer, with the counter showing
2. **Liner Notes** — the year grid full of colour (needs a populated account)
3. **An album page** — a rating and a note
4. **Earworm** — a board part-solved, greens and ambers visible
5. **Bid Wars** — a resolved war showing the reveal

Use a real populated account, not an empty one. An empty year grid is the worst
possible first screenshot.

---

## Still needed from you

These cannot be done from the code:

- [ ] A real support address to replace `spam30492@gmail.com` in `privacy.html`,
      `terms.html` and the store listing
- [ ] Apply `supabase/migrations/20260908120000_groove_roles.sql` by hand in the
      Supabase SQL editor
- [ ] Delete `REDIRECT_URI` from Vercel → Settings → Environment Variables
- [ ] Apple Developer Program enrolment (99 USD/yr, identity check, has a lead time)
- [ ] Answer the age-rating questionnaire using the table above
- [ ] Fill App Privacy / Data Safety using the table above
- [ ] Take the screenshots
- [ ] Decide the two tier-5 questions: Spotify quota, and the kworb dependency
