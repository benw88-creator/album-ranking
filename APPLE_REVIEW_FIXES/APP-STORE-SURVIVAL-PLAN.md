# VINALL — App Store Survival Plan

*Research phase, 13 November 2026. Nothing has been implemented, disabled, committed or sent to anyone.*

**How reliable this is.** The research covered official terms, API documentation, App Review guidelines, UK legislation and developer forums. On this machine a school web filter (Securly) blocked direct page fetches from musicbrainz.org, last.fm, Discogs and some Deezer pages. Points about those sites therefore come from search-result excerpts, and are marked *(snippet)*. Points marked *(unconfirmed)* are inference or come from a weak source. None of this is legal advice. A solicitor should review any rights position before you rely on it with Apple.

**Already done before the research-only instruction.** These changes are uncommitted, in the Lab worktree only, and can be reverted in seconds. They are listed here so nothing is hidden.

1. `audio` removed from `UIBackgroundModes` (2.5.4). The in-app player now pauses when the native app goes to the background.
2. Five new 1320×2868 store screenshots, made with fictional records and generated, original sleeve art (5.2.1). The script is `scripts/store-shots.mjs`, and the images are in `APPLE_REVIEW_FIXES/store-screenshots/`.

---

## 1. Executive summary

- **Most of VINALL is safe.** Ratings, score history, the Crate, profiles, Taste Match, Depth, About You, Replay, Grooves, People, the Shop, The Draw, missions, streaks, Charades and Higher or Lower's ratings mode all run on VINALL's own data or on plain facts. They need no third-party permission.
- **The real problem is underneath everything: the catalogue.**
  - Search, album pages, artwork and every 30-second clip come from Deezer's public API.
  - VINALL never registered a Deezer app, so it has not formally accepted Deezer's terms.
  - Deezer has accepted no new registrations since October 2025, and its terms are non-commercial.
  - So there is **no Deezer evidence to give Apple**. That is almost certainly what triggered the 5.2.3 rejection: the app says "Powered by Deezer" and "Open in Deezer" on screen.
- **A documentable replacement does exist: Apple's own terms.**
  - Apple publishes terms allowing its store metadata, artwork and previews to be used **to promote the music**, next to a "Listen on Apple Music" badge.
  - A rating and discovery app showing a record with that badge fits the purpose closely.
  - Apple's reviewer can check Apple's own agreement, which no Deezer document can match.
- **The cost of that route** is that Apple's terms forbid using that content "for entertainment purposes". That catches the parts of the **games** that use real artwork or audio:
  - Recall is the one game with no licensed path today short of a commercial clip licence.
  - Guess the Cover and Cover EXTREME need real sleeves.
  - Every other game can keep its mechanics.
- **Stream counts from kworb can't be evidenced**, but the games built on them can be kept. Bid Wars, Higher or Lower and the Collection can run on a VINALL-owned value made from open (CC0) data plus VINALL's own community signals. Existing Collections and Discs stay exactly as they are.
- **Recommendation: Strategy B (§8), preceded by a short clarification exchange with App Review (§12).** Run the licence enquiries in Strategy A alongside it (§6, with your approval to send them).

---

## 2. What Apple actually said, and what is inference

| Guideline | Apple's words (summary) | What Apple did **not** say |
|---|---|---|
| 5.2.3 | "potentially unauthorized access to third-party audio or video streaming, catalogs, and discovery services"; asks for documentary evidence in App Review Information | It named no provider, no game and no screen |
| 5.2.1 | "protected album cover artworks in app icons, screenshots or previews" | It did not object to artwork inside the app |
| 2.5.4 | `audio` background mode declared with no persistent audio found | — |

**Inferred, not stated:**

- The trigger is most likely the visible Deezer branding and the in-app preview playback.
- YouTube embeds and the kworb data are probably secondary, if Apple noticed them at all.
- Apple's wording covers "catalogs" as well as streaming, which is why changing audio alone may not be enough.

---

## 3. Findings from the research

### Deezer

- **Terms:** use is "strictly limited for a non-commercial purpose" (§IV); access is granted "following the process" on the developer site (§II); anything outside the terms needs Deezer's prior approval (§IX). https://developers.deezer.com/termsofuse
  - The terms say nothing about games and have no caching clause.
