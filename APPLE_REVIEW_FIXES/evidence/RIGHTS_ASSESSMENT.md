# Rights assessment, by integration and feature

Every quote below is verbatim from the copies in `sources/`, unless marked *(snippet)*, which means it comes from a search excerpt because the source page was blocked.

---

## 1. Deezer: catalogue, artwork and 30-second previews

**Grade: D now. C via a Deezer commercial agreement.**

**What VINALL uses it for:**
- search and album/artist/track metadata, through server routes;
- cover and artist images (dzcdn);
- 30-second preview URLs, played in VINALL's own player in:
  - album pages
  - For You
  - Today
  - Your music
  - Replay
  - Recall
  - onboarding
  - Community Choice (Deezer picks)

**What VINALL holds:**
- No Deezer developer account or application id anywhere in the code or the environment variables (checked).
- Deezer closed new registrations in October 2025 (Community Manager post, https://en.deezercommunity.com/features-feedback-44/api-auth-impossible-80857 *(snippet)*).

**Would accepting the published terms help? No.** Deezer Terms of Use for Developers, captured 18 Jul 2026, https://developers.deezer.com/termsofuse:

- **§I scope:** access is for developers to "develop personal web pages, blog … and personal applications". VINALL is a public app operated by a company.
- **§II(a) no content licence:** "The Developer recognizes that it shall be granted no right upon the DEEZER API, the Personal Application that it shall develop and the Content of the Services." **Even a registered developer gets no rights in the covers or recordings.** That alone means Deezer's terms cannot be the documentary evidence Apple asked for.
- **§III(2):** the developer warrants it "Possesses all rights, licenses or any other authorizations or permissions necessary". The burden of rights is placed on us.
- **§IV, four separate exclusions:**
  - "strictly limited for a non-commercial purpose and in a non-commercial environment";
  - the developer shall not receive "any moneys, incomes, revenues, data or any other consideration". VINALL collects ratings and accounts.
  - the content "shall not be associated, directly or indirectly with any trademark, brand name, or logo". VINALL is a brand.
  - "The use of the Content is limited to a strictly private use within a family scope".
- **§IX:** use "for any other purposes than those mentioned herein, shall be beforehand reviewed and approved by DEEZER".

**Conclusion.** No published Deezer permission covers VINALL, whether or not registration were open. **This is the core of the 5.2.3 rejection.**

**Smallest change if no agreement:** keep Deezer's role where it causes no rights exposure, which in practice is none of it. Alternatively, move artwork and previews to a source with a published licence. See §2.

**Route to C:**
- Deezer for Business, "Music as a Service" (licensed catalogue and technology), relaunched March 2026: https://newsroom-deezer.com/2026/03/deezer-announces-revamped-partnership-platform-deezer-for-business-to-drive-continued-growth/ *(snippet)*. Contact via https://partners.deezer.com/integration-partnerships.
- Unknown whether they deal with an app this size. Draft request in `PERMISSIONS_TO_REQUEST.md`.

---

## 2. Apple iTunes Search API: artwork, metadata and 30-second previews

**Grade: B. This is the strongest published licence available for real covers and previews.**

**Already in the app:** the album-page player uses Apple previews as its fallback (`appleMap`), and Earworm uses an iTunes genre lookup.

**Terms** (Search API page, captured 12 Nov 2026, https://performance-partners.apple.com/search-api):

- "Developers may use promotional content in the API, including previews of songs, music videos, album art and App icons only to promote store content and not for entertainment purposes."
- "Use of sound samples and other assets from the API must be proximate to a store badge."
- The Promo Content conditions:
  - (i) placed only on pages that promote the content;
  - (ii) near a badge that links to the content in iTunes or Apple Music;
  - (iii) "provided courtesy of iTunes" — only "if such Promo Content includes song or music video previews";
  - (iv) "streamed only, and not downloaded, saved, cached" — likewise only for previews, so **album art is not caught by (iv)**;
  - (v) "not used for independent entertainment value apart from its promotional purpose";
  - (vi) "not used to promote any other goods or services".
- "approximately 20 calls per minute (subject to change)": counted per caller, so calls should come from each device rather than our server.

**What it covers, once a badge or link and attribution are added:**

| Use | Covered? | Notes |
|---|---|---|
| Album page | **Yes** | Badge near the cover; "provided courtesy of iTunes" by the player |
| For You cards | **Yes, arguably** | Each card promotes one record. Add a per-card Apple Music link and attribution. The blurred cover background is not prohibited by the text but is decoration; it's safer as a colour field |
| Community feed, reviews | **Likely** | A per-card link |
| Crate grid, profile tiles | **Uncertain** | It's the user's own library. One badge per screen and tiles linking to the badged album page is the best available fit. Ask Apple |
| Collection shelf | **Weak** | Covers decorating a virtual economy; (v) and (vi) both press on it. Ask Apple |
| Games, including Guess the Cover | **No** | "not for entertainment purposes", (v) |
| Store screenshots and share images | **No** | (vi), "not used to promote any other goods or services" |

**Limits:**
- Promotional only.
- Apple may require removal at any time.
- California law.
- Coverage is lower than Deezer's: about 70% of tracks had a preview in an earlier measurement (CLAUDE.md).

**Related Apple rules:**
- App Review 5.2.5: previews "may not be used for their entertainment value (such as … the soundtrack to a game)".
- DPLA §3.3.6(F), Apple Music Feed: the same promotional model; needs enabling.
- DPLA §3.3.6(D), MusicKit: tied to subscriber playback, so not a general catalogue.

---

## 3. YouTube: Community Choice moments

**Grade: A for embedding, with one small fix (B) to VINALL's terms page.**

**What VINALL holds:**
- A Google Cloud project with the YouTube Data API enabled (`YOUTUBE_API_KEY` in Vercel), so YouTube's API Services Terms are accepted. **Screenshot the project and the enabled API for the pack.**

**Terms:**
- YouTube Terms of Service (captured 13 Nov 2026, https://www.youtube.com/t/terms): "You may also show YouTube videos through the embeddable YouTube player." This is published permission to embed.
- YouTube Developer Policies, "Last updated 2026-11-06" (https://developers.google.com/youtube/terms/developer-policies):

  | Requirement | VINALL now |
  |---|---|
  | Clients "must also state in their own terms of use that, by using those API Clients, users are agreeing to be bound by the YouTube Terms of Service" | **Missing from terms.html. One sentence to add (B)** |
  | Privacy policy must "notify users that the API Client uses YouTube API Services, reference and link to the Google Privacy Policy" | privacy.html names YouTube; **add the Google Privacy Policy link** |
  | No background player | Met: the player is visible, and background audio has been removed |
  | Must not "modify, build upon, or block any portion or functionality of a YouTube player", or "separate, isolate, or modify the audio or video components" | VINALL pauses the video with its own timer at the end of the chosen moment. The documented `end` player parameter does this with no modification. **Small change** |
  | No "incentives, rewards, or other compensation to users for engaging" | Met: the code audit confirms Community Choice pays no Discs |
  | Must not gate a video behind "an action other than clicking the play button", with an exception for normal functionality "such as login or age verification" | VINALL asks for privacy consent before loading YouTube, which falls under that "normal functionality" exception |

- Required Minimum Functionality (https://developers.google.com/youtube/terms/required-minimum-functionality *(snippet)*): player at least 200×200px, no overlays. **Check the Choice card layout.**

**Community Choice moments sourced from Deezer:** covered by Deezer's position (D). Smallest change: new picks use YouTube; existing Deezer picks link out to YouTube or play an Apple preview.

---

## 4. kworb.net stream counts: Bid Wars, Collection prices, Higher or Lower (streams)

**Grade: D.**

- kworb's FAQ says "feel free to use the data to make your own graphs" *(snippet)*. That does not cover a company storing the data and pricing an in-app economy with it.
- There are no terms to accept, and the FAQ says the owner doesn't take business proposals *(snippet)*.
- kworb's figures are themselves gathered from Spotify, whose user guidelines prohibit scraping (https://www.spotify.com/legal/user-guidelines *(snippet)*). Even permission from kworb would not clear that.
- UK database right (Copyright and Rights in Databases Regulations 1997, reg 16) covers "repeated and systematic extraction" of insubstantial parts (https://www.legislation.gov.uk/uksi/1997/3032/regulation/16).

**Smallest change that keeps Bid Wars and Collection buying exactly as games:** change only the value source to one we can evidence.

- **(A after change)** VINALL Value: Wikipedia pageviews (CC0 data, https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html *(snippet)*), Wikidata certifications (CC0), and VINALL's own community signals.
- Calibrated so today's prices barely move.
- Stored `collection.price` rows are untouched, being Discs VINALL charged, not kworb data.

**Licensed alternative (C):** Soundcharts' API starts at $50/month (https://soundcharts.com/en/pricing/developers *(snippet)*), but the right to display figures to end users is negotiated separately, and its figures are also Spotify-derived.

---

## 5. Discogs: Bid Wars "Score" mode

**Grade: B/uncertain.**

- VINALL holds a Discogs personal access token, so the Discogs API Terms are accepted.
- The 27 May 2025 terms divide data into CC0 and "Restricted Data" under a revocable licence (https://support.discogs.com/hc/en-us/articles/360009334593 *(snippet; 403 here)*).
- The community rating used as a game value is probably Restricted Data, and the scope for game use is unverified.

**Smallest change:** read the terms on a machine without the filter; if game use isn't clearly allowed, park this one mode with its existing switch.

---

## 6. MusicBrainz / Wikidata: Music Passport origins and artist-id lookups

**Grade: A.**

- MusicBrainz core data, including artist country and area, is CC0 (https://musicbrainz.org/doc/About/Data_License *(snippet)*).
- Wikidata is CC0.
- Passport uses only core data. Add a "data from MusicBrainz" credit as good practice.

---

## 7. Spotify

**Grade: A (links only).**

VINALL calls no Spotify API. Its two Spotify features need no Spotify licence:
- "Find in Spotify" opens a search URL.
- The data-export import reads the user's own file.

Spotify's design guidelines apply only if its logo is shown, and it currently isn't.

---

## 8. Games built on facts

Daily Drop, Earworm, Cover Fire questions, Guess the Year, Tracklist, and Higher or Lower's ratings mode.

**Grade: A for the facts.**

- Titles, artists, years, track counts and runtimes are facts, not copyright works.
- The static tables were compiled by VINALL.
- Ratings mode uses the user's own scores.

---

## 9. Real album covers *inside games*

Guess the Cover, Cover EXTREME, Cover Fire's sleeve answers, and the Drop/Earworm reveals.

**Grade: D now. C via rightsholders or a licensed aggregator.**

- **No published licence found allows this:**
  - Apple: "not for entertainment purposes".
  - Spotify: games banned (https://developer.spotify.com/compliance-tips *(snippet)*).
  - Deezer: no content rights at all.
  - Stock agencies: "Editorial use only".
- **Routes to C:**
  - Written permission per cover from the label or artist. The cleanest evidence; often free from independents.
  - Music Story (Believe): "High-resolution album artwork cleared for digital distribution", priced by monthly users "from indie apps to global DSPs", default "Editorial use only" (https://music-story.com/en/our-offer). It needs game use named in the contract.
  - MassiveMusic (formerly 7digital): quote only.

---

## 10. Real covers in the App Store screenshots

**Grade: D now. C per cover.**

- Apple's promotional licence excludes this: (vi) "not used to promote any other goods or services".
- App Review 4.5.2(ii) forbids using Apple Music metadata in marketing without rightsholder authorisation.
- Forum reports describe rejections for exactly this (https://developer.apple.com/forums/thread/710261, /128141 *(snippets)*).
- **Keeping the original screenshots needs written permission from the rightsholder of every cover shown.**
- The replacement screenshots in `../store-screenshots/` use invented records and original art: **A**.

---

## 11. Copyright exceptions (UK)

**Not evidence.**

- s.30(1), criticism or review: a possible defence for a cover shown beside a written review of that record. It is a defence, not a permission.
- s.30(1ZA), quotation: requires "no more than is required"; the UK IPO says even "a few bars" may need clearance (https://assets.publishing.service.gov.uk/media/5a7ee018ed915d74e6227041/ia-exception-quotations.pdf *(snippet)*).
- Neither covers games, feeds or screenshots, and Apple asks for permission, not a defence.

---

## 12. VINALL's own data and features

Ratings, history, the Crate data, profiles, Taste Match, Depth, About You, Replay (ratings), Grooves, People, Reach, the Shop, The Draw, missions, streaks, Charades and Suggestions.

**Grade: A.**

All of these use content VINALL users created, or VINALL's own code. They need no third-party permission.
