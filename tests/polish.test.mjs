import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const p=source.indexOf('function '+name+'(');assert.ok(p>0,name);return source.slice(source.slice(p-6,p)==='async '?p-6:p,source.indexOf('\n}',p)+2);}
function context(names,extras={}){const h={URL,state:{config:{togetherDate:'2026-11-08'},dates:[]},mediaCache:new Map(),...extras};vm.createContext(h);vm.runInContext(names.map(fn).join('\n'),h);return h;}

test('the personal cover follows a saved image reference and safely falls back after removal; videos never become still covers',()=>{
  const images=[{id:'video',kind:'video',date:'2026-11-08'},{id:'older',kind:'image',date:'2026-10-05'},{id:'anniversary',kind:'image',date:'2026-11-08'}];
  const h=context(['homeCoverItem'],{allMedia:()=>images});assert.equal(h.homeCoverItem().id,'anniversary');h.state.config.coverMediaId='older';assert.equal(h.homeCoverItem().id,'older');h.state.config.coverMediaId='removed';assert.equal(h.homeCoverItem().id,'anniversary');images.splice(0,images.length);assert.equal(h.homeCoverItem(),null);
});
test('editing one legacy caption retains every image, the full story and media identity; a storage failure reports failure',()=>{
  let saves=0;const h=context(['recordMedia','cleanMedia','updateMediaCaption'],{save(){saves++;return true;}});
  h.state.dates=[{id:'day',date:'2026-11-08',title:'纪念日',story:'保留整天的故事',photos:['first.jpg','second.jpg']}];
  assert.equal(h.updateMediaCaption('day','legacy-day-1','新的说明'),true);assert.equal(saves,1);assert.equal(h.state.dates[0].media.length,2);assert.equal(h.state.dates[0].media[0].src,'first.jpg');assert.equal(h.state.dates[0].media[1].caption,'新的说明');assert.equal(h.state.dates[0].story,'保留整天的故事');assert.equal(h.updateMediaCaption('missing','id','x'),false);
  h.save=()=>false;assert.equal(h.updateMediaCaption('day','legacy-day-1','未保存'),false);
});
test('browsing uses lightweight image previews and inert video posters; opening uses the original bytes',()=>{
  const h=context(['esc','photoSrc','safeMediaURL','mediaURL','previewURL','formatDuration','mediaVisual']);
  const photo={id:'photo',kind:'image',src:'https://media.example/original.jpg',caption:'<title>',width:3000,height:2000};h.mediaCache.set('photo:preview','https://media.example/small.jpg');
  assert.match(h.mediaVisual(photo,false),/src="https:\/\/media.example\/small.jpg"/);assert.match(h.mediaVisual(photo,true),/src="https:\/\/media.example\/original.jpg"/);assert.match(h.mediaVisual(photo,false),/&lt;title&gt;/);
  const video={id:'video',kind:'video',src:'https://media.example/original.mp4',duration:125};h.mediaCache.set('video:preview','https://media.example/poster.jpg');
  assert.doesNotMatch(h.mediaVisual(video,false),/<video|original\.mp4/);assert.match(h.mediaVisual(video,false),/2:05/);assert.match(h.mediaVisual(video,true),/<video.*original\.mp4.*poster=/);
});
test('thumbnail dimensions preserve aspect ratio, avoid upscaling and reject invalid metadata',()=>{
  const h=context(['previewDimensions']);assert.equal(h.previewDimensions(4000,3000).width,640);assert.equal(h.previewDimensions(4000,3000).height,480);assert.equal(h.previewDimensions(120,200).height,200);assert.equal(h.previewDimensions(Infinity,100),null);assert.equal(h.previewDimensions(0,100),null);
});
test('new preview files use the same private space without uploading an already stored original again',async()=>{
  const uploads=[];const h=context(['recordMedia','cleanMedia','prepareCloudDocument'],{backend:{url:'https://our.supabase.co',space:'shared'},cloudTransfer:{},renderCloudUI(){},assetStore:async()=>new Blob(['preview'],{type:'image/jpeg'}),uploadMediaBlob:async(_,m)=>{uploads.push(m.id);return'shared/'+m.id+'.jpg';}});
  const cloud={path:'shared/original.jpg',project:h.backend.url,space:'shared'};
  const result=await h.prepareCloudDocument({}, {dates:[{media:[{id:'p',kind:'image',cloud,previewLocalKey:'preview-key'}]}]});
  assert.deepEqual(uploads,['p-preview']);assert.equal(result.dates[0].media[0].cloud.path,'shared/original.jpg');assert.equal(result.dates[0].media[0].previewCloud.space,'shared');assert.equal(h.cloudTransfer.done,1);
});
test('a failed upload names the file, its size and the failing step instead of a bare browser error',async()=>{
  const photo=new Blob([new Uint8Array(7*1024*1024)],{type:'image/jpeg'});
  const h=context(['recordMedia','cleanMedia','prepareCloudDocument'],{backend:{url:'https://our.supabase.co',space:'shared'},cloudTransfer:{},renderCloudUI(){},validateMediaFile(){},assetStore:async()=>photo,uploadMediaBlob:async()=>{throw new TypeError('Load failed');}});
  await assert.rejects(h.prepareCloudDocument({}, {dates:[{media:[{id:'p',name:'IMG_0001.jpg',kind:'image',localKey:'p'}]}]}),/^Error: Load failed（IMG_0001\.jpg · 7\.0MB · 分块上传）$/);
  h.assetStore=async()=>({size:1024,type:'image/jpeg',slice(){return{arrayBuffer:async()=>{throw new Error('NotReadableError');}};}});
  await assert.rejects(h.prepareCloudDocument({}, {dates:[{media:[{id:'p',name:'IMG_0002.jpg',kind:'image',localKey:'p'}]}]}),/NotReadableError（IMG_0002\.jpg · 0\.0MB · 读取本机文件）/);
});
test('mobile composition limits large foreground prints while keeping the last photo reachable in a large archive',()=>{
  const h=context(['spaceLayout','spaceProject','spaceClamp','spaceFocus']);
  const items=h.spaceLayout(1001,390),camera={x:0,y:0,z:0};const large=items.filter(p=>{const q=h.spaceProject(p,camera,390,500);return q.visible&&q.opacity>.5&&q.scale*p.width>100;});assert.ok(large.length<=3);assert.equal(items.length,1001);
  const initiallyHidden=h.spaceLayout(63,0),mobile=h.spaceLayout(63,390);assert.equal(JSON.stringify(initiallyHidden),JSON.stringify(mobile));
  const last=items.at(-1),max=Math.max(...items.map(p=>-p.z)),p=h.spaceProject(last,h.spaceFocus(last,max),390,500);assert.equal(p.visible,true);assert.ok(Math.abs(p.x)<.01&&Math.abs(p.y)<.01);assert.ok(p.scale*last.width<390*.7);
});

test('sync feedback distinguishes queued local edits, reads, active uploads, completed sync and errors',()=>{
  const h=context(['transferStatus'],{backend:{ready:true,dirty:true,status:''},cloudBusy:false,cloudOperation:'',cloudTransfer:{done:2,total:13}});
  assert.equal(h.transferStatus().kind,'pending');h.cloudBusy=true;h.cloudOperation='upload';assert.match(h.transferStatus().text,/2 \/ 13/);h.cloudOperation='read';assert.equal(h.transferStatus().text,'正在更新回忆…');h.cloudBusy=false;h.backend.dirty=false;assert.equal(h.transferStatus().kind,'synced');h.backend.status='网络连接中断';assert.equal(h.transferStatus().kind,'error');
});
