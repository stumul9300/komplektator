-- Комплектатор, обновление 2: журнал изменений и защита от одновременной правки.
-- Supabase → SQL Editor → New query → вставить весь текст → Run.
-- Можно запускать повторно: ничего не сломается и данные не удалятся.
-- Перед запуском (по желанию) сделайте копию: Table Editor → items → Export → CSV.

-- 1. Номер версии у позиции: сайт присылает версию, которую видел,
--    и база не даст тихо перезаписать то, что за это время сохранил другой участник.
alter table public.items add column if not exists version bigint not null default 0;

-- 2. Журнал. Записи создаёт только база (триггер ниже), время — серверное.
create table if not exists public.audit_events (
  id bigserial primary key,
  project_id text,
  item_id text,
  actor text,
  action text not null,
  field text,
  old_json jsonb,
  new_json jsonb,
  created_at timestamptz not null default now(),
  version bigint
);
create index if not exists audit_events_item on public.audit_events (item_id, created_at desc);
create index if not exists audit_events_project on public.audit_events (project_id, created_at desc);

alter table public.audit_events enable row level security;
drop policy if exists "audit_read" on public.audit_events;
create policy "audit_read" on public.audit_events for select to anon, authenticated using (true);
-- Политик на insert/update/delete нет: изменить или удалить запись журнала с сайта нельзя.
grant select on public.audit_events to anon, authenticated;
revoke insert, update, delete, truncate on public.audit_events from anon, authenticated;

-- Короткая версия значения для журнала: без картинок, чтобы журнал не раздувался.
create or replace function public.audit_value(k text, v jsonb) returns jsonb
language sql immutable as $$
  select case
    when v is null then null
    when k in ('img','imgCut') then to_jsonb(case when v = '""'::jsonb then '' else '(фото)' end)
    when k = 'variants' and jsonb_typeof(v) = 'array' then
      coalesce((select jsonb_agg(e - 'img') from jsonb_array_elements(v) e), '[]'::jsonb)
    else v
  end
$$;

create or replace function public.items_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  o jsonb;
  n jsonb;
  act text;
  who text;
  pid text;
  skip text[] := array['_actor','sd','sc','sentAt','supOk','imgCut','approvals','_no','priceCheckedBy'];
begin
  if tg_op = 'DELETE' then
    insert into audit_events(project_id,item_id,actor,action,field,old_json,new_json,version)
    values (coalesce(old.data->>'pid','main'), old.id, old.data->>'_actor', 'purge', null,
            jsonb_build_object('name', old.data->'name'), null, old.version);
    return old;
  end if;

  who := new.data->>'_actor';
  pid := coalesce(new.data->>'pid','main');

  if tg_op = 'INSERT' then
    -- upsert существующей позиции тоже проходит через INSERT: запись «создана» делаем только для новой
    if exists (select 1 from items where id = new.id) then return new; end if;
    insert into audit_events(project_id,item_id,actor,action,field,old_json,new_json,version)
    values (pid, new.id, who, 'create', null, null,
            jsonb_build_object('name', new.data->'name', 'price', new.data->'price', 'qty', new.data->'qty', 'room', new.data->'room'),
            new.version);
    return new;
  end if;

  -- UPDATE: версия должна совпасть с той, что видел сайт
  if new.version is distinct from old.version then
    raise exception 'version_conflict' using errcode = '40001', detail = old.version::text;
  end if;
  new.version := old.version + 1;

  for k in select jsonb_object_keys(old.data) union select jsonb_object_keys(new.data) loop
    continue when k = any(skip);
    o := old.data->k;
    n := new.data->k;
    continue when o is not distinct from n;
    -- пустое → пустое (например, null → 0) не считаем изменением
    continue when coalesce(o,'null'::jsonb) in ('null','""','0','false','[]')
              and coalesce(n,'null'::jsonb) in ('null','""','0','false','[]');
    if k = 'comments' then
      if jsonb_array_length(coalesce(n,'[]'::jsonb)) > jsonb_array_length(coalesce(o,'[]'::jsonb)) then
        insert into audit_events(project_id,item_id,actor,action,field,old_json,new_json,version)
        select pid, new.id, coalesce(c->>'r', who), 'comment', 'comments', null, c, new.version
        from jsonb_array_elements(n) with ordinality as x(c, i)
        where i > jsonb_array_length(coalesce(o,'[]'::jsonb));
      end if;
      continue;
    end if;
    act := case
      when k = 'st' then 'status'
      when k = 'deleted' and n = 'true'::jsonb then 'delete'
      when k = 'deleted' then 'restore'
      when k in ('price','clientPrice','bureauPrice','delivery') then 'price'
      when k = 'pay' then 'payment'
      when k = 'chosen' then 'variant'
      else 'update'
    end;
    insert into audit_events(project_id,item_id,actor,action,field,old_json,new_json,version)
    values (pid, new.id, who, act, k, audit_value(k,o), audit_value(k,n), new.version);
  end loop;
  return new;
end
$$;

drop trigger if exists items_audit on public.items;
create trigger items_audit before insert or update or delete on public.items
  for each row execute function public.items_audit();

-- Журнал тоже обновляется у всех сразу
do $$ begin
  alter publication supabase_realtime add table public.audit_events;
exception when duplicate_object then null; end $$;
