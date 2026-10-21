# Submitting VINALL to the App Store, with Claude as the guide

Do [IOS-ON-YOUR-PHONE.md](IOS-ON-YOUR-PHONE.md) first, so the app already builds
and runs on your iPhone. Then open Claude Code on the Mac in this repo
(`~/dev/vinal`, after a `git pull`) and paste the prompt below. Claude walks you
through enrolment, the listing, TestFlight and review one step at a time, and
waits for you between steps.

You and your mum do the parts that need a password, a card or an ID check
yourselves, on Apple's website or in the Apple Developer app. Claude never asks
for them in chat.

```text
You are guiding me (Ben) through publishing VINALL to the Apple App Store, one step
at a time. I'm on a Mac in the VINALL repo. The iOS app is a Capacitor 8 project in
app/ and already builds and installs on my iPhone. VINALL is operated by Excus Ltd
(UK company no. 17517058). My mum is the director.

ALREADY DECIDED, do not re-open it: we are making a BRAND NEW Apple Account for
my mum using the Excus Ltd company email, and enrolling in the Apple Developer
Program as an ORGANISATION (Excus Ltd), not as an individual, with my mum as the
Account Holder. The App Store seller will be Excus Ltd, which matches our privacy
policy and terms. Your job is to make that happen, click by click.

Before anything else, read these files fully: STORE-SUBMISSION.md (the prepared App
Privacy answers, age rating, listing copy, App Review notes and the outstanding
blockers), LAUNCH-REVIEW.md, PRELAUNCH-AUDIT.md, and in CLAUDE.md the sections
"The native app — Capacitor, in app/", "Pre-submission pass (2026-10-21)" and
"Safety, age and moderation". The privacy policy and terms are live at
https://vinall.xyz/privacy.html and https://vinall.xyz/terms.html. The support
address is vinall.support@gmail.com.

HOW TO GUIDE ME
- One step at a time. For each step say what we're doing and why, give exact
  clicks and fields, then STOP and wait for me to say it's done or paste what I see.
  Don't run ahead.
- Apple changes its process, prices and screens often. Before telling me how a
  step works, check Apple's current documentation (developer.apple.com and
  App Store Connect Help) with web search, and say so if anything differs from
  what you expected. Prices are in GBP for the UK.
- Never ask me to paste passwords, 2FA codes, card numbers or my mum's ID into
  chat. You can't do the payment or identity steps; we do them on the website or
  in the Apple Developer app, and you tell me what to expect.
- Don't edit index.html, assets/ or api/, and don't push to main. That deploys
  the live site, and the code is frozen for this release. You MAY change Xcode
  signing settings and the app's version/build numbers when a step needs it. Show
  me the diff first, and commit those on a branch only when I say so.
- Keep a running checklist at the top of each reply: done / now / next.

THE STEPS (adjust if Apple's current process says otherwise)

1. Check what Excus Ltd needs before enrolling, and tell me what to gather:
   - Its D-U-N-S number. Walk me through Apple's own D-U-N-S lookup (on the
     developer site) with the company's exact registered name and address as on
     Companies House. If it has none, walk me through requesting one free
     through Apple's form, and tell me how long that usually takes and that the
     name/address must match Companies House exactly.
   - A website for the company (https://vinall.xyz) and a company-domain email
     address if Apple requires one for organisations. Check Apple's current
     rules. If the company email isn't on its own domain, tell me what to do.
   - That my mum, as director, has legal authority to bind Excus Ltd, and what
     Apple may do to verify that (e.g. a verification phone call).
   Wait until I confirm we have the D-U-N-S number.

2. Create the new Apple Account for my mum with the Excus Ltd email, on her
   iPhone or at account.apple.com: her legal name exactly as on her photo ID,
   date of birth, a UK phone number she can receive codes on, and two-factor
   authentication turned on (Apple requires it). Tell me which fields matter
   for enrolment and which don't. Warn me about anything that makes enrolment
   fail later, such as a name mismatch or the account being too new on a device.

3. Enrol as an Organisation and pay the annual fee (expect £79/year; confirm
   the current UK price). Use whichever route Apple currently recommends: the
   Apple Developer app on her iPhone, or developer.apple.com/programs/enroll.
   Go field by field: entity type (company/organisation), legal entity name
   "Excus Ltd" exactly as on D-U-N-S, D-U-N-S number, headquarters address,
   phone, website, her role/title as director, and accepting the Program
   License Agreement. Then the payment step. Tell me what happens next (Apple
   verification, a possible phone call to her, how long it usually takes, which
   emails to watch for) and what to do if it stalls.
   Wait here until enrolment is confirmed.

4. Once approved: have her invite me to the team (App Store Connect → Users and
   Access) with the least role that lets me upload builds and manage the listing.
   Check whether Apple has an age requirement for team members and tell me
   honestly if that affects me. Find the new Team ID.

5. Point the Xcode project at the new team. The project is currently set to team
   92R3V4JXWU. Check whether that IS the new team; if not, update
   DEVELOPMENT_TEAM. Keep the bundle ID xyz.wildcrate.vinall (never change it).
   Register the bundle ID in Certificates, Identifiers & Profiles if Xcode
   doesn't. Confirm capabilities match what the app uses (background audio
   only; no push in the native app).

6. Create the app record in App Store Connect: name "VINALL" (and what to do if
   it's taken), primary language English (UK), bundle ID, a SKU, and pricing:
   free with no in-app purchases. Explain the EU Digital Services Act trader
   status question, what declaring as a trader publishes, and let me decide.

7. Fill in the listing from STORE-SUBMISSION.md: description, subtitle,
   keywords, support URL, privacy policy URL, category, age rating questionnaire,
   App Privacy nutrition label, and export compliance (the app uses only
   standard HTTPS; tell me whether ITSAppUsesNonExemptEncryption should be set
   in Info.plist). Re-check every privacy answer against the code before I
   submit it, as STORE-SUBMISSION.md insists, and flag anything that has drifted.

8. The App Review demo account (a hard blocker per STORE-SUBMISSION.md):
   a fresh NON-admin account with a populated crate, never anyone's real account,
   because review tests account deletion. Walk me through making it and
   filling it with ratings, and where its credentials go.

9. Screenshots at the sizes Apple currently requires, taken from the demo
   account on the simulator or my phone. Suggest which 5–6 screens to show.

10. Archive and upload: set the marketing version (1.0.0) and build number, run
    `cd app && npm run sync`, archive in Xcode with the Release configuration
    and upload to App Store Connect. Explain processing time and how to read any
    upload errors.

11. TestFlight first: internal testing on my phone (and my mum's), then a
    short checklist of what to try before submitting.

12. Submit for review: paste the App Review notes from STORE-SUBMISSION.md
    (updated for anything that changed), choose manual release, and explain
    what typically gets apps like ours rejected (guidelines 4.2, 1.2, 3.1.1,
    5.1.1) and how our notes answer each.

13. After review: how to read a rejection and reply in Resolution Center,
    release the app, and what's due again each year (renewal, keeping the demo
    account alive, the support inbox).

Start with step 1. Don't re-explain the Individual vs Organisation choice; it is made.
```
