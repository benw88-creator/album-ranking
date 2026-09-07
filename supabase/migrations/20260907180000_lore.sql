-- ===========================================================================
-- LORE — what a person attaches to a record.
--
-- The unit is one answer to one question about one item. Questions are
-- deliberately small and mostly one-tap: the brief's whole point is that
-- nobody writes a 300-word essay about what a song "means".
--
-- question_text is snapshotted alongside question_id because the question
-- library lives in the client and will keep growing and changing. An answer
-- from six months ago has to still read correctly when the wording moves on,
-- and "Receipts" depends on quoting back exactly what was asked.
--
-- `skipped` records a question that was shown and waved away, so the engine
-- can stop offering it. That is a real answer for our purposes, just not one
-- worth showing on a profile.
-- ===========================================================================

create table if not exists public.lore_answers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_kind     text not null check (item_kind in ('album','song','artist')),
  item_id       text not null,
  item_name     text,
  item_artist   text,
  item_art      text,
  question_id   text not null,
  question_text text not null,
  choice        text,
  note          text,
  era           text,
  place         text,
  skipped       boolean not null default false,
  is_private    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- one answer per question per item per person; answering again updates it
  unique (user_id, item_kind, item_id, question_id)
);

create index lore_user_recent_idx on public.lore_answers (user_id, created_at desc);
create index lore_item_idx        on public.lore_answers (item_kind, item_id);
create index lore_era_idx         on public.lore_answers (user_id, era) where era is not null;

alter table public.lore_answers enable row level security;

-- Your own lore, always. Other people's only when it is a real answer they
-- have not marked private -- skips are bookkeeping, not content.
create policy "read own lore and public lore" on public.lore_answers
  for select using (
    auth.uid() = user_id
    or (is_private = false and skipped = false)
  );

create policy "write own lore" on public.lore_answers
  for insert with check (auth.uid() = user_id);

create policy "update own lore" on public.lore_answers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own lore" on public.lore_answers
  for delete using (auth.uid() = user_id);
