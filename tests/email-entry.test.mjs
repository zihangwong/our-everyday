import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';

const edgeSource=await readFile(new URL('../supabase/functions/email-entry/index.ts',import.meta.url),'utf8');
const edgeCode=edgeSource.replace(/^import .*\n/,'').replace('export function','function').replace(/\nDeno\.serve[\s\S]*$/,'');
function edgeHarness(overrides={}){
  const calls=[],diary='10000000-0000-4000-8000-000000000001',user='20000000-0000-4000-8000-000000000002';
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return name==='begin_email_entry'?{data:{diary_id:diary,auth_user_id:null}}:{data:diary};},auth:{admin:{createUser:async args=>{calls.push(['createUser',args]);return{data:{user:{id:user}}};},generateLink:async args=>{calls.push(['generateLink',args]);return{data:{user:{id:user,email:args.email},properties:{hashed_token:'private-one-time-hash',action_link:'private-one-time-link'}}};}}}};
  const client={auth:{verifyOtp:async args=>{calls.push(['verifyOtp',args]);return{data:{user:{id:user},session:{access_token:'visitor-access',refresh_token:'visitor-refresh',expires_at:999}}};}}};
  Object.assign(admin,overrides.admin||{});Object.assign(client.auth,overrides.auth||{});
  const env={SUPABASE_URL:'https://unit.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'SERVER-ONLY-SECRET',SUPABASE_ANON_KEY:'client-key',EMAIL_ENTRY_ORIGINS:'https://our.test'};
  const h=vm.createContext({Request,Response,TextEncoder,createClient:(_url,key)=>key===env.SUPABASE_SERVICE_ROLE_KEY?admin:client,env:n=>env[n]});vm.runInContext(edgeCode,h);
  return {calls,diary,user,admin,handler:h.createEmailEntryHandler({createClient:h.createClient,env:h.env})};
}
function request(email,extra={}){return new Request('https://unit.supabase.co/functions/v1/email-entry',{method:'POST',headers:{origin:'https://our.test','content-type':'application/json'},body:JSON.stringify({email,...extra})});}

test('email-only entry issues a visitor session and joins the server-selected diary without sending mail or exposing admin material',async()=>{
  const h=edgeHarness(),r=await h.handler(request(' Partner@Example.com ',{diary_id:'attacker-diary',user_id:'attacker-user'})),data=await r.json();
  assert.equal(r.status,200);assert.equal(data.diary_id,h.diary);assert.equal(data.session.access_token,'visitor-access');assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(h.calls[0][1].p_email,'partner@example.com');assert.equal(h.calls.find(c=>c[0]==='admit_email_entry')[1].p_user_id,h.user);
  assert.equal(h.calls.find(c=>c[0]==='verifyOtp')[1].type,'email');
  assert.doesNotMatch(JSON.stringify(data),/SERVER-ONLY-SECRET|private-one-time|client-key/);
  assert.equal(h.calls.find(c=>c[0]==='generateLink')[1].type,'magiclink');
});
test('unapproved addresses and throttled requests never create identities or sessions',async()=>{
  for(const reason of ['EMAIL_ENTRY_DENIED','EMAIL_ENTRY_LIMIT']){
    const h=edgeHarness({admin:{rpc:async()=>({error:{message:reason}})}}),r=await h.handler(request('outsider@example.com'));
    assert.equal(r.status,reason.endsWith('LIMIT')?429:403);assert.equal(h.calls.length,0);assert.equal((await r.json()).session,undefined);
  }
});
test('malformed, oversized, unexpected-origin and non-POST requests do not reach account administration',async()=>{
  const h=edgeHarness();
  for(const req of [request('not-an-email'),request('x'.repeat(1200)),new Request('https://unit.test',{method:'POST',headers:{origin:'https://elsewhere.test'},body:'{}'}),new Request('https://unit.test')]){
    assert.ok((await h.handler(req)).status>=400);
  }
  assert.equal(h.calls.length,0);
});
test('a full diary or failed OTP exchange never returns login tokens',async()=>{
  const full=edgeHarness({admin:{rpc:async(name)=>name==='begin_email_entry'?{data:{diary_id:'d',auth_user_id:'u'}}:{error:{message:'EMAIL_ENTRY_FULL'}}}});
  assert.equal((await full.handler(request('partner@example.com'))).status,403);
  const denied=edgeHarness({auth:{verifyOtp:async()=>({error:{message:'expired'}})}}),r=await denied.handler(request('partner@example.com'));
  assert.equal(r.status,503);assert.equal((await r.json()).session,undefined);
});

