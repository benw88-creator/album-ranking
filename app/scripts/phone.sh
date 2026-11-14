#!/bin/zsh
# Pull main, sync the web app into the iOS project, build, and reinstall
# VINALL on the iPhone plugged into this Mac.
#
#   ./app/scripts/phone.sh            pull + sync + build + install + launch
#   ./app/scripts/phone.sh --no-pull  same, without touching git
#
# Uses the project's own signing (team 9BS9SUW9B3, xyz.wildcrate.vinall) and
# the production backend baked into index.html. Never uploads anything:
# no archive, no TestFlight, no App Store Connect.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT/app"
IOS_DIR="$APP_DIR/ios/App"
DERIVED="$APP_DIR/ios/DerivedData"
BUNDLE="xyz.wildcrate.vinall"
cd "$ROOT"

say() { print -P "%F{yellow}==>%f $1"; }
die() { print -P "%F{red}✗%f $1"; exit 1; }

if [[ "${1:-}" != "--no-pull" ]]; then
  [[ "$(git branch --show-current)" == "main" ]] || die "Not on main. Run: git checkout main"
  git diff --quiet HEAD -- || die "You have uncommitted changes to tracked files. Commit or stash them first."
  say "Pulling main"
  git pull --ff-only origin main || die "Could not fast-forward main (local commits?). Nothing was changed."
fi
print "   commit $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"

# Reinstall node modules only when the lockfile changed since the last run.
STAMP="$APP_DIR/node_modules/.vinall-lock"
LOCK_HASH="$(shasum "$APP_DIR/package-lock.json" | cut -d' ' -f1)"
if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$LOCK_HASH" ]]; then
  say "Installing app dependencies"
  (cd "$APP_DIR" && npm ci --no-audit --no-fund)
  print "$LOCK_HASH" > "$STAMP"
fi

say "Syncing web assets into iOS"
(cd "$APP_DIR" && npm run sync --silent)

# First physical iPhone that is connected (cable or Wi-Fi pairing), unless DEVICE is set.
if [[ -z "${DEVICE:-}" ]]; then
  JSON="$(mktemp)"
  xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1 || true
  DEVICE="$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices;
    const p = d.find(x => x.hardwareProperties?.reality === "physical"
      && x.hardwareProperties?.platform === "iOS"
      && x.connectionProperties?.tunnelState !== "unavailable");
    if (p) console.log(p.hardwareProperties.udid);
  ' "$JSON" 2>/dev/null || true)"
  rm -f "$JSON"
fi
[[ -n "$DEVICE" ]] || die "No iPhone found. Plug it in, unlock it, and tap Trust if asked."
print "   device $DEVICE"

say "Building (Debug, signed with the team profile)"
LOG="$DERIVED/last-build.log"
mkdir -p "$DERIVED"
if ! xcodebuild -project "$IOS_DIR/App.xcodeproj" -scheme App -configuration Debug \
     -destination "id=$DEVICE" -derivedDataPath "$DERIVED" \
     -allowProvisioningUpdates build > "$LOG" 2>&1; then
  grep -E "error:" "$LOG" | head -20
  die "Build failed. Full log: $LOG"
fi

say "Installing on the iPhone"
xcrun devicectl device install app --device "$DEVICE" \
  "$DERIVED/Build/Products/Debug-iphoneos/App.app" >/dev/null

say "Launching"
if ! xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE" >/dev/null 2>&1; then
  print "   Installed. The phone was locked, so open VINALL yourself."
fi
print -P "%F{green}✓%f VINALL $(git rev-parse --short HEAD) is on the iPhone."
