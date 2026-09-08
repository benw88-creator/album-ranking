-- ===========================================================================
-- Two things needed to run this rather than guess at it: a per-question
-- breakdown, and somewhere for client errors to land.
-- ===========================================================================

-- Which questions land and which get waved away. A question with a high skip
-- rate is a bad question -- this is how you find out which ones to rewrite
-- instead of assuming the whole idea is not working.
create or replace function public.analytics_questions(p_days integer default 30)
returns table (question_id text, shown bigint, answered bigint, skipped bigint, other_used bigint)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Admins only';
  end if;
  return query
  select (e.props->>'q')::text as question_id,
         count(*) filter (where e.name = 'question_shown')    as shown,
         count(*) filter (where e.name = 'question_answered') as answered,
         count(*) filter (where e.name = 'question_skipped')  as skipped,
         count(*) filter (where e.name = 'question_other')    as other_used
  from public.analytics_events e
  where e.created_at > v_since
    and e.name in ('question_shown','question_answered','question_skipped','question_other')
    and e.props ? 'q'
  group by 1
  order by shown desc nulls last;
end;
$$;

revoke all on function public.analytics_questions(integer) from public, anon;
grant execute on function public.analytics_questions(integer) to authenticated;

-- --- Client errors ---------------------------------------------------------
-- No third party, no signup, no script tag from someone else's CDN. Errors go
-- into a table only an admin can read. Without this you find out the app is
-- broken when somebody mentions it, and most people never do.
create table if not exists public.client_errors (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  message    text not null,
  source     text,
  line       integer,
  col        integer,
  stack      text,
  url        text,
  agent      text,
  created_at timestamptz not null default now()
);

create index client_errors_time_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Anyone may report a crash, including a logged-out visitor, because those
-- are exactly the crashes nobody would otherwise hear about. Nobody may read
-- them back except through the admin function below.
create policy "anyone reports a crash" on public.client_errors
  for insert with check (true);

create or replace function public.recent_errors(p_limit integer default 30)
returns setof public.client_errors
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Admins only';
  end if;
  return query
    select * from public.client_errors order by created_at desc limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.recent_errors(integer) from public, anon;
grant execute on function public.recent_errors(integer) to authenticated;
