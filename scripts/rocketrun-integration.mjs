// Complete browser -> real route -> isolated PostgreSQL -> results/payout.
// Real MusicBrainz reads; every database/auth call is intercepted locally.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { chromium } from 'playwright';
process.env.SUPABASE_URL='https://rocketrun-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-test-only';
const {default:handler}=await import('../api/rocketrun.js');
const db=new PGlite();const user='11111111-1111-4111-8111-111111111111';
await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create table public.profiles(id uuid primary key,discs bigint default 0,game_awards_date date,game_awards jsonb default '{}');
 create table public.game_bests(game text,mode text,artist_key text,day integer,user_id uuid,score integer,elapsed_ms integer,achieved_at timestamptz,primary key(game,mode,artist_key,day,user_id));
 insert into auth.users values('${user}');insert into public.profiles(id) values('${user}');
`);
const migration=n=>fs.readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
await db.exec(migration('20261113160000_rocketrun.sql'));
await db.exec(migration('20261113210000_rocketrun_timer.sql'));
await db.exec(migration('20261113220000_rocketrun_og_hardening.sql').split('-- 3.')[0]);
const day=(await db.query('select public.rr_today() as day')).rows[0].day;
const questions=[
 {kind:'album',text:'Name an album first released in 1997.',hint:'',tier:1,conds:[['year',1997]]},
 {kind:'artist',text:'Name an artist whose name starts with M.',hint:'',tier:1,conds:[['starts','M']]},
 {kind:'album',text:'Name an album whose title starts with B.',hint:'',tier:2,conds:[['starts','B']]},
 {kind:'album',text:'Name an album with a colour in its title.',hint:'',tier:2,conds:[['colour']]},
 {kind:'album',text:'Name a live album from the 1970s.',hint:'',tier:3,conds:[['live'],['between',1970,1979]]}
];
await db.query('insert into rr_days(day,questions,version) values($1,$2,1)',[day,JSON.stringify(questions)]);
const nativeFetch=globalThis.fetch;let injected=0;const calls=[];const responses=[];const arrivals=[];
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input));
 if(u.hostname==='rocketrun-test.invalid'){
  let out;
  if(u.pathname==='/auth/v1/user')return Response.json({id:user});
  const body=init.body?JSON.parse(init.body):{};
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const fn=u.pathname.split('/').at(-1);assert.match(fn,/^rr_[a-z_]+$/);
   if(fn==='rr_attempt_q'&&body.p_q===0){
    const row=(await db.query('select extract(epoch from (now()-q_open_at))*1000 as ms from rr_runs where user_id=$1 and day=$2',[user,day])).rows[0];
    arrivals.push({received:body.p_received,elapsedMs:Number(row.ms)});
   }
   const entries=Object.entries(body);assert.ok(entries.every(([k])=>/^p_[a-z_]+$/.test(k)));
   const sql='select public.'+fn+'('+entries.map(([k],i)=>k+' := $'+(i+1)).join(',')+') as result';
   out=(await db.query(sql,entries.map(([,v])=>v))).rows[0].result;
  } else if(u.pathname==='/rest/v1/rr_days')out=(await db.query('select questions from rr_days where day=$1',[Number(u.searchParams.get('day').slice(3))])).rows;
  else if(u.pathname==='/rest/v1/rr_entities'){
   if(init.method==='POST'){
    await db.query('insert into rr_entities(id,facts,fetched_at) values($1,$2,$3) on conflict(id) do update set facts=excluded.facts,fetched_at=excluded.fetched_at',[body.id,JSON.stringify(body.facts),body.fetched_at]);out=null;
   }else out=(await db.query('select facts,fetched_at from rr_entities where id=$1',[u.searchParams.get('id').slice(3)])).rows;
  }else throw new Error('Unexpected local database path '+u.pathname);
  return out===null?new Response('',{status:200}):Response.json(out);
 }
 assert.equal(u.hostname,'musicbrainz.org','refusing unexpected external service');
 // The first three server entity requests fail as 503, while browser search is real.
 if(u.pathname.startsWith('/ws/2/release-group/')&&++injected<=3)return Response.json({error:'injected upstream outage'},{status:503,headers:{'Retry-After':'0'}});
 return nativeFetch(input,init);
};
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
let aged=false;
const server=http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/rocketrun'){
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{};calls.push({op:body.op||u.searchParams.get('op'),q:body.q,retry:!!body.retry});
  if(body.op==='answer'&&body.q===0&&!aged){aged=true;await db.query("update rr_runs set q_open_at=now()-interval '30 seconds' where user_id=$1 and day=$2",[user,day]);}
  const shim={setHeader:(k,v)=>res.setHeader(k,v),status(s){res.statusCode=s;return shim;},json(j){responses.push({op:body.op||u.searchParams.get('op'),q:body.q,ok:j.ok,reason:j.reason,receipt:!!j.retry});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(j));return shim;},end(){res.end();return shim;}};
  return await handler({method:req.method,headers:req.headers,query:Object.fromEntries(u.searchParams),body},shim);
 }
 if(u.pathname.startsWith('/api/')){res.statusCode=404;return res.end('{}');}
 const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));console.error('local integration handler:',e.message);}
});
await new Promise(resolve=>server.listen(4397,'127.0.0.1',resolve));
let browser;const result={database:'isolated in-memory PostgreSQL',productionWrites:0,liveMusicBrainz:true};
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.routeWebSocket('**/*',s=>s.close());
 await ctx.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='127.0.0.1'&&u.hostname!=='musicbrainz.org')return route.fulfill({status:200,json:{}});
  return route.continue();
 });
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4397/');await page.waitForFunction(()=>window.Cloud&&Cloud.client());
 if(await page.locator('#splash-cta').isVisible())await page.locator('#splash-cta').click();
 await page.waitForFunction(()=>!document.getElementById('splash-gate'));
 await page.evaluate(id=>{Cloud.client=()=>({auth:{getSession:async()=>({data:{session:{access_token:'isolated-fixture-session',user:{id}}}}),onAuthStateChange(){}}});RocketRunHost.open();},user);
 const g=page.frameLocator('#rocketrun-sheet iframe');await g.locator('#start').waitFor({timeout:20000});await g.locator('#start').click();
 const plan=[['Radiohead OK Computer','OK Computer'],['Mitski','Mitski'],['Frank Ocean Blonde','Blonde'],['Miles Davis Kind of Blue','Kind of Blue'],['The Allman Brothers Band At Fillmore East','At Fillmore East']];
 for(let q=0;q<5;q++){
  await g.locator('.card-tab').filter({hasText:`${q+1} OF 5`}).waitFor({timeout:30000});
  await g.locator('#answer').fill(plan[q][0]);
  const chosen=g.locator('#pick:not([hidden])',{hasText:plan[q][1]});const suggestion=g.locator('.suggestion',{hasText:plan[q][1]}).first();
  await chosen.or(suggestion).waitFor({timeout:22000});if(!await chosen.count())await suggestion.click();
  await g.locator('#launch-answer').click();
  console.log('Submitted live MusicBrainz answer',q+1,plan[q][1]);
  if(q===0){
   await page.waitForFunction(id=>!!sessionStorage.getItem('vinall_rocketrun_pending:'+id),user,{timeout:20000});
   const frame=page.frames().find(f=>f.url().includes('/arcade/rocketrun/index.html'));
   await frame.evaluate(()=>location.reload());
   await g.locator('#start').waitFor({timeout:30000});
   await g.locator('#start').click();
  }
 }
 await g.locator('.results-card').waitFor({timeout:45000});
 const state=(await db.query('select public.rr_state($1,$2) as result',[user,day])).rows[0].result;
 const profile=(await db.query('select discs,game_awards from profiles where id=$1',[user])).rows[0];
 assert.equal(state.finished,true);assert.equal(state.answers.length,5);assert.ok(state.answers.every(a=>a.key&&!a.timeout));
 assert.equal(profile.discs,1600);assert.equal(profile.game_awards.rocketrun,1);
 assert.equal((await db.query('select count(*)::int as n from game_bests')).rows[0].n,2);
 assert.ok(responses.some(r=>r.reason==='busy'&&r.receipt),'injected outage produced a retry receipt');
 assert.ok(calls.some(r=>r.op==='answer'&&r.q===0&&r.retry),'browser retried the exact first answer');
 assert.ok(arrivals.length>=2&&arrivals.at(-1).elapsedMs>32500,'retry was after the real server deadline plus grace');
 assert.ok(arrivals.every(a=>a.received===arrivals[0].received),'the original server arrival was preserved');
 assert.equal(calls.filter(c=>c.op==='pass').length,0,'no outage-induced pass');
 assert.equal(errors.length,0);
 Object.assign(result,{status:'passed',answers:5,total:state.total,discs:profile.discs,gameAwards:profile.game_awards.rocketrun,leaderboardRows:2,injected503s:Math.min(injected,3),sameAnswerReceiptUsed:true,lateRetryElapsedMs:arrivals.at(-1).elapsedMs,originalArrivalPreserved:true,receiptSurvivedRefresh:true,javascriptErrors:errors});
 console.log(JSON.stringify(result,null,2));
}catch(e){result.status='failed';result.error=e.message;result.responses=responses;result.calls=calls;console.error(JSON.stringify(result,null,2));process.exitCode=1;}
finally{fs.mkdirSync('scripts/audit-artifacts',{recursive:true});fs.writeFileSync('scripts/audit-artifacts/rocketrun-integration.json',JSON.stringify(result,null,2));if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();globalThis.fetch=nativeFetch;}
