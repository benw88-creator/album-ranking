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

Balanced in `..._20260911200000_login_rewards_and_inflation.sql`. Before it, the ceiling was
~256 Discs a day doing literally everything and ~60 on a realistic session, against a shop
costing 1,580 in total — so a normal player spent about a month earning their way to owning
everything, and **the day they owned it all, Discs stopped meaning anything.**

**Inflating what you earn, on its own, only brings that day forward.** It is safe only
alongside a sink. Keep that in mind before raising any number here.

- **Daily login** — `wallet_daily_login()`, 10 Discs on day one rising to 40 by day seven,
  then flat. Plateaued on purpose: this rewards *opening* the app, which is a weaker thing to
  reward than the rating streak beside it. No streak freezes, because a freeze here would
  protect you from not opening an app. Safe to call on every load — it returns
  `claimed_already` and changes nothing.
- **Every seventh consecutive day earns an album banner.** `wallet_claim_album_banner(art)`
  spends one `banner_picks` entitlement and appends a banner keyed **`album:<cover url>`** to
  `owned_banners`. This is the sink: every claim is a different object, so unlike a fixed
  shop it cannot be finished.
  - The URL is **re-validated server-side** against `^https://i\.scdn\.co/image/…`. Without
    that it is an arbitrary image embed on a public profile — a moderation problem and a
    tracking-pixel problem at once.
  - `album:` banners are not in the client's `BANNERS` map, so both the profile header and
    the shop need their own branch for them. The shop lists them from `owned_banners`;
    without that they would be owned but unreachable the moment you equipped anything else.
  - Covers render blurred behind a dark gradient. At full strength a 640px cover makes every
    piece of text on the header unreadable.
- **Rates**: ratings 5 × 8/day, lore 3 × 20/day, Earworm 25, Daily Drop 40, Tournament 20,
  achievements 20, Higher or Lower 20. **Caps are the anti-forgery defence, not the balance
  lever** — move the amounts, not the caps.
- **Bid War payouts (30/8/15) are deliberately not inflated.** They were already the largest
  award in the game; the pass brought everything else up to parity rather than chasing them.
  Changing them means replacing the whole of `bid_war_submit`.

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

## Bid Wars

A 1v1 sealed-bid auction, reachable from its own nav tab (`view-wars`) and from a card in
the Minigames grid. Client code is one IIFE at the bottom of `index.html`
(`window.renderWars`, `window.openBidWar`). Schema and resolution live in
`supabase/migrations/20260907130000_bid_wars.sql` and `..._160000_bid_wars_streams.sql`;
creation lives in `api/bid-war-create.js`.

How a war runs:

1. You challenge someone you follow. `/api/bid-war-create` picks five records, values each
   by its total play count, and stores those values where the client cannot read them.
2. Both players spread 100 chips across the five records, blind, one submission each.
3. When the second bid lands, `bid_war_submit` resolves the war in that same transaction.
   Higher bid takes each record; equal bids mean nobody takes it.
4. A record you won is worth its total plays. Most plays wins. Winner +30 Discs, loser +8,
   draw +15 each.

Design decisions worth not undoing:

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
- **Values are not sealed, as of `..._20260911170000_war_modes_open_values.sql`.** They
  never really were: `/api/album-streams` is public and read-only by design, and returns
  exactly the number a war stores, so a player could always look up all five records on
  their own board before bidding. Hiding a number that is one request away is a handicap on
  whoever did not think to check, not a defence — and Higher or Lower made that obvious by
  putting the same data in front of everyone.

  So `bid_war_create_from` keeps `value` in `records` instead of stripping it, and the
  bidding board shows it. **The game is better for it**: both players see all five and
  spread 100 chips blind to each other, which is a simultaneous allocation game — Colonel
  Blotto — where the skill is reading where the opponent will commit rather than knowing
  more about streaming numbers. `bid_war_values` keeps its RLS-on-no-policies isolation and
  stays authoritative at resolution, and `bid_war_submit` overwrites `records` from it, so
  a tampered blob still cannot change a result.
- **It is async by design.** With a user base this small, anything needing both players
  online at once would never actually get played.
- Play counts are power-law distributed, unlike ratings, so one record on the board is
  usually worth more than the other four combined. That makes wars more lopsided but the
  bidding sharper: spotting and winning the big one is most of the game.

### War modes

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

Streams mode pre-fetches its whole pool in one batched `?albums=` request before the first
round. Per-round fetching puts a second of dead air between guesses and a chain game lives on
rhythm. An album kworb cannot match is dropped rather than valued at zero — a zero is an
answer and a wrong one. Ties go to the player, because ratings collide constantly and losing
a run to two albums you both scored 84 would feel like a cheat.

## Groove roles

Migration `supabase/migrations/20260908120000_groove_roles.sql` (apply it by hand in the SQL
editor, like the others).

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

One consequence worth deciding on rather than discovering: a member removed by a leader can
rejoin instantly with the same link. Fixing that needs a tombstone (a removed-members table,
or a `status = 'removed'` row kept instead of deleted) — there is no way to tell "removed"
from "never joined" once the row is gone.

## Lore — the core loop

The product thesis: VINALL is not a site where you rate music, it is where your relationship
with music accumulates. The loop is **listen/rate → VINALL notices → it asks something small
→ you tap → it remembers → it resurfaces it later.**

Two rules that are easy to break by accident and must not be:

- **The word "meaning" never appears in this UI.** Asking what a song means makes people feel
  they owe you something profound, so they write nothing. Questions are casual and specific
  ("Why have you been rinsing this?", "Would you defend this song in court?").
- **Every question answers in one tap.** Free text is offered *after* the tap and never
  instead of it. An answer is complete without a note.

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
  Liner Notes. Both are now sections of `view-home`, in the order: stats, Today, Liner Notes
  (card, week strip, year grid, capped entries), recommendations, upcoming releases. The loop
  only works if the asking and the looking-back are the same page — as two tabs they were two
  separate visits, and the nav was up to nine items. `setMode('home')` calls both
  `renderToday()` and `renderDiary()`; `renderToday()` no-ops when the stack is already
  built for the day, so re-entering Home is cheap.
- **Answering advances the card by itself**, after 2.2s, with a draining line so the movement
  is expected rather than startling and an **Undo** beside the confirmation. Undo really
  deletes the `lore_answers` row — safe because `award_lore_disc` fires on INSERT only and
  is capped at 20 discs a day, so answer/undo/answer cannot earn more than answering twenty
  different questions would. Any engagement with the confirmation panel (hovering it, tapping
  Undo, reaching for "Add a note") cancels the timer: if you are still working on the card it
  must not move. Waiting for a second deliberate tap after every answer is what made this
  feel like a form.
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

The footer carries **"Artwork and catalogue data from Spotify."** because Spotify's Developer
Policy requires attribution wherever their content appears, and every piece of artwork in the
app is theirs. Apple will not raise it; Spotify can. Don't remove it.

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
