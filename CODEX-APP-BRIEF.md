# Brief — wrap VINALL as a native app with Capacitor

Hand this whole file to a Claude session with the repo checked out. It is written
to be pasted as a first message.

---

You are taking VINALL — a music ranking web app live at https://wildcrate.xyz —
and shipping it as a native iOS and Android app using **Capacitor**, without
rewriting the web app.

**Read `CLAUDE.md` in the repo root before touching anything.** It is long, it is
accurate, and it records *why* decisions were made rather than just what the code
does. Several things in this brief will only make sense against it. Read
`STORE-SUBMISSION.md` too — you are going to have to rewrite parts of it, because
it is wrong.

## What VINALL is, so you don't optimise the wrong thing

Not a site where you rate music. A place where your relationship with music
accumulates — the app can know that you gave Blonde an 82 in March and a 94 in
September, which compounds the longer an account runs. Score history is the
spine; Second Thoughts, the Crate, Standing and Taste Match all read from it.
Everything else exists to bring people back often enough for that history to
build. **When a change trades depth for engagement, depth wins.**

## Hard constraints

These are not preferences. Breaking any of them breaks the live site.

1. **The web app keeps its zero-config Vercel deploy.** There is no build step
   and no `package.json` at the repo root, and there must not be one. Vercel
   auto-detects: a root `package.json` can make it try to build, and the deploy
   that currently takes thirty seconds starts failing. **Put the entire Capacitor
   project in its own subdirectory** (`app/`) with its own `package.json`, and
   leave the root exactly as flat as it is now. Add `app/node_modules`,
   `app/ios`, `app/android` build output to `.gitignore` as appropriate.
2. **Do not rewrite `index.html`.** It is ~1.25MB of vanilla JS in one file, it
   has no tests, and every rendering decision in it is documented and deliberate.
   You will be editing it — surgically, in small diffs — not restructuring it.
3. **Four features are parked behind one-line switches and must stay parked:**
   Certification (`Cert.ON`), Liner Notes (`DIARY_ON`), market-mode Bid Wars, and
   the Album Tournament. Each is one line from coming back. Do not "clean up"
   their dead code.
4. **Never rename a key.** Keys live in the database, in `localStorage` and in
   everybody's saved state. Cover Fire is still `blitz` everywhere internally
   because of this; a producer tag's chip says FUKUMEAN and its key never will.
5. **There is no test suite.** Before every push, extract every inline `<script>`
   from `index.html` and parse it. Script at the end of this brief. Then verify
   on the live URL.

## The architecture decision you have to make first

Capacitor can either **bundle** the web assets into the binary or point a
`server.url` at the live site.

**Bundle them.** A wrapper that just loads a website is the textbook App Store
guideline **4.2 (minimum functionality)** rejection, and it also means no offline
behaviour at all. Bundling means `index.html`, `assets/`, `dither-frames/`,
`manifest.webmanifest` and `offline.html` are copied into the Capacitor `webDir`
as a build step *inside `app/`*, leaving the repo root untouched.

### The consequence, and it is the largest piece of work in this port

Bundled assets are served from a Capacitor origin — `capacitor://localhost` on
iOS, `https://localhost` on Android — not from `wildcrate.xyz`. So **every call
to `/api/*` becomes cross-origin.**

I checked: **none of the nine routes in `api/` sets a single CORS header**, and
none handles an `OPTIONS` preflight. That is correct today, because the page and
the routes share an origin. Under Capacitor it means `app-token`, `catalogue`,
`preview`, `album-streams`, `album-market`, `collection-prices`,
`collection-buy`, `bid-war-create` and `delete-account` all fail — and several
of them send `Authorization` and `Content-Type: application/json`, which forces a
preflight that currently has nothing to answer it. The catalogue is every album
name, cover and tracklist in the app, so the symptom is an app that opens to an
empty shell.

Two ways out. **Try the first; fall back to the second and write down which you
used and why.** I have tested neither — verify on a real device, not in a
simulator alone.

- **Alias the origin.** Capacitor's `server.hostname` (with
  `server.androidScheme: 'https'`) makes the webview serve the bundled files
  under `https://wildcrate.xyz`, so `/api/*` is same-origin and CORS never
  applies. Cheapest by far — it touches no serverless route. Confirm what it does
  to `localStorage` scoping, because the app's entire working state lives there
  and losing it on upgrade would wipe people's crates on their own device.
  Confirm the service worker in `sw.js` behaves; it is network-first for
  navigations and must not serve a stale shell inside the binary.
