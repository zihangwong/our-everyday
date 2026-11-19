import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const html=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const p=html.indexOf('function '+name+'(');assert.ok(p>0,name);return html.slice(html.slice(p-6,p)==='async '?p-6:p,html.indexOf('\n}',p)+2);}
function harness(names,extra={}){const h={crypto:webcrypto,backend:{user:'owner',ownerId:'owner',space:'diary',ready:true,revision:4,dirty:false,status:''},state:{config:{myName:'阿明',herName:'小雨'},dates:[],messages:[],meta:{updatedAt:'start'}},persistConfigOnly:()=>true,persistBackend(){},normalizeState:d=>structuredClone(d),...extra};vm.createContext(h);vm.runInContext(names.map(fn).join('\n'),h);return h;}

test('the composer derives the two signatures from the signed-in member and contains no author picker',()=>{
  const h=harness(['currentLetterIdentity','letterWho']);assert.equal(h.currentLetterIdentity().name,'阿明');h.backend.user='partner';assert.equal(h.currentLetterIdentity().name,'小雨');assert.equal(h.currentLetterIdentity().recipient,'阿明');assert.equal(h.letterWho({authorId:'partner',who:'my'}),'her');assert.equal(h.letterWho({authorId:'owner',who:'her'}),'my');h.backend.ownerId='';assert.equal(h.currentLetterIdentity(),null);assert.doesNotMatch(html,/id="msgWho"|data-who=/);
});
test('a new authoritative letter response retains simultaneous local edits; an idempotent replay cannot advance a stale local revision over remote edits',()=>{
  const h=harness(['applySentLetter']);const result={revision:5,message:{id:'m',authorId:'owner'},document:{config:{},dates:[],messages:[{id:'m'}],meta:{updatedAt:'remote'}},replayed:false};
  h.state.dates=[{id:'local-edit'}];h.state.meta.updatedAt='changed';const saved=h.applySentLetter(result,'start');assert.equal(saved.needsSync,true);assert.equal(h.state.dates[0].id,'local-edit');assert.equal(h.state.messages[0].id,'m');assert.equal(h.backend.revision,5);
  h.backend.revision=4;result.replayed=true;result.revision=8;assert.equal(h.applySentLetter(result,'start').needsSync,false);assert.equal(h.backend.revision,4);assert.match(h.backend.status,/备份/);
});
test('network retries reuse the same letter ID and send no client-selected name or role',async()=>{
  const elements=new Map([['msgText',{value:'给你的一封信'}],['letterStatus',{textContent:''}],['letterCharCount',{textContent:'8'}]]);const calls=[];
  const h=harness(['sendAuthenticatedLetter','applySentLetter'],{letterSending:false,letterAttempt:null,cloudBusy:false,cloudOperation:'',document:{getElementById:id=>elements.get(id)},currentLetterIdentity:()=>({name:'阿明'}),updateLetterComposer(){},renderCloudUI(){},renderMessages(){},renderHome(){},scheduleCloudPush(){},toast(){},backendErrorMessage:e=>e.message,getSupabase:async()=>({rpc:async(name,args)=>{calls.push({name,args});if(calls.length===1)return{error:{message:'network'}};const message={id:args.p_message_id,authorId:'owner',authorName:'阿明',text:args.p_text};return{data:{revision:5,message,document:{config:{},dates:[],messages:[message],meta:{updatedAt:'remote'}}}};}})});
  await h.sendAuthenticatedLetter();assert.equal(elements.get('msgText').value,'给你的一封信');assert.equal(h.cloudBusy,false);
  await h.sendAuthenticatedLetter();assert.equal(calls[0].args.p_message_id,calls[1].args.p_message_id);assert.deepEqual(Object.keys(calls[1].args).sort(),['p_id','p_message_id','p_revision','p_text']);assert.equal(elements.get('msgText').value,'');assert.equal(h.state.messages.length,1);
});

test('PostgreSQL signs letters from Auth, preserves legacy records, and handles retries without duplicate messages',async t=>{
  const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');`);
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/letter-authorship.sql',import.meta.url),'utf8'));
  async function asUser(n,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000000${n}',false);`);try{return await fn();}finally{await db.exec('reset role');}}
  const diary=(await asUser(1,()=>db.query('select public.create_diary() as value'))).rows[0].value;
  await asUser(2,()=>db.query('select public.join_diary($1)',[diary.invite_token]));
  const doc={config:{myName:'阿明',herName:'小雨'},dates:[{id:'memory',story:'原故事'}],messages:[{id:'legacy',who:'my',text:'保留历史',at:'2026-10-05'}]};
  await asUser(1,()=>db.query('select public.save_diary($1,0,$2)',[diary.id,doc]));
  const partnerId='10000000-0000-4000-8000-000000000001',ownerId='10000000-0000-4000-8000-000000000002';
  const send=(user,revision,id,text)=>asUser(user,async()=>(await db.query('select public.append_diary_letter($1,$2,$3,$4) as value',[diary.id,revision,id,text])).rows[0].value);
  await t.test('the partner is signed as 小雨 and owner as 阿明, without accepting a name parameter',async()=>{
    const partner=await send(2,1,partnerId,'来自她');assert.equal(partner.message.who,'her');assert.equal(partner.message.authorName,'小雨');assert.equal(partner.message.authorId,'00000000-0000-4000-8000-000000000002');assert.equal(partner.document.messages[0].who,'my');assert.equal(partner.document.dates[0].story,'原故事');
    const owner=await send(1,2,ownerId,'来自他');assert.equal(owner.message.who,'my');assert.equal(owner.message.authorName,'阿明');assert.equal(owner.revision,3);
  });
  await t.test('a repeated request returns the latest document without inserting a duplicate',async()=>{
    const replay=await send(2,1,partnerId,'来自她');assert.equal(replay.replayed,true);assert.equal(replay.revision,3);assert.equal(replay.document.messages.length,3);
    await assert.rejects(()=>send(1,3,partnerId,'来自她'),/LETTER_ID_CONFLICT/);
  });
  await t.test('stale, missing-revision, invalid and unrelated requests cannot change the diary',async()=>{
    const id='10000000-0000-4000-8000-000000000003';await assert.rejects(()=>send(2,1,id,'stale'),/DIARY_CONFLICT/);await assert.rejects(()=>send(2,null,id,'missing'),/DIARY_CONFLICT/);await assert.rejects(()=>send(3,3,id,'outsider'),/SPACE_FORBIDDEN/);await assert.rejects(()=>send(2,3,id,''),/INVALID_LETTER/);await assert.rejects(()=>send(2,3,id,'x'.repeat(501)),/INVALID_LETTER/);
    await db.exec('set role anon');await assert.rejects(()=>db.query('select public.append_diary_letter($1,3,$2,$3)',[diary.id,id,'anon']),/permission denied/);await db.exec('reset role');assert.equal((await db.query('select revision from public.diary_state')).rows[0].revision,3);
  });await db.close();
});
