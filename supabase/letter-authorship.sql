-- New letters are signed by the authenticated member, never a client-selected name.
-- Existing journal/backup writes remain compatible; historical letters are not relabeled.
begin;
create or replace function public.append_diary_letter(
  p_id uuid,p_revision bigint,p_message_id uuid,p_text text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_state public.diary_state; owner uuid; sender text; sender_name text;
  letter jsonb; existing jsonb; letters jsonb; next_document jsonb; stamp text; next_revision bigint;
begin
  if auth.uid() is null or not public.is_diary_member(p_id) then raise exception 'SPACE_FORBIDDEN'; end if;
  if p_message_id is null or p_text is null or length(btrim(p_text))=0 or length(p_text)>500 then raise exception 'INVALID_LETTER'; end if;
  select * into current_state from public.diary_state where diary_id=p_id for update;
  if not found or current_state.document is null then raise exception 'DIARY_NOT_READY'; end if;
  letters=coalesce(current_state.document->'messages','[]'::jsonb);
  if jsonb_typeof(letters)<>'array' then raise exception 'INVALID_DOCUMENT'; end if;
  select value into existing from jsonb_array_elements(letters) where value->>'id'=p_message_id::text limit 1;
  if existing is not null then
    if existing->>'authorId' is distinct from auth.uid()::text or existing->>'text' is distinct from btrim(p_text) then raise exception 'LETTER_ID_CONFLICT'; end if;
    return jsonb_build_object('revision',current_state.revision,'message',existing,'document',current_state.document,'replayed',true);
  end if;
  if current_state.revision is distinct from p_revision then raise exception 'DIARY_CONFLICT'; end if;
  select owner_id into owner from public.diaries where id=p_id;
  sender=case when owner=auth.uid() then 'my' else 'her' end;
  sender_name=case when sender='my' then coalesce(nullif(current_state.document#>>'{config,myName}',''),'我') else coalesce(nullif(current_state.document#>>'{config,herName}',''),'你') end;
  stamp=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  letter=jsonb_build_object('id',p_message_id::text,'who',sender,'authorId',auth.uid()::text,'authorName',sender_name,'text',btrim(p_text),'at',stamp);
  next_document=jsonb_set(current_state.document,'{messages}',letters||jsonb_build_array(letter),true);
  if jsonb_typeof(next_document->'meta') is distinct from 'object' then next_document=jsonb_set(next_document,'{meta}','{}'::jsonb,true); end if;
  next_document=jsonb_set(next_document,'{meta,updatedAt}',to_jsonb(stamp),true);
  update public.diary_state set document=next_document,revision=revision+1,updated_at=now()
    where diary_id=p_id returning revision into next_revision;
  return jsonb_build_object('revision',next_revision,'message',letter,'document',next_document,'replayed',false);
end; $$;
revoke all on function public.append_diary_letter(uuid,bigint,uuid,text) from public,anon;
grant execute on function public.append_diary_letter(uuid,bigint,uuid,text) to authenticated;
commit;
