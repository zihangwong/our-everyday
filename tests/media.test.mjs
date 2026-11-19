import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const html=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const p=html.indexOf('function '+name+'(');assert.ok(p>0,name);return html.slice(html.slice(p-6,p)==='async '?p-6:p,html.indexOf('\n}',p)+2);}
function base(names,extra={}){
  const elements=new Map(),ctx={console,TextEncoder,URL,Blob,File,crypto:webcrypto,atob,btoa,Set,Map,
    mediaCache:new Map(),draftFiles:new Map(),storeMediaPreview:async()=>false,MAX_MEDIA_BYTES:50*1024*1024,photoGeneration:1,pendingPhotos:0,draftPhotos:[],draftNewKeys:[],mediaWork:Promise.resolve(),
    state:{config:{meetDate:'2026-10-05',togetherDate:'2026-11-08'},dates:[],messages:[],meta:{updatedAt:'first'}},
    backend:{url:'https://project.supabase.co',key:'sb_publishable_test',space:'s1',user:'u1',revision:4,ready:true,dirty:true,status:'',uploads:{}},
    sbClient:null,cloudBusy:false,notices:[],toast(s){ctx.notices.push(s);},renderPhotoPre(){},renderCloudUI(){},persistConfigOnly(){return true;},persistBackend(){},renderAll(){},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{disabled:false,textContent:''});return elements.get(id);}},
    ...extra};if(names.includes('enqueueMedia')&&!names.includes('queueDraftMedia'))names=[...names,'queueDraftMedia'];vm.createContext(ctx);vm.runInContext(names.map(fn).join('\n'),ctx);return ctx;
}

test('authentication errors explain email limits and confirmation without telling users to register again',()=>{
  const h=base(['backendErrorMessage']);
  assert.match(h.backendErrorMessage({code:'over_email_send_rate_limit',message:'email rate limit exceeded'}),/不必重复注册/);
  assert.match(h.backendErrorMessage({message:'Email not confirmed'}),/邮箱尚未确认/);
  assert.match(h.backendErrorMessage({code:'email_address_not_authorized'}),/配置邮件服务/);
  assert.match(h.backendErrorMessage({code:'invalid_credentials'}),/邮箱或密码不正确/);
  assert.equal(h.backendErrorMessage({message:'数据库版本冲突'}),'数据库版本冲突');
});
test('13 mixed files keep selection order and captions, with no nine-file cap',async()=>{
  const writes=[],h=base(['validateMediaFile','enqueueMedia'],{assetStore:async(mode,key,blob)=>{writes.push({key,blob});}});
  const files=Array.from({length:13},(_,i)=>new File(['test'],i===12?'clip.mp4':'photo-'+i+'.jpg',{type:i===12?'video/mp4':'image/jpeg'}));
  h.enqueueMedia(files);h.draftPhotos[11].caption='the twelfth';await h.mediaWork;
  assert.equal(h.draftPhotos.length,13);assert.deepEqual(Array.from(h.draftPhotos,m=>m.name),files.map(f=>f.name));
  assert.equal(h.draftPhotos[11].caption,'the twelfth');assert.equal(h.draftPhotos[12].kind,'video');assert.equal(writes.length,13);assert.equal(h.pendingPhotos,0);assert.equal(h.document.getElementById('dateSave').disabled,false);
});
test('a media storage failure remains visible and never reports that file as saved',async()=>{
  const h=base(['validateMediaFile','enqueueMedia'],{assetStore:async()=>{throw Error('quota');}});
  h.enqueueMedia([new File(['x'],'clip.mp4',{type:'video/mp4'})]);await h.mediaWork;
  assert.match(h.draftPhotos[0].error,/quota/);assert.equal(h.mediaCache.size,0);assert.equal(h.pendingPhotos,0);
});

