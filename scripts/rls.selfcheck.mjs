// The consolidated ratings RLS (20261023180000) must allow and refuse exactly
// what production's six dashboard policies did. Real Postgres in PGlite, no
// credentials: both policy sets run over the same randomised accounts, follows
// and visibilities, and every viewer's reads and writes are compared.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Copied from pg_policies in production, 2026-10-23.
const OLD = `
create policy "ratings update own" on public.ratings for update using (auth.uid() = user_id);
create policy "ratings delete own" on public.ratings for delete using (auth.uid() = user_id);
create policy "users write own ratings" on public.ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ratings select friends or public" on public.ratings for select using (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ratings.user_id) AND ((p.ratings_visibility = 'public'::text) OR ((p.ratings_visibility = 'friends'::text) AND (EXISTS ( SELECT 1
           FROM follows a
          WHERE ((a.follower_id = auth.uid()) AND (a.following_id = ratings.user_id)))) AND (EXISTS ( SELECT 1
           FROM follows b
          WHERE ((b.follower_id = ratings.user_id) AND (b.following_id = auth.uid())))))))));
create policy "ratings insert own" on public.ratings for insert with check (auth.uid() = user_id);
create policy "ratings select own" on public.ratings for select using (auth.uid() = user_id);`;
const FILE = fs.readFileSync(new URL('../supabase/migrations/20261023180000_ratings_rls_consolidate.sql', import.meta.url), 'utf8')
  .replace(/^begin;|^commit;/gm, '');
// The migration refuses to run while any visibility is NULL/unknown; the
// equivalence below deliberately includes those, so it runs the policies alone.
const GUARD = FILE.match(/do \$\$[\s\S]*?end \$\$;/)[0];
const NEW = FILE.replace(GUARD, '');

const users = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
const VIS = ['public', 'friends', 'private', null];
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

async function world(policies, scenario) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    create table public.profiles(id uuid primary key, ratings_visibility text);
    create table public.follows(follower_id uuid, following_id uuid, primary key(follower_id, following_id));
    create table public.ratings(user_id uuid, kind text, item_id text, data jsonb, primary key(user_id, kind, item_id));
    alter table public.ratings enable row level security;
    grant select on public.profiles, public.follows to anon, authenticated;
    grant select, insert, update, delete on public.ratings to anon, authenticated;`);
  for (const [i, u] of users.entries()) {
    await db.query('insert into profiles values ($1, $2)', [u, scenario.vis[i]]);
    await db.query(`insert into ratings values ($1, 'album', 'a', '{}'), ($1, 'song', 's', '{}')`, [u]);
  }
  for (const [a, b] of scenario.follows) await db.query('insert into follows values ($1, $2)', [a, b]);
  await db.exec(policies);
  return db;
}
async function as(db, who, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${who ? 'authenticated' : 'anon'}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who || '']);
    const r = await db.query(sql, params);
    return { rows: r.rows, n: r.affectedRows };
  } catch (e) { return { error: e.message.split('\n')[0] }; }
  finally { await db.exec('rollback'); }
}
async function observe(db) {
  const out = {};
  for (const who of [null, ...users]) {
    const k = who ? who.slice(-1) : 'anon';
    out[k + ' reads'] = (await as(db, who, 'select user_id, kind from ratings order by 1, 2')).rows.map(r => r.user_id.slice(-1) + r.kind[0]).join(',');
    for (const target of users.slice(0, 3)) {
      const t = target.slice(-1);
      const ins = await as(db, who, `insert into ratings values ($1, 'album', 'new', '{}')`, [target]);
      out[`${k} inserts for ${t}`] = ins.error ? 'refused' : 'ok';
      out[`${k} updates ${t}`] = String((await as(db, who, `update ratings set data = '{"x":1}' where user_id = $1`, [target])).n ?? 'refused');
      out[`${k} moves own row to ${t}`] = (await as(db, who, `update ratings set user_id = $1 where user_id = $2 and kind = 'album'`, [target, who])).error ? 'refused' : 'ok';
      out[`${k} deletes ${t}`] = String((await as(db, who, 'delete from ratings where user_id = $1', [target])).n ?? 'refused');
    }
  }
  return out;
}

let compared = 0, readsSeen = new Set();
for (let s = 0; s < 12; s++) {
  const vis = users.map((_, i) => s === 0 ? VIS[i % 4] : VIS[Math.floor(rnd() * 4)]);
  const follows = [];
  for (const a of users) for (const b of users) if (a !== b && rnd() < 0.35) follows.push([a, b]);
  const scenario = { vis, follows };
  const before = await observe(await world(OLD, scenario));
  const after = await observe(await world(NEW, scenario));
  assert.deepEqual(after, before, 'scenario ' + s);
  Object.entries(before).forEach(([k, v]) => { if (k.endsWith('reads')) readsSeen.add(v); });
  compared += Object.keys(before).length;
}
// The scenarios must actually exercise the friends branch, not just public/private.
assert.ok(readsSeen.size > 20, 'scenarios too uniform to prove anything');
const db = await world(FILE, { vis: users.map(() => 'public'), follows: [] });
const blank = new PGlite();
await blank.exec(`create table public.profiles(id uuid, ratings_visibility text); insert into public.profiles values (gen_random_uuid(), null);`);
await assert.rejects(blank.exec(GUARD), /blank or unknown/);
assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename = 'ratings'`)).rows[0].n, 4);
assert.match((await db.query(`select qual from pg_policies where policyname = 'ratings read'`)).rows[0].qual, /SELECT auth\.uid\(\)/i);
console.log(`ok — ratings RLS: ${compared} read/write outcomes identical across 12 scenarios, ${readsSeen.size} distinct read sets`);
