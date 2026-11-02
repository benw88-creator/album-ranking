# Confirmation and reset emails open the app, not Safari

Rewritten 2026-11-02. The earlier version of this file said the apex redirect
"shouldn't block verification". It does: `https://vinall.xyz/.well-known/apple-app-site-association`
answers **308**, and Apple fetches the AASA without following redirects. So every
link that should open the app is on **www**, and the email templates must say
`https://www.vinall.xyz`, never `{{ .SiteURL }}` (which is the apex).

## What is already done (code)

- `.well-known/apple-app-site-association` claims only URLs that carry
  `token_hash` (the email links). Everything else on vinall.xyz stays the website.
- `index.html`: a `?token_hash=…&type=signup` link is verified with `verifyOtp`
  and signs the person in, then starts the tutorial. In the app a
  `type=recovery` link is handled in place (reset.html is not in the bundle).
- `appUrlOpen` turns the tapped link into an in-app navigation.

## What is left, in order

These need the paid Apple Developer team (Excus Ltd). The free personal team
cannot use Associated Domains.

1. **Team ID.** In `.well-known/apple-app-site-association`, replace `TEAMID`
   with the Excus Ltd Team ID (Apple Developer → Membership details). Commit and
   push. Check: `curl -s https://www.vinall.xyz/.well-known/apple-app-site-association`.
2. **Xcode.** Signing & Capabilities: Team = Excus Ltd. **+ Capability →
   Associated Domains** → `applinks:www.vinall.xyz`. Delete the app from the
   phone and install again (iOS reads the AASA at install).
3. **Supabase → Authentication → Emails.** Only after step 1 is live.
   - **Confirm signup**, the link becomes:
     ```
     <a href="https://www.vinall.xyz/?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a>
     ```
   - **Reset Password**, the link becomes:
     ```
     <a href="https://www.vinall.xyz/reset.html?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
     ```
4. **Test on the phone, from the Mail app:** sign up with a new email, tap the
   link. VINALL should open directly (no Safari), signed in, on the tutorial.

## How it fails

- Link opens Safari: the Team ID, the capability, or a stale install. Reinstall
  after any AASA change. Apple's checker: https://search.developer.apple.com/appsearch-validation-tool
- Long-pressing the link and choosing "Open in Safari" makes iOS remember that
  choice for the domain. Long-press again and choose "Open in VINALL" to undo it.

## Android

`assetlinks.json` still needs the release signing SHA-256 (see git history of
this file). Not needed for the iOS submission.