test('retrying a failed media saves the same selected file without duplicating its caption or archive position',async()=>{
  let writes=0;
  const h=base(['validateMediaFile','enqueueMedia','retryDraftMedia'],{assetStore:async()=>{if(++writes===1)throw Error('transient');}});
  h.enqueueMedia([new File(['image'],'retry.jpg',{type:'image/jpeg'})]);await h.mediaWork;
  const id=h.draftPhotos[0].id;h.draftPhotos[0].caption='保留这句说明';assert.ok(h.draftPhotos[0].error);
  h.retryDraftMedia(id);await h.mediaWork;assert.equal(h.draftPhotos.length,1);assert.equal(h.draftPhotos[0].id,id);assert.equal(h.draftPhotos[0].caption,'保留这句说明');assert.equal(h.draftPhotos[0].error,'');assert.equal(h.pendingPhotos,0);
});
test('cancelling an in-flight upload cannot attach its file to another editor session',async()=>{
  let finish;const writes=[];const h=base(['validateMediaFile','enqueueMedia'],{assetStore:async(mode,key,blob)=>{writes.push(blob);if(blob)await new Promise(r=>{finish=r;});}});
  h.enqueueMedia([new File(['x'],'image.jpg',{type:'image/jpeg'})]);await new Promise(setImmediate);
  h.photoGeneration++;h.pendingPhotos=0;finish();await h.mediaWork;
  assert.equal(writes.at(-1),null);assert.equal(h.mediaCache.size,0);assert.equal(h.pendingPhotos,0);
});
test('file limits reject unsupported and oversized files without silently truncating valid files',()=>{
  const h=base(['validateMediaFile']);assert.throws(()=>h.validateMediaFile({type:'video/mp4',size:50*1024*1024+1}),/50 MB/);
  assert.throws(()=>h.validateMediaFile({type:'image/svg+xml',size:10}),/请选择/);assert.doesNotThrow(()=>h.validateMediaFile({type:'video/webm',size:50*1024*1024}));
});
test('captions remain attached to their media when files are removed and legacy photos gain stable IDs',()=>{
  const h=base(['recordMedia','cleanMedia']);const old={id:'d1',photos:['data:image/jpeg;base64,eA==','data:image/jpeg;base64,eQ==']};
  const media=h.recordMedia(old);media[1].caption='second';media.splice(0,1);
  assert.equal(media[0].caption,'second');assert.equal(media[0].id,'legacy-d1-1');assert.equal(old.photos.length,2);
  assert.equal(h.cleanMedia({...media[0],status:'pending',progress:50}).status,undefined);
});
test('Supabase accepts only public browser keys and refuses service-role credentials or foreign URLs',()=>{
  const h=base(['validBackendConfig']);const key=role=>'x.'+btoa(JSON.stringify({role}))+'.x';
  assert.equal(h.validBackendConfig('https://project.supabase.co','sb_publishable_test'),true);
  assert.equal(h.validBackendConfig('https://project.supabase.co',key('anon')),true);
  assert.equal(h.validBackendConfig('https://project.supabase.co',key('service_role')),false);
  assert.equal(h.validBackendConfig('https://project.supabase.co','sb_secret_abc'),false);
  assert.equal(h.validBackendConfig('https://project.supabase.co.evil.test','sb_publishable_test'),false);
});
test('a revision conflict retains the local edit and marks sync as failed',async()=>{
  const h=base(['cloudPush'],{getSupabase:async()=>({rpc:async()=>({error:Error('DIARY_CONFLICT')})}),prepareCloudDocument:async(_,d)=>d,sharedState(){return structuredClone(h.state);}});
  assert.equal(await h.cloudPush(),false);assert.equal(h.backend.revision,4);assert.equal(h.backend.dirty,true);assert.match(h.backend.status,/另一台设备/);assert.equal(h.state.meta.updatedAt,'first');
});
test('an edit made during a cloud read is not replaced by the returned remote snapshot',async()=>{
  let finish;const query=new Promise(r=>{finish=r;});let scheduled=0;
  const h=base(['cloudPull'],{getSupabase:async()=>({from:()=>({select:()=>({eq:()=>({single:()=>query})})})}),scheduleCloudPush(){scheduled++;}});
  h.backend.dirty=false;const pulling=h.cloudPull();await new Promise(setImmediate);h.backend.dirty=true;h.state.meta.updatedAt='new edit';finish({data:{revision:5,document:{config:{},dates:[]}}});await pulling;
  assert.equal(h.state.meta.updatedAt,'new edit');assert.equal(h.backend.revision,4);assert.equal(scheduled,1);assert.equal(h.cloudBusy,false);
});
test('cloud commit uses the expected revision and preserves a newer edit for another sync',async()=>{
  let parameters,scheduled=0;
  const h=base(['cloudPush'],{getSupabase:async()=>({rpc:async(name,args)=>{parameters=args;h.state.meta.updatedAt='later';return{data:5};}}),prepareCloudDocument:async(_,d)=>d,sharedState(){return structuredClone(h.state);},scheduleCloudPush(){scheduled++;}});
  assert.equal(await h.cloudPush(),true);assert.equal(parameters.p_revision,4);assert.equal(h.backend.revision,5);assert.equal(h.backend.dirty,true);assert.equal(scheduled,1);
});
test('anniversaries keep the meeting and relationship dates separate, including leap years',()=>{
  const h=base(['dayCount']);const meet=h.dayCount('2026-10-05'),together=h.dayCount('2026-11-08');
  assert.equal(meet-together,34);assert.equal(h.dayCount('2026-02-29'),0);assert.ok(h.dayCount('2024-02-29')>0);assert.equal(h.state.config.meetDate,'2026-10-05');
});

