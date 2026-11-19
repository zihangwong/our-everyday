-- Optional email-only entry. Enabling an address deliberately treats knowledge
-- of that address as permission to enter. Keep the allowlist server-side.
begin;
create table if not exists public.email_entry_allowlist (
  email text primary key check (email=lower(btrim(email))),
  diary_id uuid not null references public.diaries(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  enabled boolean not null default false,
  request_window timestamptz,
  request_count integer not null default 0
);
alter table public.email_entry_allowlist enable row level security;
revoke all on public.email_entry_allowlist from public,anon,authenticated;
grant select,insert,update,delete on public.email_entry_allowlist to service_role;

create or replace function public.begin_email_entry(p_email text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.email_entry_allowlist;
begin
  select * into entry from public.email_entry_allowlist
    where email=lower(btrim(p_email)) and enabled for update;
  if not found then raise exception 'EMAIL_ENTRY_DENIED'; end if;
  if entry.request_window>now()-interval '1 minute' and entry.request_count>=6 then
    raise exception 'EMAIL_ENTRY_LIMIT';
  end if;
  update public.email_entry_allowlist set
    request_count=case when request_window>now()-interval '1 minute' then request_count+1 else 1 end,
    request_window=case when request_window>now()-interval '1 minute' then request_window else now() end
    where email=entry.email;
  return jsonb_build_object('diary_id',entry.diary_id,'auth_user_id',entry.auth_user_id);
end; $$;

create or replace function public.admit_email_entry(p_email text,p_user_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.email_entry_allowlist; actual_email text;
begin
  select * into entry from public.email_entry_allowlist
    where email=lower(btrim(p_email)) and enabled for update;
  if not found then raise exception 'EMAIL_ENTRY_DENIED'; end if;
  select lower(email) into actual_email from auth.users where id=p_user_id;
  if actual_email is distinct from entry.email then raise exception 'EMAIL_ENTRY_DENIED'; end if;
  if entry.auth_user_id is not null and entry.auth_user_id<>p_user_id then raise exception 'EMAIL_ENTRY_DENIED'; end if;
  perform 1 from public.diaries where id=entry.diary_id for update;
  if not exists(select 1 from public.diary_members where diary_id=entry.diary_id and user_id=p_user_id) then
    if exists(select 1 from public.diary_members where user_id=p_user_id)
      or (select count(*) from public.diary_members where diary_id=entry.diary_id)>=2 then
      raise exception 'EMAIL_ENTRY_FULL';
    end if;
    insert into public.diary_members(diary_id,user_id) values(entry.diary_id,p_user_id);
  end if;
  update public.email_entry_allowlist set auth_user_id=p_user_id where email=entry.email;
  return entry.diary_id;
end; $$;
revoke all on function public.begin_email_entry(text),public.admit_email_entry(text,uuid) from public,anon,authenticated;
grant execute on function public.begin_email_entry(text),public.admit_email_entry(text,uuid) to service_role;
commit;