- **Add CORS properly.** An `OPTIONS` short-circuit and
  `Access-Control-Allow-Origin` on all nine routes, allow-listing the Capacitor
  origins explicitly — **not `*`**, because these routes carry Supabase bearer
  tokens. Supabase's own endpoints already handle cross-origin and need nothing.

Whichever you pick, **`/api/preview` matters most**: it is the audio, it is
edge-cached for a week, and the player falls back to Apple only when Deezer
returns nothing — a CORS failure is not an empty list, so check the player does
not silently read a blocked request as "no preview".

## Native capabilities — not polish, this is the 4.2 defence

A bundled wrapper with no native integration is still a thin wrapper. Wire these,
in this order:

1. **Haptics.** `buzz()` is global and already called from Today and every game,
   and CLAUDE.md records that it is **silent on iOS Safari**, which has no
   vibration API — so on iPhone, today, every piece of tactile feedback in the
   app does nothing. Route `buzz()` through Capacitor's Haptics plugin when
   running natively. This is the single biggest felt improvement in the port and
   it is a few lines, because every call site already exists.
2. **Native share sheet.** Cover Fire, Earworm and the Daily Drop all build a
   spoiler-free share string and put it on the clipboard. On a phone that should
   be the system share sheet. Note the existing rule: **every clipboard write
   carries its own `.catch`**, because a refused `writeText` rejects rather than
   throwing and the button used to say "Copied" over an empty clipboard. Keep
   that property.
3. **Lock-screen media controls.** The player already sets
   `navigator.mediaSession`. Verify it actually surfaces in a WKWebView — if it
   does not, that is a real regression against mobile Safari and needs the native
   route instead.
4. **Status bar and safe areas.** The CSS already uses `viewport-fit=cover` and
   `env(safe-area-inset-*)` wrapped in `@supports (padding: max(0px))`. Check it,
   do not rebuild it.
5. **Hardware back.** Already handled on Android via history pushes and a
   `MutationObserver` on `.modal`/`.activity`. Verify; the trap is that on a
   shallow history stack, back walks off the page before `popstate` runs.

Do **not** add push notifications. There is no infrastructure for them and it
drags in a permissions prompt, a token store and a privacy-label change.

Everything must **degrade in a browser**. The same `index.html` is served on the
web. Feature-detect Capacitor; never assume it.

## Three companion tasks, in the same session

### 1. `STORE-SUBMISSION.md` is stale in a way that would be a false statement

Its paste-ready App Review notes currently say VINALL uses "the public Spotify
Web API for album artwork and catalogue information only" and that "Nothing is
played back in the app; there is no audio playback of any kind."

**Both are now false.** The catalogue moved to Deezer, and there is a full
30-second preview player with its own `<audio>` element and lock-screen controls.
Rewrite the review notes against what the code does today. Also:

- The listing copy still advertises **Liner Notes**, which is switched off.
- The privacy table predates the player and the Deezer switch.
- The Spotify-attribution obligation it describes has been replaced — Spotify's
  marks came off every surface and Deezer's logo is now mandatory. CLAUDE.md has
  the reasoning; do not undo it.
- Keep the two decisions it records (the Spotify quota cap does not apply; kworb
  is kept deliberately with its three mitigations). Those are still right.

### 2. Restore The Draw's published-odds panel

Apple guideline **3.1.1** wants published odds for anything loot-box shaped. The
panel was removed at the owner's request but `spin_items` still has a public
select policy and the server still walks those exact weights, so the numbers
never stopped being true. It read from `loadItems()` and nothing else, so this is
small. Rarities are Common 30 / Rare 25 / Epic 20 / Legendary 15 / Mythic 10,
weights summing to 1000 so the percentages are exact.

While you are there: **Discs cannot be bought and that is load-bearing.** If a
way to buy Discs for money is ever added this becomes a regulated gambling
product in the UK, and published odds stop being a courtesy and become a legal
requirement. Do not add one.

### 3. The full Deezer wordmark

