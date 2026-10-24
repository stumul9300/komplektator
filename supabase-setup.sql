-- Комплектатор: таблицы для тестовой версии сайта.
-- Supabase → SQL Editor → New query → вставить этот текст → Run.

create table if not exists public.items (
  id text primary key,
  data jsonb not null,
  created bigint
);
create table if not exists public.project (
  id text primary key,
  data jsonb not null
);

alter table public.items enable row level security;
alter table public.project enable row level security;

-- Тестовый режим: читать и менять может любой, у кого есть ссылка на сайт.
create policy "test_all_items" on public.items for all to anon, authenticated using (true) with check (true);
create policy "test_all_project" on public.project for all to anon, authenticated using (true) with check (true);

-- Чтобы изменения сразу появлялись у всех, кто открыл сайт.
alter publication supabase_realtime add table public.items, public.project;