test('imported binary assets use fresh local keys and never overwrite an existing asset before commit',async()=>{
  const stored=new Map([['old-key',new Blob(['old'],{type:'image/jpeg'})]]);
  const h=base(['normalizeState','validateMediaFile','recordMedia','cleanMedia','importBackup'],{fetch,DEFAULT_STATE:{config:{sync:{}}},hydrateMedia:async()=>{},assetStore:async(mode,key,blob)=>{if(blob===null)stored.delete(key);else stored.set(key,blob);}});
  const data={config:{},dates:[{id:'d1',date:'2026-11-08',title:'回忆',media:[{id:'asset',kind:'image',localKey:'old-key',caption:'独立caption'}]}],assets:{asset:'data:image/jpeg;base64,bmV3'}};
  await h.importBackup({text:async()=>JSON.stringify(data)});
  const media=h.state.dates[0].media[0];assert.notEqual(media.localKey,'old-key');assert.equal(await stored.get('old-key').text(),'old');assert.equal(await stored.get(media.localKey).text(),'new');assert.equal(h.state.assets,undefined);assert.equal(h.backend.ready,false);
});

test('a malformed later asset aborts import and removes only newly staged blobs',async()=>{
  const stored=new Map([['old-key',new Blob(['old'])]]);const h=base(['normalizeState','validateMediaFile','recordMedia','cleanMedia','importBackup'],{fetch,DEFAULT_STATE:{config:{sync:{}}},assetStore:async(mode,key,blob)=>{if(blob===null)stored.delete(key);else stored.set(key,blob);}});
  const original=h.state,data={config:{},dates:[],assets:{one:'data:image/jpeg;base64,bmV3',two:'not an asset'}};
  await assert.rejects(()=>h.importBackup({text:async()=>JSON.stringify(data)}),/格式/);assert.equal(h.state,original);assert.deepEqual([...stored.keys()],['old-key']);
});

