-- Direct messages between two users. The social layer stopped at
-- follows/comments/reactions/Groove membership, with nothing for "message
-- this specific person" — the obvious next thing somebody reaches for on a
-- taste-comparison app and doesn't find. Minimal on purpose: a thread and an
-- inbox, one read marker, no typing indicators, no push, no editing.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- One index for pulling a thread (either direction, ordered), one for an
-- inbox sorted by recency.
create index if not exists messages_thread_idx on public.messages
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "read own messages" on public.messages;
create policy "read own messages" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Blocked in either direction cannot message each other — same rule the
-- feed, comments and notifications already apply, checked both ways because
-- a block is one-directional and either party could be the blocker.
drop policy if exists "send messages" on public.messages;
create policy "send messages" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and recipient_id <> sender_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = sender_id and b.blocked_id = recipient_id)
         or (b.blocker_id = recipient_id and b.blocked_id = sender_id)
    )
  );

-- No update or delete policy at all. A raw UPDATE policy scoped to "you're
-- the recipient" would also let the recipient silently rewrite the sender's
-- own text, since RLS has no column-level granularity — the same reason
-- wallet_buy takes a key and never lets the client write a balance directly.
-- Marking read goes through a function instead.
create or replace function public.mark_message_read(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
  set read_at = now()
  where id = p_message_id
    and recipient_id = auth.uid()
    and read_at is null;
end;
$$;

-- One row per conversation with the latest message and an unread count —
-- the shape an inbox actually wants, which a plain filtered select cannot
-- produce without either a GROUP BY the client can't express through
-- PostgREST or a second table to keep in sync with every insert.
create or replace function public.my_conversations()
returns table (
  other_id uuid,
  last_body text,
  last_at timestamptz,
  last_from_me boolean,
  unread_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select
      case when sender_id = auth.uid() then recipient_id else sender_id end as other_id,
      sender_id, body, created_at, read_at
    from public.messages
    where sender_id = auth.uid() or recipient_id = auth.uid()
  ),
  ranked as (
    select *, row_number() over (partition by other_id order by created_at desc) as rn
    from mine
  )
  select
    r.other_id,
    r.body as last_body,
    r.created_at as last_at,
    (r.sender_id = auth.uid()) as last_from_me,
    (select count(*) from mine m2
       where m2.other_id = r.other_id and m2.sender_id <> auth.uid() and m2.read_at is null) as unread_count
  from ranked r
  where r.rn = 1
  order by r.created_at desc;
$$;

revoke all on function public.my_conversations() from public;
grant execute on function public.my_conversations() to authenticated;
revoke all on function public.mark_message_read(uuid) from public;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- Needs no entry in delete_my_data()'s hand-written table list, unlike most
-- new user-data tables — both foreign keys above are ON DELETE CASCADE, so
-- deleting the auth.users row (the final step of account deletion) removes
-- every message in either direction on its own. Same shape as bid_wars.
