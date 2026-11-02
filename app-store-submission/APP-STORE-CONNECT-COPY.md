# App Store Connect — copy-paste fields

Source: drafted in `STORE-SUBMISSION.md`, re-checked against the live code for this pass. Edit the ⏳ items before pasting.

## App name
```
VINALL
```

## Subtitle (30 char max)
```
Rate music. Remember why.
```
25 characters.

## Category
- Primary: **Music**
- Secondary: ⏳ pick **Lifestyle** or **Entertainment** (no code basis for either — your call)

## Keywords (100 char max, comma-separated, no spaces, don't repeat the name)
```
album,ratings,rank,vinyl,records,review,collection,listening,taste,history,music quiz,crate
```
91 characters.

## Description
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

## Promotional text (170 char max, no review needed to change)
```
New: play a track without leaving VINALL — thirty seconds, lock-screen controls, and your rating one tap away from the record you are actually hearing.
```
149 characters.

## Support URL
```
https://excus.co.uk/vinall/support
```
Verified live and accurate to the app. ⏳ The page lists `hello@excus.co.uk` as its contact address, but `privacy.html`/`terms.html` use `vinall.support@gmail.com` — pick one before submitting (see CHECKLIST.md §3).

## Marketing URL (optional)
```
https://vinall.xyz
```

## Privacy Policy URL
```
https://vinall.xyz/privacy.html
```

## Copyright
```
© 2026 EXCUS LTD
```

---

## Age Rating questionnaire

| Question | Answer |
|---|---|
| Users can create or upload content | Yes |
| Content is moderated | Yes — slur filter, report path, block, contact address |
| Social features / user interaction | Yes |
| Unrestricted web access | No |
| Gambling / contests | No |
| Profanity or crude humour | Infrequent/Mild |
| Alcohol, tobacco, drug references | None (user content is filtered/reportable) |
| Violence, horror, sexual content | None |

Expected outcome: **12+**. Do not set 4+; the privacy policy states 13+ as the minimum age, which must be consistent with this answer.

---

## App Privacy ("nutrition label")

No tracking of any kind — answer **No** to "Used for Tracking" on every data type below. No ad SDK, no third-party analytics SDK.

| Data type | Collected | Linked to you | Purpose |
|---|---|---|---|
| Email address | Yes | Yes | App Functionality |
| Photos/videos | Yes (if avatar uploaded) | Yes | App Functionality |
| User content — other | Yes | Yes | App Functionality (ratings, notes, lore answers, comments, reports, imported listening history) |
| User ID | Yes | Yes | App Functionality |
| Product interaction | Yes | Yes | **Both** Analytics and App Functionality — declare both, don't pick one |
| Crash data | Yes | **No** | Analytics (anonymous crashes accepted by design) |
| Name, phone, address, location, search/browsing history, device ID, performance data, purchases, financial info, contacts, health, sensitive info | No | — | — |

Notes:
- Photos only applies if avatar upload is still live — it is (`Cloud.uploadAvatar`).
- Crash data (`client_errors`) is explicitly *not* linked to identity — logged-out crashes are accepted too.
- Product interaction genuinely covers two purposes (`analytics_events` + `listening_plays`); understating it to just one is the kind of thing Apple flags.

### Google Play Data Safety (if also submitting there)
- Data encrypted in transit: **Yes**
- In-app deletion available: **Yes** — Settings → Delete my account

---

## Build info
- Bundle ID: `xyz.wildcrate.vinall` (unchanged on purpose — see checklist §3)
- Encryption: `ITSAppUsesNonExemptEncryption = false` (confirmed in `Info.plist`)
