# Vinal

Album-ranking web app, live at https://wildcrate.xyz.

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

Write policies on every table are correctly scoped by `auth.uid()` — users cannot modify
each other's rows.

Two narrower gaps remain: either participant can update a `bid_wars` row, so a player could
set themselves as winner; and a member can update their own `groove_members` row, possibly
including their own role.

More broadly, `discs`, the streak columns, the cosmetic arrays and `leaderboard_times` are
all written straight from the browser through `Cloud.saveProfile`, which upserts arbitrary
client-supplied fields. The economy is therefore client-authoritative: a user can set their
own numbers. Only `is_admin` is protected, by the trigger above. Fixing the rest means
moving disc awards and shop purchases server-side.

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
