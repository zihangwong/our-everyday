import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../maincode', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
function fn(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  return script.slice(script.slice(start-6,start)==='async '?start-6:start, script.indexOf('\n}', start) + 2);
}
function fixture(overrides = {}) {
  const base = {config:{myName:'我',herName:'你',meetDate:'2026-10-05',togetherDate:'2026-11-08',spotifyUrl:'',sync:{url:'',pass:'',on:false,lastSync:'',status:''}},meta:{updatedAt:'2026-10-25T12:00:00.000Z'},dates:[],messages:[],proposals:[]};
  return {...base,...overrides};
}
function harness(initial = fixture()) {
  const elements = new Map();
  const ctx = {
    state:structuredClone(initial),DEFAULT_STATE:fixture(),durableState:JSON.stringify(initial),
    mediaCache:new Map(),draftNewKeys:[],console,TextEncoder,TextDecoder,Uint8Array,URL,crypto:webcrypto,btoa,atob,
    localStorage:{setItem(_key,value){ctx.stored=value;}}, KEY:'meet_zhuoxin_v2',
    notices:[],toast(msg){ctx.notices.push(msg);},scheduleCloudPush(){ctx.pushScheduled=(ctx.pushScheduled||0)+1;},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',innerHTML:'',dataset:{},listeners:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(){return[];}});return elements.get(id);},querySelectorAll(){return[];}},
    renderAll(){ctx.renders=(ctx.renders||0)+1;},closeProposalOverlay(){ctx.closed=true;},
    openDateModal(){ctx.opened=true;},renderPlaceRows(rows){ctx.places=rows;},openRecall(id){ctx.recalled=id;},
    observeReveal(){},bindSpotlight(){},resetDateFilters(){},openDateModal(){ctx.opened=true;},
    todayISO(){return'2026-11-09';},completingProposalId:null,editingId:null,draftMood:'开心',draftPhotos:[],pendingPhotos:0,favoritesOnly:false,
    closeDateModal(){ctx.dateClosed=true;},
  };
  vm.createContext(ctx);
  const names=['esc','uid','fmtDate','normalizeState','photoSrc','recordMedia','mediaURL','safeMediaURL','mediaVisual','cleanMedia','proposalRecord','proposalStatus','save','persistConfigOnly','sharedState','icon','memoryCard','renderDates','completeProposal','acceptProposal'];
  vm.runInContext(names.map(fn).join('\n'),ctx);
  const start=script.indexOf('document.getElementById("dateForm").addEventListener("submit", function(e){');
  vm.runInContext(script.slice(start,script.indexOf('\n});',start)+4),ctx);
  return ctx;
}

