import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL enforces two-person membership, private files and compare-and-swap writes',async t=>{
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
  `);
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  async function asUser(n,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000000${n}',false);`);try{return await fn();}finally{await db.exec('reset role');}}
  let diary;
  await t.test('creating a space is idempotent and media bucket is private',async()=>{
    diary=(await asUser(1,()=>db.query('select public.create_diary() as value'))).rows[0].value;
    const again=(await asUser(1,()=>db.query('select public.create_diary() as value'))).rows[0].value;
    assert.equal(again.id,diary.id);
    assert.equal((await db.query("select public from storage.buckets where id='diary-media'")).rows[0].public,false);
  });
  await t.test('an unrelated authenticated user cannot read state or upload to that space',async()=>{
    assert.equal((await asUser(3,()=>db.query('select * from public.diary_state'))).rows.length,0);
    await assert.rejects(()=>asUser(3,()=>db.query("insert into storage.objects(bucket_id,name) values('diary-media',$1)",[diary.id+'/secret.mp4'])),/row.level security/i);
    await assert.rejects(()=>asUser(3,()=>db.query('select public.save_diary($1,0,$2)',[diary.id,{config:{},dates:[]} ])),/SPACE_FORBIDDEN/);
  });
  await t.test('the invited partner joins; a third person cannot join or self-insert membership',async()=>{
    assert.equal((await asUser(2,()=>db.query('select public.join_diary($1) as id',[diary.invite_token]))).rows[0].id,diary.id);
    await assert.rejects(()=>asUser(3,()=>db.query('select public.join_diary($1)',[diary.invite_token])),/INVITE_UNAVAILABLE/);
    await assert.rejects(()=>asUser(3,()=>db.query("insert into public.diary_members values($1,'00000000-0000-4000-8000-000000000003')",[diary.id])),/permission denied/);
  });
  await t.test('stale writes fail without replacing the winning document',async()=>{
    const doc={config:{togetherDate:'2026-11-08'},dates:[{id:'one',media:[{kind:'video',caption:'first'}]}]};
    assert.equal((await asUser(1,()=>db.query('select public.save_diary($1,0,$2) as revision',[diary.id,doc]))).rows[0].revision,1);
    await assert.rejects(()=>asUser(2,()=>db.query('select public.save_diary($1,0,$2)',[diary.id,{config:{},dates:[]}])),/DIARY_CONFLICT/);
    const saved=(await asUser(2,()=>db.query('select document from public.diary_state'))).rows[0].document;
    assert.equal(saved.dates[0].media[0].caption,'first');
    await assert.rejects(()=>asUser(1,()=>db.query('select public.save_diary($1,1,$2)',[diary.id,{config:{},dates:null}])),/INVALID_DOCUMENT/);
  });
  await t.test('private media is readable by the partner, but not by outsiders or anonymous users',async()=>{
    await asUser(1,()=>db.query("insert into storage.objects(bucket_id,name) values('diary-media',$1)",[diary.id+'/video.mp4']));
    assert.equal((await asUser(2,()=>db.query('select * from storage.objects'))).rows.length,1);
    assert.equal((await asUser(3,()=>db.query('select * from storage.objects'))).rows.length,0);
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false);");
    await assert.rejects(()=>db.query('select public.create_diary()'),/permission denied/);await db.exec('reset role');
  });
  await db.close();
});
