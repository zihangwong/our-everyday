import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);}
const ctx=vm.createContext({});vm.runInContext(['spaceLayout','spaceClamp','spaceWheel','spaceStep','spaceProject','spaceFocus'].map(fn).join('\n'),ctx);

test('all archive photos have stable independent 3D placement, different sizes and actual depth layers',()=>{
  for(const count of [0,1,63,1001]){
    const layout=ctx.spaceLayout(count);assert.equal(layout.length,count);assert.equal(JSON.stringify(layout),JSON.stringify(ctx.spaceLayout(count)));
    assert.deepEqual(Array.from(layout,x=>x.index),Array.from({length:count},(_,i)=>i));
    for(const p of layout){assert.ok(p.width>=165&&p.width<300);assert.ok(p.z<0);assert.ok(Math.abs(p.x)<850&&Math.abs(p.y)<550);}
    if(count>7){assert.ok(new Set(layout.map(x=>x.width)).size>5);assert.ok(layout[7].z<layout[0].z-400);}
  }
});
test('moving forward increases perspective scale and creates stronger movement in nearby photos',()=>{
  const a=ctx.spaceLayout(63),near=a[0],far=a[35],camera={x:0,y:0,z:0};
  const n=ctx.spaceProject(near,camera,1400,650),f=ctx.spaceProject(far,camera,1400,650);
  assert.ok(n.scale>f.scale*3);
  assert.ok(ctx.spaceProject(near,{...camera,z:250},1400,650).scale>n.scale);
  const panNear=ctx.spaceProject(near,{...camera,x:100},1400,650),panFar=ctx.spaceProject(far,{...camera,x:100},1400,650);
  assert.ok(Math.abs(panNear.x-n.x)>Math.abs(panFar.x-f.x)*3);
});
test('every photo can be brought into view, including the last image on a narrow screen',()=>{
  for(const count of [1,63,1001]){
    const items=ctx.spaceLayout(count),max=Math.max(...items.map(p=>-p.z));
    for(const p of items)for(const width of [280,390,1440]){
      const camera=ctx.spaceFocus(p,max),projection=ctx.spaceProject(p,camera,width,500);
      assert.equal(projection.visible,true);assert.ok(Math.abs(projection.x)<1e-8&&Math.abs(projection.y)<1e-8);assert.ok(projection.opacity>.9);
    }
  }
});
test('wheel units and camera limits prevent runaway travel while keeping page boundaries reachable',()=>{
  assert.equal(ctx.spaceWheel(3,1,600),48);assert.equal(ctx.spaceWheel(1,2,600),600);assert.equal(ctx.spaceWheel(120,0,600),120);
  assert.equal(ctx.spaceWheel(99999,0,600),900);assert.equal(ctx.spaceWheel(-99999,0,600),-900);
  assert.equal(ctx.spaceClamp({x:9999,y:-9999,z:99999},1500).z,1500);
  assert.equal(ctx.spaceClamp({x:9999,y:-9999,z:-8},1500).z,0);
  assert.equal(ctx.spaceClamp({x:9999,y:-9999,z:0},1500).x,850);assert.equal(ctx.spaceClamp({x:0,y:-9999,z:0},1500).y,-550);
});
test('camera easing is frame-rate independent and reduced motion responds without trailing animation',()=>{
  const target={x:400,y:-300,z:1200};
  function simulate(hz){let camera={x:0,y:0,z:0};for(let i=0;i<hz;i++)camera=ctx.spaceStep(camera,target,1/hz,false);return camera;}
  const a=simulate(60),b=simulate(120);for(const key of ['x','y','z'])assert.ok(Math.abs(a[key]-b[key])<1e-9);
  const snap=ctx.spaceStep({x:0,y:0,z:0},target,0,true);for(const key of ['x','y','z'])assert.equal(snap[key],target[key]);
});
test('photos behind or too close to the camera are clipped without non-finite projection values',()=>{
  const p=ctx.spaceLayout(1)[0];
  for(const z of [800,1080,99999]){
    const projected=ctx.spaceProject(p,{x:0,y:0,z},700,600);assert.equal(projected.visible,false);assert.ok(Number.isFinite(projected.scale));assert.ok(Number.isFinite(projected.x));
  }
  assert.equal(ctx.spaceProject({...p,z:-5000},{x:0,y:0,z:0},700,600).visible,false);
});

test('space photo details open immediately and a delayed older transition cannot replace them',()=>{
  const updates=[],rendered=[];
  const h=vm.createContext({state:{dates:[{id:'first'},{id:'second'}]},recallOpenGeneration:0,photoTransition:null,motionReduced:()=>false,document:{activeElement:{querySelector:()=>({style:{}})},querySelector:()=>null,startViewTransition(update){updates.push(update);return{skipTransition(){},finished:Promise.resolve()};}},renderRecallContent(d,index){rendered.push([d.id,index]);}});
  vm.runInContext(fn('openRecall'),h);
  h.openRecall('first',2);assert.equal(updates.length,1);assert.equal(rendered.length,0);
  h.openRecall('second',6,true);assert.deepEqual(rendered,[['second',6]]);
  updates[0]();assert.deepEqual(rendered,[['second',6]]);
});