test('entry point parses and remains identical to the single-file source', async()=>{
  new vm.Script(script);
  assert.equal(await readFile(new URL('../index.html',import.meta.url),'utf8'),source);
});
test('accepting a proposal schedules a date without creating a completed memory',()=>{
  const h=harness(fixture({proposals:[{id:'p1',title:'公园散步',date:'2026-11-09',status:'draft'}]}));
  h.acceptProposal('p1');
  assert.equal(h.state.proposals[0].status,'accepted');
  assert.equal(h.state.dates.length,0);
  h.acceptProposal('p1');
  assert.equal(h.state.dates.length,0);
  assert.equal(h.renders,1);
});
test('completion opens a prefilled editor; cancel does not create or complete anything',()=>{
  const h=harness(fixture({proposals:[{id:'p1',title:'公园散步',date:'2026-11-09',places:['湖边'],status:'accepted'}]}));
  h.completeProposal('p1');
  assert.equal(h.completingProposalId,'p1');
  assert.equal(h.document.getElementById('fTitle').value,'公园散步');
  assert.equal(h.document.getElementById('fDate').value,'2026-11-09');
  assert.equal(h.state.dates.length,0);
  assert.equal(h.state.proposals[0].status,'accepted');
});
test('saving a completed proposal links exactly one memory and repeated submit cannot duplicate it',()=>{
  const h=harness(fixture({proposals:[{id:'p1',title:'公园散步',date:'2026-11-09',status:'accepted'}]}));
  h.completeProposal('p1');
  h.document.getElementById('fStory').value='那天的晚霞';
  const submit=h.document.getElementById('dateForm').listeners.submit;
  submit({preventDefault(){}});
  assert.equal(h.state.dates.length,1);
  assert.equal(h.state.dates[0].proposalId,'p1');
  assert.equal(h.state.proposals[0].dateId,h.state.dates[0].id);
  assert.equal(h.state.proposals[0].status,'completed');
  submit({preventDefault(){}});
  assert.equal(h.state.dates.length,1);
});
test('completion save failure restores the accepted status and allows a clean retry',()=>{
  const h=harness(fixture({proposals:[{id:'p1',title:'公园散步',date:'2026-11-09',status:'accepted'}]}));
  h.completeProposal('p1');
  const submit=h.document.getElementById('dateForm').listeners.submit;
  h.localStorage.setItem=()=>{throw new Error('quota');};
  submit({preventDefault(){}});
  assert.equal(h.state.dates.length,0);assert.equal(h.state.proposals[0].status,'accepted');assert.equal(h.dateClosed,undefined);
  h.localStorage.setItem=()=>{};
  submit({preventDefault(){}});
  assert.equal(h.state.dates.length,1);assert.equal(h.state.proposals[0].status,'completed');
});
test('new linked and legacy accepted proposals reuse their existing memory',()=>{
  for(const legacy of [false,true]){
    const d={id:'d1',title:'公园散步',date:'2026-10-22',story:legacy?'这是她答应了的约会提案：「公园散步」\n行程':''};
    if(!legacy)d.proposalId='p1';
    const h=harness(fixture({dates:[d],proposals:[{id:'p1',title:'公园散步',date:'2026-10-22',status:legacy?'accepted':'completed'}]}));
    assert.equal(h.proposalStatus(h.state.proposals[0]),'completed');
    h.completeProposal('p1');
    assert.equal(h.recalled,'d1');
    assert.equal(h.state.dates.length,1);
    assert.equal(h.opened,undefined);
  }
});
test('quota failure restores durable data and does not upload or report success',()=>{
  const h=harness();
  h.state.dates.push({id:'unsaved'});
  h.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.equal(h.save(),false);
  assert.equal(h.state.dates.length,0);
  assert.equal(h.pushScheduled,undefined);
  assert.match(h.notices.at(-1),/没有保存成功/);
});
test('a failed acceptance leaves the original proposal pending',()=>{
  const h=harness(fixture({proposals:[{id:'p1',status:'draft'}]}));
  h.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  h.acceptProposal('p1');
  assert.equal(h.state.proposals[0].status,'draft');
  assert.equal(h.renders,undefined);
  assert.equal(h.closed,undefined);
});
test('search matches place/story/title, combines mood and respects date order',()=>{
  const h=harness(fixture({dates:[
    {id:'a',title:'散步',date:'2026-10-06',mood:'开心',places:['湖边'],story:'晚霞',photos:[]},
    {id:'b',title:'湖边咖啡',date:'2026-10-07',mood:'平静',places:[],story:'聊天',photos:[]},
    {id:'c',title:'晚餐',date:'2026-10-05',mood:'开心',places:[],story:'走到湖边',photos:[]}
  ]}));
  h.document.getElementById('dateSearch').value='湖边';
  h.document.getElementById('dateMood').value='开心';
  h.document.getElementById('dateSort').value='asc';
  h.renderDates();
  const html=h.document.getElementById('dateList').innerHTML;
  assert.ok(html.indexOf('晚餐')<html.indexOf('散步'));
  assert.ok(!html.includes('湖边咖啡'));
  assert.match(h.document.getElementById('dateCount').textContent,/找到 2 条/);
});

test('backup/shared payload excludes connection credentials and leaves local settings alone',()=>{
  const h=harness();Object.assign(h.state.config.sync,{on:true,url:'private-endpoint',pass:'private-password'});
  const data=h.sharedState();
  assert.equal(data.config.sync.pass,'');assert.equal(data.config.sync.url,'');
  assert.equal(h.state.config.sync.pass,'private-password');
});
test('legacy backup gains missing collections; malformed data is rejected',()=>{
  const h=harness();const legacy={config:{myName:'甲'},dates:[{id:'d1',title:'初见',date:'2026-10-05'}]};
  const data=h.normalizeState(legacy);assert.equal(data.proposals.length,0);assert.equal(data.messages.length,0);assert.equal(data.dates[0].photos.length,0);
  assert.throws(()=>h.normalizeState({config:{},dates:[null]}));
});
test('imported photo attributes cannot inject HTML',()=>{
  const h=harness();assert.equal(h.photoSrc('x" onerror="alert(1)'), '');
  assert.equal(h.photoSrc('javascript:alert(1)'),'');

});




