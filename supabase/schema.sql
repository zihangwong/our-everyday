-- Run once in a new Supabase project's SQL Editor. No public media bucket.
begin;
create table if not exists public.diaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  invite_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.diary_members (
  diary_id uuid not null references public.diaries(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  primary key(diary_id,user_id)
);
create table if not exists public.diary_state (
  diary_id uuid primary key references public.diaries(id) on delete cascade,
  revision bigint not null default 0,
  document jsonb,
  updated_at timestamptz not null default now()
);
alter table public.diaries enable row level security;
alter table public.diary_members enable row level security;
alter table public.diary_state enable row level security;

create or replace function public.is_diary_member(p_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.diary_members where diary_id=p_id and user_id=auth.uid());
$$;
revoke all on function public.is_diary_member(uuid) from public;
grant execute on function public.is_diary_member(uuid) to authenticated;
drop policy if exists diary_read on public.diaries;
create policy diary_read on public.diaries for select to authenticated using(public.is_diary_member(id));
drop policy if exists membership_read on public.diary_members;
create policy membership_read on public.diary_members for select to authenticated using(user_id=auth.uid());
drop policy if exists state_read on public.diary_state;
create policy state_read on public.diary_state for select to authenticated using(public.is_diary_member(diary_id));
revoke all on public.diaries,public.diary_members,public.diary_state from anon,authenticated;
grant select on public.diaries,public.diary_members,public.diary_state to authenticated;

create or replace function public.create_diary() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.diaries;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  -- Repeated clicks reuse this user's existing space instead of creating duplicates.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select d.* into item from public.diaries d join public.diary_members m on m.diary_id=d.id where m.user_id=auth.uid() limit 1;
  if found then return jsonb_build_object('id',item.id,'invite_token',item.invite_token); end if;
  insert into public.diaries(owner_id) values(auth.uid()) returning * into item;
  insert into public.diary_members values(item.id,auth.uid());
  insert into public.diary_state(diary_id) values(item.id);
  return jsonb_build_object('id',item.id,'invite_token',item.invite_token);
end; $$;

create or replace function public.join_diary(p_invite uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare diary uuid;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  select id into diary from public.diaries where invite_token=p_invite for update;
  if diary is null then raise exception 'INVITE_UNAVAILABLE'; end if;
  if public.is_diary_member(diary) then return diary; end if;
  if exists(select 1 from public.diary_members where user_id=auth.uid()) then raise exception 'ALREADY_IN_SPACE'; end if;
  if (select count(*) from public.diary_members where diary_id=diary)>=2 then raise exception 'INVITE_UNAVAILABLE'; end if;
  insert into public.diary_members values(diary,auth.uid());return diary;
end; $$;

create or replace function public.save_diary(p_id uuid,p_revision bigint,p_document jsonb) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare next_revision bigint;
begin
  if not public.is_diary_member(p_id) then raise exception 'SPACE_FORBIDDEN'; end if;
  if jsonb_typeof(p_document) is distinct from 'object' or jsonb_typeof(p_document->'dates') is distinct from 'array'
    or jsonb_typeof(p_document->'config') is distinct from 'object' then raise exception 'INVALID_DOCUMENT'; end if;
  update public.diary_state set document=p_document,revision=revision+1,updated_at=now()
    where diary_id=p_id and revision=p_revision returning revision into next_revision;
  if not found then raise exception 'DIARY_CONFLICT'; end if;
  return next_revision;
end; $$;
revoke all on function public.create_diary(),public.join_diary(uuid),public.save_diary(uuid,bigint,jsonb) from public;
grant execute on function public.create_diary(),public.join_diary(uuid),public.save_diary(uuid,bigint,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('diary-media','diary-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Text comparison avoids UUID-cast errors for malformed object paths.
create or replace function public.can_access_diary_media(p_name text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.diary_members where diary_id::text=split_part(p_name,'/',1) and user_id=auth.uid());
$$;
revoke all on function public.can_access_diary_media(text) from public;
grant execute on function public.can_access_diary_media(text) to authenticated;
drop policy if exists diary_media_read on storage.objects;
drop policy if exists diary_media_insert on storage.objects;
drop policy if exists diary_media_update on storage.objects;
create policy diary_media_read on storage.objects for select to authenticated using(bucket_id='diary-media' and public.can_access_diary_media(name));
create policy diary_media_insert on storage.objects for insert to authenticated with check(bucket_id='diary-media' and public.can_access_diary_media(name));
create policy diary_media_update on storage.objects for update to authenticated using(bucket_id='diary-media' and public.can_access_diary_media(name)) with check(bucket_id='diary-media' and public.can_access_diary_media(name));
-- No browser DELETE policy: removing a memory doesn't immediately destroy its file.
commit;