`assets/deezer-mark.png` is Deezer's own published icon, taken unaltered from
their CDN because their brand site was erroring at the time. Their guidelines ask
for the logo to be clearly visible and identified, and forbid altering it. Swap
it for the full wordmark from deezerbrand.com **if that site is reachable**; if
it is not, leave the icon alone rather than redrawing anything. A brand mark
reproduced from memory is an altered brand mark. `.dz-credit` is the one class
that lays it out; it appears in the footer, in Settings and on the album page.

### Deliberately NOT in this session

**Do not split `CLAUDE.md` into skills.** It is worth doing — it is ~51k tokens
re-sent every message — but not here. It is unrelated to shipping an app, and it
means rewriting your own instructions while working from them. Separate session.

## Blocked on the owner, not on you

Flag these; do not invent answers.

- **A real support address** to replace `spam30492@gmail.com` in `privacy.html`
  and `terms.html`. Apple emails it during review and a dead mailbox is a
  rejection. This blocks submission.
- **Apple Developer Program enrolment** — £79/yr in the UK, identity check, has a
  lead time. Google Play is a one-off $25.
- **`supabase/migrations/20260916230000_listening_note_play.sql` has never been
  applied.** It is pasted by hand into the Supabase SQL editor. Until then the
  player observes plays and writes nothing. Note that applying it will *not* make
  `findRinsed` and `findAbandoned` start producing cards — they want 15 plays and
  20 plays plus 240 days of silence respectively, sized against an import
  covering years. That is expected, not a bug.

## How to work on this repo

- **`git pull` before touching anything, and push as soon as a change is
  finished.** There are clones on two machines and `index.html` conflicts badly.
- **Push to `main` and the site is live** in about thirty seconds. Verify on the
  live URL afterwards. There is no staging.
- **Migrations are applied by hand and not recorded**, so keep every new one
  idempotent — `create or replace`, `drop ... if exists`, `if not exists`. Any
  migration that *multiplies* a stored value rather than setting it needs a
  sentinel guard, because a multiply is the one shape where re-running is
  silently wrong rather than merely redundant.
- **Match the file's voice.** Comments explain the reasoning and the bug that
  prompted the code, never what the line does.
- **Update `CLAUDE.md` in the same commit** as anything worth remembering.

Three rules this project learned the hard way, all of which apply here:

- Anything that says "progress towards" must know when there is nothing left to
  progress towards. A clamp is not that — it hides the condition instead of
  reporting it.
- Anywhere a boolean gates a privacy branch, decide what **NULL** means and say
  so. A `v_self := (p_user = auth.uid())` guard reads correctly in English and is
  NULL for an anonymous caller, which is how a breakdown meant to be private was
  served to every logged-out visitor.
- **An error caught and not reported is worse than one that crashes**, because a
  crash at least reaches a console. `reportIssue()` exists and lands in
  `client_errors`, which the admin panel reads.

## The syntax check

There is no test suite; this is the substitute. Run it against `index.html`
before every push.

```js
// checkscripts.js — node checkscripts.js index.html
const fs = require('fs'); const vm = require('vm');
const file = process.argv[2] || 'index.html';
const src = fs.readFileSync(file, 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(src)) !== null) {
  const attrs = m[1] || '', body = m[2];
  if (/\bsrc\s*=/i.test(attrs)) continue;
  if (/\btype\s*=\s*["']?(application\/json|application\/ld\+json|text\/template)/i.test(attrs)) continue;
  if (!body.trim()) continue;
  n++;
  const line = src.slice(0, m.index).split('\n').length;
  try { new vm.Script(body, { filename: file + ' @line ' + line }); }
  catch (e) { bad++; console.error('FAIL block #' + n + ' at line ' + line + '\n      ' + e.message); }
}
console.log((bad ? 'FAILED' : 'ok') + ' — ' + n + ' block(s), ' + bad + ' with errors');
process.exit(bad ? 1 : 0);
```

The current baseline is **26 inline blocks, 0 errors**. If you see a different
block count, something structural changed and you should know why.

## Start here

Read `CLAUDE.md`. Then get a Capacitor shell in `app/` building and running on a
simulator with the assets bundled, and **find out which way the origin problem
resolves before building anything on top of it** — it determines whether this is
a small port or nine serverless routes of work. Report back with that answer
before going further.
