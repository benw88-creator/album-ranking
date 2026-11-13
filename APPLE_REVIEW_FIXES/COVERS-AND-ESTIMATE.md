# Keeping real covers, and a revised build estimate

*Research only, 13 Nov 2026. Nothing has been implemented, sent or signed up for. This follows on from `APP-STORE-SURVIVAL-PLAN.md`.*

**How reliable this is.** A web filter on this machine blocked several primary pages: Apple's Identity Guidelines, Discogs, TIDAL's developer site and Spotify's compliance page. Points from those are search excerpts, marked *(snippet)*. The Apple Search API terms, the Apple Developer Program License Agreement (DPLA) and the App Review Guidelines were read directly. One search result contained instructions to the research agent to drop its task; they were ignored.

---

## 1. Is there a low-cost licence for real covers in trivia games?

**I found no self-serve or published-price licence that explicitly allows album covers in a quiz game, or allows cropping them.** Every source checked falls into one of three groups:

| Group | Sources | Effect on a quiz |
|---|---|---|
| Promotion-only | Apple Search API, Apple Music Feed | "not for entertainment purposes", so no use in games (CONFIRMED) |
| Games banned outright | Spotify | "a name that tune quiz" given as the banned example *(snippet)* |
| Silent on games, price by quote | Music Story, MassiveMusic/7digital, Gracenote, Musixmatch | Possible only by negotiation |

Feed.fm's clip product is pitched at trivia apps, but it is US-only (CONFIRMED, its implementation guide), so it is not available to a UK app. Stock agencies (Alamy and others) mark album covers "Editorial use only". PPL and PRS license recordings and compositions, not artwork.

Realistic routes, cheapest credible first:

| # | Route | Quiz use? | Cropping? | Price | Time | Counts as Apple evidence? |
|---|---|---|---|---|---|---|
| 1 | **Direct written permission** from labels or self-releasing artists for a curated pool of covers | Yes, if the letter says so | Yes, if stated | Often free for indies; majors case by case, no published form | Weeks per rightsholder; majors may never reply | **Yes**, the cleanest evidence |
| 2 | **Music Story (Believe)**: "High-resolution album artwork cleared for digital distribution", priced by monthly active users "from indie apps to global DSPs" (CONFIRMED, music-story.com/en/our-offer). Default is "Editorial use only" | Unknown, needs a named grant | Unknown | Quote via music-story.com/en/contact | Weeks | Only if the contract names games, cropping and the UK |
| 3 | **MassiveMusic (ex-7digital, Songtradr, London)**: cover art CDN from 33px to 3000px | Unknown | Unknown | Quote only | Weeks | Only if the contract grants game rights; aggregators often pass rights through rather than grant them |
| 4 | **Gracenote**: licensed cover art database | Unknown | Unknown | Enterprise sales | Weeks to months | Probably, if granted; unlikely to be cheap |

Music Story is the best lead: it is the only aggregator that openly prices for indie-sized apps and sells artwork with rights metadata. The rows above that read "Unknown" will stay unknown until someone asks, and **making contact needs your approval**. Draft enquiry, not sent:

> Subject: Artwork + metadata licence for a small UK music app (VINALL)
>
> Hello, Excus Ltd (UK, company 17517058) runs VINALL, a free album-rating app on iOS and the web with a few hundred users. We'd like a quote for album artwork and core metadata (title, artist, release date, tracklist) for a worldwide catalogue. Specifically, we need the licence to permit, in writing:
> (1) display on rating, collection and discovery screens;
> (2) use in music trivia games, including showing a whole cover or a cropped/zoomed section as a question;
> (3) territory UK and worldwide, iOS and web;
> (4) caching of image files for up to [30] days;
> (5) the attribution you require.
> Could you tell us your smallest tier, minimum term and price, and whether the licence grants these rights or passes through label terms?

**Fallback if no licence comes through:** route 1, scoped. Guess the Cover and Cover EXTREME could run on a pool of covers with signed permission, starting with independent and self-released artists who tend to say yes.

---

## 2. Can Apple's promotional terms cover VINALL's normal screens unchanged?

**The rules** (Search API and DPLA §3.3.6(F), CONFIRMED):

- Artwork appears only "on pages that promote the content".
- It sits next to a badge linking to that record on Apple Music or iTunes.
- Previews carry "provided courtesy of" attribution and are "streamed only".
- Nothing is "used for independent entertainment value".

Neither text has an explicit no-cropping or no-overlay rule. The Identity Guidelines *(snippet)* say to use only Apple's badge, unmodified, and "only one Apple Music badge" per layout.

**Separate signal.** A second-hand report of a WWDC answer (forum thread 710261) says in-app artwork is fine; developers were rejected for artwork in **store screenshots**. That matches VINALL's own 5.2.1 rejection.

| Screen | Fits Apple's terms? | Change needed | Visual identity |
|---|---|---|---|
| Album page | **Yes, with a badge.** Strongest fit: the page is about one record | "Listen on Apple Music" badge near the cover; attribution beside the player | Unchanged apart from the badge |
| For You | **Probably, with changes** | A small Apple Music link on each card plus attribution. The **blurred copy of the cover used as a background** is a modification no rule permits; swap it for the sleeve's sampled colour (`albumColor()` already exists) | Close; the glow becomes a colour field |
| Community feed and reviews | **Plausible** | A small Apple Music link per card | Unchanged apart from the link |
| Crate grid, profile tiles | **Unsettled.** It's your own library, not a promotion page; the score sits on the art | One badge per screen; each tile opens the badged album page. The score may need to move to the label strip under the art | Small change if the score must move |
| Collection shelf (bought with Discs, net worth) | **Weak.** Covers decorating a virtual economy sit close to "independent entertainment value" | Ask Apple, or use licensed art | — |
| Share images and link previews | **No.** They are generated images marketing VINALL; App Review 4.5.2(ii) forbids marketing use without rightsholder permission | Text card, or licensed art | Changes |
| Guess the Cover, Cover EXTREME, Cover Fire, Drop/Earworm reveals | **No**, as games. Possible exception: a reveal screen with a badge linking to the answer record could be called promotion; that is a question to ask Apple | Licensed covers (§1) | — |

