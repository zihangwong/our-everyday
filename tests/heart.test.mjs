import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../maincode',import.meta.url),'utf8');
function fn(name){const p=source.indexOf('function '+name+'(');assert.ok(p>0,name);return source.slice(p,source.indexOf('\n}',p)+2);}
const h={};vm.createContext(h);vm.runInContext(fn('anniversaryLabel')+fn('anniversaryProgress'),h);
const at=(iso)=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d,15,30);};

test('the heart fills from one monthly anniversary to the next',()=>{
  const p=h.anniversaryProgress('2026-11-08',at('2026-11-19'));
  assert.equal(p.next,1);assert.equal(p.daysLeft,19);assert.equal(p.today,false);
  assert.ok(Math.abs(p.progress-11/30)<1e-9);
  assert.equal(p.text,'离在一起 1 个月，还有 19 天');
});
test('on the anniversary day the heart is full and says so',()=>{
  const day=h.anniversaryProgress('2026-11-08',at('2026-12-08'));
  assert.equal(day.today,true);assert.equal(day.progress,1);assert.equal(day.months,1);assert.equal(day.text,'今天，在一起 1 个月了');
  const first=h.anniversaryProgress('2026-11-08',at('2026-11-08'));
  assert.equal(first.today,true);assert.equal(first.progress,1);assert.equal(first.text,'今天，我们在一起了');
});
test('a day that a month lacks falls on its last day, and years read as years',()=>{
  const feb=h.anniversaryProgress('2026-01-31',at('2026-02-28'));
  assert.equal(feb.today,true);assert.equal(feb.months,1);
  assert.equal(h.anniversaryProgress('2026-11-08',at('2027-11-08')).text,'今天，在一起 1 周年了');
  assert.equal(h.anniversaryProgress('2026-11-08',at('2027-12-01')).text,'离在一起 1 年 1 个月，还有 7 天');
});
const g={};vm.createContext(g);vm.runInContext(fn('anniversaryLabel')+fn('anniversaryProgress')+fn('anniversaryHearts'),g);
test('each finished month leaves a full heart behind, with its date',()=>{
  const r=g.anniversaryHearts('2026-11-08',at('2027-02-20'));
  assert.equal(r.past.length,3);
  assert.deepEqual(Array.from(r.past,x=>x.kind),['month','month','month']);
  assert.equal(r.past[0].label,'第 1 个月 · 2026.12.08');assert.equal(r.past[2].label,'第 3 个月 · 2027.02.08');
  assert.equal(r.current.next,4);
});
test('on an anniversary the newest heart is the full, beating one; the next day it joins the row',()=>{
  assert.equal(g.anniversaryHearts('2026-11-08',at('2026-12-08')).past.length,0);
  assert.equal(g.anniversaryHearts('2026-11-08',at('2026-12-08')).current.today,true);
  assert.equal(g.anniversaryHearts('2026-11-08',at('2026-12-09')).past.length,1);
});
test('twelve month hearts fold into one year heart',()=>{
  const r=g.anniversaryHearts('2026-11-08',at('2028-01-10'));
  assert.deepEqual(Array.from(r.past,x=>x.kind),['year','month','month']);
  assert.equal(r.past[0].label,'1 周年 · 2027.11.08');assert.equal(r.past[0].short,'1年');
  assert.equal(r.past[2].label,'第 14 个月 · 2028.01.08');
  assert.equal(g.anniversaryHearts('',at('2026-11-19')).past.length,0);
});
test('a missing or future date never shows a broken heart',()=>{
  const none=h.anniversaryProgress('',at('2026-11-19'));
  assert.equal(none.progress,0);assert.equal(none.text,'在设置里写下在一起的日子');
  const soon=h.anniversaryProgress('2026-12-01',at('2026-11-19'));
  assert.equal(soon.daysLeft,12);assert.equal(soon.progress,0);assert.equal(soon.text,'离在一起，还有 12 天');
});
