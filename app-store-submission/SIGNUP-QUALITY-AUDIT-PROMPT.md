Paste this into a new Claude Code session (or `/loop` it periodically) whenever you want a dedicated pass on the sign-up/login flow. It's also baked into `CLAUDE.md` now as a standing rule, so any Claude session touching this area should already know the bar — this is for when you want someone to actively go hunting.

---

Audit VINALL's entire sign-up and login flow for anything that could read as
a lie, a stutter, or a dead end. This is the single most important screen in
the app — it's the only one a non-user ever sees — so the bar is "nothing it
says or does could possibly mislead someone," not "it mostly works."

Specifically check, by actually trying each one (don't just read the code):

1. Sign up with an email that already has a CONFIRMED account. The message
   shown must be true — no "check your email" if nothing was sent.
2. Sign up with an email that has an UNCONFIRMED account (resend case).
3. Sign up, then immediately try to sign up again with the same email before
   confirming.
4. Log in with a wrong password, a non-existent email, an empty field.
5. Trigger a password reset, then try the link twice (should say it expired,
   not error silently).
6. Trigger a password reset, let the link sit 2+ minutes, then use it.
7. Open the sign-up sheet on a phone-sized viewport and focus the email
   field, then the password field — watch for any stutter, jump, or content
   hidden behind the keyboard or its autofill/QuickType bar.
8. Close and reopen the sheet mid-typing — nothing should be lost or stuck.
9. Submit while offline / with a flaky connection — the error must be
   accurate ("network error," not "something went wrong" for a network
   failure specifically).
10. If native Apple/Google sign-in is wired by the time you read this: cancel
    the native sheet partway through, and confirm the button returns to its
    normal state rather than hanging on "please wait."
11. Confirmation and reset emails, if Universal Links are set up: tap one
    with the app installed and confirm it opens the APP, not Safari.

For each one, report: what actually happened, whether the message shown was
literally true, and whether anything visibly glitched. Fix anything that
fails, in the smallest diff that fixes the actual cause — not a cosmetic
patch over the symptom. Update `CLAUDE.md`'s "Sign-up and login are the one
screen that must never be wrong" section with whatever you find, in the same
style as the two entries already there, so the next person doesn't rediscover
it.
