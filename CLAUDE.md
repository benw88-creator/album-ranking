# VINALL

Album-ranking web app (renamed from Vinal to VINALL), live at https://wildcrate.xyz.

## Shape

Zero-config Vercel deployment — there is no build step and no `package.json`.

- `index.html` — the entire front end, one large file (~540KB). Vanilla JS, no framework.
- `api/*.js` — Vercel serverless functions, auto-detected from the folder:
  - `app-token.js` — mints an app-level token (Client Credentials); this is how **every**
    catalogue request is authorised, for guests and signed-in users alike
  - `bid-war-create.js` — Bid War creation, both modes
  - `album-streams.js`, `_streams.js` — stream valuation (kworb). `?albums=a,b,c`
    batches up to 12, sharing one artist cache across the batch
  - `album-market.js`, `_discogs.js` — market valuation (Discogs)
  - `preview.js` — 30-second preview clips for one album, from Deezer (which sends
    no CORS headers, hence a route), edge-cached a week. This is what VINALL's own
    player plays — see **Playing a track**
  - `delete-account.js` — in-app account deletion

**There is no Spotify user login.** Accounts are Supabase email/password. `api/login.js` and
`api/callback.js` existed for a Spotify OAuth flow that nothing ever called — `login()` was
never invoked from anywhere — and its leftover client half fired a request to `/api/token` on
every single page load, which 404'd. Both routes and that code are gone. A useful consequence:
**the 5-user Spotify Development Mode cap does not limit who can use VINALL**, because no user
ever authenticates against Spotify. Only the app owner's credentials are involved.
- `assets/`, `dither-frames/` — static media
- `supabase-migration-discs.sql` — loose schema SQL (see Database below)

Data comes from the Spotify Web API; user data is stored in Supabase.

## The spine — score history, and why everything hangs off it

VINALL had two economies running in parallel and only one of them was about music.
There was the Disc economy — play games, earn currency, buy cosmetics and records —
which is generic and could belong to any app. And there was the meaning economy —
rate, answer, remember, collect — which is the differentiated one and was
underdeveloped and disconnected. Lore answers went into a table and never came back.
The Crate was a feed with hearts on it. Level was lifetime Discs, which measures how
much of the app you have used rather than how deep you have gone.

The thing this app can know that nothing else can is **how your opinion of a record
moved**. Spotify knows what you played. Every rating site knows what you think today.
Only this one can know that you gave Blonde an 82 in March and a 94 in September.
That fact can only be earned by time, it compounds the longer an account runs, and it
is what makes a VINALL account expensive to walk away from. So it is the spine, and
four features read from it.

### `history[]` and `ratedAt` on every rating

`pushScoreHistory()` in `saveAlbum` / `saveSong`. One entry per *distinct* score,
oldest first, current last, so `[0]` is the first thing you ever thought and the last
is what you think now. A re-rate to the same number is not a change of mind and writes
no row — it still stamps `ratedAt`, because that field answers "when did you last look
at this". Capped at 24, and the cap drops from the **middle**: the first opinion is the
origin of the story and the recent ones are the live part, so neither end is ever the
thing thrown away. `scoreMove(item)` is the read side and is on `window`.

This is local data riding the existing `app_state` mirror, so it needed no migration.

**It also exposed a real sync bug.** `mergeItemMap` resolved per item on `savedAt`,
which is the moment a record *entered* the crate and never moves again. For any record
rated on two devices the two timestamps were identical, the `>=` sent the tie to local
every time, and **a re-rate made on another device could never come down**. Re-rating is
the whole point of score history, so that had to stop being true: the merge resolves on
`max(ratedAt, savedAt)` now, and an item written before `ratedAt` existed has none and
falls back to exactly the old behaviour.

### Second thoughts (Today)

`findSecondThoughts()` + `rethinkCard()`. An album whose last look was six months ago
gets a card that says "You gave this 82 in November 2025" with a slider on it. The save
button carries the verdict rather than the word "save" — *Still 82* until you move it,
then *Make it 95* — so the control reads as one sentence and there is no way to move the
slider and not notice you had not saved.

Both answers are worth having: "still 82" is a fact about you and so is 82 → 95.
Answering either way stamps `ratedAt` and buys six months of quiet.

Six months is the floor deliberately — any sooner and it is a nag about a record you
have barely lived with. **These are claimed before the ask pool**, for the same reason
receipts are: `findAnyRated` puts every rated record in the ask pool, so a filter
running afterwards finds every id already taken and shows none of them. That is exactly
how the first version of this shipped and showed nothing.

This is the strongest return-driver in the product and the only card in the stack that
cannot be built on a first visit.

### The Crate: a stance, not a like

The heart is gone and **nothing took its slot**. A like on a rating is agreement with a
*person*, not with an opinion — it cannot disagree, it cannot be uncertain, and it can
be given by somebody who has never heard the record. The unit this app already thinks in
is a score out of 100, so that is what a response is: you answer somebody's 93 with your
own number, and the gap between them is the interaction. The card then reads
`You 62 −31`.

- **The spread.** One dot per score anybody has given that record, on a 0–100 track,
  the poster's filled in their own score colour and yours ringed. Two ratings is the
  floor — a single dot is not a spread, it is the post again. `Cloud.fetchAlbumScores()`
  gets the lot in one round trip, because `crate_feed` already holds exactly one row per
  person per album; it needs no session, since a record dividing people is worth seeing
  logged out.
- **"Not heard"** is the honest answer to a stranger's opinion and the one the heart
  could not express. It goes to a **shortlist** (`crate_shortlist_v1`, in `SYNC_KEYS`,
  merged with the same per-item rule as ratings), which turns the admission into the only
  genuinely useful thing it could be: a queue of records somebody you follow rated highly
  enough to post. Rating one takes it off, so the list empties by being used.
- Answering **builds your own crate** — the score is a real rating, with history. That is
  the elegant part: engaging with somebody else's opinion is how your library grows.
- Comments stay. Discussion was never the problem.

`feed_likes` and `Cloud.toggleLike` / `fetchLikes` are left in place and unused, parked
the same way market-mode Bid Wars is.

One trap worth not repeating: the first version of `commitCall` asked Spotify for the
album's `artistId` in the background, because a feed row does not carry one. A failed
catalogue call runs `showGate()`, so **an optional enrichment put a "can't reach Spotify"
banner across the page because somebody answered a card**. It takes the id from another
record by the same artist in your crate now — free, offline, right nearly always — and an
absent id costs that record a place among the recommendation seeds and nothing else,
since `artistStats` skips a blank id rather than lumping them together.

### Standing replaces Level as the headline

Level is `lifetime_xp`, which is every Disc ever earned. It rises fastest for somebody
grinding minigames and barely moves for somebody quietly building a serious crate, which
is the opposite of what this app is for. It is **still there**, unchanged, on the profile
as a statistic. What leads is Standing.

A record earns depth by having more of *you* attached to it:

| | |
|---|---|
| scored it | 1 |
| wrote a note on it | +1 |
| answered a question about it | +1 |
| own it | +1 |
| changed your mind about it, 30+ days apart | +2 |
| held it 90 days | +1 |

Three points makes a **deep cut**. You cannot get there by rating faster — rating is one
point — and you cannot get there in an afternoon, because the two-point ingredient needs a
month to pass between two opinions and the one-point one needs ninety days on the shelf.
Tiers roughly double: Listener 0 / Crate Digger 3 / Selector 10 / Collector 25 / Curator
60 / Archivist 130.

The profile block **prints the rule**. A ladder whose steps you cannot see is a ladder
people climb by accident, and this one is trying to say what the app thinks is worth
doing.

It is computed from local data, so it is yours and is not shown on anybody else's
profile. Publishing it would need a `profiles` column and a `pin_profile_economy` change
— and a number people can compare is a number people optimise, which is the failure mode
this replaced. If it is ever published, publish the tier name and not the count.

`Standing.get()` reads `CollectionWorth.mine()` and `VinallLore.items()`, two small
synchronous accessors added for it; both return empty until their owners have loaded,
which degrades the number rather than breaking it.

### The Collection carries its provenance

Price says what the world thinks. The provenance line is the only thing on an owned card
that is about you: *Held since Feb 2026 · you gave it 93 ↑15 from 78*. A record you own
and have **never rated** says so and is tappable — it is the one state on that page worth
acting on, and a shelf full of records you have never had an opinion about is a portfolio
again.

Four shelf orders, because a shelf you can only sort by price is a portfolio: Value,
Longest held, Your rating, Grown on you. Both helpers are wrapped in try/catch and fall
back to returning nothing and to the original order — they are ornaments on a card, and an
ornament that throws would take the whole shelf down with it.

### Taste match — the one number that is about two people

Everything else on a profile describes one person. This is the only thing in the app
that describes a pair, and it is the thing a rating site can compute that a streaming
service cannot: two libraries of scores out of 100 over the same records.

**Overlap is not agreement**, which is why this is not "artists you both like". Two
people who both own Blonde have told you nothing. Two people who scored it 94 and 51
have told you everything. So the match is about the distance between the numbers and
nothing else.

**The measure, and why it is not `100 − average gap`.** That arithmetic flatters
everybody: ratings cluster in the 60s to 90s, so two strangers already "agree" to about
85% and the number means nothing at 88. Instead the gap is measured against what
coincidence would have produced — `chanceBaseline` is the mean distance between your
scores and theirs *paired at random*, the gap two people with exactly your two rating
habits would get by luck:

```
edge  = 1 − (actual mean gap / chance baseline)
match = sqrt(edge)
```

100% is identical opinions, 0% is no better than coincidence, and both are true of
`edge` before the square root. **The square root is presentation and is admitted as
such in the code**: `edge` alone is unusable as a gauge, because two people who
genuinely share a taste still land near 0.3, so a raw scale reports nearly every real
pair between 0 and 30 and the feature reads as broken. The curve spreads the range
people actually occupy and moves neither anchor. Verified against synthetic libraries:
identical 100, near-twin 95, close 78, similar 43, unrelated 0, inverted 0.

Two corrections that matter more than they look:

- **`FLOOR` (14) stops the denominator collapsing.** Somebody who scores everything
  between 70 and 90 has a tiny chance baseline, and dividing by it would punish a
  narrow rater for being consistent.
- **`chanceBaseline` strides rather than samples.** A match that came out 74% and then
  71% on the next render would be read as a bug, and that reading would be correct.

**Five shared records minimum.** Four is a coincidence with a percentage printed on it.
Below the floor `compare` returns `enough: false` and every caller says how many are
missing instead of inventing confidence. Above it, the chip prints the shared count
beside the percentage and greys out below twelve — 91% on six is a rumour and 74% on
ninety is a fact, and a chip that hides which one it is teaches people to trust the
wrong number.

