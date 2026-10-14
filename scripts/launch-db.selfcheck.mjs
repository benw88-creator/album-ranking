// Real PostgreSQL execution in isolated, in-memory PGlite. No live credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL('supabase/migrations/' + name, root), 'utf8');
const functionSQL = (source, name) => {
  const m = source.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$\\$;', 'i'));
  assert.ok(m, name); return m[0];
};
const economy = read('20260921140000_xp_from_everything.sql');
const freeze = read('20261013180000_freeze_and_double_discs.sql');
const migration = read('20261015000000_launch_security_and_integrity.sql');
const boards = read('20261014100000_game_leaderboards.sql');
const recall = read('20260925120000_recall_time_based_scoring.sql');
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const pin = functionSQL(economy, 'pin_profile_economy');
const fields = [...new Set([...pin.matchAll(/(?:new|old)\.(\w+)/g)].map(m => m[1]))].filter(x => x !== 'id');
const type = name => name === 'is_admin' ? 'boolean default false' : name.startsWith('owned_') ? "text[] default '{}'" :
  name.startsWith('active_') && name !== 'active_days' ? 'text' : /_date$/.test(name) ? 'date' :
  ['game_awards','game_plays'].includes(name) ? "jsonb default '{}'" : 'bigint default 0';
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon, authenticated, service_role;
  create table public.profiles(id uuid primary key references auth.users(id), ${fields.map(n => n + ' ' + type(n)).join(',')},
    boost_until timestamptz, streak_freeze_used_on date, missions_date date, missions_claimed text[]);
  create table public.ratings(user_id uuid references auth.users(id) on delete cascade, kind text, item_id text, data jsonb, updated_at timestamptz,
    primary key(user_id,kind,item_id));
  create table public.app_state(user_id uuid references auth.users(id) on delete cascade, key text, value jsonb, updated_at timestamptz,
    primary key(user_id,key));
  create table public.blocks(blocker_id uuid, blocked_id uuid, primary key(blocker_id,blocked_id));
  create table public.messages(sender_id uuid, recipient_id uuid, body text);
  create table public.push_subscriptions(endpoint text primary key,user_id uuid,p256dh text,auth text,created_at timestamptz default now());
  create table public.recall_daily(day integer primary key, answer text);
  create table public.recall_results(id uuid default gen_random_uuid(),user_id uuid,mode text,day integer,track text,
    step integer,reveal_seconds integer,attempts integer,score integer,correct boolean,verified boolean,unique(user_id,mode,day));
  create function public.recall_norm(text) returns text language sql immutable as $$select lower($1)$$;
  ${functionSQL(recall, 'recall_points')}
  ${functionSQL(recall, 'recall_submit')}
  ${functionSQL(boards, 'game_score')}
  create function public.push_unsubscribe(text) returns void language sql as $$select$$;
  create function public.level_for_xp(bigint) returns integer language sql as $$select 1$$;
  ${functionSQL(economy, 'xp_awards_total')}
  ${pin}
  ${functionSQL(freeze, 'boost_profile_awards')}
  ${functionSQL(freeze, 'wallet_record_rating')}
  create trigger pin_profile_economy before insert or update on profiles for each row execute function pin_profile_economy();
  create trigger boost_profile_awards_trg before insert or update on profiles for each row execute function boost_profile_awards();
  insert into auth.users values ('${a}'),('${b}');
  insert into profiles(id) values ('${a}'),('${b}');
  alter table profiles enable row level security;
  create policy profiles_own on profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
  alter table ratings enable row level security;
  create policy ratings_own on ratings for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
  alter table app_state enable row level security;
  create policy app_state_own on app_state for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
  alter table blocks enable row level security;
  create policy blocks_own on blocks for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
  alter table messages enable row level security;
  grant select,insert,update,delete on profiles,ratings,app_state,blocks,messages to authenticated;