test('email-entry database rules are server-only, bind the real Auth email and keep the two-person limit',async t=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text unique);
    create table public.diaries(id uuid primary key);
    create table public.diary_members(diary_id uuid references public.diaries(id),user_id uuid references auth.users(id),primary key(diary_id,user_id));
    insert into auth.users values('00000000-0000-4000-8000-000000000001','owner@example.com'),('00000000-0000-4000-8000-000000000002','partner@example.com'),('00000000-0000-4000-8000-000000000003','outsider@example.com');
    insert into public.diaries values('10000000-0000-4000-8000-000000000001');
    insert into public.diary_members values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');`);
  await db.exec(await readFile(new URL('../supabase/email-entry.sql',import.meta.url),'utf8'));
  await db.exec(`insert into public.email_entry_allowlist(email,diary_id,enabled) values('partner@example.com','10000000-0000-4000-8000-000000000001',true);`);
  async function role(name,fn){await db.exec('set role '+name);try{return await fn();}finally{await db.exec('reset role');}}
  await t.test('browser roles cannot enumerate the allowlist or admit their own identities',async()=>{
    for(const name of ['anon','authenticated']){
      await assert.rejects(()=>role(name,()=>db.query('select * from public.email_entry_allowlist')),/permission denied/);
      await assert.rejects(()=>role(name,()=>db.query("select public.begin_email_entry('partner@example.com')")),/permission denied/);
      await assert.rejects(()=>role(name,()=>db.query("select public.admit_email_entry('partner@example.com','00000000-0000-4000-8000-000000000003')")),/permission denied/);
    }
  });
  await t.test('the allowed identity joins idempotently; substituting another user is refused',async()=>{
    await assert.rejects(()=>role('service_role',()=>db.query("select public.admit_email_entry('partner@example.com','00000000-0000-4000-8000-000000000003')")),/EMAIL_ENTRY_DENIED/);
    for(let i=0;i<2;i++)await role('service_role',()=>db.query("select public.admit_email_entry('partner@example.com','00000000-0000-4000-8000-000000000002')"));
    assert.equal((await db.query('select count(*) from public.diary_members')).rows[0].count,2);
    await db.exec("insert into public.email_entry_allowlist(email,diary_id,enabled) values('outsider@example.com','10000000-0000-4000-8000-000000000001',true)");
    await assert.rejects(()=>role('service_role',()=>db.query("select public.admit_email_entry('outsider@example.com','00000000-0000-4000-8000-000000000003')")),/EMAIL_ENTRY_FULL/);
  });
  await t.test('the per-address allowance is atomic and can be disabled without making files public',async()=>{
    for(let i=0;i<6;i++)await role('service_role',()=>db.query("select public.begin_email_entry('partner@example.com')"));
    await assert.rejects(()=>role('service_role',()=>db.query("select public.begin_email_entry('partner@example.com')")),/EMAIL_ENTRY_LIMIT/);
    await db.exec("update public.email_entry_allowlist set enabled=false where email='partner@example.com'");
    await assert.rejects(()=>role('service_role',()=>db.query("select public.begin_email_entry('partner@example.com')")),/EMAIL_ENTRY_DENIED/);
    assert.equal((await db.query('select count(*) from public.diary_members')).rows[0].count,2);
  });
  await db.close();
});