**The percentage is never alone.** A number with no evidence under it is a horoscope.
Under it: the records you are furthest apart on, the ones you are dead on, and the ones
they rate highly that you have never heard — which go straight to the **shortlist**,
the same place "Not heard" goes from a Crate card, carrying *why* ("charlie gave it
94"). That last list is the point of the whole block: the reason to follow somebody
whose taste is not yours is the records you would never otherwise reach.

One bug found while building it: the first version only printed disagreements of ten or
more, so a **well-matched pair got a percentage with no evidence under it at all** —
exactly the horoscope the design was meant to avoid. The widest gap now always renders;
the floor only trims the second and third rows.

Where it appears, all from one primitive:

| surface | source | cost |
|---|---|---|
| somebody's profile | the `ratings` rows already fetched to draw their grid | none |
| People, ordered by it | `Cloud.fetchScoresByUsers` | one paged trip |
| username search result | same | one trip |
| the poster on a Crate card | same | one trip per page of feed |
| Groove members | same | one trip |

A 45 from somebody you agree with nine times in ten is different information from a 45
by a stranger, and a Crate card had no way of saying so. Grooves have promised "see
everyone's taste" since they shipped and listed names.

**Privacy.** The profile block computes from `fetchUserRatings`, so it inherits that
query's RLS: somebody with private rankings returns nothing here for the same reason
their grid is empty. The batched path reads `crate_feed`, which is public — posting is
public and the spread already renders every score — so it is gated in the client on
`ratings_visibility === 'public'`. Scores being public one at a time is not the same as
consenting to a portrait assembled out of them.

**`fetchAlbumScores` had the 1000-row bug** and it is fixed in the same pass. 120
albums is 120 rows only if every record has exactly one rating; at nine raters each it
is over the PostgREST cap, and the cap is not an error — it is a short array and a 200.
The spread would simply have stopped showing people. Same failure shape as
*A profile showed twelve albums out of forty*, one section down, and the same fix.

### Certification — the step after owning a record

`..._20260915220000_certification.sql`, plus the `Cert` and `CertPanel` modules.

The progression was Rank → Acquire → Own, and it stopped. A record on the shelf on day
one looked exactly like one held for two years with every track rated. This is the fourth
step, and it is deliberately **the only one Discs cannot reach**.

**Records already have a certification ladder and everybody can read it without being
taught.** The BPI hands out Silver, Gold, Platinum and Diamond and the award stays on the
sleeve for life. So: no XP, no levels, no bars filling for their own sake. A record
collects **marks**, the marks make a certification, the certification is a thing you
display. "Gold" is what anybody would call the good version of an owned record without
being told, which is the test a name has to pass here — the same test the Draw's rarities
failed twice before landing on Common/Rare/Epic/Legendary/Mythic.

**Two axes, and keeping them apart is the design:**

- **Certification is earned.** No path in the migration grants a mark for money.
- **Finishes are bought, and gated by certification.** Once a record is Gold you may spend
  Discs having it plated. The Discs buy the plating, never the award — nobody sells you
  the Gold disc, you pay for the frame it goes in.

That split is also what makes it a **bottomless sink**, which the Shop is not: every
cosmetic there can be finished and an account that owns them all has nowhere to put Discs.
There is no last record to plate. Same argument the album banner used to carry.

#### The marks, and why none of them are taken on trust

| | |
|---|---|
| rated it | 1 |
| wrote a note on it | 1 |
| changed your mind, 30+ days apart | 2 |
| changed it again (3+ distinct scores) | 1 |
| own it | 2 |
| held it 90 days | 1 |
| held it a year | 2 |
| a Lore answer about it | 1 each, capped at 2 |
| rated 3 of its songs | 1 |
| rated 8 of its songs | 1 |

Max 14. **Silver 4 · Gold 6 · Platinum 9 · Diamond 13.**

**Ownership is a gate, not just a mark** — `cert_tier_for(14, false)` is null, and there is
a guard asserting it. Marks accumulate on a record you have never bought and certify
nothing until you do, because the step this extends is the one after own.

Diamond is 13 of 14 and one ingredient is a year of holding, so it cannot be hurried by any
amount of activity in a weekend. That is the point of the number: you should be able to look
at somebody's Diamond record and know they did not get it this month.

**Every input already lived on the server**, which is why `collection_marks()` computes the
tier itself rather than believing the browser: `collection.bought_at` for the holding, the
album's `ratings` row for score, note and the score history the spine gave us, `ratings`
again for songs by their `albumId`, and `lore_answers`. That matters because **the tier
gates a purchase** — a client that could name its own tier could press a Diamond finish
onto a record it had rated once. It is the same rule as `wallet_buy` taking a key and never
a price, applied to an entitlement instead of a cost.

`collection_certs(user)` returns a whole shelf in one call, because the Collection draws
dozens of cards and a round trip each would be a round trip each.

The workings are private and the award is not: somebody else's shelf shows what a record is
certified at, but how close they are to the next rung comes back only for yourself — same
line Standing and Taste Match draw.

**That line did not hold on the first attempt, and the failure is worth copying the fix
from** (`..._20260915234500_cert_detail_privacy.sql`). The guard was
`v_self boolean := (p_user = auth.uid())`, which is correct for a signed-in caller looking
at somebody else and **NULL for an anonymous one** — so `not v_self` was NULL, the early
return never fired, and every logged-out visitor got the breakdown. Three-valued logic, not
a typo: it reads correctly in English and is wrong only for the one caller nobody pictures
while writing it. **Anywhere a boolean gates a privacy branch, decide what NULL means and
say so.** Caught by calling the function from a logged-out browser against a real shelf,
which is worth doing to anything with a `v_self` in it.

#### The finishes

Silver leaf 8,000 · Gold plate 25,000 · Platinum 60,000 · Holographic 75,000 ·
Prism 150,000 (Diamond only). `owned_finishes` is **per record**: switching between ones
already bought for that record is free, because charging twice for something owned makes
people leave it alone rather than play with it.

`Cert.art()` is the single renderer. The shelf, the album page and a profile showcase all
go through it, so a finish bought in one place appears in the others with no second
implementation to keep in step — the mistake themes made for months, where the Shop swatch
and the real theme were separately invented and drifted.

Two things learned building the visuals:

- **Holographic shipped invisible.** `mix-blend-mode: color-dodge` at 30% over bright
  artwork is nothing at all — a 75,000-Disc purchase that looked identical to no finish.
  `overlay` darkens where the art is light and lightens where it is dark, so it reads on
  anything, and tight repeating bands say *foil* where a smooth wash says *tint*. Then it
  had to come back **down** to 0.34: at 0.55 the finish was louder than the cover it is
  supposed to be honouring, and the record is still the thing.
- Every scrolling gradient here travels in **pixels** at **90deg** with matching first and
  last stops. See the note on that further up: this app has shipped the percentage version
  of that bug four times.

#### Inscription, and the Masters

**The inscription is free**, Gold and up, one line, 80 characters. It is the only part of a
plated record that could not have been bought, and it is the most on-thesis thing in the
feature — the customisation making a relationship with a record visible rather than a
purchase visible.

**Masters** are at most three Diamond records, and the cap *is* the feature: a showcase of
everything is a shelf, and the question this answers is which records **are** you. They
lead the profile, above Standing and above the top 3, and unlike Standing they render on
somebody else's profile — `collection` is publicly readable, and a plated record nobody
else can see is a screensaver.

The panel lives on the **album page under the tracks**, not in the Collection, because
nearly every mark is earned by something on that screen: you read "rated 3 of its songs —
not yet" with the tracklist directly above it. It also renders for a record you do **not**
own, showing the marks waiting on it and saying that owning it is the gate — a progression
you cannot see until you have paid to enter is a progression nobody knows exists.

`Cert.FINISHES` mirrors `finish_spec()` in SQL. Display against payment, the same
arrangement as `LADDER` against `v_ladder`: change one and you must change the other.

### What was deliberately not done

- **No "how many still fit" counter in the Crate**, and no second currency. The Disc
  economy is untouched: no migration, no RLS change, no new table, nothing added to a pin
  trigger. Every change above is client-side and reversible.
- **Standing does not gate anything.** Progression that locks features turns a statement
  of values into a toll gate.
- The shortlist is a local list, not a `lists` row. It syncs, it is private, and it costs
  no round trip per tap.

## Deploying

GitHub → Vercel is connected. **Push to `main` and the site is live** in roughly half a minute:

```
git add -A && git commit -m "..." && git push
```

There is nothing to run locally to make a deploy happen. Verify on the live URL after the push.

## Working across two machines

Both this machine and Ben's main PC have clones. `index.html` is one enormous file, so
concurrent edits conflict badly and are painful to resolve.

**Always `git pull` before touching anything, and push as soon as a change is finished.**
Never leave uncommitted work sitting on one machine.

## Environment variables

Set in Vercel → Project → Settings → Environment Variables. Not in the repo.

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — used only by `/api/app-token`
- `DISCOGS_TOKEN` — a personal access token from Discogs → Settings → Developers,
  generated instantly with no OAuth flow. Market-mode Bid Wars and
  `/api/album-market` return a 500 saying so until it is set; nothing else is
  affected.

`REDIRECT_URI` is no longer read by anything and can be deleted from Vercel. It only mattered
to the removed OAuth routes. Preview deploys therefore work fully, since `/api/app-token`
needs no registered redirect.

The Supabase URL and anon key are inlined in `index.html`. That is normal for Supabase —
the anon key is meant to be public — but it only stays safe while Row Level Security is
enabled on every table.

For local work (optional, needs Node): `vercel env pull .env.local`.

## Database

Supabase project ref `cqfxyebejpkyhswolrwi` (project name "Crate", Postgres 17, eu-west-1).

The schema is still maintained by hand in the dashboard. `supabase/migrations/` holds the
migrations written since, not a full history — the core tables are not in there. Snapshotting
the rest needs `supabase db pull`, which needs Docker, which needs WSL2, which needs admin
rights — so it can only be done from the main PC, not the school laptop.

**Several migrations were applied by hand in the SQL editor and are therefore not recorded in
Supabase's migration history**: `..._090000_protect_is_admin.sql`,
`..._20260908120000_groove_roles.sql` and `..._20260909120000_listening_history.sql` (the last
two applied 2026-09-09). A future `supabase db push` will try to apply all of them again.
That is safe — every one of them is idempotent, using `create or replace`,
`drop ... if exists` and `if not exists` throughout. **Keep new migrations idempotent for
exactly this reason**, because "applied by hand and not recorded" is the normal case here,
not the exception.

**Two of them were not, and the pattern that fixes it is worth copying.** The inflation
passes ran bare `update shop_items set cost = cost * 4` and `* 5`, so applying either
twice multiplies twice and there is no way to tell from the data which happened.
`..._20260915100000_harder_progression.sql` guards its multiply on a sentinel — the most
expensive tag is 16,000 before it and 192,000 after, so the block cannot fire twice, and
it raises rather than guessing if it finds neither. **Any migration that multiplies a
stored value rather than setting it needs that guard**, because a multiply is the one
shape where re-running is silently wrong instead of merely redundant.

The school laptop has **no Node, no npm, no Supabase CLI and no working Python**, so nothing
there can reach Supabase or Vercel directly. Migrations written on that machine have to be
pasted into the SQL editor by hand, and JS changes cannot be executed before they ship —
structural checks and a post-deploy console read on the live site are the available
substitutes.

## Security notes

Write policies on every table are scoped by `auth.uid()` — users cannot modify each other's
rows.

**The economy is server-side** as of `..._190000_server_economy.sql`. `discs`, the streak
columns, the cosmetic arrays and the daily award counters are all pinned by the
`pin_profile_economy` trigger, which replaced the narrower `pin_profile_is_admin`. The only
ways to move them are `wallet_record_rating()`, `wallet_buy()` and the `award_lore_disc`
trigger, all `security definer`. Prices live in `shop_items`, never in the request. Equipping
a theme or banner is still a client write, because the trigger reverts anything not owned.

Do not reintroduce a client-side balance. The previous version computed discs in the browser
and posted the result, and its "daily cap" was an in-memory variable — both were trivially
bypassed from the console, and nothing can be sold on top of that.

### Minigame payouts were fake until `..._20260911100000_game_awards.sql`

`Wallet.awardDiscs(amount)` read like it granted discs. It took the amount, threw it away,
read the wallet back with `wallet_state()` — a read-only select — and toasted the number
anyway. No server function awarded it, and after the economy went server-side no client write
could. **Earworm, Daily Drop, the Tournament, achievement claims and Completionist all showed
rewards that were never written.** Only Bid Wars, ratings and lore ever paid out.

`wallet_award_game(p_game)` replaces it: **the client names the game and never a number**, the
way `wallet_buy` takes a key and never a price. These games run entirely in the browser so a
win cannot be verified — same posture as `wallet_record_rating`, which you can call without
rating anything — so the defence is the same, a hard daily cap per game (`game_awards_date`
and `game_awards`, both pinned by the trigger; without that, resetting your own counters
client-side farms the caps). Adding a game means adding a `when` to the case *and* nothing
else.

Lore keeps its trigger and uses `Wallet.syncAward()`, which re-reads and toasts the difference
that actually landed, so nothing is promised once the daily cap is hit.

**A reward that vanishes on refresh is worse than no reward.** Before adding feel to a game,
check the feel is attached to something real.

### The economy's shape, and why the sink matters more than the faucet

Current numbers set by `..._20260913220000_doubling_login_and_inflation.sql`. The rule that
survived every pass: **inflating what you earn, on its own, only brings forward the day
somebody owns everything.** It is safe only alongside a sink.

- **Daily login** — `wallet_daily_login()`. **1,500 / 2,000 / 2,500 / 3,000 / 4,000 / 5,000,
  and day seven pays a free record instead of Discs.** 18,000 and one album per seven-day
  cycle. Safe to call on every load — it returns `claimed_already` and changes nothing.
  - **It cycles.** Position is `((login_streak - 1) % 7) + 1`. Before this it *plateaued* in
    SQL while the Rewards page drew a cycle, and the two silently disagreed from day eight.
    Both are now the same expression.
  - The ladder is an **array of seven literals** in SQL and the same array in the Rewards
    module. Written as literals rather than a formula on purpose: a mismatch is then visible
    on sight, which is how the last drift should have been caught.
  - No streak freezes here, because a freeze would protect you from not opening an app.
- **It used to double, and that was the economy's biggest distortion**
  (`..._20260915140000_flatten_login_ladder.sql`). 1,000 doubling to 32,000 meant **day six
  alone paid more than maxing every game in the app pays in a day** — 32,000 against 30,800
  — for one tap on a button that cannot be done well or badly. Against a realistic session
  rather than a maximal one it was worse: the old ladder averaged 9,000 a day and a normal
  day's play is 7,000–12,000, so **logging in paid about the same as playing**.
  - The reason that mattered here specifically: **it put the two progression systems in
    opposition.** Standing measures depth and prints its own rule on the profile to say
    depth is what the app values; the wallet paid best for opening the app and closing it.
    Someone optimising for Discs was doing nothing VINALL is for.
  - Flattened rather than cut, so consistency still pays — a full week is 18,000 against the
    9,000 somebody gets only ever landing on day one, a 2x premium where it was 9x. The
    miss-a-day cliff falls from 32x to 3.3x, which matters because the design already
    flinched at it: freezes were refused for this ladder precisely because "a freeze would
    protect you from not opening an app".
  - **Day seven is untouched and is the point.** A record of your choice is worth more than
    the six Disc days together — Views alone is 51,240 — so the reward for a week of turning
    up is a record rather than a pile of currency, and the Disc days can be modest because
    of it. Day six is 5,000, which is exactly one spin.
- **Bid War payouts were the last thing in the old money** and are now 3,000 / 1,500 / 800,
  capped at three paid settlements a day — see the Bid Wars section for why the cap had to
  ship in the same file as the amounts. Every part of the economy is now denominated
  consistently.
- **Rates** (`..._20260914160000_play_pays_properly.sql`): ratings 400 × 10/day, lore 250 ×
  20/day, Earworm 2,000 × 3, Daily Drop 3,000, achievements 1,600 × 5, Higher or Lower
  1,600 × 3, Tournament 1,600 × 2 (parked). **A day of everything is 30,800.**
  - The sizing rule is *against prices*, not against each other — and
    `..._20260915100000_harder_progression.sql` moved the prices a long way without touching
    a single rate, and `..._20260916090000_thirty_tags.sql` re-priced the tags one by one on
    top of it. A spin is **5,000**, the cheapest tag **21,000**, the whole shop
    **~4,953,500** — of which 4,381,000 is the thirty tags. A realistic session buys a spin
    or two and nothing else; the cheapest tag is about a day and the dearest is months,
    which is what a status cosmetic should be.
  - **Rates were not touched by that pass**, deliberately. Halving what a rating pays reaches
    the same place with a worse feel: the thing you do most often paying less is felt every
    session, where a distant price is felt once. The income side moved a day later instead,
    and only where it was rewarding the wrong thing — the login ladder.
  - **Where the two passes leave it.** Login 18,000 a week plus a record; realistic play
    ~70,000 a week; maxing everything 215,600. So login is **20% of a realistic week, where
    it was ~47%**. The cheapest tag is about four days of realistic total income and the
    whole shop about 27 weeks of it.
  - **Caps are the anti-forgery defence, not the balance lever** — move the amounts, never the
    caps. Every one of these games runs in the browser and a win cannot be verified, so the
    cap is the only thing between a daily payout and a console loop.
  - Raising earnings cannot break The Draw: its 2,993-against-5,000 is a ratio between two
    Disc figures, so the sink holds whatever the faucet does. It *does* make the Collection
    cheaper in real terms — Views is now under two days of everything — and the divisor was
    deliberately left alone, because `collection.price` is both what a record cost and what it
    counts for, so re-pricing new buys without re-pricing stored rows makes net worth
    incoherent between them.
- **Bid War payouts are 3,000 / 1,500 / 800**, capped at three paid settlements a day
  (`..._20260915180000_bid_war_payouts.sql`). Exactly 100x the old 30/8/15, so the ratios are
  untouched — a loss is 27% of a win, a draw is half, and both were deliberate.
  - It stayed unscaled through four inflation passes for two reasons, and both had to be
    dealt with in the same file. `bid_war_submit` still has no `create or replace` since
    `20260907130000`, so the migration re-declares the whole of sealed-bid resolution —
    **extracted programmatically from that file and diffed against it, not retyped.**
  - **The cap is the real content.** There was none before, which was fine at 30 Discs and
    is not at 3,000: a war cannot be *forged*, but it can be *manufactured* — two accounts
    that follow each other create wars, both bid, split the proceeds. The number that makes
    three/day safe is that **collusion pays less than honest play**: a colluding pair
    extracts 3 × (3,000 + 800) = 11,400 between them, 5,700 each, against 30,800 each for
    simply playing the games. Preserve *that*, not "there is a cap" — a cap that leaves
    manufacturing profitable just sets the going rate for it.
  - `war_award()` is one atomic UPDATE with no explicit row lock, and `bid_war_submit`
    applies the two awards **in uuid order**, so two wars between the same pair settling at
    once serialise instead of deadlocking on each other's profiles. It shares
    `game_awards` / `game_awards_date` with `wallet_award_game` under the key `bidwar`;
    whichever runs first that day sets the date and the other merges.
  - **`bid_wars.initiator_award` / `opponent_award` record what was actually paid**, and the
    client renders that instead of the `oc === 'won' ? 30 : …` it used to hardcode. With a
    cap, inferring the payout from the outcome is not brittle, it is wrong — a capped player
    gets nothing and the old line announced 3,000. Same lesson as `login_last_date`: the
    server returns the field. Wars resolved before that migration carry null and get no Disc
    line rather than an invented one.
- **The sink is the Collection**, priced off stream counts, and album picks feed it. That is
  the same argument the album banner used to carry — every claim is a different object, so it
  cannot be finished. **If the Collection ever goes, this inflation loses its floor.**
- **The Draw is the other sink**, and only while its expected return stays under its cost.
  See The Draw.

### The album banner, and where its job went

Removed in `..._20260913220000`. Seven days used to pay a banner — pick a record, its cover
becomes your profile header, keyed `album:<cover url>` in `owned_banners`. Day seven pays the
*record* now, one `album_picks`, so the banner had no way in left. Gone with it:
`wallet_claim_album_banner`, the picker module, the `album:` branches in the profile header
and the Shop, and the Album Banner Pick boost. Outstanding `banner_picks` were converted to
album picks rather than voided; `album:` keys were stripped from `owned_banners` and un-equipped,
because an equipped one with no renderer is a blank header.

`profiles.banner_picks` still exists, zeroed and still pinned. Dropping a column on a live
table to save nothing is the worse trade.

## Discs (`view-rewards`)

Called **Discs** in the nav and the heading. The view id, the `views` entry in `setMode`,
`renderRewards` and every `rw-` class are all still `rewards` — renaming those buys nothing
and walks straight into the `setMode` trap below.

The seven-day login ladder, **The Draw itself**, and a door to The Shop. That is the whole page.

**The Draw lives here and nowhere else.** It was a card in Minigames *and* a fourth tab in
Collection, neither of which is the section named after the currency it spends — and it is not
a minigame, it is the currency's other half. The reel's markup sits inside `view-rewards` as a
**sibling of `#rewards-body`**, wrapped in `#draw-block`, because `renderRewards()` replaces
`#rewards-body`'s innerHTML and the reel module holds live references to `#draw-window` and
`#draw-strip` — rebuilding those underneath it mid-spin drops the strip on the floor. That is
the same reason it was a sibling of `#col-body` before it moved. `#draw-block` exists so the
heading and the reel hide together for a logged-out visitor, whose render returns early.

**It used to explain itself and no longer does.** There was a paragraph above the ladder, a
card describing the album banner, and a table listing every rate in the game. All of it was
true and all of it read as a manual — which is the wrong shape for a currency. Finding out
that answering a question on Today pays, or that the Draw is where Discs go, is the
interesting part, and printing it up front spends that discovery to save a sentence.

The ladder keeps its numbers, because they are the reason to come back tomorrow and **nobody
can discover a schedule**. That is the line: what you could not find out by playing stays on
the page; what you would enjoy finding out does not.

**The ladder is the claim, and it is the only one.** There were three Claim buttons for one
action: a bar above the ladder, a strip on Home, and the ladder itself. Both extras are gone.
They were not merely redundant — each was another place to get the state wrong, and the Home
strip did exactly that (below). The live day is a `<button>`, it glows, and pressing it takes
the day. The nav dot is the only thing that still advertises the claim from elsewhere, which
is all the Home strip was ever for.

### `login_last_date` was read in three places and written in none

Fixed in `..._20260914120000_login_returns_last_date.sql` plus the client half. Worth reading
before adding any field the client decides things with.

`claimedToday` — in the ladder, the nav dot and the old Home strip — compares
`Wallet.get().login_last_date` against today in UTC. Nothing ever put that value in the state
object: not the initial literal, not `load()`, and `wallet_daily_login` did not return it. So
it was `undefined` on every render since the feature shipped and **`claimedToday` was
permanently false**.

The symptom was not "nothing happens". It was worse than that: you press the live day, the
server pays, and because `login_streak` updates while `login_last_date` does not, the ladder
re-renders offering the **next** day. Press that and the server correctly answers
`claimed_already` and pays nothing — while the tile still animates. The first claim each day
worked; every press after it was theatre over a no-op, which is indistinguishable from a
broken button.

Three things to take from it:

- **A value read in three places and written in none should be impossible to miss, and was
  not**, because every symptom looked like a correct second press.
- The fix is the **server returning the field**, not the client inferring "it must be today".
  Inferring is exactly how `payFor()` drifted from the pay formula. `dailyLogin()` keeps a
  fallback for a new build against an old function, and it calls `reportIssue` when it fires
  rather than papering over the skew.
- The claim handler no longer bursts on `claimed_already`. Firing the confetti for a claim
  that paid nothing is the same lie in miniature.

The ladder also now draws what the server is *about* to do rather than what it last recorded:
a streak more than a day stale is shown as zero (mirroring `v_gap`), and a completed week with
today unclaimed shows an empty board with day one live rather than seven ticks and a glowing
day one contradicting each other.

- It is a `<button>` rather than a `<div>` only when it is live, so it needs `font: inherit`
  and `width: 100%` back — a button inherits neither.
- **The glow is the only affordance on the page that says "take this"**, so it stops the
  instant the tile is pressed (`.taking`). A re-render is a round trip away and a tile still
  pulsing after a tap reads as ignored.
- Day seven's `celebrate()` lives in `Wallet.dailyLogin()`, not at the two call sites, so the
  claim reads identically from the ladder and from the Home card. Day seven pays **no Discs**,
  so without it the biggest day is the only one that says nothing when you take it.

Two traps here:

- **`views` in `setMode` is an explicit map, not derived from the DOM.** Adding a nav button
  without adding the matching entry hides every section and shows a blank page.
- `LADDER` in the Discs module mirrors `v_ladder` in `wallet_daily_login()`. **Change one and
  you must change the other** — this is display only, the server is what pays. A third copy
  lived in `renderHomeClaim` and went with the Home strip.

## The Collection

Records you buy with Discs and keep (`..._20260913100000_collection.sql`, `view-collection`,
`api/collection-buy.js`, `api/collection-prices.js`).

**The distinction from Bid Wars is the whole design.** A war is a match: it starts, it
resolves, the records were never yours. This is a position you hold. Both read the same
valuation, so knowing what a record is worth pays off in two different games.

- **Not exclusive** — two people can own the same album. A one-owner-per-record version is a
  far sharper game, but it needs a way to take a record *off* somebody, and without that the
  first week permanently decides the standings.
- **Price is `streams / 250,000`.** Raw totals are unusable — Views is 12.81bn streams.
  Divided down it fits what people actually earn: Views 51,240 Discs (about two days of doing
  everything), In Rainbows 9,280, The Money Store 720. **Linear, not compressed, on purpose**:
  the hundred-to-one spread is what makes a famous record a target and an obscure one
  affordable, and a square-root curve would flatten exactly that.
  **The divisor moves with the economy and nothing enforces it** — 5,000,000 to 1,250,000 to
  250,000 across the 4x and 5x passes, each time in lockstep with a migration. Change the
  rates without it and every record goes either free or unbuyable.
- **The browser never names a price.** `/api/collection-buy` values the album itself and calls
  `collection_buy_from`, which is service-role only. Same rule as `wallet_buy` taking a key and
  never a cost — a client that could name its own price could buy a twelve-billion-stream
  record for one Disc.
- **Selling refunds 70%.** Churning has to cost something, or a net worth only measures how
  many times somebody has been round the loop. `collection_sell` takes no price: the refund is
  derived from the stored row, so it is safe to expose straight to a signed-in client.
- **The market page prices from the `album_plays` cache**, never inline. Twenty uncached
  albums would be twenty kworb fetches in one serverless invocation, which times out. Uncached
  rows show "price on request" and one tap values them.
- **Collections are publicly readable**, like ratings — other people seeing what you built is
  the point. There is **no INSERT or UPDATE policy at all**, so the only way in is the definer
  functions.
- `collection` is in `delete_my_data()`. See the note there: missing that line is how
  `app_state` survived account deletion for weeks.
### Completion is on the album page, and open

`primeCompletion` used to render a teaser with a **Show progress** button and load the
discography only when it was pressed. Nobody pressed it, because it sits under the tracklist
and below the fold. It draws itself now: what is left to rank by an artist you are already
looking at is the most actionable thing on that page.

It costs nothing to open — `fetchStudioAlbums` caches per artist in memory *and*
localStorage, so only the first visit to an artist is a request, and `openAlbum` has already
made one for the tracklist by then. A Spotify outage gates the page either way, so this adds
no new exposure to the `showGate` trap that caught `commitCall`.

**Every row carries the sleeve.** A discography as a column of titles is a spreadsheet; the
cover is how anybody recognises a record they have not got round to, and it is the thing the
list is asking them to go and rate. A rated row dims its art and ticks green, an unrated one
stays at full strength — so the gaps are what the eye lands on rather than the ticks.

### One free spin a day, items in full and Discs at a quarter

`profiles.spin_free_date` (`..._20260916140000_daily_free_spin.sql`), the same shape as
`login_last_date`. `wallet_spin` sets the cost to 0 and stamps the date in the same
transaction that grants the prize, so there is no window where a second call is also free,
and **the column is pinned** — without that line in `pin_profile_economy` a client clears the
date and spins free on every reload.

`spin_free_available()` exists only to label the button, and a database without the migration
answers with an error, which the client reads as "not free" rather than promising a free spin
it cannot deliver.

**The quarter is the whole design, not a compromise.** A straight free spin injects the
pool's full 2,993 daily — ~21,000 a week, more than the entire login ladder, and most of
what `..._20260915140000` had just removed from the income mix. So `v_share` scales the
**Disc** payouts only:

| | |
|---|---|
| a theme, banner, flair, frame, tag or album pick you do not own | whole |
| Discs, and the Disc consolation for a duplicate | a quarter |

**Items are sinks, not currency.** Handing somebody their first theme costs the economy
nothing and is the outcome that makes a free spin feel generous; the Disc rows are the dull
result nobody is playing for, so quartering them takes the money out of exactly the outcome
you would rather not land on. The jackpot survives as a real moment at 25,000 on a 0.3%
roll.

That lands it at **~456 Discs a day for a fresh account** (which wins items, not duplicates)
and **~748 for one that owns every drawable cosmetic** — 3,200–5,200 a week against ~70,000
for a realistic week of play, so about 5% of income rather than a quarter of it.

A **paid** spin is untouched: `v_share` is 1, the pool is the same, 2,993 against 5,000
still holds. The sink rule was never in danger — that rule is about what a paid spin returns
— but the faucet beside it was.

`v_pay` is computed once and used at all three places a Disc payout happens. **The picks
branch is deliberately left alone**: `amount` is a count of records there and not money, so
scaling it would quietly turn three free albums into one. There is a guard that fails the
migration if any raw `v_item.amount` is still being added to `discs`, because a single
missed site means that row pays full price on a free spin.

- **Album picks** (`profiles.album_picks`, Mythic only, three at a time) claim any record for
  nothing. `/api/collection-buy` takes `pick: true` and calls `collection_claim_pick_from`
  instead of `collection_buy_from` — the route decides *which function*, never whether the
  caller has a pick, which is checked in the function. The record is stored at its **real
  price**, because a free record worth nothing would make the prize one you would not want,
  and marked `via_pick` so it cannot be sold. See The Draw for why that restriction is
  load-bearing rather than flavour.

## Playing a track

The track number on every row of an album page is a button, and pressing it plays the
record **in VINALL** — a bar at the bottom with pause, a scrubber, next, previous and
lock-screen controls. `VinalPlayer` and `Play` at the bottom of `index.html`, plus
`api/preview.js`.

### There is no pause link, and that is why VINALL owns an `<audio>` element

The first version handed the record's URI to the operating system and let whatever
Spotify was running pick it up. **Verified end to end on Windows 2026-09-16** — with
Spotify not running at all, `spotify:track:19YKaevk2bce4odJkP5L22` cold-launched the app
and its window title became `Frank Ocean - Nikes`, which Spotify only shows once a track
is loaded and playing.

Then pause was asked for, and the honest answer is that **a `spotify:` link has exactly
one verb**. Fired at a live client, all of these did nothing at all:

`spotify:pause` · `spotify:playpause` · `spotify:app:pause` · `spotify:action:pause` ·
`spotify:internal:pause` · the same track twice (it plays, it does not toggle) · a bare
`spotify:` · `spotify:search:blonde` over a playing track (it kept playing)

Windows accepted every one, because Spotify claims the whole scheme. Spotify ignored
every one. The vocabulary is one word long and the word is *open this*. Do not go looking
for a second verb; it was looked for.

There is a second reason and it is worse: **VINALL cannot read Spotify's state either.**
Even given a pause link, the button would not know whether to show ▶ or ⏸ and would be
wrong about half the time. A pause button that might be a play button is worse than none.

So pause requires owning the sound. Everything else follows from that, including
`navigator.mediaSession`, which puts real controls on a phone's lock screen — something
no embed or iframe can do.

The alternative was Spotify's own `/me/player/*`, which does all of this perfectly **for
five people**. See the Development Mode note below.

### Nothing launches Spotify by itself, and that is the point

Launching the app **takes the whole screen**: Spotify raises its own window, and no web
page can stop it once the OS has the URI. There is no flag, no target and no timing trick
— the only way not to be thrown out of VINALL is not to throw.

So a track with no preview anywhere does not hand off. The bar goes into an **offer**
state — title, artist, and one button — and the listener decides. *Leaving VINALL should
always be something somebody chose, never a side effect of pressing play.*

### Deezer first, Apple second, and the numbers behind that order

| source | how | measured coverage |
|---|---|---|
| **Deezer** via `/api/preview` | one request per album, edge-cached a week | **100%** on Blonde, IGOR and In Rainbows |
| Apple iTunes Search | one client-side sweep, filtered on `collectionName` | In Rainbows 100%, Graduation 100%, Blonde 65%, **IGOR 17%** — ~70% overall |

Apple was first because it answers CORS and needs no key, so it could be called straight
from the page with no server at all. Its catalogue simply thins out on streaming-first
records, and 17% on IGOR is what forced the change.

Deezer sends **no CORS headers**, which is why `api/preview.js` exists. That is normally
the worse trade — every listener then shares one IP and one rate limit — except an
album's preview list is public, identical for everybody and effectively immutable, so it
is cached at the edge for a week. **Deezer is hit about once per album ever, not once per
listener.** A miss is cached too, for a day, or a record Deezer does not carry re-spends
the budget on every visitor.

Apple stays as the client-side fallback, so a dead route or a missing record still leaves
the browser able to find it alone. The route **never 500s into the player**: an empty list
means "try Apple", and a record that will not play is a row that offers the handoff. Both
are ordinary states.

Two things that cost time and should not be rediscovered:

- **`collectionName` is the guard against covers, and it is load-bearing.** A search for
  Tyler's EARFQUAKE returns a tribute act and a *lullaby rendition* above the original —
  and does not return the original at all. The Deezer route scores its album match for
  the same reason.
- **A per-track fallback was built, measured and deleted.** Across 53 tracks it recovered
  exactly **zero** that the album sweep had missed, at one request each. Anything a sweep
  cannot find, a narrower search cannot find either. Do not add it back without measuring.

The route returns **raw titles**, not a normalised map: the player already has a `norm()`
and matching it server-side would be two copies of one rule waiting to drift, the same
arrangement `LADDER` against `v_ladder` is written up to avoid.

Both Apple's and Deezer's terms want the clip kept beside a link back, so `#pb-src` names
whichever source served the audio. It is not decoration.

### The unlock timer was killing the track the same tap had started

The bar filled in correctly, the row lit up, the media session carried the right title,
and the audio sat at 0:00, paused. Every time.

`unlock()` primes a silent clip so iOS grants the element permission inside a real
gesture, then tidies up on a `setTimeout(0)`. `playIndex()` calls `unlock()` and sets the
genuine `src` a microtask later — so **the timer always landed after the real source**,
and its `pause()` + `removeAttribute('src')` stripped the track the very same press had
started. Not a race; guaranteed. The cleanup now runs only while the source is still the
silent clip.

Worth knowing how it was found, because everything downstream looked healthy: a fresh
`new Audio()` on the identical URL played first time, which ruled out autoplay policy,
the preview URLs, CORS and the whole resolution layer in one step.

### The player fills `listening_plays`

`..._20260916230000_listening_note_play.sql`. **Apply it by hand in the SQL editor**, like
the others.

That table was built for an import of the user's own Spotify data export, because Spotify
hands out no per-user listening data at any tier this app can reach. Almost nobody
requests an export — so `findRinsed` and `findAbandoned` have sat *first in `buildQueue`*
reading an empty table for most accounts since they shipped. Now that VINALL owns the
audio it can observe a play directly.

- **`listening_note_play()` takes no count.** It takes the track and adds exactly one
  play — the same rule as `wallet_buy` taking a key and never a price — and the migration
  has a guard that fails if the function ever grows a `plays` parameter. An upsert could
  not do this anyway: it *replaces* the row, so a browser would have to read-modify-write
  and lose a play whenever two devices overlapped.
- **Twenty of the thirty seconds counts.** A preview heard to the end is exactly Spotify's
  own 30-second definition and no more; a tap and a skip is not a play, and counting one
  would make "what have you been rinsing" mean the opposite of what it says.
- **Time is accumulated, not read off `currentTime`.** Dragging the scrubber to 0:25 buys
  nothing — a jump shows up as a gap bigger than a tick and is discarded — and the real
  listened milliseconds are sent, never a flat 30,000.
- **`source` is left alone on an existing row** and set to `'vinall'` only on insert, so an
  imported history is never quietly relabelled. `album` and `track_uri` fill a gap and
  never overwrite: the import carries better metadata than a preview lookup does.
- **The key is built in the listening module, not the player.** `k` is that module's rule
  (it mirrors `normTitle` in `api/_streams.js`) and a second copy of it next to the audio
  code is a second copy to drift. The player calls `VinalListening.noteListen()` and knows
  nothing about keys.
- A failed RPC is reported through `reportIssue` **once per session**, not per track:
  the usual cause is the migration not being applied yet, which is the normal state on
  this project, and a handled error with no report at all is worse than an unhandled one.

### A custom-scheme navigation fails silently, so nothing may claim success

If Spotify is not installed, firing `spotify:track:` does **absolutely nothing** — no
error, no event, no rejected promise. So the handoff never says "playing". It watches for
the page to lose focus (`blur`, `pagehide`, `visibilitychange`), because an app coming
forward is the only evidence available, and after 1.4s with none of them it offers the
web player.

**That offer is worded as a question and must stay that way.** Losing focus is evidence an
app came forward, never proof that none did: Spotify *already running* can take the URI
and start playing without raising a window, and the panel would then appear over a track
that is audibly playing. "Didn't open?" is harmless when wrong. "No Spotify app answered",
which shipped first, is a lie in the register this file keeps warning about.

Desktop autoplay is **not guaranteed** either — one test run opened Spotify and left it
idle on "Spotify Premium". Usually it plays; occasionally it just opens the app.

### Why a player at all, rather than Spotify's

This app is in Spotify's **Development Mode**, capped at **five authorised users** since
February 2026, with Extended Quota gated behind a registered business at 250k MAU. The cap
is visible in this repo — probing the live API through `/api/app-token`:

| | |
|---|---|
| `/albums/{id}`, `/albums/{id}/tracks`, `/artists/{id}`, `/artists/{id}/albums`, `/tracks/{id}` | 200 |
| `/search?limit=10` | 200 |
| `/search?limit=20` | **400 Invalid limit** |
| `GET /albums?ids=` (batch), `/artists/{id}/top-tracks` | **403 Forbidden** |
| `popularity`, `available_markets` | **gone** |

So the note under Daily Drop — "search limit **10** — anything larger is a 400" — is not a
Spotify quirk somebody found, it is the February 2026 restriction, and VINALL survives
that migration only because it fetches single items everywhere. Two other things came with
it: the app owner must hold active Premium or the whole app stops, and refresh tokens now
expire **six months from original consent** rather than from last refresh.

Neither the player nor the handoff touches any of it.

### Structure

- `#player-bar` is a **direct child of `<body>`**, a sibling of every view. The album page
  rebuilds its `innerHTML` constantly and a player inside it would be destroyed mid-note —
  the `#draw-block` rule again. `z-index` 160, under the modals.
- A row only knows its **index**; the player holds the record. Re-rendering the list
  cannot strand the queue that is playing.
- The click handler is delegated on `document`, so `renderTracks()` re-wires nothing.
- One `<audio>`, created once and reused forever. iOS will not let a *new* element play
  outside a gesture.
- `next`/`prev` skip past unplayable tracks via `seekPlayable` rather than stopping dead.
- Nothing is marked as unplayable until the sweep lands: "no preview" and "not looked yet"
  are different claims.
- `.song-row .idx` sets `width: 24px` and outranks a bare `button.idx`, so the circle
  first shipped as a 24×26 oval. Restated at matching specificity. Measure the rendered
  box, not the rule.

## Settings

A modal off the account menu (`openSettings`), holding **Motion**, a **clear-cached-data**
button, **log out** and **delete account**, and the Privacy/Terms links.

The line that decides what belongs here rather than in the Shop: **a preference or an account
action, never a thing you own.** Motion was in the Shop only because the Shop was the one modal
that existed, which made a display preference look like something you might have to buy — and
it forced the Shop to open for logged-out visitors purely so they could reach it. The Shop needs
an account again; Settings is the modal that opens for anybody, with the account group hidden
when nobody is signed in.

The gear is in the account dropdown when signed in and next to Log in when not, because Motion
is exactly the control somebody should not have to sign up to reach.

**Clear cached app data** sends the `vinall-sw-purge` message `sw.js` listens for, deletes every
Cache Storage entry, and reloads with a cache-busted URL. It exists because the service worker
is network-first but not never-stale, and when a stale shell does get served there is otherwise
no way out from inside the app — "open the console and post a message" is not a fix a user can
perform. The reload is cache-busted on purpose: the reason you pressed it is that a normal
reload gave you the stale thing.

## The Shop

Six kinds of thing now, five of them owned and one repeatable
(`..._20260913180000_mythic_tags_and_shop.sql`). Prices live in `shop_items` and are read into
the client maps by `loadPrices()` — **the `cost` written beside each item in `index.html` is a
fallback, not the price.** They drifted apart once already when the 4x inflation moved the
rows and not the duplicates, and the Shop offered Sundown at 150 while `wallet_buy` charged
600.

- **Producer tags** — a stamped chip under your username, `owned_tags` / `active_tag`.
  **Thirty, all real**, 21,000 to 1,000,000, and **4,381,000 for the lot**
  (`..._20260916090000_thirty_tags.sql`). Seven invented "house" ones (STRAIGHT OUT THE
  CRATE, NO SKIPS, PROMO USE ONLY…) were written to fill the cheap end and removed in
  `..._20260914090000`: the whole appeal of a producer tag is recognition, and an invented
  one has none to offer. Anyone holding one was **refunded from `shop_items` before the row
  was deleted** — do it in that order or the price is unrecoverable.
  - Prices are **set one by one, not multiplied**, which is why the cheapest came *down*
    from 48,000 to 21,000 while the top went to 1,000,000. The entry price decides whether a
    tag is a thing anybody ever owns and four days of play for the cheapest was too much.
  - **I GOT TOO MUCH PROFIT at 1,000,000 is 3.3x the next most expensive thing in the app.**
    It is set from the list as given; if it was meant to be 100,000 it is one line in that
    migration and one in `TAGS`.
  - Renaming a tag **keeps the key**, always: a key is what `shop_items`, `owned_tags` and
    `active_tag` hold, so changing one orphans everybody who owns it. `fuckumean` is the
    standing example — the chip says FUKUMEAN and the key never will. Three more were
    relabelled that way (`taykeith`, `metro`, `pluh`).
  - **Two older guards now read false on purpose.** `..._20260914090000` asserts exactly
    nineteen tags, and `..._20260915100000` is sentinelled on metro costing 16,000 or
    192,000 — it is 120,000 now. Both refuse rather than doing the wrong thing, which is the
    behaviour those guards exist for, but they are where a `supabase db push` would stop.
  - **These are deliberately not `profiles.badges`.** That column holds status markers — CEO,
    OG, Beta Tester, Verified — which are *awarded*. Putting bought items in the same array
    would make Verified purchasable, which is the one thing a verification marker can never be.
  - **No `desc`.** A tag is three words on a chip; a line explaining it underneath is
    explaining the joke. `shopItemRow` drops the element entirely when desc is empty rather
    than rendering a blank one.
  - **Each has its own two colours and one of three motions**, from `TAG_STYLE`. The colours
    ride in as `--t1`/`--t2` custom properties and the motion is a class (`sweep`, `pulse`,
    `flicker`), so nineteen distinct chips cost one CSS block rather than nineteen keyframes.
    One gold chip for all of them read as a label rather than as the thing somebody spent
    16,000 Discs on.
  - The section is called **Tags** in the Shop, not "Producer tags".

### Levels are Discs, and level 200 is the ceiling

`profiles.lifetime_xp` is commented "every Disc ever earned" and means it literally:
`pin_profile_economy` adds every *rise* in the balance to it and never subtracts. **XP is not a
second currency, it is the running total of the first one.** Spending cannot lower it, and
there is no separate lifetime column because this is it.

Two consequences worth knowing:

- **Any server-side Disc grant pumps it, including an admin top-up from the SQL editor.** The
  editor runs as `postgres`, so `current_user <> 'authenticated'` and the XP branch fires. A
  top-up that should not count as progress has to restore `lifetime_xp` in the same
  transaction — lowering it is not a rise, so the trigger does not fight the restore.
- **`level_for_xp` caps at 200**, mirrored by `MAX_LEVEL` in the Wallet module. Change one and
  you must change the other, same arrangement as `LADDER` and `payFor`.

At the cap `into / step` stops meaning anything: XP keeps accruing past a floor with nothing
above it, so the Home tile rendered `11,397,658 / 102,287` — a fraction over eleven thousand
percent — under a bar silently clamped at 100%. `levelInfo()` returns `max` now and the tile
says "Max level". **Anything that says "progress towards" has to know when there is nothing
left to progress towards**, and a clamp is not that: it hides the condition instead of
reporting it.

Level gates nothing anywhere — it is display-only in three places (the Home tile, the
Collection standings row, and the `levelUp()` pop).

### Scrolling gradients must travel in pixels, not percentages

Applies to `tagSweep`, `flShift` (Holographic), `drawShimmer` and `dtPrism` — every animation
in the app that loops a gradient through itself. All four shipped broken and all four looked
the same way: the rainbow reaches the end and visibly snaps back to the start.

`background-position: 260%` **does not mean "shift by 260% of the width"**. Percentage
positioning aligns a *point of the image* to a *point of the box*, so with an image 2.6× the
box the travel is `(W − 2.6W) × 2.6 ≈ −4.2W` — a distance with no relationship to the
gradient's own period. Frame 0 and frame 1 are therefore different images, and the jump between
them is the glitch.

A pixel tile is exact: size the gradient to N pixels, let it repeat (the default), translate by
exactly N. Two conditions on the gradient itself, or a tiling seam replaces the snap:

- first and last colour stops identical, and
- the angle **90deg** — a 100deg gradient tiled horizontally meets itself on a diagonal.

Only the *scrolling* variant gets the tile. The still ones (`fl-foil`, `fl-chrome`, `fl-bleed`,
and pulse/flicker tags) take `100% 100%` so the palette spans the word once, instead of showing
one slice of an oversized gradient — which on a short tag like "21" was a single flat colour.

`titleShine` and `shineSweep` are unaffected: they ping-pong 0% → 100% → 0%, so they return to
where they started whatever the percentages resolve to.
  - `tagChipHtml()` is shared by the profile header and the Shop swatch, so **what you buy is
    what you saw**. Themes got this wrong for months: the shop swatch and the real theme were
    separately invented and drifted.
  - The Mythic tag prize draws straight from `shop_items where kind='tag'`, so adding or
    removing a tag needs no second edit to the prize pool.
- **Name flair** — a paint job on the username, `owned_flairs` / `active_flair`. No size
  change and no layout change, deliberately: a cosmetic that moves the profile header around
  is a cosmetic that breaks somebody else's page.
- **Avatar frames** — `owned_frames` / `active_frame`, drawn on a `.pa-wrap` wrapper rather
  than on the `<img>`, which already uses its own border and box-shadow. Card Sleeve is a
  border rather than a filled panel behind the avatar: a filled `::before` needs `z-index:-1`
  to sit behind its own wrapper, and that only holds while nothing up the tree creates a
  stacking context.
- **Boosts** — `kind = 'boost'`, bought and never owned, so it can be bought again and again.
  **This is the Shop's floor.** Every cosmetic can be finished; an account that owns all of
  them has nowhere left to put Discs, and a currency with nowhere to go stops being a
  currency. Streak Freeze is the only one left (Album Banner Pick went with the banner), and
  it tops up an entitlement that already exists rather than inventing one. **Nothing here
  raises a daily cap** — caps are the anti-forgery defence for the minigames, not a balance
  lever, and selling a way round one would be selling a way to forge awards.
- Themes and banners, unchanged.

Tags, flair and frames are three copies of one shape, so they share `buyCosmetic` /
`equipCosmetic` and one `cosmeticRows()` renderer keyed on `OWN_KEY` / `ACT_KEY`. Themes and
banners keep their own pair because a theme also repaints the app and a banner has the
`album:` special case.

**Sections are `<details>` and none of them open.** Thirteen rows became nearly fifty, and
fifty rows in a 92vh modal buries the Motion setting under all of them — which matters,
because Motion is the one control in the Shop a logged-out visitor can actually use. Producer
tags opened by default at first; nineteen rows unfolding on open put the scroll straight back,
and picked a favourite besides. Which section is open is not remembered between opens on
purpose: a shop resets to its front window.

**A purchase keeps your place.** `renderShop()` rebuilds the whole list, so buying a tag used to
collapse every section and throw you back to the shop front — you bought one thing and then had
to walk back to where you were standing to buy the next. The open section titles and the panel's
`scrollTop` are read at the top of the render and put back at the bottom, after the sections
exist again so the scroll is not clamped against a collapsed list. Restoring is not the same as
skipping the re-render: the row still has to redraw to say Equipped instead of Buy.

**Buying draws a stamp, it does not throw confetti.** `stampBought()` sweeps a light across the
row while the request is in flight, then draws a ring and a tick onto it and says *Purchased*.
Deliberately unlike `burst()`, which in this app means a **win** — a Mythic, a tournament,
seven days running. A purchase is a transaction clearing, not a win, and reusing the win
animation would flatten both: if everything celebrates, nothing does. It is the only animation
in VINALL that draws a line rather than throwing particles.

All four kinds buy through one `doBuy()` helper rather than four copies of the same handler,
because the version with four copies is the version where the animation is on three of them.
The dash lengths in the stamp CSS are the measured path lengths (2πr ≈ 94.2, tick ≈ 22) —
guessing them leaves a visible stub at the end of the draw.

**A first one is equipped automatically** when it comes out of The Draw and the slot is empty.
Winning a producer tag and seeing nothing change anywhere is how a prize becomes a line of
text. Only when the slot is empty — overwriting something you chose would be worse than doing
nothing.

The profile header validates `active_tag` against the `TAGS` map rather than printing what is
stored. It cannot currently be anything else, since the pin trigger only accepts a key the
account owns — but it is the one place in the app where a stored string is rendered at size,
and "it can only be a known key" is exactly the assumption that stops being true the day
somebody writes an admin grant.

## The Draw

A case-opening reel bought with Discs, a pane inside Collection
(`..._20260911230000_the_draw.sql`, then `..._20260913140000_rarities_and_inflation.sql`,
now `..._20260913180000_mythic_tags_and_shop.sql`). Own module near the bottom of
`index.html`.

**It is not gambling, and the distance is load-bearing:**

- Discs **cannot be bought**. Earned only, no purchase path, and `terms.html` already says so.
- Nothing it awards has cash value or leaves the app.

**If a way to buy Discs for money is ever added, this becomes a regulated gambling product in
the UK and elsewhere. Take advice before doing that** — and published odds stop being a
courtesy at that point and become a legal requirement.

### The rarities, and the odds panel that used to publish them

Five tiers, renamed for the third time and now named the way everybody else names them:
**Common 30% / Rare 25% / Epic 20% / Legendary 15% / Mythic 10%**. Weights sum to 1000, so the
percentages are exact rather than rounded.

The previous set (Bargain Bin / B-Side / Deep Cut / White Label / Holy Grail) read better and
**nobody could rank it on sight**, which is most of what a rarity name is for. Colour follows
the same ladder: grey, cyan, violet, gold, and Mythic prismatic — Mythic had to differ *in
kind* from Legendary rather than in brightness, because gold was already the top of the old
ladder.

**The on-page odds panel and the paragraph above the reel were both removed** at the owner's
request. `spin_items` still has a public select policy and the server still walks those exact
weights, so the numbers did not stop being true — they stopped being printed. Two things
before that stays gone for good: Apple's guideline 3.1.1 wants published odds for anything
loot-box shaped, so an App Store submission needs the panel back (it read from `loadItems()`
and nothing else, so restoring it is small), and see the paragraph above about paid Discs.

### Mythic, and why the spin costs 5,000

Mythic is exactly three things: **100,000 Discs** (0.3% absolute — one spin in 333),
**3 albums of your choice** (3.4%), and **a producer tag** (6%, a random one you do not own).
Legendary carries **1 album of your choice**, so picks run 1 at Legendary and 3 at Mythic.

The whole pool's expected return is **~2,993 Discs against a 5,000 cost**, computed for the
worst case — somebody who owns every drawable cosmetic and therefore converts every duplicate
to Discs. That margin is the safety property, and it is the reason the earning rates can be as
inflated as they are. **An economy whose only sink pays out more than it takes is not a sink,
it is a printer.** Before changing any weight, any `amount`, or `v_cost`, redo the sum; it is
written out line by line at the top of `..._20260915100000_harder_progression.sql`, **and
that file now also recomputes it from the table and refuses to apply if it ever reaches the
cost** — the rule is enforced by the database rather than by a comment somebody has to
remember to read.

**Mythic is the only tier `..._20260915100000` did not multiply.** Every other prize went up
5x with the cost, which would have held the old 0.89 ratio exactly; leaving Mythic alone is
what drops it to **0.599**, because 360 of the old 886.6 lived there. The jackpot at 5x would
be 500,000 and worth 300 of expected return on its own, which would have undone the pass.

**A duplicate pays 20% of its shop price, not all of it.** A 5,000-Disc spin cannot hand back
a 30,000-Disc theme's worth of Discs thirty times in a hundred and stay a sink. Cosmetic
`amount`s and cosmetic shop prices have gone up together at every pass, so the fifth holds
exactly — 1,600/8,000, 3,500/17,500, 4,500/22,500.

**Tags now break that rule and it is deliberate.** They went up 12x while the Mythic tag
prize's `amount` stayed at 1,000, so a duplicate tag pays about 2% of the cheapest tag. The
consequence, stated rather than discovered: **once somebody owns all nineteen tags, Mythic's
most likely outcome pays 1,000 Discs against a 5,000 spin.** That is a bad moment and it is a
long way off — all nineteen is 1,770,000 Discs of buying — but it is the number to raise when
anyone gets close, and each 1,000 added costs the pool 60 of expected return, which 0.599
absorbs easily.

That sum is also why **a record claimed with an album pick cannot be sold**. At the 70%
refund, free records are pure arbitrage, and enough of it flips the pool from a sink to a
faucet. `collection.via_pick` marks them and `collection_sell` refuses them.

**The tag prize has no fixed `ref`.** It grants a random tag you do not own yet, drawn from the
same `shop_items` rows you could buy, so the strip tile says "Producer tag" and only the result
says which one — hence `granted` alongside `label` in what `wallet_spin` returns. Own them all
and it pays its price back in Discs like any other duplicate.

`wallet_spin()` charges, rolls weighted, grants and returns. **The browser is told what it won
and never asked** — the animation is theatre played out after the result already exists, the
same relationship the Bid War reveal has with `bid_war_submit`. Duplicates pay their shop
price back in Discs, which is the only thing keeping the rare tiers worth landing on once you
own them.

The motion, since it is the whole feature and is easy to ruin:

- One strip, one transform, one transition. No per-frame JS, no per-tile animation — it holds
  60fps on a phone.
- 70 tiles with the prize at index 62. **Landing on tile 62 rather than tile 3 is what makes
  it read as spun rather than picked.**
- **Every rarity goes past on every spin**, via `SEED_PLAN` — one of each tier dropped at
  fixed positions, clustered toward the end so the run gets visibly more valuable as it
  slows. Left to pure weighting the strip is mostly grey, and most spins showed nothing to
  react to on the way down. This is theatre and it is honest theatre: **what goes past has no
  bearing on what you get**, which the server decided before the strip was built. `SEED_PLAN`
  never writes at or past `WIN_INDEX`.
- Each rarity owns a vibrant colour — cyan, violet, gold, prismatic — driving the tile, the
  result text, the landing glow and the window border. **Common stays grey on purpose**: a
  strip where everything glows is a strip where nothing does.
- **The result handler must not call `renderCollection()`.** The Draw is a pane inside
  Collection, so that call re-enters `render()`, hits the `tab === 'draw'` branch and runs
  `resetStrip()` — wiping the result you are still looking at. Winning album picks therefore
  does not refresh the Market; the Market reads `album_picks` from Wallet state when you
  switch to it, which `applyWallet()` has already updated.
- The stop is **jittered a few pixels off centre**. Stopping perfectly centred twice running
  reads as mechanical.
- `cubic-bezier(.12,.72,.12,1)` — long, late deceleration. Linear feels like a slot machine
  cheating; too soft and it never felt like it was moving.
- `TILE` in the module must match the tile width plus margins in the CSS. They are two
  numbers that have to agree and nothing enforces it.

### The pin trigger's escape hatch must be `current_user`, not the JWT

Fixed in `..._20260909160000_fix_economy_pin.sql`. Worth reading before touching any pin
trigger, because the broken version looked completely reasonable.

`pin_profile_economy` originally let legitimate writes through with
`if auth.role() is distinct from 'authenticated'`, commented "the wallet functions all pass
straight through". They did not. **`auth.role()` reads the request's JWT claim from a
request-scoped GUC, and `security definer` does not change that** — it changes the executing
role. So inside `wallet_record_rating()` the claim was still `authenticated`, the guard never
fired, and the trigger reverted the award with `new.discs := old.discs`.

Every server-side economy write was being silently undone: `wallet_record_rating`,
`wallet_buy`, `award_lore_disc` and the `bid_war_submit` payouts. **The Discs economy was
inert for every non-admin user from the day it went server-side.**

Two things hid it for days, and both are worth remembering:

- `wallet_record_rating` returns `earned` from a local variable but `discs` from
  `returning *` — the row *after* triggers. So the client toasted "+3 Discs" next to a number
  that never moved, and the RPC reported success.
- The only person likely to notice was an admin, and an admin's balance renders as the
  literal `∞` regardless of what is stored. **The admin view hid the bug from the one person
  looking for it.** Be wary of any admin short-circuit that replaces a real value with a
  symbol.

`current_user` is the boundary that actually exists: PostgREST issues `SET LOCAL ROLE` per
request, so a client write arrives as `authenticated`, while inside a definer function it is
the function's owner, and the SQL editor and `service_role` are neither. The transaction-local
flag in `..._groove_roles.sql` (`vinall.role_ok`) is the other correct answer. **Any check
based on the JWT is wrong by construction, because the JWT is identical on both sides of a
definer boundary.**

Nothing was back-paid, deliberately — the award counters were reverted by the same trigger, so
there is no record of what anyone would have earned, and reconstructing it from row counts
would ignore the daily caps. The fix migration ends with a commented one-off grant if you want
to make good as an explicit decision.

Client side, `recordRating()` now reports through `window.reportIssue()` both when the RPC
errors and when `earned > 0` while the balance does not move — the second is the exact
signature of a reverted server write, and it lands in `client_errors` where the admin panel
shows it. `if (res.error) return;` is how this stayed invisible; **a handled error with no
report is worse than an unhandled one**, because an exception at least reaches a console.

That gap where a `groove_members` row could be updated by its own member — including their
role — is closed. See Groove roles below.

## Daily Drop

One album puzzle and one song puzzle a day, six guesses each, scored Wordle-style across
five attributes. Client code is one IIFE near the bottom of `index.html`
(`window.openDailyDrop`); there is no schema and no server route.

Two invariants hold it together. Breaking either is how the first version broke:

- **Every attribute is static data, baked into `ALBUM_ROWS` / `SONG_ROWS` in that IIFE.**
  Nothing is looked up at play time, so the game needs no token, works offline, scores
  instantly and scores the same on every device. The previous version resolved the answer
  through Spotify search on each load, which failed twice over: Spotify stopped returning
  `popularity`, so the tie-break that chose between a 1971 master, a 1997 compilation cut
  and a 2021 remix silently became "whatever came back first", and the day's answer then
  differed between loads. Rows replayed from localStorage were re-scored against a
  different record than the one they were played against, which is how a board ends up
  self-contradictory — one guess green on Length and a closer one grey. Two concurrent
  loads (flip Album/Song mid-fetch) could also interleave rows from both answers into the
  same list.
- **You guess from the same list the answer is drawn from**, searched locally. Searching
  the whole of Spotify while the answer came from a hidden hundred is not difficulty, it is
  a raffle: no clue can eliminate anything, because the candidate set is unbounded. With a
  closed list the board narrows, and the status line prints how many records still fit
  every clue on screen — computed by re-scoring each candidate through the same
  `scoreGuess`, so it can never promise a candidate the board contradicts.

The rest:

- **`render()` is synchronous and rebuilds everything from storage.** There is no in-flight
  state, so switching mode, reopening, and reloading all land in the same place, and the
  old race cannot come back.
- **Genres are curated, not fetched.** Twelve buckets, one per artist with a few per-record
  overrides. Apple's `primaryGenreName` is what the app uses elsewhere, but it is missing
  for streaming-only records, erratic across one artist's catalogue, and a game needs the
  same buckets every day for a green Genre tile to mean anything. `FAMILIES` groups
  neighbouring buckets so Rock against Alternative reads amber rather than a flat no.
- **The day's pick is a seeded shuffle indexed by day number**, not `hash(date) % length`:
  the modulo version can repeat a record within a fortnight, a shuffled cycle plays the
  whole list first. Both halves are pure, so every device agrees without a server.
- **Storage keys are `vinal_drop2_<mode>_<date>`.** The v1 keys held Spotify ids and mean
  nothing to this version.
- Two free hints, on a timer rather than a button (decade after three guesses, first letter
  and word count after five) — being stuck with no way forward is a dead end, not
  difficulty, and nobody should have to decide whether taking a hint is cheating.
- **Column widths are weighted, and the song board swaps columns 4 and 5.** Five equal
  columns do not survive a 375px phone: the two prose columns (Artist, Genre) need more
  than the small integers, and the wide numeric value is Runtime for albums but Length for
  songs. Sizes step down by the *longest single word*, not the whole string, because that
  word is what has to fit on one line.
- `baseName`, `collapseEditions` and the iTunes `artistGenre` lookup used to live in this
  module and are still used by Earworm and the diary; they moved to their own IIFE
  underneath it and still export as `window.VinalTitles` / `window.VinalGenre`.

Refreshing the baked data means re-resolving each pool entry against Spotify (search limit
**10** — anything larger is a 400) for year, track count, runtime, duration and track
number, then spot-checking: a song that lands on a greatest-hits package or a box set takes
the compilation's year and track number, and an album that exists only as a later remaster
takes the remaster's year.

Finishing a guess buzzes, and a win pays through `Wallet.awardGame('drop')` and
`notePlay('drop')` like every other game — never `awardDiscs`, which now reports itself as
an issue.

## Earworm

The other half of the Daily Drop: that one asks you to deduce a record from its
attributes, this one gives you the record's shape and asks you to spell it. The answer is
the TITLE of a famous album or song stripped to letters, the board is as wide as that
title rather than a fixed five, and six rows score like the game everyone already knows.
One IIFE in `index.html` (`window.openEarworm`), no schema, no server route.

Same two invariants as the Drop, for the same reasons:

- **The pool is static**, baked into `EW_ROWS` as title / artist / kind / genre / art.
  Genre and artwork are lifted from the Drop's table wherever the same record appears in
  both, so the two games label a record identically and neither needs the network. The
  previous version awaited an iTunes genre lookup *before drawing the board at all*: a
  measured 4.2s of empty "Loading…" on open, six when Apple was slow (that is the abort
  timeout), a blank Genre clue whenever it timed out, and a silently dead keyboard on top
  of the previous puzzle for the whole of that time whenever you switched mode. Two loads
  could also be in flight at once, and the one that resolved last won regardless of which
  mode was selected. `ewLoadAnswer()` is synchronous now and none of that is reachable.
- **A library pick is the one record with no baked genre** (it came out of your own
  crate, not the list). That clue is filled in afterwards if `VinalGenre` answers, guarded
  by a token so a late reply cannot paint a puzzle that has moved on — it never blocks the
  board.

What makes it playable:

- **The board draws the word shape**, and the clue row says it out loud ("11 letters",
  "5 + 2 + 4"). Forty-five per cent of these titles are more than one word, and as an
  unbroken run of letters "OKCOMPUTER" and "THANKUNEXT" are not puzzles, they are anagram
  homework. Measured over the pool, adding the shape takes the records sharing a clue set
  from a median of 14 down to 4.
- **There is deliberately no "how many still fit" counter**, unlike the Drop. Measured:
  kind + genre + word shape already leaves a median of **1** candidate, so the number
  would read "1 of 140" before you had typed anything — it would announce that the answer
  is pinned down without telling you which record it is. The Drop can show its count
  because you pick from a list you can see; here the list is invisible and the count would
  be a solver, not a progress bar.
- Word breaks are their own fixed grid tracks (`--ew-wordgap`) with an empty `.ew-gap` in
  each, so every letter stays exactly `1fr` and the gaps cost the cells nothing in
  evenness. At 375px the worst case — eleven letters in three words — still lands on 24px
  cells, the same size they were before the shape existed, because the panel gives back
  its side padding there.
- **No dictionary check.** Titles are not words and rejecting "SICKOMODE" for not being in
  a word list would be absurd; length is the only rule, and a short guess is refused with
  a shake rather than silently ignored or spent.
- The daily pick is a seeded shuffle indexed by day number, so the list plays through
  before anything repeats, and storage moved to `vinal_earworm2_<date>` — the v1 key
  belongs to a pool with no genre or artwork and a different pick for any given date.
- `ew-card-status` had been in the markup since the game shipped with nothing ever writing
  to it. It now carries today's result on the Minigames card, like the Drop's — though
neither was actually visible until the `.gc-best` selector was scoped. See **The status
line on the card** under Cover Fire.

The card is gated on three rated albums (see the unlock gates), so `window.openEarworm()`
opens it in a fresh browser where clicking the card will not.

## Cover Fire

Ten sleeves, about a minute a go. Three ways to play and one engine underneath:
**Today's Ten**, solo, and head to head against somebody you follow.

**It was called Album Blitz and the rename is display only.** Every id, table,
RPC, award key, notification type and localStorage key is still `blitz` —
`blitz_matches`, `wallet_award_game('blitz')`, `crate_blitz_daily`, the lot. A key
is what the server, the wallet and everybody's saved state hold, and renaming one
orphans all three; the producer tags make the same point from the other end, where
the chip says FUKUMEAN and the key never will. The display name lives in one
constant, `NAME`, which the share line reads from so anything a person copies out
cannot drift from the heading above it.
`..._20260916180000_album_blitz.sql`, plus the `Blitz` module (questions) and the
lobby/run IIFE under it in `index.html`.

**It creates no new music data.** Every question is generated from `ALBUM_ROWS` and
`SONG_ROWS` — the static tables the Daily Drop already bakes in, now exported as
`window.VinalPool` rather than copied. They carry title, artist, year, genre, track count
and runtime for albums, and for songs the album they are off *and that album's artwork*,
which is what makes the song-to-album round a wall of real sleeves rather than a list of
titles. No token, works offline, scores instantly.

**It is not Higher or Lower.** That asks which of *your* records has more streams and it
keeps that. Blitz asks about records everybody knows, from a shared list, so two people can
be asked the same question — which a game drawn from a personal crate can never do.

### Ten fixed rounds, no lives

Sudden death is the obvious shape for a fast quiz and the wrong one here: if a match ends
when you miss, two players answer a different number of questions and the scores stop being
comparable. **A fixed ten is what makes "2,400 to 2,050" mean anything.** A miss costs the
streak instead, which is where all the points are.

Nine question kinds — first/latest, most/fewest tracks, longest, by-this-artist,
this-song's-album, genre, year. **No kind appears more than twice in a match**: without
that cap a ten-round match could ask "which one is by X" four times, every question
technically different and the match still repetitive, because what people notice is the
*shape* of the question and not the records in it.

### Today's Ten

Everybody gets the same ten, seeded by day number, **one go**. That is the whole Wordle
trade, and the cap is the half that makes it work: "2,450" means nothing if the other
person could sit there until they got it.

It is called Today’s Ten rather than Today’s Cover Fire: the copy beside it
already says "same ten for everybody", and the long form does not fit a chip next to
two other buttons.

`dailySeed()` runs the day number through a multiply-and-xor rather than using it raw, so
today's daily is not the ten questions a solo run would build from the same number.

**The one go is only as good as its storage, so `crate_blitz_daily` is in `SYNC_KEYS`.**
Without that the cap was one device deep — the same ten were a fresh attempt on a phone,
which is exactly what a shared score is supposed to rule out. It needed a merge rule of
its own, like every other key there: a newer `day` supersedes, and on the **same** day the
**earlier** attempt wins, because the first go is the honest one and taking the later would
turn a second device into a retry. Same direction as the Earworm best taking the smaller
row count. Records written before `at` existed have none, read as 0 and therefore win —
which is right, since they were written before anything carrying a stamp.

A determined person can still clear their own storage. That is fine and is not worth
defending against: there is no payout difference between the three modes and nobody else's
score is affected.

**The share text is spoiler-free.** A row of filled and empty circles says how you did and
never which records came up:

```
Cover Fire #2449 — 1,163
○●●●○●●○○●  6/10
wildcrate.xyz
```

`marks[]` is pushed one per round in `answer()` and reset in `begin()`.

**A rejected `writeText` escapes the `try` around it**, so every clipboard call in the app
carries its own `.catch` now — the Blitz share, the Earworm share, the Daily Drop share, the
profile link and the Groove join link. A clipboard write is refused by *rejecting*, not by
throwing (no permission, not a user gesture, insecure context), so the surrounding code sees
nothing and the button cheerfully says "Copied" over an empty clipboard. Four of the five
were written that way.

### The multiplier is the game

100 for right, up to 100 more for speed, all times a streak multiplier stepping 1 / 1.5 /
2 / 3 at three, five and eight in a row. **A flawless run is exactly 3,600** and the back
half is worth more than double the front, so a miss at round nine costs far more than one
at round two — which is what makes the last three rounds tense rather than a formality.

Escalation runs on three dials at once and none is announced: choices 2 → 3 → 4, clock
7s → 6s → 5s, and comparisons narrowing from decades apart to a year or two (`tight`).
Difficulty you feel and cannot read is the kind people keep playing.

### RISK, and the one decision in the run

Streaks and a multiplier are not risk and reward. They are reward with a *tax* on
failure: the ladder climbs by itself and a miss knocks it down, and at no point
does the player choose anything. There was no decision anywhere in the run.

**RISK is one tap, once per run.** Arm it during a round (the chip, or `R`) and
that round doubles if you get it right, and costs you `100 x multiplier` if you
do not — on top of the streak you were going to lose anyway.

The interesting part is not the double, it is **when**. Spend it at round two and
it is nearly free and worth about 200. Hold it to round ten at a nine-streak and
it is worth 600 — but you are spending it on four choices and five seconds, with
the whole run behind it. That decision is available from the first round and gets
more expensive to keep putting off, which is the shape you want: no extra screen,
no menu, no second currency, and a reason for the last three rounds to be tense
rather than a formality.

Details that matter:

- **The chip prints this round's actual numbers**, not the rule. `RISK x2 -450` at
  a three-streak and `RISK x2 -100` at the start are the same rule, and only the
  first one tells you why you are hesitating.
- **The penalty is priced before the streak moves**, so it costs what the
  multiplier was when you took the risk, not what the answer just did to it.
- **Score floors at zero.** A negative number is not a position in a game anybody
  can read, and it would break the share row besides.
- **A wrong risk is a red `-450`, not a smaller green number.** Same element,
  opposite read — a penalty that looks like a gain is a penalty nobody notices.
- It disarms every round and cannot be re-armed once spent; the chip then says
  which round it went on.

**The ceiling moved and the server had to be told.** A flawless run is 3,600 and
always was; RISK on the best possible round — the tenth, at a nine-streak, worth
200 x 3 — adds another 600. So the ceiling is **4,200**, and `blitz_submit` clamps
to exactly that (`..._20260916210000_cover_fire_risk.sql`). `Blitz.MAX_SCORE`
mirrors it; change one and you must change the other, the same arrangement as
`LADDER` against `v_ladder`.

Leaving the clamp at 3,600 would not have errored. It would have filed a great run
as a worse one and decided a head to head on the wrong number — a silent
truncation, which this file already calls the worst failure shape available. So
**the client compares what came back with what it sent** and calls `reportIssue`
on a gap, which means an unapplied migration says so in `client_errors` instead of
quietly costing people matches.

### Fourteen kinds, and why adding one needed a column

The original nine ask about release order, track counts, runtime, artist,
song-to-album, genre and year. Five more were added with Cover Fire, all built
from the same seven columns — **no fetch, no table, no token**, because the pool
being static is what makes a round instant, offline and identically scored on
every device, and a kind that needed the network would spend all three:

| | |
|---|---|
| `notgenre` / `notartist` | odd one out — *which is NOT* |
| `decade` | from the 1990s, a wider net than an exact year |
| `avgtrack` | runtime / tracks |
| `opener` | which record opens with this song |

**The negation is the point of the first two.** Every other kind asks you to find
the match, and the eye gets very good at that very quickly — you learn to stop
reading at the first sleeve that fits. *Which is NOT* makes you check all four.
They are barred below three choices, where they collapse back into the question
they are the inverse of.

`avgtrack` is the only comparison on this pool that cannot be done by eye: a
40-minute record with eight tracks and a 40-minute record with twenty look
identical on every other question. It returns null rather than Infinity for a
trackless row, so `compareBy`'s `typeof` filter drops it instead of ranking it
top.

**Adding a kind changes every question built from every seed**, which is the whole
reason `blitz_matches.build_v` exists. `shuffled` draws one random number per
element, so a longer list orders the ten differently — it is not that the new
kinds get mixed in, it is that the old ones come out somewhere else. A match
created before the deploy where one player had already played would have dealt the
second player a different ten, and the two scores would have been compared as
though they answered the same questions, with nothing anywhere saying otherwise.

So `KINDS_V1` is frozen — contents **and** order — existing matches carry
`build_v = 1` and replay against it, and new ones take the column's default of 2.
No function changed for this: `blitz_create` returns the whole row so the column
rides back on its own, and `blitzList` selects `*`. The client defaults to **1**
and not to the newest when the field is missing, so a database without the
migration puts both players on v1 together rather than silently re-dealing matches
that were already half played.

The one-time cost is the day of the deploy: two people playing Today's Ten either
side of it get different tens. A daily already played is unaffected, because the
record stores its score and marks rather than re-deriving them.

### Solo is the mode about your own crate

`qYouHigh` and `qYouLow` — *which did you rate higher*, *which did you rate lowest*
— drawn from `crate_albums_v1` with your own artwork.

**They are barred from the daily and from a head to head, and that is not a
limitation, it is the rule that makes a shared seed mean anything**: a shared seed
has to produce a shared *question*, and two people do not have the same ratings.
Which turns solo from a warm-up into the one mode that is about your records
rather than the canon.

A personal kind that cannot be served is left **out of the list** rather than
allowed to return null from inside it — the list's length decides how many random
numbers `shuffled` draws, so a dead entry would still move every other question
along. Needs ten rated albums; below that, solo is simply the shared set.

### Streams and a shared rating question are deliberately absent

Both were asked for and neither is in. Worth recording so they are not
rediscovered as oversights:

- **Streams.** The data exists (`album_plays`, `/api/album-streams`) but the pool
  carries no stream totals, and the endpoint requires a Supabase JWT. A live fetch
  would cost the game offline play and, worse, break the shared seed — one player
  with the data and one without get different questions. Doing it properly means
  baking a `streams` column into `ALBUM_ROWS` in the same pass that refreshes the
  rest, which needs a machine that can reach the API. Until then a streams round
  would have to invent a number, and a wrong stream total reads as a bug — the
  same line Bid Wars draws against Discogs prices.
- **A rating question everyone gets.** Ratings are personal, so this can only ever
  be the solo kinds above. There is no version of it that survives a shared seed.

### The seed is the fairness mechanism, and it is sealed

Both players must get the same ten questions, so the match carries a seed and each client
builds the identical set from it with a mulberry32 — integer ops only, so two phones agree.
Verified over 200 seeds: same seed gives byte-identical questions, no kind repeats more
than twice, every correct index in range, every choice has artwork.

**`blitz_seeds` has RLS on and no policies at all**, exactly like `bid_war_values`. On the
match row anybody could read the seed, build the ten questions at their leisure, look the
answers up and then play. `blitz_start()` is the only route to it and refuses once you have
submitted. There is a guard in the migration that fails if a policy is ever added to that
table, and another if `blitz_matches` gains a write policy — scores may only come from
`blitz_submit()`.

**A table with RLS on and no policies returns an empty result, not an error.** Zero rows
back from a probe is the seal working, and a check that calls that a leak is a check that
is wrong — which is how the first probe of this table read. The migration's own guard is
the stronger proof anyway, because it raises rather than reporting.

That is not proof against a determined cheat; the game runs in a browser and the score is
client-reported, the same posture as every other minigame. `blitz_submit` clamps to 3,600
because a flawless run is the arithmetic ceiling, and the daily cap does the rest.

### Both players are paid the same, deliberately

Winning pays no more than losing. Bid Wars had to reason hard about collusion because its
payout differs by outcome; here there is no differential to farm, so two accounts playing
each other all day earn exactly what one account playing alone earns. **The prize for
winning is the head-to-head record** (`blitz_record`), which is the thing people replay
for — the result screen leads with "Against them: 4W 2L 1D" and a Rematch button.

1,600 × 3/day through `wallet_award_game('blitz')`, the same as Higher or Lower.

**Win streaks were deliberately not added.** The head-to-head record already carries the
rivalry, and a streak would need its own column and its own reset rules to say the same
thing a second time.

### The status line on the card, and the selector that wiped all four

`#blitz-card-status` shipped in the markup with nothing writing to it — precisely what
`ew-card-status` did for the whole life of Earworm, and the second time this exact defect
has been introduced. It says whether today's is unplayed, the best score, and — replacing
both once a fetch answers — **how many matches are waiting on you**, which is the only line
on that grid that is a reason to open the app rather than a statistic. The local half is
written first and unconditionally, so the card says something without the network, and
nothing is ever inferred from a cached count: "2 waiting on you" when there are none is the
stale-field shape that cost this app a week over `login_last_date`. The fetch is tokened,
because entering the view and closing the modal can both start one and the slower would
otherwise land last and win with the older number.

**Fixing it exposed the reason no card status was ever visible.** `renderBests()` ran
`document.querySelectorAll('.gc-best')` — *every* one of them — read `crate_best_<data-best>`
and blanked anything that came back empty. The five-round games carry `data-best`; the Daily
Drop, Earworm, Cover Fire and Higher or Lower each write their own status line into the same
`.gc-best` slot **with no `data-best` on it**, so all four were read as `crate_best_undefined`
and wiped.

What makes it worse than a wasted element is *when* it ran. `setMode('games')` calls
`renderGameBests()`, so the wipe fired on the way **into** the only view those cards appear
in — each module painted its line at load and this cleared it a moment before anybody could
see it. Today's Drop result, your Earworm score, runs left on Higher or Lower: all four had
been invisible since they shipped, and each looked like its own separate never-implemented
feature rather than one shared cause.

So the selector is scoped to `.gc-best[data-best]`, and `renderBests()` then calls the four
painters (`paintDropCard`, `paintEarwormCard`, `paintBlitzCard`, `paintHigherLowerCard`).
Scoping alone only stops the wipe — calling them is what makes the lines *show*, because
nothing else repaints them on entering the view. **One function now means "repaint the game
cards"**, which is also why the repaint was taken back out of `paintUnlocks()`: that paints
the lock overlays, it runs immediately after `renderGameBests()` on the same view change, and
having both call it gave the Blitz card two `blitzList()` round trips per visit.

### Two things that cost time

- **The timer bar did not animate.** `transition: none` + `width: 100%` then a
  `requestAnimationFrame` to set the transition and `0%` — rAF fires *before* style
  recalculation, so both landed in one computed style and the browser saw nothing to
  animate. The bar sat full for the whole round, which is worse than no clock because it
  says you have time. `void bar.offsetWidth` forces the reflow that commits the 100% so
  the next line has something to transition from — the same idiom as the multiplier bump
  in Higher or Lower.
- **A throttled tab lies about transitions.** `getBoundingClientRect()` on the draining bar
  returned a constant width while a `CSSTransition` was demonstrably running, because the
  pane was not painting. A screenshot forces a paint and showed the truth. Measure animation
  with a screenshot, not a rect, when the tab may be in the background.

## Bid Wars

A 1v1 sealed-bid auction, reachable from its own nav tab (`view-wars`) and from a card in
the Minigames grid. Client code is one IIFE at the bottom of `index.html`
(`window.renderWars`, `window.openBidWar`). Schema and resolution live in
`supabase/migrations/20260907130000_bid_wars.sql` and `..._160000_bid_wars_streams.sql`;
creation lives in `api/bid-war-create.js`.

How a war runs:

1. You challenge someone you follow. `/api/bid-war-create` picks five records, values each
   by its total play count, and stores those values where the client cannot read them.
2. Each player is **dealt the five records one at a time** and commits chips to each before
   seeing the next. Blind, one submission each.
3. When the second bid lands, `bid_war_submit` resolves the war in that same transaction.
   Higher bid takes each record; equal bids mean nobody takes it.
4. A record you won is worth its total plays. Most plays wins. Winner +3,000 Discs, loser
   +800, draw +1,500 each — **capped at three paid settlements a day**, and what was
   actually paid is stored on the war in `initiator_award` / `opponent_award` rather than
   inferred by the client from the outcome.

Design decisions worth not undoing:

- **The board is dealt, not laid out.** All five used to be on screen at once with chips you
  could move around freely until you were happy — which is an *allocation puzzle*: the set is
  known, so you are solving for the best split rather than deciding about a record. One at a
  time makes it a decision under uncertainty: you commit to this record not knowing whether
  something you want more is still in the deck, so holding back has a real cost and so does
  going big early.
  - **There is no back button, and that is the whole mechanism.** Going back would let you see
    all five and then revise, which is the old game with extra steps. The review screen at the
    end is **read-only** for the same reason — it exists so you see your board before sealing
    it, not so you can edit it.
  - Two layers of not-knowing now: what a record is worth (sealed, below) and what is coming
    next. Do not add a "records remaining" preview; the dots deliberately say *how many* are
    left and never *which*.
  - `_bids` holds only locked records. Chips-left counts the card in your hand as already gone
    (`paintChips(w, pending)`), so the number moves while you decide rather than after you
    commit, and the input is clamped to what is actually available — going over is no longer
    reachable at all.
  - **All in** is on every card, not just the last. Without it the final record takes twenty
    taps to put your pot on, and unspent chips buy nothing whatsoever.
  - One `#war-submit` button with two jobs (`warPrimary`): lock the card in hand, or seal the
    finished board. A submit error drops you back to the review, not into the deck — the board
    is still decided.
- **Value is total Spotify streams**: the sum of every track on the album. Spotify exposes
  no stream counts at all (not per track, not per album, and this app no longer receives
  even `popularity`), so `api/bid-war-create.js` takes the album's real tracklist from the
  Spotify API, reads per-track totals from kworb.net's artist table, and sums the matches.
  Cached in `album_plays` for 14 days, `source = 'kworb'`.
  An album is skipped unless at least **70%** of its tracks match (`MIN_MATCH` in
  `_streams.js`) and at least 4 match (`MIN_TRACKS`, so a 3-track EP matching 2 cannot pass
  on percentage alone), which stops a half-matched record being undervalued against a fully
  matched one. Measured match rates: 100% for american dream, Blonde, SOS, To Pimp A
  Butterfly, In Rainbows, The Money Store; 92% IGOR; 64% Rumours, where kworb omits very
  low-stream deep cuts that barely move a sum — note that Rumours now falls *below* the
  threshold and is skipped rather than undervalued.
  This replaced Last.fm album playcount, which was wrong by about a thousand times —
  scrobbles are not streams, and album-level scrobbles undercount further because plays
  scatter across singles and reissues. `LASTFM_API_KEY` is no longer used here.
  The kworb dependency is scraped HTML, so it is the most brittle part of the feature: if
  match rates collapse, check the table markup in `artistStreamTable`.
- **Wars settle live.** `bid_wars` is in the `supabase_realtime` publication, so the player
  who bid first is pushed straight to the reveal when the second bid lands, instead of
  sitting on "waiting" until they reload. A 15s poll covers a failed socket. `bid_war_bids`
  and `bid_war_values` are deliberately not published — streaming either would unseal the
  bids or leak the values.
- **Creation is a server route, not a Postgres function.** Postgres cannot make the HTTP
  call, and the browser must not: a player who fetches the playcounts themselves knows what
  every record is worth before bidding. The route verifies the caller's Supabase JWT and
  never trusts an id from the request body.
- **Records still come from `crate_feed`** (top 40 by rating count, shuffled), so the board
  is always albums this community has actually put in front of itself, with real artwork.
  Only the *valuation* changed from rating to plays.
- **Everything after creation is server-authoritative.** Clients have no INSERT or UPDATE
  policy on any bid war table. `bid_war_submit` and `bid_war_decline` are `security
  definer`; `bid_war_pool` and `bid_war_create_from` are service-role only. A player cannot
  write their own winner, score or Disc payout, and Bid War payouts remain the only part of
  the Discs economy a client cannot forge.
- **`album_plays` and `bid_war_values` have RLS on and no policies**, so neither is
  reachable from the browser. `bid_war_submit` folds the values into `bid_wars.records` at
  resolution, when revealing them is the whole point.
- **Bids are sealed** by the SELECT policy on `bid_war_bids`: your own row always, your
  opponent's only once `status = 'resolved'`.
- **Values are sealed, and the leak that made that meaningless is closed**
  (`..._20260912090000_reseal_war_values.sql`). This reverses
  `..._20260911170000_war_modes_open_values.sql`, and the round trip is worth understanding
  before anyone opens them again.

  They were opened because `/api/album-streams` was public and returned exactly the figure a
  war stores — so a player could price all five records on their own board before bidding,
  and the seal only held against whoever did not think to check the network tab. **That
  reasoning was right about the leak and wrong about the remedy.** Opening them turned the
  game into pure chip allocation and removed what it was for: backing your own read of which
  record the world actually listens to.

  So both halves move together. `bid_war_create_from` strips `value` from `records` again,
  and `/api/album-streams` now **requires a Supabase JWT** and refuses any album sitting on
  one of the caller's own pending boards, via `my_sealed_albums()` — which returns ids only,
  never values, and never sees anybody else's wars. Sealing without closing the endpoint
  would just restore hidden-from-you-and-one-request-away.

  The bidding board omits the value **unconditionally** rather than checking whether the
  field is present, so wars created during the open window are covered with no data
  migration. Higher or Lower and the kworb health button both send the session token now; an
  album that overlaps a live board comes back `sealed` and is dropped from the pool like any
  other unpriceable record.
- **It is async by design.** With a user base this small, anything needing both players
  online at once would never actually get played.
- Play counts are power-law distributed, unlike ratings, so one record on the board is
  usually worth more than the other four combined. That makes wars more lopsided but the
  bidding sharper: spotting and winning the big one is most of the game.

### War modes

**Market mode is parked, not deleted.** The picker in `war-new-modal` is `display:none` and
every war is created as `streams`. The `mode` column, `_discogs.js`, `/api/album-market`, the
`album_market` cache and the per-mode formatter are all still in place and still work —
bringing it back is removing one style rule. Keep it that way rather than ripping it out.

`bid_wars.mode` is `streams` | `market`, chosen before the opponent because it changes what
the game is rather than decorating it.

- **streams** — total Spotify streams, via kworb. Power-law distributed, so one record is
  usually worth more than the other four together and the whole game is taking that one.
- **market** — what a copy costs on Discogs, in `lowest_price`. Prices bunch up, so a market
  war is five tight calls instead of one big one.

Market mode is the only place a second external service is allowed, and Discogs earned it by
having a **real documented API** — token auth, rate-limit headers, a 429 when you cross the
line. That is a contract. AOTY, RateYourMusic and Metacritic have no API at all, sit behind
bot protection, and their scores are aggregated third-party critic content. One scrape
(kworb) is enough for any app.

Things that cost time to discover and should not be rediscovered:

- **Community stats are on a `/releases/{id}`, never on a `/masters/{id}`.** A master returns
  no `community` object whatsoever.
- **Discogs 403s any request without a User-Agent.** It looks exactly like an auth failure.
- Stats are per-pressing, so a famous album's have/want/rating counts fragment across every
  version of it. `_discogs.js` takes the master's `main_release` as a proxy rather than
  summing every version, which is fine *here*: a war value has to be identical for both
  players and unguessable, not accurate. Nobody knows the "true" market price of a record.
  That licence does not extend to stream totals, where a wrong figure reads as a bug — which
  is why that valuation has a match threshold and a debug endpoint and this one doesn't.
- **Price, not the Discogs rating.** `community.rating.average` clusters between about 3.7
  and 4.6 because collectors rate everything highly, which is unplayable as a war value.
  `lowest_price` has real spread.
- **Prices are stored in minor units** (pence/cents) because `bid_war_values.value` is
  `bigint` and £2.19 would truncate to 2. `album_market` carries the currency alongside, and
  each record carries `cur` so the client can render a symbol rather than a bare number.
- `album_market` caches for **3 days**, not 14 like `album_plays`: an asking price moves with
  what is actually for sale that week, where a stream total only goes up.

Client-side, every value goes through `fmtVal(n, war, rec)` rather than `fmtPlays`. £12.50
rendered through the streams formatter reads as "1,250".

## Album Tournament — parked

Its card in the Minigames grid was its only way in, so removing that card retires it. The
module, `tourney-modal`, and the `'tournament'` case in `wallet_award_game` are all still
there — parked the same way market-mode Bid Wars is, so bringing it back is putting a card
back rather than rebuilding anything. `window.openTournament` is exported for exactly that.

Two things the removal had to touch, and both would have been silent failures:

- The module did `document.getElementById('tourney-card').addEventListener(...)` unguarded,
  which throws a TypeError the moment the card is gone — and it runs at load, inside the same
  script as the rest of the tournament. It is null-checked now.
- `GATES` in the unlock painter had a `tourney-card` entry. `paintUnlocks` does guard with
  `if (!card) return;`, so this one was harmless, but a gate for a card that cannot exist is a
  gate that can never be passed. Removed.

## Higher or Lower

Own modal, own module, near the bottom of `index.html`. Two records from your own crate, one
value showing, and the run continues until you are wrong — no round limit, because a score is
only worth telling somebody if there was no ceiling on it.

**The pool is your rated albums and nothing else**, deliberately. Higher-or-lower on the
global charts is trivia about strangers' records; on your own crate it asks how well you know
the things you chose.

Two modes that are different games, not a setting:

- **Streams** — the same valuation Bid Wars uses. Power-law, so gaps are enormous and the
  skill is knowing which of your records the world actually listens to.
- **Your ratings** — your own scores out of 100. Clustered, so gaps are tiny and the skill is
  remembering what you thought. **Needs no network at all**, which makes it the mode that
  works on a train and the mode that works on day one.

Streams mode pre-fetches its pool in batched `?albums=` requests — the first twelve before
the first round, the next twelve in the background once four playable records are left.
Per-round fetching puts a second of dead air between guesses and a chain game lives on
rhythm. An album kworb cannot match is dropped rather than valued at zero — a zero is an
answer and a wrong one. Ties go to the player, because ratings collide constantly and losing
a run to two albums you both scored 84 would feel like a cheat.

Three rules added after it shipped, every one of them something it looked broken without:

- **No album is asked about twice in a run.** `nextRight()` used to exclude only the two
  records on screen, so on a pool of twelve a run of fifteen was mostly repeats — which
  reads as the game being broken however correct the answers are. A `used` set enforces it;
  the background top-up is what stops the rule from cutting a good run short, and when the
  crate genuinely runs out the run ends saying so rather than starting again.
- **Every pause is skippable.** Tap, click, press Enter or press space while a verdict is up
  and the next round comes immediately. The correct-answer wait is 620ms rather than 950 and
  the wrong-answer wait 1250 rather than 1400, arrow up / arrow down answer, and covers are
  preloaded so the art does not swap in a beat late. The fixed unskippable wait was most of
  why this felt sticky. Clicking the backdrop mid-run skips the wait instead of closing,
  because a stray tap beside the panel should not cost a score and a run.
- **Three runs a day, unlocked at 25 rated albums** (`GATES['hl-card']`, was 8 — a crate of
  eight is not enough of a crate for "how well do you know your own records" to mean
  anything, and the pool ran dry inside a single run). The runs are counted by
  `game_start_run()` in `..._20260914233000_game_play_limits.sql`, which is a **play** limit
  and not the payout cap. `wallet_award_game` already capped Higher or Lower at three
  payouts a day, so the fourth run was allowed, paid nothing, and said so only in a toast —
  a limit you find by hitting it is a disappointment, a limit on the start screen is a rule.
  A localStorage mirror (`crate_hl_runs`) covers signed-out play and a browser running
  against a database where that migration has not been applied; it is a courtesy, not a
  defence, and the payout cap is still what bounds the money.

The run is spent by `claimRun()` **after** the pool is known to be playable, so a failed
`/api/album-streams` never costs somebody one of their three.

**`crate_hl_best` is in `SYNC_KEYS`**, and it was the last local score that did not follow
you between devices — the five-round bests have synced since they shipped, so a best set on
a phone simply was not there on a laptop and there was no way to tell that from never having
set one.

It is a **map** (`{ streams, rating }`), not a number, which is why it could not join the
`crate_best_*` line: the two modes are separate games and separate bests, and a whole-blob
newest-wins merge would drop whichever device wrote first. It merges per key with the larger
number winning — the same rule the game log's play counts want, so both now call one
`maxByKey()` rather than keeping two copies of the same loop. It is deliberately key-agnostic:
a third mode would merge correctly without that function being touched.

Note the asymmetry inside `mergeGameLog`, which is the reason that merge is field-by-field in
the first place: the play counts take the **larger** and the Earworm best takes the **smaller**
row count, because fewer guesses is better. `maxByKey` is only correct for the half that goes
up. Do not widen it over the other.

## Groove roles

Migration `supabase/migrations/20260908120000_groove_roles.sql` (apply it by hand in the SQL
editor, like the others).

The badges are literal gold and silver with a slow sheen across them, not `var(--gold)` —
the accent colour follows whatever theme is equipped, and a pink "PRESIDENT" chip is not a
gold one.

`groove_members.role` is `president` | `vp` | `member`. Whoever creates a groove is its
president; a president or vice president may promote a member to VP, demote a VP, remove a
member, and invite. **A VP has the same powers as the president**, with one asymmetry: the
president cannot be demoted or removed by anybody, including a VP, because otherwise handing
someone a promotion would be a way to lose your own groove. The president also has no Leave
button, since leaving would strand the groove with nobody able to run it.

How it is held together:

- **Role is pinned by a trigger.** `pin_groove_role` forces `role = 'member'` on any client
  insert and reverts any client update, unless a transaction-local flag
  (`vinall.role_ok`) is set — which only the `security definer` functions below do. This is
  what closes the old self-promotion gap; a member cannot write themselves a role even with
  direct API access.
- **Creation moved server-side.** `groove_create(name)` writes the `grooves` row and the
  creator's president row in one transaction, so `owner_id` cannot be supplied by the caller
  and a groove cannot end up with no one in charge. The client no longer inserts either row.
- `groove_set_role`, `groove_remove_member` — definer functions that check
  `groove_is_leader()` and refuse to touch a president.
- **The new RLS policies are `restrictive`**, deliberately. A restrictive policy ANDs with
  whatever permissive policies already exist, so these could be added without first knowing
  the existing policy set — which is not recorded in migrations. They narrow inserts to
  "yourself, or a leader inviting" and deletes to "yourself, or a leader removing".
- `grooves.owner_id` is still written and still correct, but **role is now the authority**,
  not ownership. Read the role, not `owner_id`, when deciding what someone may do.

**Joining by link is deliberate.** The insert policy allows a row where
`user_id = auth.uid()` precisely so `handleGrooveLink` can add you from a `?groove=` link
with no leader present. Groove ids are UUIDs, so they are not enumerable, and anyone holding
the link was given it.

What was not deliberate was doing it blind. `handleGrooveLink` used to `upsert` on every
visit with no `onConflict`, so a second visit either errored or added a duplicate membership
row depending on keys this file cannot see, and it silently promoted an `invited` row to
`member` without the person ever seeing the invite. It now selects first and inserts only
when there is genuinely no row, leaving any existing row alone.

### The invite list says what is true, not what failed

`inviteToGroove` used to blind-insert and report any unique-key clash as **"Already in"**.
A clash means a row exists, and that row is a *pending invite* far more often than a
membership — the list offered an identical Invite button to everyone you follow, including
people who had already been sent one on a previous visit, so clicking again labelled them
as being in a groove they had never joined. Three greyed "Already in" rows on a two-member
groove is exactly that, and nothing in the UI could tell you which of the two it meant.

Now `Cloud.grooveRoster()` reads every row of the groove before the list renders, and each
person is labelled **Member** (not a button — there is nothing inviting them would do),
**Invited**, or **Invite**. A second click on someone already invited re-sends the
notification and says "Reminded", because that is what pressing it again means. A clash
that still happens — a race with another leader, or a row RLS will not show us — is re-read
and named rather than guessed at; a genuine failure puts the row back instead of leaving a
greyed label that reads like something happened.

`..._20260914234500_groove_invite_visibility.sql` adds a permissive select policy so a
leader can see the `invited` rows of their own groove. The select policies on
`groove_members` predate this repo's migrations and are recorded nowhere, so whether that
was already allowed is unknown — a permissive policy ORs with whatever exists, so the worst
case is that it is redundant. The client does not depend on it: a row it cannot see is
still named correctly, because `grooveMembers()` can see every membership and the list has
already filtered those out.

One consequence worth deciding on rather than discovering: a member removed by a leader can
rejoin instantly with the same link. Fixing that needs a tombstone (a removed-members table,
or a `status = 'removed'` row kept instead of deleted) — there is no way to tell "removed"
from "never joined" once the row is gone.

## Lore — the core loop

The product thesis: VINALL is not a site where you rate music, it is where your relationship
with music accumulates. The loop is **listen/rate → VINALL notices → it asks something small
→ you tap → it remembers → it resurfaces it later.**

Rules that are easy to break by accident and must not be:

- **The word "meaning" never appears in this UI.** Asking what a song means makes people feel
  they owe you something profound, so they write nothing.
- **Every question answers in one tap.** Free text is offered *after* the tap and never
  instead of it. An answer is complete without a note.
- **The app has no personality and never nudges you.** No "Be honest", no "…didn't it?", no
  telling somebody what they are thinking. It states a situation flatly and the **options** do
  all the work. This is the rule the first rewrite broke — "Someone's face just came to mind,
  didn't it?" is the app being clever *at* you, and a question that performs charm is exactly
  what reads as machine-written. "Someone puts this on the aux." carries more than any amount
  of voice, because the answer is a verdict.

### The question library, rewritten

The original set asked you to *describe a feeling* — "Where does this take you?", "What era of
your life does this belong to?" That is a survey, and it read as one. The set now **puts you in
a situation and makes you take a side**.

Every entry passes three tests:

- **A mate could text it.** If it only works written down, it is dead.
- **There is a wrong answer** — something you would be embarrassed to pick, or would defend.
- **Every option survives the receipt.** `findReceipt` quotes answers back verbatim 45 days
  later as `You said "X" about <record>`, so an option that cannot finish that sentence is a
  dead end, not merely a weak choice. "Taking the aux back" works; "A room" never did. The old
  library had eleven that failed this, including three separate phrasings of "no idea".

**Three or four options beats six.** The old set padded to five and nine, and the extra entries
were always taxonomy. A three-way with real stakes is sharper than a six-way list of places.

Tones are the register a finder asks for, and they were renamed with the library because the
old ones (casual / silly / place / people / time / opinion) described *subject matter* rather
than register:

| tone | what it asks | n |
|---|---|---|
| `stance` | a verdict on the record, usually with someone watching | 17 |
| `habit` | when and how you actually play it | 11 |
| `origin` | how it reached you | 1 |
| `attachment` | how much of you is in it | 18 |
| `structure` | how the album is built (album-only) | 7 |

`origin` having one question is deliberate rather than an oversight — there is only one honest
way to ask how something reached you, and `questionFor` falls back to the whole pool when a
requested tone is exhausted.

**`OPT_FX` keys must exist as real options.** It maps option text to a decorative class, and
after the rewrite every one of its old keys (`faded`, `tipsy`, `3am specifically`) pointed at
text that no longer existed anywhere — a lookup that silently never matches. Check it whenever
options change.

Pieces:

- `lore_answers` (migration `..._180000_lore.sql`) — one row per question per item per person.
  `question_text` is snapshotted next to `question_id` because the library lives in the client
  and keeps changing; Receipts depends on quoting back exactly what was asked. `skipped`
  records a question waved away so the engine stops offering it.
- **Question library** — data, not code, at the top of the Lore module in `index.html`. Add
  questions by appending to `QUESTIONS`; the engine needs no changes.
- **Discovery finders** — `findFresh`, `findNostalgia`, `findArtistGap`, `findAlbumLove`,
  `findContradiction`, `findReceipt`. A discovery is a *reason to ask*, not the question: the
  line sets context and a library question does the asking, so the same question reads
  differently in different framings. That is where variety comes from without needing
  hundreds of questions.
- All finders run on data the app already has (local album/song ratings and `crate_feed`).
  **None of them need Spotify**, which matters — see the Spotify note below.
- **Today lives on Home.** It was its own first nav tab, alongside a separate Diary tab for
  Liner Notes. Both became sections of `view-home`. The loop only works if the asking and the
  looking-back are the same page — as two tabs they were two separate visits, and the nav was
  up to nine items. `setMode('home')` calls both `renderToday()` and `renderDiary()`;
  `renderToday()` no-ops when the stack is already built for the day, so re-entering Home is
  cheap.
- **Liner Notes is TEMPORARILY OFF.** Three switches, flip them together: `display:none` on
  `.ln-card` and on `#fold-year` in the Home markup, and `DIARY_ON` in the Liner Notes module.
  Nothing was deleted — the module, the entry modal, the schema and every `renderDiary()` call
  site are intact, so this is a switch and not a migration. `renderDiary` stays **defined as a
  no-op** rather than left undefined, because three call sites test `if (window.renderDiary)`
  and one of them sits inside a `try` that swallows what it catches: a missing function there
  would be silent, a no-op is honest. The render is stopped as well as the markup hidden,
  because building a year grid nobody can see is a full pass over every entry on every Home
  visit.
- **Answering advances the card by itself**, after 2.2s, with a draining line so the movement
  is expected rather than startling. Waiting for a second deliberate tap after every answer is
  what made this feel like a form. It is now a toggle — **Auto**, beside Refresh, remembered
  in `localStorage` under `crate_today_auto`. With it off there is no timer and no drain line
  (a countdown to nothing happening is worse than no countdown) and a **Next** button appears
  instead.

  **It never worked with a mouse, and it took two goes to fix — the lesson is in the second
  attempt.** The timer was cancelled on the confirmation panel's `pointerenter`, and that panel
  renders *directly under the cursor*, because you have just clicked an answer button inside
  the same card. The event fired the instant the panel appeared. Swapping it for `pointermove`
  was the same mistake one step along: any twitch of the hand cancelled it, which with a mouse
  is always.

  **Only a click inside the panel stops it now.** A click is the one thing there that is
  unambiguously intent, and the only reason to stay on a settled card is to reach "Add a
  note" — itself a click. Neither the presence nor the motion of a pointer over an element
  that appeared underneath it means anything at all.

  There was also a draining progress bar. It is gone: it asked you to watch a clock instead of
  reading the card, and once the pause stopped being cancellable it had nothing left to
  communicate. `AUTO_MS` is 1150 rather than 2200, so the slide reads as a consequence of
  answering rather than a wait.

- **Undo lives in the header**, next to Refresh — not on the card. With auto-advance on, the
  card you want to take back has already slid away by the time you want to take it back, which
  makes the card the one place the button cannot be.
  - **It does not expire.** `advance()` used to call `clearUndoable()`, so the button lived
    for exactly `AUTO_MS` — about a second — and the moment you reach for it is the moment
    after the card has gone. **A window that closes before you have finished reading is not
    an undo, it is a reflex test.** The only things that retire it now are another answer
    taking its place and the undo happening. The machinery already supported this:
    `undoLast` handles the card having slid away, and the button carries the record's name
    in its `title` so it still says what it would take back once nothing is on screen.

  It undoes the last answer wherever you
  are: if that card is still live it restores its options, and if it has gone the answer is
  simply deleted and the question returns to the pool on the next rebuild. Undo really deletes
  the `lore_answers` row — safe because `award_lore_disc` fires on INSERT only and is capped at
  20 discs a day, so answer/undo/answer cannot earn more than answering twenty different
  questions would. Its confirmation rides in the header hint because **`toast` is local to the
  Wallet module, not global.**
- **Today** — an endless stack, not a page. One card is live and
  the next rides up over the top of it; the one you dealt with recedes behind rather than
  flying off. Cards are absolutely positioned, so `#today-stream` has its height set in JS
  after every mount — without that the page below jumps on each advance. The queue rebuilds
  itself when it runs dry, and answered questions drop out of the finders, so it never
  repeats itself while there is anything left to ask.
- **Your Music Lore** — a profile section, deliberately not "Your Meaningful Music".

### Spotify listening data: the hard limit

Development Mode allows **5 authenticated users**, and the app owner needs Premium. Extended
Quota requires a registered business with **250k MAU** — circular and unreachable.
`recently-played` is a 50-item rolling window that cannot be paged past, there are no
per-user play counts anywhere in the API, and Audio Features is blocked for dev-mode apps.

There is also no Spotify user login any more (see Shape), so there is no per-user Spotify
data reaching this app by any route at all. That is not a gap to close later; it is the
permanent condition.

So listening history comes from **the user's own Spotify data export** — and now actually
does. See **Listening history** below. Design any listening feature against
`listening_plays`, never against the Spotify API directly.

Every question also carries an **Other…** option that opens a free-text field. The one-tap rule
is about never *demanding* text, not about refusing it — plenty of real answers are on no list.

### Listening history

`listening_plays` (migration `..._20260909120000_listening_history.sql`) is the internal
store the note above was describing. One row per track per person, and the client module
is the block commented `LISTENING HISTORY` near the bottom of `index.html`.

- **Aggregated in the browser, never uploaded raw.** A real Extended export is 100k–500k
  play events. The finders only want counts and dates, so the events are folded to one row
  per track before anything is sent, and only the top `CAP` (4000) rows go up. Nobody's
  play-by-play leaves their machine.
- **`k` is the merge key** — normalised `artist|track`, mirroring `normTitle` in
  `api/_streams.js`. That is what makes re-importing an overlapping export merge instead of
  doubling every count. Non-latin titles normalise to empty under that regex, so they fall
  back to the plain lowercased string rather than collapsing into one row.
- **Two export shapes exist** and people have both in the same zip: Extended streaming
  history (`ts`, `ms_played`, `master_metadata_*`, `spotify_track_uri`) and the basic
  one-year `StreamingHistory*.json` (`endTime`, `artistName`, `trackName`, `msPlayed`). The
  parser reads both. Only the Extended one carries track ids, and a Lore answer is keyed by
  item id — so someone who imports only the basic download gets the ratings-based finders
  exactly as before rather than an error.
- **30 seconds is a play**, matching Spotify's own definition. Counting skips would make
  "what have you been rinsing" mean the opposite of what it says.
- **The panel is dormant until the migration is applied.** One head query decides whether
  the table is reachable; if it is not, nothing renders at all. A feature that appears and
  then errors when touched is worse than one that waits.
- Two new finders read it: `findRinsed` (played a lot, never rated, never asked about) and
  `findAbandoned` (played 20+ times, nothing for eight months). They are first in
  `buildQueue` because they are the strongest signal in the pool when there is any
  listening data, and they return nothing when there is none.
- RLS is own-rows-only for all four operations. This is the most personal table in the
  database and it is never read to build somebody else's public profile.

## App shell — manifest, service worker, offline

Added so the site can be wrapped without failing review for the obvious reasons.

- `manifest.webmanifest` — installable, standalone display, VINALL's own dark
  ground. Icons are generated, not hand-drawn: `assets/icons/` holds 192/512
  plus **maskable** variants at 66% scale (a maskable icon whose art fills the
  square gets its edges cropped by Android's circular mask), a 180px opaque
  `apple-touch-icon`, 1024px for the store listing, and 16/32 favicons.
- `sw.js` — **network-first for navigations, deliberately.** `index.html` is
  one 650KB file that changes on every push, so a cache-first shell would serve
  last week's build with nothing to indicate it. The cache is a fallback for
  having no signal, never a fast path. Static media under `assets/` and
  `dither-frames/` is cache-first with a background refresh. `/api/*` is never
  touched — a cached `app-token` is an expired one. Cross-origin is left alone.
  Only `res.ok` responses are stored: the first version cached a 404 and would
  then have served that as the offline fallback for the path.
  Escape hatch: `navigator.serviceWorker.controller.postMessage('vinall-sw-purge')`
  clears every cache and unregisters the worker.
- `offline.html` — precached, and what a cold load with no connection gets.
  Returns to the app by itself on the `online` event.
- **Safe areas** — `viewport-fit=cover` plus `env(safe-area-inset-*)` on
  `.wrap`, `header`, the drawers and the modals, wrapped in
  `@supports (padding: max(0px))` and written as `max(28px, env(...))` so a
  phone with no insets keeps the normal gutter rather than collapsing to zero.
- **Hardware back / edge swipe** — switching views pushes history, and back
  returns through them. A sheet opening pushes its own entry, watched by a
  `MutationObserver` on `.modal`/`.activity` rather than wired at each
  `open()` site, so back closes the top sheet instead of leaving the app. Without
  the push-on-open, back on a shallow history stack walks off the page before the
  `popstate` handler can run — which is exactly what the first version did.

`STORE-SUBMISSION.md` holds the prepared App Privacy, Data Safety and
age-rating answers, drafted listing copy, and the shortlist of things only Ben
can do.

## Colour

The app used to have two accents — `--gold` and `--accent-2` — on near-black grey, so every
surface looked like every other surface. **That is what "dull" was: not a lack of saturation
but a lack of difference.**

- **Five fixed hues**: `--c-cyan`, `--c-violet`, `--c-pink`, `--c-lime`, `--c-blue` (plus
  `-dim` variants). **Deliberately not themed**, exactly like `--red`/`--yellow`/`--green` —
  they mean the same thing under every skin, so a section keeps its identity when somebody
  equips Neon Vault.
- Use them for **identity and for telling one number from another, never decoratively.** A
  palette applied at random is noise with more steps.
- **`--section`** is the current tab's hue. `setMode` writes `body[data-section]`, the CSS
  maps that to a hue, and the page background and every `.section-head` read from it — so the
  whole page changes temperature between tabs rather than just an accent.
- The **body background** is four radial washes in different hues and corners, all under 6%.
  It should be felt, not seen: anything stronger fights the album artwork, which is the real
  colour in this app.
- The **stats row** on Home is: albums ranked, songs ranked, net worth, level, streak, Discs.
  The two average-rating tiles were removed — an average of your own scores barely moves once
  there are fifty of them, so they were the only numbers on the strip that never changed, and
  a stat that never changes is furniture. **Net worth comes from `CollectionWorth`**, a cache
  in the Collection module, never an RPC in `renderStats()`: that function runs on every
  rating, every award and every view change. `get()` returns null until the single fetch lands
  and then re-renders, and will not retry in a loop if it fails. Both buy paths and the sell
  path return the new total in their own response, so the tile updates without a second trip.
- The **profile's Statistics block** (`done-grid`, was "What you've done") follows one rule:
  **every tile is a number that only goes up, or a personal best.** That is why Level and
  Discs-to-spend are not in it — a balance falls every time you buy something, so it measures
  what you have left rather than what you have done, and Level was a rendering of lifetime
  Discs sitting beside lifetime Discs. Same reasoning removed `avg` and `level` from the
  profile header.
  - **Lifetime Discs is `profiles.lifetime_xp`.** The pin trigger adds every *rise* in the
    balance to it and never subtracts, so it is already the running total of everything ever
    earned and spending cannot touch it. There is no separate lifetime column and there does
    not need to be.
  - Net worth comes from `collection_net_worth(prof.id)` — takes a user id, reads a publicly
    readable table, so it works on anybody's profile. The lore, Completionist and game-log
    tiles are local-only and therefore owner-only, because RLS keeps other people's out of
    reach, as it should.
  - **Favourite minigame and best Earworm come from `crate_gamelog_v1`**, a local store in
    `SYNC_KEYS` so it rides the same `app_state` mirror as ratings. It is not a server table
    because **nothing pays out from it** — it records what you reached for, and a client that
    lies about that gains nothing. The moment anything grants Discs off these numbers it has
    to move server-side like every other counter in the economy.
    - `notePlay(key)` fires at the **end** of a round, never when a modal opens: a setup screen
      you backed out of is not a game you played. Higher or Lower counts outside its payout
      gate, because a run that died at two was still a run played and "favourite" should mean
      what you reach for, not what you were good at.
    - `mergeGameLog` merges **per field, not newest-wins**, because the two halves want
      opposite comparisons — a bigger play count wins, a *smaller* Earworm row count wins.
      Taking the whole blob from whichever device wrote last would silently drop a best.
- The **stats row** and the **minigames grid** assign hues by `nth-child`, not per-element
  classes, so both keep working whatever they contain that day. Wallet and level tiles stay
  gold because those carry meaning and are not part of a rotation.

## Feedback primitives

`burst(el, opts)`, `ripple(el, ev)` and `buzz(kind)` are global, defined next to
`celebrate()`, and used by Today and every game — so a correct guess in Earworm feels like one
in Daily Drop feels like answering a question. Before them each surface invented its own
feedback or had none, and the ones with none were the ones nobody played twice.

All three **no-op entirely under `prefers-reduced-motion`**, by doing nothing rather than
doing something smaller. `buzz` is silent on iOS Safari, which has no vibration API, so
nothing may depend on it firing.

The lesson worth keeping: the wins already had eighty pieces of confetti. **What was missing
was the five guesses before them**, which were completely silent — and those are what a
session actually consists of. Put feedback on the frequent small moments before the rare big
one.

## Analytics and safety

`analytics_events` records event names with small prop bags — `question_shown`,
`question_answered`, `question_skipped`, `question_other`, `note_added`, `today_opened`,
`rating_saved`. Written through `window.track(name, props)`, fire-and-forget so a failed
insert never interrupts anything. Users may only read their own rows;
`analytics_summary(days)` is admin-gated and returns the funnel, including `answered_2_plus`
against `answerers` — whether anyone answers a **second** question is the number that says
whether this product works.

`reports` and `blocks` exist because App Store guideline 1.2 requires a filter, a report
path, a block and a contact before it will accept user-generated content. `hasSlur` was the
filter; the rest are new. Blocks are one-directional and silent — the blocked person is never
told.

Blocks are now applied everywhere a blocked person could otherwise reach you: the People list,
the crate feed, **album comments** (filtered by `feed_comments.user_id`), **notifications**
(by `notifications.actor_id`), **follower and following lists**, **username search** (a
blocked user returns "no user called…" rather than a Follow button) and **groove member
lists**. Filtering is client-side, which is right for a mute-style block — the rows are still
readable by policy, they are simply never shown.

**The ordering is the whole thing, and it is easy to get wrong.** `isBlocked()` reads a cache
that `loadBlocks()` fills, and it returns `false` when that cache is empty — so a filter that
runs before the load is not a weak filter, it is no filter, and it fails silently. Two call
sites shipped that way (album comments and groove member lists) and looked correct in the
diff. Every site that calls `isBlocked` now awaits `loadBlocks()` first; on the album page it
rides along in the same `Promise.all` as the ratings and comments.

`loadBlocks()` also used to cache an empty map for a logged-out visitor, which meant logging
in mid-session left the cache looking populated and quietly disabled every filter until a
reload. It now returns without caching when nobody is signed in.

Account deletion is `/api/delete-account`: `delete_my_data()` clears this project's rows as
the user, the route deletes the avatar folder from the `avatars` storage bucket with the
service role, then the Admin API removes the `auth.users` row. Apple has required in-app
deletion since June 2022.

The table/column list in `delete_my_data()` is walked dynamically, so naming a table this
project does not have is skipped rather than raising — but **the list itself is hand-written,
so a new table is not covered until somebody adds it**. Two were missing: `app_state`, the
cloud mirror of localStorage holding every rating and diary entry, and `listening_plays`.
Both are in the list now. `bid_wars` and `bid_war_bids` need no entry because their FKs to
`auth.users` cascade. `client_errors` deliberately holds no user id. The avatar *file* could
never be reached from SQL at all, which is why that half lives in the route.

**Adding a table that holds user rows means adding it to that array in the same migration.**

### Checking a Bid War valuation

`/api/album-streams?q=<search>` or `?album=<spotify id>` returns exactly what a war would
value an album at, plus the match ratio; add `&debug=1` for the per-track breakdown and the
list of tracks that did not match. It imports the same `_streams.js` the war route does, so
the two cannot drift.

Reach for it first whenever a total looks wrong. The first time these numbers were wrong the
algorithm turned out to be fine — the fault was stored data — and there was no way to tell
the two apart without this.

There is now a **kworb health** button on the admin panel that probes four albums with known
match rates and shows the ratio, the matched count and `kworbRows` for each. It exists
because the scrape is the most brittle thing in the app and nothing surfaced a failure: if
kworb changes its table markup, every album falls below `MIN_MATCH`, wars quietly stop being
creatable, and the first sign of it would be a war valuing a record at zero. `kworbRows` is
the signal that separates "kworb dropped some deep cuts" from "the scrape is dead" — a live
artist table has hundreds of rows, a broken one has none, and that holds even when the
search picks a different edition of the album. It runs on the button rather than on render
because each probe costs a Spotify call and a kworb fetch.

**A war's values are frozen at creation.** That is deliberate, so neither player can watch
them move mid-war, but it also means a war created under a broken or superseded valuation
carries those numbers for good. If the valuation method changes again, purge `album_plays`
and clear pending wars in the same migration, as `..._220000_purge_stale_values.sql` does.

## Admin stats, crash reports, legal

`renderAdminStats()` draws a panel on your own profile, and only if `profiles.is_admin` is
true — it renders nothing at all for everybody else. It calls `analytics_summary(14)`,
`analytics_questions(30)` and `recent_errors(8)`. The headline tile is deliberately
**"came back for a 2nd answer"**; the questions table is sorted worst-first, because a
question with a low answer rate is a question to rewrite rather than evidence the idea fails.

`#admin-stats` and `#listening-import` both live inside `view-profile`, which is *also* how
you look at somebody else's profile. Both now bail when `?u=` names anybody but you —
without that the admin panel followed you around and drew your own numbers under a
stranger's name. Any new section added to that view needs the same guard.

Crash reporting is the first script in the body so it catches failures in everything below.
No third-party script and no signup: errors go to `client_errors`, which anyone may insert
into (logged-out crashes are exactly the ones nobody would otherwise report) and only an
admin may read back, via `recent_errors()`. Capped at 8 per session and deduped by
message+line so one error in a loop cannot flood the table.

`privacy.html` and `terms.html` are plain static pages, linked from the footer. The contact
address is `spam30492@gmail.com`, set as a **temporary** stand-in — swap it for a real
support address before any store submission or public launch, since this is the address people
use to exercise data rights. `privacy.html` also covers imported listening history: what is
stored, that the aggregation happens on the device, and that it is private to the account.

### Spotify attribution — the mark, and a link to the record

Spotify's Developer Policy requires attribution wherever their content appears, and every
piece of artwork in this app is theirs. Apple will not raise it; Spotify can.

For a long time that was met with a **sentence** in the footer — "Artwork and catalogue data
from Spotify." — which is not what either document asks for. Two separate requirements were
being missed:

- Design Guidelines: *"you must always attribute content from Spotify with the logo."* The
  **logo**, not prose. There was no mark anywhere in the app.
- Developer Policy II.4.2: metadata and cover art must be *"accompanied by a link back to the
  applicable album, content or playlist on the Spotify Service."* Album pages linked nowhere.

So the mark now appears in the footer, in Settings and on the player bar (which shows Spotify
cover art while it plays), and every album page carries a **Play on Spotify** button pointing
at *that album* rather than at the service root — the policy asks for a link to the content,
not to Spotify in general. "Play on Spotify" is one of the three strings the guidelines permit
for that button; it is not a phrasing of ours to improve on.

**One definition of the mark**, in the `SpotifyMark` module, injected into every
`data-spotify-mark` placeholder. Not three copies in three places — the Shop swatch and the
real theme were separately invented once and drifted for months, and a brand mark is the worst
thing in the app to let drift, because the guidelines forbid altering it at all. `#1ED760` and
the viewBox are theirs: do not recolour it, squash it, redraw it, or lay it over album artwork.

### The games hold no Spotify content, and that was the point of moving the artwork

The policy says **"Do not create a game, including trivia quizzes"**, and the compliance notes
name *"a 'name that tune' quiz"* as the example — which is Earworm exactly, with Daily Drop and
Cover Fire as trivia quizzes beside it.

The way out was that the games run on **baked static tables**, and the only thing in them
Spotify owned was the artwork. Title, artist, year, genre, track count and runtime are plain
fact. So all **323** Spotify cover URLs in `EW_ROWS`, `ALBUM_ROWS` and `SONG_ROWS` were
re-pointed at Deezer. There is no `i.scdn.co` left anywhere in the file, and not one rule of
play changed.

Worth keeping from how it was done, because the same pass will be wanted again if the pool is
ever refreshed:

- **373 artwork cells, 236 unique covers.** Thriller appears in all three tables. Resolve each
  cover once and replace globally — which is also what preserves the property this file already
  calls out, that Earworm and the Drop label a record identically.
- **Diacritics were the whole failure mode.** The first pass got 231/236 and every single miss
  was the same bug: Deezer writes Beyoncé with an acute and JAY-Z as *JAŸ-Z*, and stripping
  non-alphanumerics **without folding diacritics first** turns those into `beyonc` and `jaz`,
  which match nothing. Normalise NFD and drop the combining marks before stripping. Dropping
  parentheticals (`(Remastered 2009)`, `(Explicit Version)`) fixed the rest.
- **Live albums, karaoke records and tributes are refused by name.** They carry the right title
  and the wrong sleeve, which is worse than no sleeve — the same reason `collectionName` guards
  the preview lookup.
- **Deezer does not carry everything.** *808s & Heartbreak* is simply absent, so Heartless comes
  from Apple, where 47 of these covers already came from. Expect one or two of these.
- **Every URL was fetched and checked for an image response before the file was touched**, and
  the apply step rebuilds the file region by region and **refuses** if any `i.scdn.co` sits
  outside the three tables — those would be runtime artwork from the live API and must not be
  rewritten by a data pass.

### `Covers` — a non-Spotify sleeve for the two surfaces that cannot keep one

The static game pools were the bulk of it; two surfaces read artwork **live** and needed the
same treatment:

- **Certification finishes.** Holographic and Prism are animated washes laid *on top of* the
  sleeve, and the guidelines say "Artwork must be kept in its original form. Don't animate or
  distort it in any way. This includes applying overlays."
- **Higher or Lower and Cover Fire's solo rounds**, which draw live from `crate_albums_v1` and
  were therefore still showing Spotify art inside a game.

`Covers` resolves a Deezer sleeve for those two and **nothing else changes anywhere**. Album
pages, search, the Crate and profiles keep Spotify artwork and should: a rating site showing
records, crediting Spotify with the logo and linking back to each release is what the API is
*for*. That use is intended, not tolerated.

- **Keyed by artist + album name, not by Spotify id**, because the callers do not agree on ids:
  the crate keys by Spotify album id, the Collection and Masters come back from the `collection`
  table, and a Crate feed row has neither. A name is the one thing all of them carry.
- **It rides `/api/preview`**, which already resolved the album on Deezer for the player's clips
  and now returns `cover` alongside them. One lookup serves both, and the week-long edge cache
  makes the second caller free.
- **A miss is cached too.** Deezer has no *808s & Heartbreak*; without that, every render of a
  shelf holding it would spend another request rediscovering the same absence.
- **The swap lives inside `Cert.art()`**, because that is the single renderer every plated
  surface goes through — the property this file already relies on for a finish bought in one
  place appearing in the others. A caller that does not pass `artist`/`album` renders exactly as
  before, so an un-updated one degrades rather than breaking.
- **Spotify's URL stays the fallback while a lookup is in flight, deliberately.** The
  alternative is a blank square, and on Cover Fire the sleeve *is* the question — a placeholder
  would break the game to win a second of purity. Game pools are warmed when they are built, so
  that window is first-visit only.

`STORE-SUBMISSION.md` holds the paste-ready **App Review notes**, and the decisions on the two
outside dependencies: the Spotify Development Mode cap does not apply (it limits authenticated
users, and there are none), and kworb is kept deliberately with the 14-day `album_plays` cache,
the admin health button and frozen war values as the things that make an outage survivable.

The privacy policy was extended to cover what review actually asks for and what the
code actually does: blocks and reports (data about two people, previously undisclosed),
the working copy held in browser storage, retention per data type, the UK/EU legal bases
(contract for the account and ratings, legitimate interests for analytics, crash reports
and moderation records), where the data is held (Supabase eu-west-1, Vercel global), and
the right to complain to the ICO.

### A profile showed twelve albums out of forty

Three faults compounding, fixed together. Worth reading whole, because only one of
them was visible and the other two were the ones that lose data.

**1. `.slice(0, 12)` on the profile album grid.** A hard cap with no button to lift it and
nothing on screen admitting it existed, so somebody who had rated forty albums read as having
rated twelve. Gone — every album renders, highest first. That is also the consistent choice:
the owner's own Crate has no paging, so a capped profile was the odd one out rather than the
careful one.

**2. `fetchUserRatings` had no pagination.** PostgREST caps a response at **1000 rows** by
default and reports nothing — a 200 and a short array. Albums and songs share the `ratings`
table, so a crate with a few hundred rated tracks sails past that and the songs simply stop
arriving. It pages now. **A silent truncation is the worst failure shape available**: it is
indistinguishable from "they rated fewer".

**3. `backfillRatingsOnce` was three bugs stacked, and is now `reconcileRatings`.**

- **The batching did nothing.** It built `jobs.push(syncRating(...))` then awaited the array
  ten at a time — but calling an async function *starts* it, so every request was already in
  flight before the loop began. The array held hundreds of running promises; the loop was
  decorative. A big library fired hundreds of simultaneous upserts on login.
- **`syncRating` swallows every error**, so whichever of those failed, failed silently.
- **The flag was set regardless of outcome.** A half-written backfill was permanent on that
  browser, because it never ran again.

Burst, silence, flag. The replacement runs **every login**, diffs ids rather than trusting a
flag, and pushes only what is genuinely missing — so an account already broken by the old code
repairs itself on next open, with no migration and no flag to bump. It bails rather than
re-pushing everything if the diff query fails, bulk-upserts 200 rows per request instead of one
per rating, and calls `reportIssue` when a chunk fails, because the old version's defining
characteristic was being quiet.

### Correction: the ratings sync is fine

An earlier note in this file called ratings a dangerous dual source of truth. That was
overstated. `pullAndMerge()` merges cloud `app_state` into localStorage using
`mergeItemMap`, which resolves **per item by `savedAt`** rather than clobbering whole blobs,
and `backfillRatingsOnce` repopulates the public `ratings` table on any new browser. It is a
sound local-first design. The one real gap — that it only ran at login, so a tab left open
could sit on stale data — is closed by re-merging on `visibilitychange`, throttled to once a
minute.

## Password reset

The client side is complete: `resetPasswordForEmail` sends
`redirectTo: location.origin + location.pathname`, and on return the app handles all three
things that can arrive — `#type=recovery` (implicit flow), `?code=` (PKCE), and
`#error=...` for an expired or already-used link. That last case is the common one and used
to be ignored entirely, which is why a dead link dumped people on the normal app with no
explanation.

**The reset link going to `localhost` is a Supabase dashboard setting, not app code.**
Authentication → URL Configuration:

- **Site URL** must be `https://wildcrate.xyz` (it defaults to `http://localhost:3000`)
- **Redirect URLs** must include `https://wildcrate.xyz/**`, plus
  `https://*.vercel.app/**` if preview deploys should work

Supabase silently falls back to Site URL whenever a requested `redirectTo` is not on the
allow-list, so a wrong Site URL breaks reset for everyone with no error anywhere.

Do **not** try to fix this with `supabase config push`. It pushes the whole `config.toml`,
and any auth setting absent from that file is reset to the CLI's default — which on a live
project can disable signups or change token expiry as a side effect of a two-field change.