- **Registrations closed:** a Deezer Community Manager posted on 19 Oct 2025 that they "disable[d] the possibility of creating new accesses". https://en.deezercommunity.com/features-feedback-44/api-auth-impossible-80857
  - Users were still reporting it closed in March 2026 *(not fully confirmed)*.
- **Commercial route:** the Deezer FAQ says some uses are not possible "unless there is a commercial agreement". Deezer for Business relaunched in March 2026, including "Music as a Service" (licensed catalogue and technology).
  - Its named partners are large telecoms and retailers. Prices and eligibility are not published.
  - https://support.deezer.com/hc/en-gb/articles/360011538897 · https://partners.deezer.com/integration-partnerships
- **Verdict:** **BLUE**. Only a signed commercial agreement would count as evidence, and whether a small app can get one is unknown.

### Apple

- **iTunes Search API** (https://performance-partners.apple.com/search-api):
  - Use is "only to promote store content and not for entertainment purposes".
  - Assets must be "proximate to a store badge".
  - Previews must be "streamed only, and not downloaded, saved, cached".
  - Rate limit is "approximately 20 calls per minute", per IP address. Calls made from each user's own device avoid the shared limit, which VINALL already does for its Apple fallback.
  - No sign-up is needed.
- **Apple Music Feed, DPLA §3.3.6(F)** (https://developer.apple.com/support/terms/apple-developer-program-license-agreement/):
  - Feed content may be displayed "for the purposes of promoting the subject".
  - It may only appear on screens that promote that content, next to an Apple Music badge linking to it.
  - Previews must carry "provided courtesy of Apple Music", must be streamed and never cached, and must "not [be] used for independent entertainment value apart from its promotional purpose".
  - Developers report 401 errors, so the Feed may need enabling *(unconfirmed)*.
- **MusicKit / Apple Music API, DPLA §3.3.6(D):**
  - The API may only be used for purposes related to "facilitating access to Your end users' Apple Music subscriptions".
  - "album art and music-related text … may not be used separately from music playback".
  - Full songs must be playable.
  - No monetising access to Apple Music.
  - **This is a poor fit as a catalogue for non-subscribers.** It does fit an optional "play the full song" feature for subscribers on album pages.
- **App Review 5.2.5:** previews "may not be used for their entertainment value", for example "the soundtrack to a game".
- **Open questions with no answer from Apple:**
  - Three Apple forum threads asking about preview-based quizzes (836910, 848839, 850156) have no reply.
  - A UK album-rating site, Soundmark, asked whether it could use Apple Music API artwork (thread 854424) and also has no reply.
  - Nobody publicly knows Apple's line on rating apps, which is why §12 asks Apple directly.

### Spotify

- **Not viable:**
  - Development Mode allows 5 users, search returns at most 10 results, and `popularity` has been removed (Feb 2026 migration guide).
  - Extended Quota needs a registered business with at least 250k monthly active users.
  - The Developer Policy says "Do not create a game, including trivia quizzes", bans products "integrated with streams or content from another service", and bans storing Spotify content indefinitely.
  - 30-second preview URLs were withdrawn in November 2024.
  - Sources: https://developer.spotify.com/policy · https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- **Allowed:** "Open in Spotify" links, using Spotify's wording rules: "PLAY / LISTEN ON SPOTIFY" (https://developer.spotify.com/documentation/design).

### YouTube

- **What the terms allow and require:**
  - Embedding the official IFrame player is the use YouTube's API Services Terms provide for.
  - `start` and `end` are documented player parameters.
  - Required Minimum Functionality:
    - the player must be at least 200×200px,
    - no overlays,
    - autoplay only when more than half the player is visible,
    - the HTTP Referer header must be sent.
- **Developer Policies:**
  - no background playback (III.I.9);
  - no separating audio from video (III.I.7);
  - no modifying or blocking the player (III.I.6);
  - "not offer or provide incentives, rewards" for engaging with content (III.F.3).
  - Sources: https://developers.google.com/youtube/terms/developer-policies · https://developers.google.com/youtube/terms/required-minimum-functionality
- **How VINALL stands:**
  - The code audit confirms **Community Choice pays no Discs** for posting or agreeing, so III.F.3 is satisfied.
  - VINALL's own 150ms timer that pauses the video at the end of the chosen moment should be replaced by the documented `end` parameter. That removes any argument that it modifies the player.
- **Search quota:** search now has its own default of 100 calls a day, separate from the 10,000 units for everything else (changed 1 Jun 2026). CLAUDE.md's "100 of 10,000 units" is out of date.

### kworb.net and stream counts

- **kworb:**
  - robots.txt allows everything.
  - Its FAQ says "feel free to use the data to make your own graphs", which does not cover a company storing the data and using it to price a game economy.
  - It has no terms of use, and the FAQ says the owner doesn't answer business proposals *(snippet)*.
- **Legal exposure:**
  - UK database right (Copyright and Rights in Databases Regulations 1997, reg 16) covers "repeated and systematic extraction" of insubstantial parts. That is VINALL's 14-day re-scrape pattern.
  - Whether kworb's maker qualifies for UK protection after 2021 is unknown.
  - kworb's own figures are scraped from Spotify, so even written permission from kworb would not clear Spotify's position.
- **Verdict: RED** as a data source. The games built on it are **AMBER**: keep them and change the metric.

### Open data and licensed data

- **MusicBrainz:**
  - Core data is CC0: artists, release groups, releases, recordings and ISRCs. CC0 is a real, documentable licence for **facts**.
  - Tags and genres are CC BY-NC-SA, so non-commercial only.
  - The API allows about 1 request a second; self-hosting the mirror removes the limit.
  - https://musicbrainz.org/doc/About/Data_License *(snippet)*
- **Cover Art Archive:**
  - "copyrighted by their respective copyright owners".
  - It **grants no licence** and is not evidence. https://coverartarchive.org/
- **Wikipedia pageviews:** CC0 data, with good power-law spread; covers only albums that have an article. https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html
- **ListenBrainz:** CC0 and allowed commercially, but coverage of mainstream albums is thin.
- **Wikidata:** CC0, including certifications such as RIAA and BPI awards *(property id unconfirmed)*.
- **Last.fm:** data "solely for non-commercial purposes"; commercial use needs partners@last.fm. Not recommended.
- **Discogs:** some data is CC0, the rest is "Restricted Data" under a revocable licence; image licence unconfirmed. Not the primary catalogue.
- **Paid metadata and artwork, needing a contract:** 7digital/Songtradr (UK), Gracenote, Music Story. None publishes prices. These are the only sources whose contract could cover **artwork used in games**.
- **Paid licensed clips for games:**
  - Songclip has deals with UMG, WMG and NMPA, and offers "pass-through" licensing *(sources 2021–22; current status unconfirmed)*.
  - Feed.fm offers "60 second Clips from popular songs" with indemnification and usage-based pricing *(one third party says from $250)*.
  - Neither publishes terms covering games.
- **Royalty-free or artist-opt-in audio:**
  - Audius Open Music License covers "apps, games" unless the artist opts out (July 2025).
  - Epidemic Sound's licence lists games.
  - Jamendo's National tier is about €89 a track *(unconfirmed)*.
  - All of these are real permissions, but none of them is chart music.

### UK law

- Bare facts are not copyright. Titles, tracklists, years and runtimes are free to use. Large-scale extraction from someone else's database is a separate database-right question.
- CDPA s.30(1) (criticism or review) is a **defence** for showing the sleeve of the record being reviewed. It does not grant permission, and it does not cover games, decoration or share images.
- s.30(1ZA) (quotation) does not credibly cover clips used as game content. The UK IPO says even "a few bars" in a book may need clearance.
- Neither is "documentary evidence" for Apple.

### Comparable apps (leads, not arguments)

- **Musicboard:** data source not public.
- **stats.fm, Airbuds, Receiptify, Volt.fm:** built on users' own Spotify or Apple Music logins, so they inherit those platforms' permissions.
- **Soundmark (UK):** currently asking Apple the same artwork question VINALL would ask.
- No public case was found of open-licence evidence clearing a 5.2.3 rejection.

---

## 4. Feature-by-feature decision matrix

**Key:**

- 🟢 **KEEP**: a clear permission basis exists.
- 🟠 **MODIFY**: survives with a changed source or link.
- 🔴 **TEMPORARILY UNAVAILABLE** in the iOS build: no defensible implementation today.
- 🔵 **NEEDS PERMISSION**: could stay unchanged with a licence.

Confidence: **H** high, **M** medium, **L** low.

| Feature | Current dependency | Position | Best solution | What users lose | Effort | Evidence for Apple | Class |
|---|---|---|---|---|---|---|---|
| Album and song ratings, score history, the Crate grid, Liked | Own data; Deezer art URLs on the cards | Data is VINALL's own; the art is not | Keep. Art comes from Apple next to a badge on the album screen; grid tiles open the badged album screen. Ask Apple whether grid thumbnails are fine (§12) | Nothing, if Apple agrees | M | Own data; Apple §3.3.6(F) / Search API terms | 🟢 data H / 🟠 art M |
| Search | Deezer `/api/catalogue?path=search` | Unevidenced | iTunes Search API, called from the device, plus MusicBrainz CC0 for facts | A little coverage on niche releases; Apple storefront `gb` | M–L, mostly in `_toCatalogue` | Apple Search API terms; MusicBrainz CC0 | 🟠 M |
| Album page, tracklist, artist hero | Deezer catalogue; Deezer artist photo | Unevidenced | Apple metadata and art with a "Listen on Apple Music" badge; tracklist from Apple or MusicBrainz; artist hero uses your own top-rated sleeves (the photo is dropped) | The artist photo | M | As above | 🟠 M |
| Track previews on the album page | Deezer clips via `VinalPlayer` (Apple is already the fallback) | Unevidenced | Apple preview URL, "provided courtesy of Apple Music", streamed and never cached. Optional MusicKit full-song playback for subscribers | Coverage drops from ~100% to ~70% (measured earlier in CLAUDE.md) | S–M | §3.3.6(F) / Search API terms | 🟠 M |
| For You | Deezer discographies and chart; Deezer clips, autoplay | Unevidenced | Same Apple previews and badge on every card, which is a discovery screen promoting the record. Keep autoplay; ask Apple (§12) | Some records without a clip | M | §3.3.6(F) "promoting the subject" | 🟠 M–L |
| Song-row play, Today card play, Your music, Replay clips | Deezer clips through `VinalAudio` | Unevidenced | Same Apple source, with a badge where the card shows the record | As above | S | As above | 🟠 M |
| Suggestions, Reviews, Community grid, share pages | Own data; stored art URLs | Own data | Keep. Share images use VINALL's generated art or the badged Apple art | — | S | Own data | 🟢 H |
| Community Choice, YouTube moments | YouTube IFrame player and Data API | Permitted under YouTube API Terms if compliant | Keep. Use the `end` parameter, keep player ≥200px and no overlays, add a "YouTube" source label, no Discs (already true) | Nothing | S | YouTube API Services Terms (accepted through the Google Cloud project), RMF | 🟢 M |
| Community Choice, Deezer moments | Deezer clips and waveform peaks | Unevidenced | New picks are YouTube only; existing Deezer picks show "Watch on YouTube" (search link) or are hidden in iOS | Older Deezer-sourced moments stop playing in-app | S | — | 🟠 M |
| Recall | Deezer clips, 1/3/5/10s reveal | No licensed path for chart recordings in a quiz; Apple §3.3.6(F) and 5.2.5 forbid it | **(a)** licensed clips (Songclip / Feed.fm) → 🔵; **(b)** temporarily off in iOS, with a designed "coming to the app" card; **(c)** an *Indie Recall* mode on Audius OML or Epidemic tracks, with real permission but not chart music | Today's Recall in iOS until (a) | (b) S, (c) M–L | (a) contract; (c) the licence text | 🔴/🔵 H |
| Onboarding tutorial (Recall "Memories" plus "one song") | Deezer clips | As Recall | Replace the Recall beat with a rating beat or a Daily Drop round; the song beat plays the badged Apple preview | The tutorial's Recall moment | S | — | 🟠 H |
| Daily Drop | Static facts plus Deezer/Apple sleeves on reveal | Facts are free; the sleeve inside a game is entertainment use | Keep the game. Replace the reveal sleeve with VINALL-generated art plus "Listen on Apple Music" | The real sleeve on the reveal | S | Facts; generated art is VINALL's own | 🟢 game H / 🟠 art |
| Earworm | Static titles; sleeves on reveal; iTunes genre lookup | As Drop; the genre lookup is minor | As Drop. Genre from the baked table (MusicBrainz tags are non-commercial) | As Drop | S | As Drop | 🟢/🟠 H |
| Cover Fire | Facts; **sleeves are the answer buttons** | Real sleeves in a game have no licence route except a paid contract | Answer buttons become typeset title cards on VINALL-generated art (the generator from the screenshots) | The sleeve-recognition element; the name now oversells it | M | Own art | 🟠 M |
| Guess the Cover, Cover EXTREME | Real cover art is the question | No route without licensed art | 🔴 in iOS until licensed art (7digital, Gracenote) → 🔵 | Two of the five-round modes | S | Contract | 🔴/🔵 H |
| Guess the Year, Tracklist (five-round) | Deezer discography and tracklists | Facts | Same games on MusicBrainz CC0 or Apple data | — | M (comes with the catalogue move) | CC0 | 🟢 after the move, M |
| Higher or Lower, ratings mode | Own scores | Own data | Keep | — | — | Own data | 🟢 H |
| Higher or Lower, streams mode | kworb | Unevidenced | Becomes "VINALL Value" or "Wikipedia readers" mode (§5) | Exact Spotify totals | M | CC0 / own data | 🟠 M |
| Bid Wars | kworb streams; Discogs "market" mode | Unevidenced | Value = VINALL Value (§5). Market mode parked (CLAUDE.md says it already was; the code audit shows it live) | Exact streams; market mode | M | CC0 / own data | 🟠 M |
| The Collection, net worth, Draw album picks | kworb streams ÷ 250,000 | Unevidenced | New buys priced by VINALL Value, mapped by quantile onto today's price distribution. Stored `collection.price` rows untouched; sell refunds unchanged | Nothing held; future prices shift a little | M + one migration | Own data | 🟠 M |
| Music Passport | MusicBrainz country of origin | Core data CC0 | Keep; add a MusicBrainz credit | — | S | CC0 | 🟢 H |
| Spotify export import | The user's own exported file | The user's own data | Keep; matching runs against the new catalogue | — | S | Own data | 🟢 H |
| Charades, Shop, The Draw, missions, streaks, Grooves, People, Reach, Taste Match, Depth, About You, Replay (ratings) | Own data | — | Keep | — | — | — | 🟢 H |
| Static game pools (379 rows) | Hot-linked dzcdn / mzstatic sleeves | Facts are free; sleeves are not | Keep the rows; drop the art URLs in iOS in favour of generated art | Real sleeves in games | S | Own art | 🟠 H |
| "Open in Deezer" / "Powered by Deezer" | Deezer branding | Draws the question | Becomes "Listen on Apple Music" plus "Open in Spotify / YouTube" links | — | S | Link-outs need no licence | 🟠 H |

---

## 5. Best replacements for Deezer, YouTube and kworb

### Deezer

- **Catalogue:** the iTunes Search API, called from the device, with Apple Feed if Apple enables it, plus MusicBrainz CC0 for facts and canonical ids.
- **Previews:** Apple preview URLs next to a badge, on screens that promote the record.
- **Ids:** stored ratings stay keyed as they are (no re-keying, CLAUDE.md trap 4). The app already resolves legacy ids by name and artist, and the `_toCatalogue` switch is the single place to change provider.

### YouTube

- Keep it, compliance-tightened:
  - the `end` parameter instead of VINALL's own stop timer;
  - minimum player size and no overlays (to verify in Choice);
  - a visible YouTube source credit;
  - Terms and Privacy linking YouTube's Terms of Service and Google's Privacy Policy (Developer Policies III.A.1/2; to check against the current terms).

### kworb → "VINALL Value"

An original valuation built only from documentable inputs:

- **Base:** Wikipedia article pageviews for the album, summed over 12 months. The data is CC0, a public, power-law measure of "how much the world cares about this record".
- **Bonus:** certifications from Wikidata (CC0), e.g. Gold, Platinum and Diamond tiers.
- **Uplift:** VINALL's own community signal, using raters, mean score and collectors, capped per account and counting only aged accounts so collusion can't move prices.
- **Fallback for albums with no Wikipedia article:** a floor price plus the community uplift. Obscure records stay cheap, which is how the Collection already works.
- **Calibration:** map the new metric by quantile onto the current price distribution. A record at today's 90th percentile still costs roughly what it costs today.

**Migration** (§13, one idempotent migration):

- purge `album_plays` (kworb-derived);
- resolve or void pending streams-mode wars;
- leave `collection.price` untouched, since that is Discs VINALL charged, not kworb data.

**Copy changes:** "Most streams wins" becomes "Highest VINALL Value wins". In Higher or Lower, "Which has more streams?" becomes "Which matters more to the world?", showing Wikipedia readers and certifications as the evidence. It is a different number with the same game, and an honest label.

---

## 6. Recall, Community Choice, Bid Wars and the Collection

**Recall** is the one game with no licensed path today. Options, best first:

1. **Licensed clips.**
   - Songclip (major-label pass-through) or Feed.fm (60-second clips, indemnified).
   - This is the only route that keeps chart Recall exactly as it is.
   - It needs a quote and a contract; cost unknown.
   - **Needs your approval to make contact.**
2. **Indie Recall.**
   - Same mechanics, run on tracks under the Audius Open Music License (which explicitly covers "apps, games") or an Epidemic Sound subscription.
   - It is legal and documentable.
   - It plays rising and independent artists, which can be a discovery angle ("name it before everyone else does"). It is not the same buzz as chart hits.
3. **Temporarily unavailable in the iOS app,** with a designed card ("Recall is coming to the app — play it on vinall.xyz") rather than a dead button. The web version is unaffected.

   Note: the website has the same Deezer non-commercial question. Apple simply doesn't review it.
4. **Rejected options:**
   - MusicKit subscriber playback: the agreement needs full songs and forbids modifying content.
   - Apple previews: they carry an explicit entertainment-use ban.
   - Fair dealing: not credible for clips used as game content.

**Community Choice:** keep YouTube moments with the compliance changes in §5; Deezer moments become YouTube-only for new picks.

**Bid Wars and the Collection:** VINALL Value (§5). The gameplay and the Collection are unchanged; only where the value comes from changes.

---

## 7. Recommended catalogue and artwork architecture

```
MusicBrainz (CC0)  ── canonical ids (release-group MBID), facts, ISRCs
        │
Apple (Search API now; Feed if enabled) ── art + previews, only beside a
        │                                   "Listen on Apple Music" badge
        │
VINALL's own ── ratings, history, community, VINALL Value, generated game art
        │
Link-outs ── Apple Music · Spotify · YouTube (no licence needed for a link)
```

- **Games** use facts and VINALL's own generated art. They never use Apple or third-party content.
- **Long term:** add a licensed metadata and art provider (7digital or Gracenote) to replace Apple art where Apple's "promotional only" rule is too narrow, and to allow commercial use.

---

## 8. Three strategies

### Strategy A — Maximum preservation (licence it as it is)

- **What:** keep the app unchanged and get written permission from:
  - Deezer for Business (catalogue, previews, games);
  - Songclip or Feed.fm (game clips);
  - 7digital or Gracenote (artwork in games).
- **Preserves:** everything.
- **Development time:** near zero.
- **Cost:** unknown, probably recurring, possibly large.
- **Time to resubmit:** weeks to months, or never (Deezer serves large partners; the licensors may not deal with a pre-revenue app).
- **Uncertainty:** very high.
- **App Review risk:** low once contracts are signed.

### Strategy B — Fastest defensible launch (recommended)

- **What:**
  - Apple and MusicBrainz catalogue in the iOS build;
  - badged Apple previews on album pages and For You;
  - YouTube Choice, compliance-tightened;
  - VINALL Value in place of kworb;
  - generated art in the games;
  - Recall, Guess the Cover and Cover EXTREME unavailable in iOS for now, with designed cards;
  - Deezer branding replaced by link-outs.
- **Preserves:** about 90% of features.
- **Modified:** about 12.
- **Unavailable in iOS:** 3 game modes.
- **Development time:** roughly 2–3 weeks in Lab.
  - The catalogue switch is the largest piece.
  - `_toCatalogue` and resolving by name keep it contained.
- **Ongoing cost:** £0, apart from the Apple Developer membership.
- **Uncertainties:**
  - Whether Apple accepts Apple art on rating grids and an autoplaying For You feed under "promotion".
  - Whether the Apple Feed needs enabling.
  - Coverage drops from Deezer's (~100% previews) to Apple's (~70%).
- **App Review risk:** medium, falling to low-medium if Apple answers the §12 questions favourably first.

### Strategy C — Long-term architecture

- **What:**
  - MusicBrainz MBIDs as the permanent keys;
  - a licensed metadata and art contract;
  - a licensed clip provider for Recall and For You;
  - MusicKit full-song playback for Apple Music subscribers;
  - Spotify and YouTube as link-outs;
  - VINALL Value as the economy.
- **Supports monetisation.** Apple's agreement bans monetising access to Apple Music, but not the rest of the app, subject to the contract terms.
- **Time:** about 2–3 months.
- **Cost:** contract-dependent.
- **Uncertainty:** commercial terms.
- **App Review risk:** low.

**Recommendation:** B now, with C's licence enquiries (= A's contacts) running alongside it, so that any licence that comes through brings Recall and the cover games back into the app without another redesign.

---

## 9. The recommended approach, in one paragraph

Ask App Review the three questions in §12 this week; it is cheap and could save a second rejection. At the same time, with your go-ahead, send enquiries to Deezer for Business, Songclip, Feed.fm and 7digital. Build Strategy B in Lab behind a single `Rights` switch, native app only at first, using the existing `Cert.ON` / `DIARY_ON` pattern, so the website is untouched until you decide otherwise. Resubmit with Apple's own terms and MusicBrainz's CC0 licence as the evidence, and say plainly in the review notes that Recall and the two cover games stay out of the app until licences are signed.

---

## 10. Exact features that must change, and why

1. **Deezer catalogue, search and artwork in iOS.** VINALL has no registration and no agreement, and registration is closed.
2. **Deezer previews** (album page, For You, song rows, Today, Your music, Replay, onboarding). Same reason; replaced by Apple previews next to a badge.
3. **Recall** (iOS). No licensed path for chart clips in a quiz; Apple's own preview terms forbid it.
4. **Guess the Cover and Cover EXTREME** (iOS). Real covers as game content; no licence.
5. **Cover Fire's sleeve buttons, and the sleeves on Daily Drop and Earworm reveals.** Covers used as game content; replaced by VINALL-generated art.
6. **kworb stream counts** (Bid Wars, Higher or Lower streams mode, Collection pricing). Scraped data with no licence, which is itself scraped from Spotify.
7. **Community Choice's Deezer moments, and VINALL's own stop timer on YouTube.** Deezer as above; the timer is a player-modification risk.
8. **"Powered by / Open in Deezer" branding.** It flags the provider that can't be evidenced.

---

## 11. Evidence

| Evidence | Status |
|---|---|
| Apple DPLA §3.3.6(F) and Search API terms (Apple's own) | Available: cite them in the review notes |
| MusicBrainz CC0 licence page | Available: attach as PDF |
| YouTube API Services Terms acceptance (Google Cloud project with the API key) | Available: screenshot of the project and API |
| Statement that Discs, VINALL Value and game art are VINALL's own | Available: VINALL's own statement |
| Deezer agreement | **Unavailable** (closed; commercial enquiry needed) |
| Clip licence for Recall | **Unavailable** (enquiry needed) |
| Licensed cover art for games | **Unavailable** (enquiry needed) |
| kworb permission | **Not worth pursuing**: it would not clear Spotify's position |

---

## 12. Proposed message to App Review (clarification before building)

To send through the Resolution Center reply, or to raise in an App Review appointment. **Not sent.**

> Hello, and thank you for the review of VINALL 1.0 (submission 7753a2db-5c36-49e3-b552-6f6acac8a4b8).
>
> Before resubmitting we want to make sure the changes we're planning address Guideline 5.2.3 properly. VINALL is a music rating and discovery app: people score albums and songs out of 100 and share their ratings. We plan to:
>
> 1. Source album and song metadata, artwork and 30-second previews from Apple, under the iTunes Search API and Apple Music Feed terms (DPLA §3.3.6(F)). Each record would carry an unaltered "Listen on Apple Music" badge linking to it, previews would carry "provided courtesy of Apple Music" and be streamed only, and we would use MusicBrainz (CC0) for factual metadata.
> 2. Stop using any third-party audio, and any third-party artwork, inside our games. Games would use factual metadata and VINALL's own original artwork only.
> 3. Keep official YouTube IFrame embeds (YouTube API Services Terms) for a feature where users pick a moment of a music video.
>
> Could you confirm whether:
> (a) showing Apple Music artwork next to the badge on rating screens, including a user's grid of their rated albums where each tile opens the badged album page, is an acceptable use;
> (b) a discovery feed that plays the Apple preview of each recommended record, with the badge and attribution on every card, is acceptable promotional use;
> (c) official YouTube embeds used this way would need additional documentation beyond the YouTube API Services Terms?
>
> We would also confirm that 2.5.4 is resolved (the audio background mode has been removed) and 5.2.1 is resolved (new screenshots use only original artwork).

---

## 13. Implementation plan for VINALL Lab (after your approval)

1. **Keep or revert the 2.5.4 and 5.2.1 changes already made** (your call), and send the §12 questions.
2. **Add a `Rights` switch** (native-only at first), following the `Cert.ON` pattern, so every change below can be reversed with one line.
3. **Catalogue:** add an Apple + MusicBrainz backend behind `_toCatalogue`, called from the device to respect the Search API's per-IP rate limit, with no caching of preview URLs. Badge component and attribution.
4. **Previews:** switch `VinalAudio` and `VinalPlayer` to the Apple source in iOS; badge and attribution on every playing card.
5. **Games:**
   - generated art for Cover Fire, Daily Drop, Earworm and the static pools;
   - designed "coming to the app" cards for Recall, Guess the Cover and Cover EXTREME;
   - replace the Recall beat in onboarding.
6. **Community Choice:** the `end` parameter, a YouTube source credit, new picks YouTube-only, and "Watch on YouTube" for Deezer moments.
7. **VINALL Value:** a server module (Wikipedia pageviews + Wikidata certifications + community), quantile calibration against the current `album_plays`, then one idempotent migration that purges `album_plays` and settles pending streams-mode wars. Collections untouched. New copy for the affected games.
8. **Branding:** Deezer marks replaced with link-outs; privacy and terms updated (providers, YouTube terms).
9. **Tests:** Playwright specs for each switched surface, the overflow suite, a native build on the Mac, and a device run (lock and resume, previews, Choice).
10. **Resubmission pack:** rights audit, review notes, evidence PDFs. Then transfer to production by cherry-picking, as LAB-ONLY.md requires, with your sign-off at each push.

---

## Summary

**KEEP UNCHANGED**

- Ratings and score history
- The Crate's data
- Profiles, Taste Match, Depth and About You
- Replay (ratings), Grooves, People and Reach
- The Shop, The Draw, missions and streaks
- Charades
- Higher or Lower (ratings mode)
- Music Passport
- Spotify export import
- Suggestions, Reviews and the Community feed
- Community Choice YouTube moments (with small compliance changes)

**KEEP WITH MODIFICATIONS**

- Search, album pages and artwork (Apple + MusicBrainz, badge)
- All preview playback outside games (Apple, badge, attribution)
- For You
- Daily Drop, Earworm and Cover Fire (generated art)
- Guess the Year and Tracklist (new data source)
- Bid Wars, Higher or Lower and the Collection (VINALL Value)
- Onboarding
- Deezer branding (link-outs)

**TEMPORARILY UNAVAILABLE (iOS app only)**

- Recall
- Guess the Cover and Cover EXTREME
- Community Choice's older Deezer-sourced moments (link-out instead)
- Bid Wars market mode

**REQUIRES LICENSING OR FURTHER EVIDENCE**

- Deezer catalogue and previews, unchanged (Deezer for Business)
- Chart-music Recall (Songclip / Feed.fm)
- Real covers in games (7digital / Gracenote)
- Apple's view on rating grids and the autoplay feed (the §12 questions)