test('orbit follows a continuous closed path at every responsive width',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitPoint'),ctx);
  for(const width of [280,335,560,1160])for(const count of [1,2,8,16,63,250])for(let i=0;i<count;i++){
    const a=ctx.orbitPoint(i,count,.37,width),b=ctx.orbitPoint(i,count,.37+2*Math.PI,width);
    assert.ok(Math.abs(a.x-b.x)<1e-8);assert.ok(Math.abs(a.y-b.y)<1e-8);
    assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));assert.ok(a.scale>=.67&&a.scale<=1);
    assert.ok(a.cardWidth>=76&&a.cardWidth<=110);
  }
});

test('orbit only claims deliberate horizontal drags, leaving clicks and vertical scrolling alone',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitIntent'),ctx);
  assert.equal(ctx.orbitIntent(3,2),'pending');assert.equal(ctx.orbitIntent(0,0),'pending');
  assert.equal(ctx.orbitIntent(12,2),'drag');assert.equal(ctx.orbitIntent(-70,-4),'drag');
  assert.equal(ctx.orbitIntent(3,20),'scroll');assert.equal(ctx.orbitIntent(15,16),'scroll');
});

test('ring includes the entire archive in order without truncating or changing photo indices',()=>{
  for(const size of [17,63,250,1001]){
    const input=Array.from({length:size},(_,i)=>({dateId:'d'+Math.floor(i/2),photoIdx:i%2,title:'回忆'+i,src:'https://example.com/'+i+'.jpg'}));
    const before=JSON.stringify(input),ctx=vm.createContext({allMedia:()=>input,safeMediaURL:s=>s,ORBIT_SAMPLES:[]});
    vm.runInContext(fn('orbitPhotos'),ctx);const photos=ctx.orbitPhotos();
    assert.equal(photos.length,size);assert.equal(new Set(photos.map(p=>p.src)).size,size);
    photos.forEach((photo,i)=>assert.equal(photo,input[i]));assert.equal(JSON.stringify(input),before);
  }
});

test('demo photographs are presentation objects and invalid sources never enter the ring',()=>{
  const samples=[{title:'示例',src:'https://example.com/sample.jpg'}];
  const input=[{src:'javascript:invalid'}];
  const ctx=vm.createContext({allMedia:()=>input,safeMediaURL:s=>s.startsWith('https://')?s:'',ORBIT_SAMPLES:samples});
  vm.runInContext(fn('orbitPhotos'),ctx);const list=ctx.orbitPhotos();
  assert.equal(list[0].demo,true);assert.equal(samples[0].demo,undefined);assert.equal(input.length,1);
});

test('coasting is time based and consistent across 60Hz and 120Hz displays',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitAdvance'),ctx);
  function simulate(hz){let a=0,v=2.4;for(let i=0;i<hz*5;i++){const p=ctx.orbitAdvance(a,v,.065,1/hz);a=p.angle;v=p.velocity;}return{a,v};}
  const a=simulate(60),b=simulate(120);
  assert.ok(Math.abs(a.a-b.a)<1e-10);assert.ok(Math.abs(a.v-b.v)<1e-10);
  assert.ok(a.v>.065&&a.v<.13);
  const normal=ctx.orbitAdvance(0,.065,.065,Math.PI*2/.065);
  assert.ok(Math.abs(normal.angle-2*Math.PI)<1e-10);
});

test('reverse throws smoothly settle back to the default direction and zero elapsed time does not jump',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitAdvance'),ctx);
  const still=ctx.orbitAdvance(1,-2,.065,0);assert.equal(still.angle,1);assert.equal(still.velocity,-2);
  const settled=ctx.orbitAdvance(1,-2,.065,20);assert.ok(Math.abs(settled.velocity-.065)<.00001);
});

test('rapid flicks are bounded in either direction, even with duplicate event timestamps',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitThrow'),ctx);
  assert.equal(ctx.orbitThrow(10,0),2.8);assert.equal(ctx.orbitThrow(-10,0),-2.8);
  assert.equal(ctx.orbitThrow(.05,.1),.5);assert.equal(ctx.orbitThrow(0,0),0);
});

test('autoplay stops for pause, reduced motion, background, dialogs and photo interaction',()=>{
  const ctx=vm.createContext({});vm.runInContext(fn('orbitCanRun'),ctx);
  const ready={paused:false,reduced:false,hidden:false,visible:true,home:true,dialog:false,pointer:false,hovered:false,focused:false,opening:false};
  assert.equal(ctx.orbitCanRun(ready),true);
  for(const flag of ['paused','reduced','hidden','dialog','pointer','hovered','focused','opening'])assert.equal(ctx.orbitCanRun({...ready,[flag]:true}),false,flag);
  for(const flag of ['visible','home'])assert.equal(ctx.orbitCanRun({...ready,[flag]:false}),false,flag);
});
