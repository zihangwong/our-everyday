import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const a=source.indexOf('function '+name+'(');assert.ok(a>=0);return source.slice(a,source.indexOf('\n}',a)+2);}
const ctx=vm.createContext({});vm.runInContext(fn('orbitWindow')+'\n'+fn('orbitPoint'),ctx);

test('a bounded ring visits every archive item in both directions, even when archive size is not a slot multiple',()=>{
  for(const width of [280,390,741,1440])for(const count of [1,7,8,13,63,250,1001]){
    const slots=Math.min(count,width<600?8:12),step=2*Math.PI/slots;
    for(const direction of [-1,1]){
      const seen=new Set();
      for(let k=0;k<count;k++){
        const items=ctx.orbitWindow(count,direction*k*step+.001,width);
        assert.equal(items.length,slots);assert.equal(new Set(items.map(x=>x.slot)).size,slots);
        assert.equal(new Set(items.map(x=>x.index)).size,slots);
        for(const item of items){assert.ok(item.index>=0&&item.index<count);seen.add(item.index);}
      }
      assert.equal(seen.size,count);
    }
  }
  assert.equal(ctx.orbitWindow(0,0,390).length,0);
});

test('recycling the ring leaves continuing photos in place and wraps to the same identity after a full archive cycle',()=>{
  for(const count of [13,63,250]){
    const width=741,step=2*Math.PI/12,a=ctx.orbitWindow(count,.18,width),b=ctx.orbitWindow(count,.18+.01,width);
    for(const item of a){const next=b.find(x=>x.logical===item.logical);assert.ok(next);assert.equal(next.index,item.index);assert.equal(next.slot,item.slot);assert.ok(Math.abs(next.theta-item.theta-.01)<1e-10);}
    const cycle=ctx.orbitWindow(count,.18+count*step,width);
    assert.deepEqual(Array.from(cycle,x=>x.index).sort((x,y)=>x-y),Array.from(a,x=>x.index).sort((x,y)=>x-y));
  }
});

test('ring proportions and card sizes remain independent of archive growth',()=>{
  for(const width of [280,390,741,1440]){
    const a=ctx.orbitPoint(0,12,.4,width),b=ctx.orbitPoint(0,1001,.4,width);
    assert.equal(a.radius,b.radius);assert.equal(a.cardWidth,b.cardWidth);
    assert.ok(a.radius+a.cardWidth/2<width/2+2);
  }
});

test('mode switching preserves the full browse wall and wakes the correct exhibition',()=>{
  const elements=new Map(['galleryOrbit','galleryScatter'].map(id=>[id,{hidden:false}]));
  const buttons=['orbit','scatter'].map(mode=>({dataset:{galleryMode:mode},setAttribute(_k,v){this.pressed=v;}}));
  const h=vm.createContext({galleryMode:'orbit',setSpaceExpanded(){},scatter:{pause(){h.pauses++;}},pauses:0,document:{getElementById:id=>elements.get(id),querySelectorAll:()=>buttons},orbit:{wake(){h.wakes++;},resize(){h.resizes++;}},wakes:0,resizes:0,renderScatter(){h.scattered++;},scattered:0});
  vm.runInContext(fn('setGalleryMode'),h);h.setGalleryMode('scatter');
  assert.equal(elements.get('galleryOrbit').hidden,true);assert.equal(elements.get('galleryScatter').hidden,false);assert.equal(buttons[1].pressed,'true');assert.equal(h.scattered,1);
  h.setGalleryMode('orbit');assert.equal(elements.get('galleryOrbit').hidden,false);assert.equal(elements.get('galleryScatter').hidden,true);assert.equal(h.resizes,1);assert.equal(h.wakes,2);assert.equal(h.pauses,1);
});