`);
const sql = async (q, args=[]) => (await db.query(q, args)).rows;
const asUser = async (uid, fn) => {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${uid}';`);
  try { await fn(); } finally { await db.exec('reset role; reset "request.jwt.claim.sub";'); }
};
let checks=0;
const check = async (name, fn) => { await fn(); checks++; console.log('ok — '+name); };
try {
  // Confirm the actual old definition is vulnerable, so the regression is real.
  await asUser(a, async () => { await sql('update profiles set is_admin=true,discs=999 where id=$1', [a]); });
  assert.equal((await sql('select is_admin from profiles where id=$1',[a]))[0].is_admin,true);
  await db.exec(`update profiles set is_admin=false, discs=0 where id='${a}';`);
  await db.exec(migration);
  await db.exec(migration); // idempotency with installed triggers and grants
  await check('direct admin/disc/counter/cosmetic writes are pinned, including inserts', async () => {
    await asUser(a, async () => {
      await sql("update profiles set is_admin=true,discs=999999,owned_themes=array['stolen'],active_theme='stolen',active_days=999,game_awards='{}',boost_until=now()+interval '1 year' where id=$1",[a]);
      const p=(await sql('select * from profiles where id=$1',[a]))[0];
      assert.equal(p.is_admin,false); assert.equal(p.discs,0); assert.equal(p.active_days,0); assert.deepEqual(p.owned_themes,[]); assert.equal(p.active_theme,null); assert.equal(p.boost_until,null);
    });
    const c='33333333-3333-4333-8333-333333333333';
    await db.exec(`insert into auth.users values('${c}')`);
    await asUser(c,async()=>{await sql('insert into profiles(id,is_admin,discs) values($1,true,999999)',[c]);
      const p=(await sql('select is_admin,discs from profiles where id=$1',[c]))[0];assert.equal(p.is_admin,false);assert.equal(p.discs,0);});
  });
  await check('actual wallet RPC awards and daily cap still work', async () => {
    await asUser(a, async()=>{
      for(let i=0;i<12;i++) await sql('select wallet_record_rating()');
      const p=(await sql('select discs,rating_awards_count from profiles where id=$1',[a]))[0];
      assert.equal(p.discs,4000);assert.equal(p.rating_awards_count,10);
      await sql('update profiles set rating_awards_count=0,discs=999999 where id=$1',[a]);
      await sql('select wallet_record_rating()');
      assert.equal((await sql('select discs from profiles where id=$1',[a]))[0].discs,4000);
    });
  });
  await check('approved push providers accepted, arbitrary URLs and invalid keys rejected', async()=>{
    const endpoints=['https://web.push.apple.com/token','https://fcm.googleapis.com/fcm/send/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://wns2-by3p.notify.windows.com/?token=example'];
    await asUser(a,async()=>{
      for(const e of endpoints)await sql('select push_subscribe($1,$2,$3)',[e,'B'.repeat(87),'a'.repeat(22)]);
      for(const e of ['https://127.0.0.1/','https://fcm.googleapis.com.evil.test/fcm/send/x','https://user@web.push.apple.com/x','https://web.push.apple.com:444/x'])
        await assert.rejects(sql('select push_subscribe($1,$2,$3)',[e,'B'.repeat(87),'a'.repeat(22)]),/bad endpoint/);
      await assert.rejects(sql('select push_subscribe($1,$2,$3)',[endpoints[0],'bad','bad']),/bad subscription keys/);
    });
  });
  await check('recipient block stops message inserts while the block row remains private', async()=>{
    await asUser(b,async()=>{await sql('insert into blocks values($1,$2)',[b,a]);});
    await asUser(a,async()=>{
      assert.equal((await sql('select * from blocks')).length,0);
      await assert.rejects(sql("insert into messages values($1,$2,'blocked')",[a,b]),/row-level security/);
    });
    await asUser(b,async()=>{await sql('delete from blocks where blocker_id=$1',[b]);});
    await asUser(a,async()=>{await sql("insert into messages values($1,$2,'allowed')",[a,b]);});
  });
  await check('caller-supplied Recall answers cannot become public daily scores',async()=>{
    await db.exec("insert into recall_daily values(1,'known'),(2,'known')");
    await asUser(a,async()=>{
      const forged=(await sql("select recall_submit(1,'daily','forged',0,1,'forged',true,0) as r"))[0].r;
      assert.equal(forged.verified,false);
      const honest=(await sql("select recall_submit(2,'daily','known',0,1,'known',true,0) as r"))[0].r;
      assert.equal(honest.verified,true);
    });
    await assert.rejects(sql("select game_score('recall','daily','{}',10000,$1,1)",[a]),/no daily result/);
    assert.equal((await sql("select game_score('recall','daily','{}',10000,$1,2) as s",[a]))[0].s,1000);
  });
  await check('deletion survives stale rating and app_state writes; deliberate re-rating succeeds',async()=>{
    await asUser(a,async()=>{
      const old={ratedAt:100,savedAt:50,score:85};
      await sql("insert into ratings(user_id,kind,item_id,data) values($1,'album','record',$2)",[a,old]);
      await sql("insert into app_state(user_id,key,value) values($1,'crate_albums_v1',$2)",[a,{record:old}]);
      await sql("select rating_delete('album','record',200,$1)",[a]);
      await sql("insert into ratings(user_id,kind,item_id,data) values($1,'album','record',$2) on conflict(user_id,kind,item_id) do update set data=excluded.data",[a,old]);
      await sql("update app_state set value=$2 where user_id=$1 and key='crate_albums_v1'",[a,{record:old,other:{ratedAt:100}}]);
      assert.equal((await sql('select * from ratings where user_id=$1',[a])).length,0);
      assert.deepEqual((await sql('select value from app_state where user_id=$1',[a]))[0].value,{other:{ratedAt:100}});
      const fresh={ratedAt:300,score:90};
      await sql("insert into ratings(user_id,kind,item_id,data) values($1,'album','record',$2)",[a,fresh]);
      await sql("select rating_delete('album','record',200,$1)",[a]); // a delayed retry cannot erase a newer rating
      assert.deepEqual((await sql('select data from ratings where user_id=$1',[a]))[0].data,fresh);
    });
  });
  await check('old-client direct deletes establish tombstones, scoped to the owner',async()=>{
    await asUser(a,async()=>{await sql("delete from ratings where user_id=$1 and item_id='record'",[a]);assert.equal((await sql('select * from rating_deletions')).length,1);});
    await asUser(b,async()=>{
      assert.equal((await sql('select * from rating_deletions')).length,0);
      await assert.rejects(sql("insert into rating_deletions values($1,'song','x',1)",[b]),/permission denied/);
      await assert.rejects(sql("select rating_delete('song','never-synced',200,$1)",[a]),/account changed/);
      await sql("select rating_delete('song','never-synced',200,$1)",[b]);
    });
  });
  await check('legacy JSON column types also enforce deletion guards',async()=>{
    await db.exec('alter table ratings alter column data type json using data::json; alter table app_state alter column value type json using value::json;');
    // Compile the migration against the JSON schema, rather than reusing
    // PL/pgSQL record plans compiled for the earlier JSONB fixture.
    await db.exec(migration);
    await asUser(a,async()=>{
      await sql("insert into ratings(user_id,kind,item_id,data) values($1,'song','legacy',$2)",[a,{ratedAt:100}]);
      await sql("insert into app_state(user_id,key,value) values($1,'crate_songs_v1',$2)",[a,{legacy:{ratedAt:100}}]);
      await sql("select rating_delete('song','legacy',200,$1)",[a]);
      await sql("update app_state set value=$2 where user_id=$1 and key='crate_songs_v1'",[a,{legacy:{ratedAt:100}}]);
      assert.deepEqual((await sql("select value from app_state where user_id=$1 and key='crate_songs_v1'",[a]))[0].value,{});
    });
  });
  await check('private import cache rejects client reads/writes and account deletion cascades',async()=>{
    await asUser(a,async()=>{await assert.rejects(sql('select * from catalogue_matches'),/permission denied/);});
    await db.exec(`delete from profiles where id='${a}'; delete from auth.users where id='${a}';`);
    assert.equal((await sql('select * from rating_deletions where user_id=$1',[a])).length,0);
  });
  console.log(`launch database selfcheck: ${checks} groups passed (in-memory PostgreSQL)`);
} catch (e) {
  console.error(e.message); if(e.where)console.error(e.where);
  process.exitCode=1;
} finally { await db.close(); }