test('resumable video upload retries from the confirmed server offset and sends six MiB chunks',async()=>{
  const MiB=1024*1024,patches=[];let offset=0,failed=false;const endpoint='https://project.storage.supabase.co/storage/v1/upload/resumable';
  const h=base(['tusMetadata','uploadMediaBlob'],{fetch:async(url,options)=>{
    assert.ok(url.startsWith(endpoint));
    if(options.method==='POST')return new Response(null,{status:201,headers:{Location:endpoint+'/job'}});
    if(options.method==='HEAD')return new Response(null,{headers:{'Upload-Offset':String(offset)}});
    patches.push({offset:Number(options.headers['Upload-Offset']),size:options.body.size});
    if(!failed){failed=true;return new Response(null,{status:503});}
    assert.equal(Number(options.headers['Upload-Offset']),offset);offset+=options.body.size;return new Response(null,{status:204,headers:{'Upload-Offset':String(offset)}});
  }});
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}},blob={type:'video/mp4',size:13*MiB,slice:(start,end)=>({size:Math.min(end,13*MiB)-start})};
  assert.equal(await h.uploadMediaBlob(client,{id:'asset',name:'clip.mp4'},blob),'s1/asset.mp4');assert.equal(offset,13*MiB);assert.ok(patches.every(p=>p.size<=6*MiB));assert.equal(h.backend.uploads.asset,undefined);
});

test('a tampered resumable location never receives the login token',async()=>{
  let calls=0;const h=base(['tusMetadata','uploadMediaBlob'],{fetch:async()=>{calls++;throw Error('must not send');}});h.backend.uploads.asset={url:'https://evil.test/steal'};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'private-test-token'}}})}};
  await assert.rejects(()=>h.uploadMediaBlob(client,{id:'asset'},{type:'video/mp4',size:7*1024*1024}),/地址不匹配/);assert.equal(calls,0);
});

test('a legacy backup larger than localStorage becomes 63 lossless binary assets before metadata commits',async()=>{
  const stored=new Map(),payload=Buffer.alloc(96000,65),src='data:image/jpeg;base64,'+payload.toString('base64');let metadataBytes;
  const h=base(['normalizeState','validateMediaFile','recordMedia','cleanMedia','importBackup'],{fetch,DEFAULT_STATE:{config:{togetherDate:'2026-11-08',sync:{}}},hydrateMedia:async()=>{},assetStore:async(mode,key,blob)=>{if(blob===null)stored.delete(key);else stored.set(key,blob);},persistConfigOnly(){metadataBytes=JSON.stringify(h.state).length;return metadataBytes<5*1024*1024;}});
  const data={config:{meetDate:'2026-10-05'},dates:Array.from({length:9},(_,i)=>({id:'legacy'+i,date:'2026-11-08',title:'回忆',photos:Array(7).fill(src)})),messages:[],proposals:[{id:'p1',title:'历史计划'}]};
  assert.ok(JSON.stringify(data).length>5*1024*1024);await h.importBackup({text:async()=>JSON.stringify(data)});
  assert.equal(stored.size,63);assert.equal(h.state.dates.flatMap(d=>d.media).length,63);assert.ok(h.state.dates.every(d=>d.photos.length===0));assert.ok(metadataBytes<50000);
  assert.equal(h.state.config.meetDate,'2026-10-05');assert.equal(h.state.config.togetherDate,'2026-11-08');assert.equal(h.state.proposals.length,1);assert.equal(h.backend.ready,false);
  const bytes=new Uint8Array(await stored.values().next().value.arrayBuffer());assert.equal(bytes.length,payload.length);assert.equal(bytes[95000],65);
});

test('legacy conversion rolls back staged files when the metadata write fails',async()=>{
  const stored=new Map([['original',new Blob(['keep'])]]);const h=base(['normalizeState','validateMediaFile','recordMedia','cleanMedia','importBackup'],{fetch,DEFAULT_STATE:{config:{sync:{}}},persistConfigOnly:()=>false,assetStore:async(mode,key,blob)=>{if(blob===null)stored.delete(key);else stored.set(key,blob);}}),original=h.state;
  const data={config:{},dates:[{id:'old',date:'2026-11-08',title:'回忆',photos:['data:image/jpeg;base64,bmV3']}],messages:[]};
  await assert.rejects(()=>h.importBackup({text:async()=>JSON.stringify(data)}),/无法保存/);assert.equal(h.state,original);assert.deepEqual([...stored.keys()],['original']);
});
