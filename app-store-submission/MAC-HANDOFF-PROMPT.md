Paste this to Claude on your Mac to pick up from here.

---

I'm submitting VINALL (album-ranking repo) to the App Store tonight. A Windows
session already did the code-side work; everything left needs Xcode/a Mac,
which is why I'm continuing here. Read `app-store-submission/CHECKLIST.md`,
`NATIVE-AUTH-SETUP.md` and `UNIVERSAL-LINKS-SETUP.md` in the repo for full
detail — this is the short version.

## Before payment / before submitting

1. **Pull the latest code.** `git pull` on `main` — tonight's session fixed a
   signup bug, a keyboard bug, and added Universal Links scaffolding.
   Confirm you actually have the commit (`git log -3`) before doing anything
   else.
2. **Install and sync native deps.**
   ```
   cd app
   npm install
   npx cap sync
   ```
   If `npm install` errors, paste the full output before trying anything else
   — don't guess at it.
3. **Apple/Google sign-in is already fully built** — a native Swift plugin
   (`VinallNativePlugin.webAuth` in `AppDelegate.swift`) opens the system
   sign-in sheet for both providers through one mechanism. It's just not
   switched on yet. Full steps in `app-store-submission/NATIVE-AUTH-SETUP.md`
   — short version: create an Apple Services ID + Sign In with Apple key,
   create a Google OAuth web client, enable both in **Supabase Dashboard →
   Authentication → Providers**, and add `xyz.wildcrate.vinall://auth` to
   **Authentication → URL Configuration → Redirect URLs**. No Xcode
   capability and no rebuild needed for any of this — it's all dashboard
   config, reopen the installed app to test.
4. **Universal Links** — `app-store-submission/UNIVERSAL-LINKS-SETUP.md`:
   replace `TEAMID` in `.well-known/apple-app-site-association` with my real
   Apple Team ID (commit+push that one file), add the **Associated Domains**
   capability in Xcode (`applinks:vinall.xyz`, `applinks:www.vinall.xyz`).
5. **Build to a real device** (not just the simulator) and test:
   - Sign up with a brand-new email, then try signing up again with the same
     email — should say "already exists," not "check your email"
   - Tap the email/password fields with the keyboard up — the sheet must
     resize and both fields must be reachable. **This was patched blind from
     a screenshot and never confirmed on a real device — check it properly.**
   - Once step 3's dashboard config is done: tap "Continue with Apple" and
     "Continue with Google," confirm each actually completes sign-in
6. Once everything above checks out: **archive the build in Xcode** and
   upload it to App Store Connect (Xcode → Product → Archive → Distribute App).

## After payment / submission (tonight)

Apple Developer Program enrolment should already be active before you can
upload a build at all — if it isn't yet, that's step zero, not something to
do after.

7. In **App Store Connect**, open the app record (or create one if this is
   the first submission) and fill in, copy-pasting straight from
   `app-store-submission/APP-STORE-CONNECT-COPY.md`:
   - Name, subtitle, category (Music + your pick of secondary), keywords,
     description, promotional text
   - Support URL: `https://excus.co.uk/vinall/support`
   - Marketing URL: `https://vinall.xyz`
   - Privacy Policy URL: `https://vinall.xyz/privacy.html`
   - Age rating questionnaire — answers are in that file
   - App Privacy ("nutrition label") — answers are in that file
8. Upload screenshots (already shot).
9. Select the build you archived in step 6.
10. **App Review Information**: demo account email/password (the one already
    created and populated — confirm `profiles.is_admin` is `false` on it one
    more time), reviewer contact details, and paste the notes from
    `app-store-submission/REVIEWER-NOTES.md` verbatim.
11. Submit for review.

If anything in Xcode or App Store Connect throws an error you don't
recognise, paste the exact text rather than paraphrasing it — several of
tonight's build errors so far have only been diagnosable from the literal
message.
