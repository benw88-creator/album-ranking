-- RocketRun's 30-second clock. Rolled back: nothing persists.
--   supabase db query --linked --project-ref <LAB> -f scripts/sql-checks/rocketrun-timer.sql
begin;
do $$
declare u uuid := gen_random_uuid(); d integer := public.rr_today(); v jsonb; r public.rr_runs;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rr-timer@test.invalid', now());
  insert into public.rr_days (day, questions, version) values (d, '[{},{},{},{},{}]'::jsonb, 1) on conflict do nothing;

  -- Opening starts the clock; opening again does not restart it.
  v := public.rr_open_q(u, d, 0);
  if not (v->>'ok')::boolean or (v->>'remaining_ms')::int < 29000 then raise exception 'open 0: %', v; end if;
  update public.rr_runs set q_open_at = now() - interval '20 seconds' where user_id = u and day = d;
  v := public.rr_open_q(u, d, 0);
  if (v->>'remaining_ms')::int > 10500 then raise exception 'reopen restarted the clock: %', v; end if;

  -- An answer that ARRIVED in time is judged in time, however late it is checked.
  v := public.rr_attempt_q(u, d, 0, now() - interval '1 second');
  if not (v->>'ok')::boolean then raise exception 'in-time attempt refused: %', v; end if;
  -- One that arrived after 30s + grace is passed for 0 m, once.
  update public.rr_runs set q_open_at = now() - interval '40 seconds' where user_id = u and day = d;
  v := public.rr_attempt_q(u, d, 0, now());
  if v->>'reason' <> 'timeout' then raise exception 'late attempt not timed out: %', v; end if;
  if not exists (select 1 from public.rr_answers where user_id = u and day = d and q = 0 and key is null and timed_out) then
    raise exception 'timeout not recorded';
  end if;
  v := public.rr_attempt_q(u, d, 0, now());
  if (v->>'next')::int <> 1 then raise exception 'second late attempt should see next=1: %', v; end if;

  -- An answer to a question nobody opened is refused (and opens it): no clock-free answers.
  v := public.rr_attempt_q(u, d, 1, now());
  if v->>'reason' <> 'not_open' then raise exception 'unopened answer accepted: %', v; end if;
  v := public.rr_attempt_q(u, d, 1, now());
  if not (v->>'ok')::boolean then raise exception 'retry after not_open refused: %', v; end if;

  -- Opening a question out of order is refused.
  v := public.rr_open_q(u, d, 3);
  if v->>'reason' <> 'order' then raise exception 'out of order open: %', v; end if;

  -- A question left open is expired by the next read (refresh / come back later).
  v := public.rr_open_q(u, d, 1);
  update public.rr_runs set q_open_at = now() - interval '5 minutes' where user_id = u and day = d;
  v := public.rr_expire(u, d, now());
  if v is null or not (v->>'timeout')::boolean then raise exception 'expire did nothing: %', v; end if;
  if (public.rr_state(u, d)->'open') is not null and (public.rr_state(u, d)->'open'->>'q')::int = 1 then raise exception 'state still shows q1 open'; end if;

  -- A manual pass inside the clock is a pass, not a timeout.
  v := public.rr_open_q(u, d, 2);
  v := public.rr_pass(u, d, 2, now());
  if (v->>'timeout') is not null then raise exception 'early pass marked as timeout: %', v; end if;

  raise notice 'rocketrun-timer: ok';
end $$;
rollback;
