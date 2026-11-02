# Native Apple sign-in — setup

Google is deliberately not wired natively (your call) — its button just hides itself in the app. Apple only, below.

The code side is done (`index.html`'s `wireSocialAuth`, `app/package.json`). Everything below is portal/Xcode work that has to happen on your machine with a Mac and the actual accounts — I can't click through Apple Developer or Supabase's dashboard from here, and this project needs a Mac to open `app/ios` in Xcode at all (`npm run ios`).

Do these in order. Skipping a step fails in a specific, identifiable way, noted under each one.

## 1. Install the plugin
```
cd app
npm install
npx cap sync
```
Fails if `npm install` errors — check `@capacitor-community/apple-sign-in` resolved.

## 2. Apple — Services ID + capability

In **Apple Developer → Certificates, Identifiers & Profiles**:
1. **Identifiers → your App ID (`xyz.wildcrate.vinall`)** → enable the **Sign In with Apple** capability, save.
2. **Identifiers → + → Services IDs** → create one, e.g. `xyz.wildcrate.vinall.signin`. This is NOT your app's bundle ID — it's a separate identifier just for the sign-in button.
3. Configure that Services ID → Sign In with Apple → add `https://cqfxyebejpkyhswolrwi.supabase.co/auth/v1/callback` as a return URL, and `vinall.xyz` as a domain.
4. In Xcode, open `app/ios/App/App.xcworkspace` → App target → **Signing & Capabilities** → **+ Capability** → **Sign in with Apple**.
5. Update `NATIVE_APPLE_SERVICES_ID` in `index.html` (search for it) if you used a different Services ID string than `xyz.wildcrate.vinall.signin`.

**Fails as**: Apple's native sheet opens then immediately errors ("invalid_client" or similar) if the Services ID doesn't match what's registered, or if the capability isn't added in Xcode.

## 3. Supabase — authorize the native client ID

**Supabase Dashboard → Authentication → Providers → Apple**: add your Services ID (`xyz.wildcrate.vinall.signin`) to the provider's authorized client ID list, alongside whatever's already there for the web flow.

**Fails as**: `signInWithIdToken` returns an error like "Unacceptable audience" — Supabase rejecting the token because the app that issued it isn't on the allow-list yet. This is the step people forget because it's not in Xcode, it's a third place.

## 4. Build and test
```
cd app
npm run ios      # opens Xcode — build to a real device or simulator
```
Apple's native sign-in works fine on the simulator.

## Later, if you ever want native Google too
Real native Google sign-in needs: an iOS OAuth client ID + reversed-client-ID URL scheme in `Info.plist` (Google Cloud Console), an Android OAuth client ID + SHA-1 fingerprint, and adding that iOS client ID to Supabase's Google provider allow-list alongside the existing web one. Ask and I'll scope it properly when you want it — it's a similar shape to the Apple steps above, just with Google's own portal instead.

## What I can verify once it's built
Nothing from here — this needs a Mac, Xcode, and your actual Apple/Google accounts. Once you've built it, tell me what happens on tapping each button and I can read the error against the four failure modes above.
