# VINALL on your iPhone, built on a Mac with Codex

The iOS project already exists in `app/` (Capacitor 8, Swift Package Manager,
bundle ID `xyz.wildcrate.vinall`). Nothing needs creating. The work is:
install the tools, let Xcode sign it once, then have Codex sync, build and
install it on the phone.

The app bundles the website's files, but every account and API call goes to
the live site (`https://www.vinall.xyz`), so you sign in with your real
account and see your real crate.

---

## Part 1: things only you can do (about 30 minutes, mostly downloads)

These need a GUI, a password or a physical tap, so Codex can't do them.

1. **Install Xcode** from the Mac App Store. Open it once, accept the licence,
   and let it install the iOS platform when it asks.
2. **Install Node.js** (LTS) from https://nodejs.org, or with Homebrew:
   `brew install node`.
3. **Sign in to Xcode with your Apple ID:** Xcode → Settings → Accounts → `+` →
   Apple ID.
   - If that Apple ID is on the paid Apple Developer team that owns
     `92R3V4JXWU`, the project is already set to it, so leave it alone.
   - On a free Apple ID it still works, with limits: the app stops opening
     after 7 days (rebuild to refresh) and you need your own bundle ID (see the
     note in the prompt).
4. **Plug the iPhone in with a cable** and tap **Trust This Computer** on the
   phone.
5. **Turn on Developer Mode on the iPhone:** Settings → Privacy & Security →
   Developer Mode → On. The phone restarts; confirm when it asks.
6. **Get the code onto the Mac:**
   ```bash
   git clone https://github.com/benw88-creator/album-ranking.git ~/dev/vinal
   ```
   (or `git pull` if it's already there).
7. **Open Codex in that folder** (`~/dev/vinal`) and paste the prompt below.

The first time the app installs, the phone may refuse to open it ("Untrusted
Developer"). Fix: Settings → General → VPN & Device Management → your Apple ID
→ Trust. You only do this once.

---

## Part 2: the prompt for Codex

Copy everything inside the box.

```text
You are in the VINALL repo (a music-rating web app, live at https://vinall.xyz).
The iOS app already exists as a Capacitor 8 project in app/. Your job: build it
and install it on my iPhone, which is plugged into this Mac by USB. Do not
redesign or refactor anything.

Read CLAUDE.md first, especially "The native app — Capacitor, in app/". Rules
that must not be broken:
- The repo root stays flat: no package.json, no build step at the root. Run all
  npm commands inside app/.
- Do not change appId (xyz.wildcrate.vinall), iosScheme, androidScheme or
  hostname in app/capacitor.config.json. The app's local data is keyed to that
  origin and changing it wipes people's ratings.
- Do not edit index.html or anything under assets/ for this task. If the build
  needs a source change, stop and tell me what and why first.
- Do not commit or push anything unless I ask.

Steps:
1. Check the tools: `xcodebuild -version`, `node -v` (needs 20+), and
   `xcrun devicectl list devices`. My iPhone should be listed as connected and
   paired. If it isn't, stop and tell me exactly what to do on the phone.
2. `git pull` so the code is current.
3. `cd app && npm install`.
4. `npm run sync`. This copies the web app into app/www and runs `npx cap
   sync`. Confirm it printed the sync-web line and that
   app/ios/App/App/public/index.html exists afterwards.
5. Build for a real device, letting Xcode handle signing:
     cd ios/App
     xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
       -destination 'generic/platform=iOS' -derivedDataPath build \
       -allowProvisioningUpdates build
   If signing fails because team 92R3V4JXWU isn't available to my Apple ID,
   find my own team ID (`security find-identity -v -p codesigning`, or ask me),
   then rebuild with `DEVELOPMENT_TEAM=<mine>` and
   `PRODUCT_BUNDLE_IDENTIFIER=xyz.wildcrate.vinall.dev` added to the
   xcodebuild command, as build settings on the command line, not edits to the
   project file. Tell me you did this, because that copy is a separate app on
   the phone.
6. Install and launch:
     xcrun devicectl device install app --device <device id> \
       build/Build/Products/Debug-iphoneos/App.app
     xcrun devicectl device process launch --device <device id> <bundle id you built with>
   If launch fails with a trust or profile error, tell me to go to Settings →
   General → VPN & Device Management and trust the developer, then try the
   launch again.
7. Report back in plain words: what you ran, whether it installed and opened,
   and the exact error text for anything that failed. Don't guess at fixes for
   signing or device problems. Tell me what to click instead.

To rebuild later after I've pulled new web changes, only steps 2, 4, 5 and 6
are needed (step 3 only if app/package.json changed).
```

---

## Part 3: checking it on the phone

Once it opens, spend two minutes on these. They're the things that can only be
judged on a real device:

- **Sound:** rate a record and play a Recall round. Effects should be subtle
  and should duck under a music preview. Settings → Sound turns them off.
- **For You slider:** drag sideways to rate, swipe up and down on the same
  slider to move between songs. Neither should steal the other.
- **Haptics:** taps, ratings and wins should all give a small buzz.
- **Lock screen:** play a track from an album page, then lock the phone. The
  controls and artwork should be there.
- **Keyboard:** open search or Recall. The input should stay above the keyboard.

## When something goes wrong

| What you see | What it means |
|---|---|
| "No account for team 92R3V4JXWU" | Your Apple ID isn't on that team. Let Codex use your own team (step 5 of the prompt). |
| "Untrusted Developer" on the phone | Settings → General → VPN & Device Management → Trust. |
| App opens to a blank dark screen | `npm run sync` didn't copy the web files. Run it again inside `app/` and rebuild. |
| App stopped opening after a week | Free Apple ID builds expire after 7 days. Rebuild and install again. |
| Phone not listed by `devicectl` | Unlock it, re-plug the cable, tap Trust, and check Developer Mode is on. |
