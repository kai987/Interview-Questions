-- Audio publication compares updated_at before registering immutable objects.
-- Every writer must advance it, including direct SQL and edits to the question.
create or replace function public.version_interview_private_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := greatest(pg_catalog.clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

revoke all on function public.version_interview_private_content() from public, anon, authenticated;

create or replace trigger version_interview_private_content
before update on public.interview_private_content
for each row execute function public.version_interview_private_content();

create or replace function public.version_interview_question_audio()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Retains the caller's existing RLS permissions; no private text is changed.
  update public.interview_private_content
  set updated_at = updated_at
  where question_id = new.id;
  return new;
end;
$$;

revoke all on function public.version_interview_question_audio() from public, anon, authenticated;

create or replace trigger version_interview_question_audio
after update of question on public.interview_questions
for each row when (old.question is distinct from new.question)
execute function public.version_interview_question_audio();
