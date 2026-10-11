# VINALL prelaunch audit

The initial audit ran on the existing development branch without a deployment,
push, migration, database write or live account operation. On 2026-10-11 the
owner approved pushing and releasing the tested changes. Release work preserves
the existing history and keeps live Supabase data unchanged.

## Changes

- For You uses desktop Up/Down navigation, suppresses desktop wheel navigation,
  retains native touch momentum and mandatory snapping, and leaves inputs,
  buttons, sliders and open overlays in control of their own keys.
- The feed observer is rooted in its scroller. Settled playback uses a constant
  time post lookup rather than measuring every accumulated post. Interrupted
  keyboard transitions, leaving the feed, resize, refresh and feed switches have
  explicit playback and generation handling.
- Vertical swipes that start on the score slider no longer leave an accidental
  score change. Horizontal range input remains native.
- Feed height/art sizing handles short screens and avoids subtracting navigation
  clearance twice. Resize retains the same whole post. Feed controls have 44px
  touch targets; Crate tabs fit 320px phones.
- Page entrances use cancellable fades with stable geometry. Transformed page
  entrances reproduced missed clicks in WebKit and forced synchronous layout.
  Re-selecting a view does not replay its entrance.
- Dialogs, activity panels and onboarding trap focus, make the background inert,
  prevent background scrolling, expose dialog semantics and restore the opener.
  Game close paths retain their original cleanup/confirmation behavior. Delayed
  auth autofocus respects already-selected fields and nested dialogs.
- Cards support keyboard activation, controls have visible focus rings, pinch
  zoom is available, and reduced-motion mode suppresses ambient/large motion
  while retaining functional feed snapping.
- Album and public-profile requests reject stale responses. Album/person
  navigation has real history entries; closing a sheet consumes its entry.
  Invalid destinations leave the current view intact. The exposed currentMode
  value now stays current for existing feature refresh hooks.
- Media-session play/pause commands are idempotent. Space leaves focused controls
  and open overlays alone.
- Browser titles consistently use `VINALL — [Page Name]`, with `VINALL` for Home.
  Legal, offline, reset and share pages follow the same branding.
- Browser PNG/ICO, Apple touch and installable-web icons derive from the supplied
  official artwork. The versioned icon URLs and service-worker cache version
  prevent the old mark being retained indefinitely.
- Service-worker background refreshes have an explicit lifetime. Cached shell
  comparison uses an unconsumed response, preserving update notifications. API,
  reset and live share requests still bypass caching.
- Supabase browser SDK is pinned to 2.117.3 to resolve the reproducible Firefox
  startup lock rejection. The vendored file's SHA-256 is recorded in index.html;
  the prior immutable asset remains for compatibility with older cached shells.
  Reference: https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md

## Reproduce verification

The app remains a static site with no root package.json or frontend build step.
Development dependencies live in scripts/ and are excluded from deployment.

```powershell
cd scripts
npm ci --ignore-scripts
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers"
npx playwright install webkit firefox
npm run check
npm test
npm run serve
```

Chrome uses the installed Windows Chrome executable configured in
scripts/playwright.config.mjs. On another OS, change that project's executable
to an installed Chrome or install Playwright Chromium and omit executablePath.

The browser suite intercepts all external HTTP and WebSocket traffic and uses
synthetic catalogue, profile and audio data. Ratings are stored only in isolated
test-browser storage. Screenshots, timings and failure details are written under
scripts/test-results (gitignored); the default reporter also creates an HTML
report under scripts/playwright-report.

Coverage includes all 14 primary views at 320, 375, 768, 1024, 1440 and 2560px,
album detail, all standalone documents, search, history, cards, rating changes,
deletion confirmation, failed sign-in, nested dialogs, desktop feed navigation,
rapid changes, wheel suppression, refresh races, rotation and reduced motion.
Chrome receives real touchscreen events for flicks and swipes from the range
control. Chrome and Firefox use actual local media elements; Windows WebKit
tests the provider interface with a deterministic transport because its media
decoder does not support the local WAV fixture.

`npm run check` parses all 41 inline scripts, shared interaction code and service
worker, runs the existing repository trap checks, and runs four cache-lifecycle
tests. API JavaScript is also syntax-checked. Native web assets are verified with
`node app/scripts/sync-web.mjs`; this is asset bundling, not an iOS/Android build.

## Recorded results

- 69 unique browser cases passed across Chrome, WebKit and Firefox. One WebKit
  native gesture-injection case is skipped because that engine has no CDP touch
  injection; the corresponding Chrome gesture test passed. The combined release
  run passed 69/70 with that one intentional skip. Feed/timing rechecks passed 15/15.
- Four service-worker lifecycle tests passed. All 41 inline scripts, shared
  interaction script, worker and API files parsed; repository traps and
  `git diff --check` passed. Capacitor asset bundling passed.
- Final repeated-navigation sample on this Windows machine: Chrome maximum
  navigation-to-next-frame 19.4ms, frame p95 6.2ms, no frame gaps over 50ms,
  observed layout-shift score 0 and no observed long tasks. Firefox maximum
  18ms, frame p95 42.4ms; Windows WebKit maximum 50ms, frame p95 52ms.
  Firefox/WebKit do not expose the layout-shift/long-task observations used
  here, so those measurements are explicitly null for those engines. Windows
  WebKit's slower frame cadence is a remaining device-validation limitation;
  these measurements do not establish physical Safari frame performance.

## Verification limits

Mocked data exercises client behavior and error handling, not live Supabase
authorization, payouts, purchases, account recovery delivery, provider quotas or
realtime updates. Those need a separate approved staging environment. Physical
iPhone/iPad Safari, real network latency and native store builds also need device
acceptance testing. Browser timing attachments are measurements from this
Windows machine, not a universal frame-rate guarantee.
