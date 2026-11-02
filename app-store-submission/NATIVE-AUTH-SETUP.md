# Native Apple / Google sign-in — setup

**Correction (2026-11-02):** this file originally described wiring Apple
sign-in with a third-party Capacitor plugin and `signInWithIdToken()`. That
work is unnecessary — `main` already has a complete native implementation,
written before tonight's session: a custom Swift plugin
(`VinallNativePlugin.webAuth`, in `app/ios/App/App/AppDelegate.swift`) that
opens the system `ASWebAuthenticationSession` sheet and runs the exact same
Supabase OAuth flow as the website, just through the system sheet instead of
a browser tab. It covers **both** Apple and Google through one mechanism —
no separate SDK per provider, no community plugin, nothing to install.

Per that code's own comment (dated 2026-10-29): it currently fails because
**both providers are disabled on the Supabase project**. That's the only
remaining gap — pure dashboard config, no code and no Xcode capability
needed. iOS only for now; there's no Android equivalent wired yet.

## What to actually do

### 1. Apple Developer — create the OAuth credentials Supabase needs
Apple Developer → Certificates, Identifiers & Profiles:
1. **Identifiers → + → Services IDs** → create one (any identifier string,
   e.g. `xyz.wildcrate.vinall.signin` — it's just an OAuth client, not your
   app's bundle ID).
2. Configure it → **Sign In with Apple** → enable → set the domain to
   `vinall.xyz` and the return URL to
   `https://cqfxyebejpkyhswolrwi.supabase.co/auth/v1/callback`.
3. **Keys → + →** enable **Sign In with Apple**, generate a key, download
   the `.p8` file once (Apple won't let you download it again) — note its
   Key ID.
4. You'll need: the Services ID, your Team ID (Membership page), the Key ID,
   and the `.p8` file's contents.

### 2. Google Cloud Console
Credentials → Create Credentials → **OAuth client ID → Web application**
(not iOS/Android — this goes through the system browser sheet, so it's a
web-style client). Redirect URI:
`https://cqfxyebejpkyhswolrwi.supabase.co/auth/v1/callback`. Note the client
ID and secret.

### 3. Supabase Dashboard
**Authentication → Providers**:
- **Apple** → enable → paste in the Services ID, Team ID, Key ID, and the
  `.p8` key contents from step 1.
- **Google** → enable → paste in the client ID and secret from step 2.

**Authentication → URL Configuration → Redirect URLs** → add
`xyz.wildcrate.vinall://auth` to the allow-list. Without this, per the
code's own comment, "Supabase falls back to the Site URL and the sheet never
closes by itself."

### 4. Test
No rebuild needed for the Supabase/Apple/Google config changes — just
reopen the already-installed app and tap the buttons. If a button still
doesn't appear at all, that's `enabledProviders()` correctly hiding it
because `/auth/v1/settings` still reports the provider as off — recheck step 3.

**Fails as**: tapping the button opens the system sheet, then it closes
immediately with no error reaching the app — almost always the redirect URL
allow-list (step 3's second part), not the provider config.
