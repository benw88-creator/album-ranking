-- Hardening from the 2026-11-13 security review. Idempotent.

-- 1. RocketRun: an answer to a question that was never opened is refused.
--    The first version started the clock AT the answer, so a client that
--    skipped rr_open_q had no clock at all (prompts are public, so it could
--    research all five and post them back to back). The refusal opens the
--    question, so the current client's one retry is judged normally.
create or replace function public.rr_attempt_q(p_user uuid, p_day integer, p_q integer, p_received timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; r public.rr_runs; v jsonb;
begin
  a := public.rr_attempt(p_user, p_day);
  if not (a ->> 'ok')::boolean then return a; end if;
  if (a ->> 'next')::int <> p_q then return a; end if;
  select * into r from public.rr_runs where user_id = p_user and day = p_day;
  if r.q_open is distinct from p_q then
    update public.rr_runs set q_open = p_q, q_open_at = now() where user_id = p_user and day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  v := public.rr_expire(p_user, p_day, p_received);
  if v is not null then return jsonb_build_object('ok', false, 'reason', 'timeout', 'passed', v); end if;
  return a;
end $$;
revoke all on function public.rr_attempt_q(uuid, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.rr_attempt_q(uuid, integer, integer, timestamptz) to service_role;

-- 2. "Missing from the catalogue" reports: the cap is count-then-insert, so
--    it takes a per-user lock (CLAUDE.md: any count-then-act cap needs one).
create or replace function public.rr_report_missing(p_user uuid, p_day integer, p_q integer, p_text text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('rr_missing:' || p_user::text));
  if (select count(*) from public.rr_missing where user_id = p_user and day = p_day) >= 10 then return false; end if;
  insert into public.rr_missing (user_id, day, q, text) values (p_user, p_day, p_q, left(btrim(p_text), 120));
  return true;
end $$;
revoke all on function public.rr_report_missing(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.rr_report_missing(uuid, integer, integer, text) to service_role;

-- 3. og_numbers: the number is public on the profile (profiles.og_number); the
--    table itself is not. Readable whole it listed every account's id and
--    signup time, private ones included. Each person reads their own row.
drop policy if exists og_numbers_read on public.og_numbers;
create policy og_numbers_read on public.og_numbers for select using ((select auth.uid()) = user_id);
revoke all on public.og_numbers from anon, authenticated;
grant select on public.og_numbers to authenticated;
revoke all on function public.og_on_signup() from public, anon, authenticated;

do $$ begin
  if has_table_privilege('anon', 'public.og_numbers', 'select') then raise exception 'og_numbers readable by anon'; end if;
  if has_function_privilege('authenticated', 'public.rr_attempt_q(uuid, integer, integer, timestamptz)', 'execute') then
    raise exception 'rr_attempt_q callable by authenticated';
  end if;
end $$;
