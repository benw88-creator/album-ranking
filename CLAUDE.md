# VINALL

Album-ranking web app (renamed from Vinal to VINALL), live at https://wildcrate.xyz.

## Shape

Zero-config Vercel deployment — there is no build step and no `package.json`.

- `index.html` — the entire front end, one large file (~540KB). Vanilla JS, no framework.
- `api/*.js` — Vercel serverless functions, auto-detected from the folder:
  - `login.js` — redirects to Spotify's authorise screen
  - `callback.js` — exchanges the Spotify code for an access token
  - `app-token.js` — mints an app-level token (Client Credentials) so guests can browse without logging in
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

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
- `REDIRECT_URI` — must exactly match a redirect URI registered in the Spotify developer
  dashboard. This is why preview deploys can't complete an OAuth login: their URLs aren't
  registered. Guest mode (`/api/app-token`) works on previews regardless.

The Supabase URL and anon key are inlined in `index.html`. That is normal for Supabase —
the anon key is meant to be public — but it only stays safe while Row Level Security is
enabled on every table.

For local work (optional, needs Node): `vercel env pull .env.local`.

## Database

Supabase project ref `cqfxyebejpkyhswolrwi` (project name "Crate", Postgres 17, eu-west-1).

The schema is still maintained by hand in the dashboard. `supabase/migrations/` holds only
the one trigger migration below, not a full history. Snapshotting the rest needs
`supabase db pull`, which needs Docker, which needs WSL2, which needs admin rights — so it
can only be done from the main PC, not the school laptop.

`supabase/migrations/20260907090000_protect_is_admin.sql` was applied by hand in the SQL
editor, so it is **not** recorded in Supabase's migration history. `supabase db push` will
try to apply it again; that is safe, because it uses `create or replace` and
`drop trigger if exists`.

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

One gap remains: a `groove_members` row can be updated by its own member, which may include
their role within the groove.

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
  An album is skipped unless at least 60% of its tracks match, so a half-matched record
  cannot be undervalued against a fully matched one. Measured match rates: 100% for
  american dream, Blonde, SOS, To Pimp A Butterfly, In Rainbows, The Money Store; 92% IGOR;
  64% Rumours, where kworb omits very low-stream deep cuts that barely move a sum.
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
- **It is async by design.** With a user base this small, anything needing both players
  online at once would never actually get played.
- Play counts are power-law distributed, unlike ratings, so one record on the board is
  usually worth more than the other four combined. That makes wars more lopsided but the
  bidding sharper: spotting and winning the big one is most of the game.

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
- **Today** (`view-today`, first nav tab) — an endless stack, not a page. One card is live and
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

So listening history should come from **the user's own Spotify data export** (Extended
streaming history JSON — complete lifetime plays, no quota, works for everyone), with Last.fm
as a live alternative for people who scrobble. Design any listening feature against an
internal store, never against the Spotify API directly.

Every question also carries an **Other…** option that opens a free-text field. The one-tap rule
is about never *demanding* text, not about refusing it — plenty of real answers are on no list.

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
told — and are currently applied to the People list and the crate feed. **They are not yet
applied to comments, grooves, notifications or search**, which is worth closing before any
store submission.

Account deletion is `/api/delete-account`: `delete_my_data()` clears this project's rows as
the user, then the Admin API removes the `auth.users` row with the service role. It walks a
table/column list dynamically so a schema change cannot turn deletion into a hard error.
Apple has required in-app deletion since June 2022.

### Checking a Bid War valuation

`/api/album-streams?q=<search>` or `?album=<spotify id>` returns exactly what a war would
value an album at, plus the match ratio; add `&debug=1` for the per-track breakdown and the
list of tracks that did not match. It imports the same `_streams.js` the war route does, so
the two cannot drift.

Reach for it first whenever a total looks wrong. The first time these numbers were wrong the
algorithm turned out to be fine — the fault was stored data — and there was no way to tell
the two apart without this.

**A war's values are frozen at creation.** That is deliberate, so neither player can watch
them move mid-war, but it also means a war created under a broken or superseded valuation
carries those numbers for good. If the valuation method changes again, purge `album_plays`
and clear pending wars in the same migration, as `..._220000_purge_stale_values.sql` does.
