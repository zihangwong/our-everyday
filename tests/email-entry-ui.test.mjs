import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>0);return source.slice(source.slice(start-6,start)==='async '?start-6:start,source.indexOf('\n}',start)+2);}
function harness(names,extra={}){
  const events=[];
  const h={events,state:{meta:{}},backend:{space:'',user:'partner',ready:false,dirty:false,status:'',revision:0},
    PUBLIC_DIARY_CONFIG:{url:'https://our-project.supabase.co',key:'sb_publishable_frontend'},
    persistBackend(){events.push('persist');},renderAll(){},renderCloudUI(){},hydrateMedia:async()=>{},
    hideEmailEntry(){events.push('unlocked');},showEmailEntry(message){events.push(['locked',message]);},backendErrorMessage:e=>e.message,
    ...extra};vm.createContext(h);vm.runInContext(names.map(fn).join('\n'),h);return h;
}
test('a new device discovers its existing membership and waits for cloud hydration before unlocking',async()=>{
  const h=harness(['enterConnectedDiary']);let selectedUser;
  h.getSupabase=async()=>({from(table){assert.equal(table,'diary_members');return{select(){return this;},eq(field,value){assert.equal(field,'user_id');selectedUser=value;return this;},limit(){return this;},maybeSingle:async()=>({data:{diary_id:'shared-diary'}})};}});
  h.cloudPull=async force=>{assert.equal(force,true);assert.equal(h.events.includes('unlocked'),false);h.backend.ready=true;h.events.push('hydrated');};
  await h.enterConnectedDiary();assert.equal(selectedUser,'partner');assert.equal(h.backend.space,'shared-diary');assert.deepEqual(h.events.slice(-2),['hydrated','unlocked']);
});
test('failed cloud reads and unsynced local memories keep the entry gate closed',async()=>{
  const h=harness(['enterConnectedDiary'],{getSupabase:async()=>({}),cloudPull:async()=>{h.backend.status='读取失败';}});
  await assert.rejects(h.enterConnectedDiary('shared-diary'),/读取失败/);assert.equal(h.events.includes('unlocked'),false);
  h.state.meta.pendingCloud=true;h.backend.space='old-diary';await assert.rejects(h.enterConnectedDiary('other-diary'),/未同步/);assert.equal(h.backend.space,'old-diary');
});
test('email submission uses the configured endpoint, attaches only the returned session and selects its server-chosen diary',async()=>{
  const diary='12345678-1234-1234-1234-123456789abc';let request,attached,opened;
  const h=harness(['submitEmailEntry'],{fetch:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({diary_id:diary,session:{access_token:'visitor',refresh_token:'refresh'}})};},getSupabaseClient:async()=>({auth:{setSession:async tokens=>{attached=tokens;return{};}}}),enterConnectedDiary:async id=>{opened=id;}});
  await h.submitEmailEntry('  Partner@Example.com  ');assert.equal(request.url,'https://our-project.supabase.co/functions/v1/email-entry');assert.equal(JSON.parse(request.options.body).email,'partner@example.com');assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');assert.equal(attached.access_token,'visitor');assert.equal(opened,diary);
  // Unsynced memories must not block signing back in: enterConnectedDiary decides whether the space matches.
  h.backend.dirty=true;h.state.meta.pendingCloud=true;h.backend.space=diary;request=null;opened=null;
  await h.submitEmailEntry('partner@example.com');assert.notEqual(request,null);assert.equal(opened,diary);
});
test('an upload failure on an already loaded album unlocks the diary and keeps the error visible',async()=>{
  const h=harness(['enterConnectedDiary'],{getSupabase:async()=>({}),cloudPull:async()=>{h.backend.status='同步未完成：Load failed';}});
  h.backend.space='shared-diary';h.backend.ready=true;h.backend.dirty=true;h.state.meta.pendingCloud=true;
  await h.enterConnectedDiary('shared-diary');
  assert.equal(h.events.includes('unlocked'),true);assert.equal(h.backend.status,'同步未完成：Load failed');assert.equal(h.backend.dirty,true);
});
test('cold startup asks for an email; a saved session resumes the existing shared space',async()=>{
  let session=null,resumed=0;
  const h=harness(['bootBackend'],{getSupabaseClient:async()=>({auth:{getSession:async()=>({data:{session}})}}),enterConnectedDiary:async()=>{resumed++;}});
  await h.bootBackend();assert.equal(h.events[0][0],'locked');assert.equal(resumed,0);session={user:{id:'partner'}};await h.bootBackend();assert.equal(resumed,1);
});
