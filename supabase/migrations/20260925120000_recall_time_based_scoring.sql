-- Recall scores continuously off elapsed time within the 10s window, not
-- just the discrete reveal step, so two correct guesses in the same reveal
-- step are not worth the same amount — faster is always worth more.
-- Deterministic: a pure function of elapsed milliseconds, clamped to the
-- window. p_elapsed_ms is optional and falls back to the old step ladder
-- when absent (an older client, or nothing to compare against).

create or replace function public.recall_points(p_step integer, p_elapsed_ms integer default null)
returns integer
language sql immutable
as $$
  select case
    when p_elapsed_ms is null then
      case coalesce(p_step, 9) when 0 then 1000 when 1 then 750 when 2 then 500 when 3 then 250 else 0 end
    else
      greatest(250, least(1000, round(250 + 750 * (1 - least(greatest(p_elapsed_ms, 0), 10000) / 10000.0))))
  end
$$;

create or replace function public.recall_submit(
  p_day integer, p_mode text, p_guess text, p_step integer,
  p_attempts integer, p_claim text, p_correct boolean, p_elapsed_ms integer default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_answer  text;
  v_claim   text := nullif(public.recall_norm(coalesce(p_claim, '')), '');
  v_guess   text := public.recall_norm(coalesce(p_guess, ''));
  v_known   boolean;
  v_drift   boolean := false;
  v_correct boolean;
  v_score   integer;
  v_row     public.recall_results;
  v_mode    text := coalesce(nullif(p_mode, ''), 'daily');
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  p_step := greatest(least(coalesce(p_step, 3), 3), 0);
  p_attempts := greatest(least(coalesce(p_attempts, 1), 8), 1);

  select answer into v_answer from public.recall_daily where day = p_day;
  v_known := v_answer is not null;

  if v_known and v_claim is not null and v_claim <> v_answer then
    v_drift := true; v_answer := v_claim; v_known := false;
  end if;

  if v_known then
    v_correct := (v_guess = v_answer);
  elsif v_claim is not null then
    v_correct := (v_guess = v_claim);
  else
    v_correct := coalesce(p_correct, false);
  end if;

  v_score := case when v_correct then public.recall_points(p_step, p_elapsed_ms) else 0 end;

  if v_mode = 'daily' then
    select * into v_row from public.recall_results
      where user_id = v_me and day = p_day and mode = 'daily';
    if v_row.id is not null then
      return jsonb_build_object('already', true, 'correct', v_row.correct,
        'score', v_row.score, 'step', v_row.step, 'verified', v_row.verified);
    end if;
  end if;

  begin
    insert into public.recall_results
      (user_id, mode, day, track, step, reveal_seconds, attempts, score, correct, verified)
    values
      (v_me, v_mode, p_day, left(coalesce(p_claim, ''), 200), p_step,
       case p_step when 0 then 1 when 1 then 3 when 2 then 5 else 10 end,
       p_attempts, v_score, v_correct, v_known)
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.recall_results
      where user_id = v_me and day = p_day and mode = 'daily';
    return jsonb_build_object('already', true, 'correct', v_row.correct,
      'score', v_row.score, 'step', v_row.step, 'verified', v_row.verified);
  end;

  return jsonb_build_object('already', false, 'correct', v_correct, 'score', v_score,
                            'step', p_step, 'verified', v_known, 'drift', v_drift);
end $$;

revoke all on function public.recall_points(integer, integer) from public, anon;
grant execute on function public.recall_points(integer, integer) to anon, authenticated, service_role;
revoke all on function public.recall_submit(integer, text, text, integer, integer, text, boolean, integer) from public, anon;
grant execute on function public.recall_submit(integer, text, text, integer, integer, text, boolean, integer) to authenticated;
