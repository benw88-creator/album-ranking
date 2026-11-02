Paste this to Claude on your Mac to pick up from here.

---

I'm submitting VINALL (album-ranking repo) to the App Store tonight. A Windows
session already did the code-side work; everything left needs Xcode/a Mac,
which is why I'm continuing here. Read `app-store-submission/CHECKLIST.md`,
`NATIVE-AUTH-SETUP.md` and `UNIVERSAL-LINKS-SETUP.md` in the repo for full
detail — this is the short version.

## Before payment / before submitting

1. **Pull the latest code.** `git pull` on `main` — a Windows session
   committed and pushed native Apple sign-in, a signup bug fix, a keyboard
   fix, and Universal Links scaffolding. Confirm you actually have those
   commits (`git log -3`) before doing anything else.
2. **Install and sync native deps.**
   ```
   cd app
   npm install
   npx cap sync
   ```
   If `npm install` errors, paste the full output before trying anything else
   — don't guess at it.
3. **Apple Developer setup** (needs my Apple Developer account, logged in as
   me):
   - App ID (`xyz.wildcrate.vinall`) → enable the "Sign In with Apple"
     capability
   - Create a Services ID, e.g. `xyz.wildcrate.vinall.signin` (NOT the app's
     bundle ID — a separate identifier) → add
     `https://cqfxyebejpkyhswolrwi.supabase.co/auth/v1/callback` as its
     return URL, `vinall.xyz` as its domain
   - Get my Team ID (Membership page, top right) and replace `TEAMID` in
     `.well-known/apple-app-site-association` with it, then commit+push that
     one file
4. **Xcode** (`npm run ios` opens it):
   - App target → Signing & Capabilities → add **Sign in with Apple**
   - Same screen → add **Associated Domains** → `applinks:vinall.xyz` and
     `applinks:www.vinall.xyz`
   - If the Services ID string isn't `xyz.wildcrate.vinall.signin`, update
     `NATIVE_APPLE_SERVICES_ID` in `index.html` (search for it) to match
5. **Supabase Dashboard** (Authentication → Providers → Apple): add the
   Services ID from step 3 to the authorized client ID list.
6. **Build to a real device** (not just the simulator — Apple's native
   sign-in and keyboard behaviour both need to be checked for real) and test:
   - Sign up with a brand-new email, then try signing up again with the same
     email — should say "already exists," not "check your email"
   - Tap the email/password fields with the keyboard up — the sheet must
     resize and both fields must be reachable. **This was patched blind from
     a screenshot and never confirmed on a real device — check it properly.**
   - Tap "Continue with Apple," confirm it actually completes sign-in
7. Once everything above checks out: **archive the build in Xcode** and
   upload it to App Store Connect (Xcode → Product → Archive → Distribute App).

## After payment / submission (tonight)

Apple Developer Program enrolment should already be active before you can
upload a build at all — if it isn't yet, that's step zero, not something to
do after.

8. In **App Store Connect**, open the app record (or create one if this is
   the first submission) and fill in, copy-pasting straight from
   `app-store-submission/APP-STORE-CONNECT-COPY.md`:
   - Name, subtitle, category (Music + your pick of secondary), keywords,
     description, promotional text
   - Support URL: `https://excus.co.uk/vinall/support`
   - Marketing URL: `https://vinall.xyz`
   - Privacy Policy URL: `https://vinall.xyz/privacy.html`
   - Age rating questionnaire — answers are in that file
   - App Privacy ("nutrition label") — answers are in that file
9. Upload screenshots (already shot).
10. Select the build you archived in step 7.
11. **App Review Information**: demo account email/password (the one already
    created and populated — confirm `profiles.is_admin` is `false` on it one
    more time), reviewer contact details, and paste the notes from
    `app-store-submission/REVIEWER-NOTES.md` verbatim.
12. Submit for review.

If anything in Xcode or App Store Connect throws an error you don't
recognise, paste the exact text rather than paraphrasing it — several of
tonight's build errors so far have only been diagnosable from the literal
message.
