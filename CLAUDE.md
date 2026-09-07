# Vinal

Album-ranking web app, live at https://wildcrate.xyz.

## Shape

Zero-config Vercel deployment — there is no build step and no `package.json`.

- `index.html` — the entire front end, one large file (~540KB). Vanilla JS, no framework.
- `api/*.js` — Vercel serverless functions, auto-detected from the folder:
  - `login.js` — redirects to Spotify's authorise screen
  - `callback.js` — exchanges the Spotify code for an access token
  - `app-token.js` — mints an app-level token (Client Credentials) so guests can browse without logging in
- `assets/`, `dither-frames/` — static media
- `supabase-migration-discs.sql` — loose schema SQL (see Database below)

Data comes from the Spotify Web API; user data is stored in Supabase.

## Deploying

GitHub → Vercel is connected. **Push to `main` and the site is live** in roughly half a minute:

```
git add -A && git commit -m "..." && git push
```

There is nothing to run locally to make a deploy happen. Verify on the live URL after the push.

## Working across two machines

Both this machine and Ben's main PC have clones. `index.html` is one enormous file, so
concurrent edits conflict badly and are painful to resolve.

**Always `git pull` before touching anything, and push as soon as a change is finished.**
Never leave uncommitted work sitting on one machine.

## Environment variables

Set in Vercel → Project → Settings → Environment Variables. Not in the repo.

- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
- `REDIRECT_URI` — must exactly match a redirect URI registered in the Spotify developer
  dashboard. This is why preview deploys can't complete an OAuth login: their URLs aren't
  registered. Guest mode (`/api/app-token`) works on previews regardless.

The Supabase URL and anon key are inlined in `index.html`. That is normal for Supabase —
the anon key is meant to be public — but it only stays safe while Row Level Security is
enabled on every table.

For local work (optional, needs Node): `vercel env pull .env.local`.

## Database

Supabase project ref `cqfxyebejpkyhswolrwi`.

The schema is currently maintained by hand in the Supabase dashboard; only
`supabase-migration-discs.sql` is tracked, and it is not a full history. This is the one
part of the project that does not travel between machines. To fix that:
`supabase link --project-ref cqfxyebejpkyhswolrwi` then `supabase db pull` to snapshot the
live schema into `supabase/migrations/`, and commit it.