**What this means:** Apple-sourced real covers can carry the core rating and discovery identity, with a badge and links added. The Collection, share images and the cover games need either a licence or an explicit yes from Apple. **Apple has not answered anyone publicly on rating grids.** Forum thread 854424, a UK rating site asking exactly this, was posted last week and has no reply. Asking App Review directly is the only way to find out.

Questions to add to the draft App Review message (§12 of the survival plan):

- **(d)** May Apple-sourced artwork appear in a user's collection and on profile tiles, with each tile linking to the badged album page?
- **(e)** May a quiz's answer-reveal screen show the record's artwork beside a "Listen on Apple Music" badge?

---

## 3. Revised build estimate: challenged and broken down

**My earlier "2–3 weeks" was padded.** The code already has the seams the change needs:

- **Catalogue:** one translation point, `_toCatalogue`.
- **Fetching:** `_spExec`, which already batches requests, caches them for a day and retries.
- **Audio:** an audio provider registry, `VinalAudio.register`.
- **Apple previews:** an Apple preview lookup that already runs from the browser (`appleMap`, CORS works).
- **Cover swapping:** a cover-swap module, `Covers`.
- **Image sizing:** `thumb()`, which already rewrites Apple image sizes (`NNNxNNNbb`).
- **Switches:** the `Cert.ON` switch pattern.

Measured scale: 57 `thumb()` calls, about 120 `<img>` render sites and 326 `dzcdn` literals. Most of the literals are in the 379-row static game pools.

| # | Task | Reuses | Estimate (focused days) |
|---|---|---|---|
| 1 | `Rights` switch, native-only | `Cert.ON` pattern | 0.25 |
| 2 | Apple catalogue adapter, called **from the device** inside `_spExec`. iTunes `search` and `lookup` (including batch `lookup?id=a,b,c`) translated into the existing Spotify response shape. Legacy ids resolved by name. Chart from Apple's RSS charts. Release classification reuses `isNonStudio`. Device-side calls avoid the shared ~20/min per-IP limit on Vercel | `_spExec` cache and retries, `isNonStudio` | 1.5 |
| 3 | Apple previews as the primary source in `VinalAudio` and `VinalPlayer` | Provider registry, `appleMap` | 0.5 |
| 4 | Badge and attribution component, placed on the album page, For You cards, the player bar and feed cards. Official badge from Apple's marketing tools | — | 0.5 |
| 5 | Stored artwork: a one-off backfill rewriting stored `dzcdn` cover URLs to Apple's, by name + artist, in the shared tables. Covers `crate_feed`, `collection`, `lists`, `profiles.top3`, `suggestions`, `lore_answers`, `liked_songs` and `ratings.data`, plus the `moments.art` and `crate_feed_guard` checks. Each device rewrites its local crate on load. **Production data change: needs your approval and a backup first** | `Covers`-style matching | 1.0 |
| 6 | Deezer branding becomes link-outs; privacy and terms text | — | 0.5 |
| 7 | Community Choice: YouTube's `end` parameter in place of VINALL's own stop timer, a source credit, new picks YouTube-only, older Deezer moments link out | — | 0.5 |
| 8 | VINALL Value in place of kworb: Wikidata's Apple Music album id (P2281) gives the Wikipedia article and its pageviews (CC0). Add certifications and a capped community uplift, quantile-calibrate against today's prices, one idempotent migration, copy changes | `_streams.js` slot, existing Wikidata client | 1.5 |
| 9 | Cover games in the interim (§1), **real covers kept wherever licensed**: until then, a designed "coming to the app" state for Guess the Cover and Cover EXTREME in the iOS app only. **No generated art** | — | 0.25 |
| 10 | Recall interim card, onboarding beat swap | — | 0.5 |
| 11 | Playwright specs for every switched surface, the overflow suite, regression run | Existing suite and fixtures | 1.0 |
| 12 | iOS build, device check, upload. **On the Mac**: this Windows machine can't build iOS | — | 0.5 to 1 |
| | **Total** | | **≈ 8.5–9 focused days** |

**Fastest realistic path: about 1.5 calendar weeks of build.** Items 2–4, 6 and 7 can run in parallel with item 8, and item 5 is done once and verified on a rolled-back copy first. Under about 6 days is not realistic without cutting VINALL Value. The only way to cut it is to hide Bid Wars and Collection buying for a while instead, and I'd advise against that.

**What sets the timeline is outside the code:**

- Apple's answers to questions (a)–(e).
- Licence quotes, if you want real covers in the games at launch.
- The production data backfill.
- A Mac session.

**Order that keeps covers first:**

1. **This week, in parallel:** send the App Review questions and the Music Story and MassiveMusic enquiries (both need your approval), and build tasks 1–4 and 6–8 in Lab.
2. **Once Apple answers:** settle the grid, Collection and reveal screens, and run the backfill (task 5).
3. **Resubmit** with the cover games in a "coming to the app" state, unless a licence has arrived. Bring them back with one switch the day one does.
