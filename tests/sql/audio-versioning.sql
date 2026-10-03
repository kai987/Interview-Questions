-- Run after version_interview_audio_updates. The inner transaction is always
-- rolled back, including the temporary question change. No fixture persists.
do $verify$
declare
  original public.interview_private_content%rowtype;
  original_question text;
  first_version timestamptz;
  second_version timestamptz;
  matched integer;
begin
  perform set_config('lock_timeout', '5s', true);
  select * into strict original from public.interview_private_content
    order by user_id, question_id limit 1;
  select question into strict original_question from public.interview_questions
    where id = original.question_id;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', original.user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.interview_private_content set updated_at = updated_at
      where user_id = original.user_id and question_id = original.question_id
      and updated_at = original.updated_at
      returning updated_at into strict first_version;
    if first_version <= original.updated_at then raise exception 'Version did not advance'; end if;
    update public.interview_private_content set updated_at = updated_at
      where user_id = original.user_id and question_id = original.question_id
      and updated_at = original.updated_at;
    get diagnostics matched = row_count;
    if matched <> 0 then raise exception 'Stale publication was accepted'; end if;
    execute 'reset role';
    update public.interview_questions set question = original_question || E'\n[rollback-only verification]'
      where id = original.question_id;
    select updated_at into strict second_version from public.interview_private_content
      where user_id = original.user_id and question_id = original.question_id;
    if second_version <= first_version then raise exception 'Question change did not invalidate the version'; end if;
    update public.interview_private_content set updated_at = updated_at
      where user_id = original.user_id and question_id = original.question_id
      and updated_at = first_version;
    get diagnostics matched = row_count;
    if matched <> 0 then raise exception 'Publication after a question change was accepted'; end if;
    raise exception using errcode = 'ZX001', message = 'Rollback successful verification';
  exception when sqlstate 'ZX001' then null;
  end;
  if (select to_jsonb(p) from public.interview_private_content p
      where p.user_id = original.user_id and p.question_id = original.question_id)
      is distinct from to_jsonb(original) then raise exception 'Private row was not restored'; end if;
  if (select question from public.interview_questions where id = original.question_id)
      is distinct from original_question then raise exception 'Question was not restored'; end if;
end;
$verify$;
select true as authenticated_update_verified, true as monotonic_version_verified, true as stale_updates_rejected,
  true as question_change_verified, true as temporary_changes_rolled_back;
