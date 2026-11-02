# Confirmation/reset links open the app, not Safari — setup

What's done: `.well-known/apple-app-site-association`, `.well-known/assetlinks.json`, `vercel.json` headers for both, the Android manifest's App Links intent filter, and an `appUrlOpen` listener in `index.html` that turns an incoming link into a normal in-app navigation — reusing the exact link-handling code that already works for web visitors (`Cloud.init`'s "Coming back from the reset email"), unmodified.

No Supabase change needed — `redirectTo` is already a real `https://vinall.xyz/...` URL (not a custom scheme), which is exactly what Universal Links need. The emails themselves don't change.

What's left needs your accounts/Mac — can't do these from here.

## 1. Apple — fill in your Team ID
`.well-known/apple-app-site-association` currently has a placeholder:
```
"appID": "TEAMID.xyz.wildcrate.vinall"
```
Replace `TEAMID` with your 10-character Apple Developer Team ID (Apple Developer → Membership details → Team ID). Commit and push — this file has to be live on vinall.xyz before the next step works.

## 2. Xcode — Associated Domains capability
`app/ios/App/App.xcworkspace` → App target → Signing & Capabilities → **+ Capability → Associated Domains** → add:
```
applinks:vinall.xyz
applinks:www.vinall.xyz
```
**Fails as**: links keep opening Safari instead of the app — this is the single most common missed step, and it fails silently (no crash, no error, just the old behaviour).

## 3. Android — SHA-256 fingerprint
`.well-known/assetlinks.json` has a placeholder:
```
"sha256_cert_fingerprints": ["REPLACE_WITH_YOUR_RELEASE_SHA256_FINGERPRINT"]
```
Get your **release** signing cert's fingerprint (not debug — this has to match what you actually publish to the Play Store):
```
keytool -list -v -keystore <your release keystore> -alias <your key alias>
```
Copy the `SHA256:` line, paste it in (with or without colons, Google accepts both), commit, push.

## 4. Verify
- Push steps 1 and 3's file changes to `main` first — both `.well-known` files have to be live before iOS/Android will trust them.
- iOS fetches and caches the AASA file at **install time**. If you test before pushing it, or test an old install, delete the app and reinstall after pushing.
- Apple's validator: `https://search.developer.apple.com/appsearch-validation-tool` — paste `vinall.xyz`, it tells you whether the file is reachable and well-formed.
- Fails gracefully either way: if verification never succeeds, the link just opens in Safari exactly as it does today — nothing breaks, it just doesn't improve.

## One thing worth knowing
`vinall.xyz`'s apex 308-redirects to `www.vinall.xyz` (per `CLAUDE.md`). Apple's AASA fetcher does follow HTTPS redirects, so this shouldn't block verification — but because `applinks:www.vinall.xyz` is also declared, the file needs to be reachable at **both** hosts, which it already is since both are served by the same Vercel deployment.
