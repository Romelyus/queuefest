-- ============================================================
-- QueueFest — Supabase Schema
-- Управление очередями на фестивале настольных игр
-- ============================================================

-- Расширение для UUID
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. ТАБЛИЦА: events (события / фестивали)
-- ============================================================
create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  description text not null default '',
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. ТАБЛИЦА: users (пользователи)
-- ============================================================
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  bracelet_id text not null,
  name        text not null,
  role        text not null default 'user' check (role in ('user','manager','admin')),
  event_id    uuid not null references events(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Один браслет — один юзер на событие
  unique(bracelet_id, event_id)
);

-- ============================================================
-- 3. ТАБЛИЦА: game_tables (столы)
-- ============================================================
create table if not exists game_tables (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(id) on delete cascade,
  table_name            text not null,
  game_name             text not null,
  status                text not null default 'free' check (status in ('free','playing','paused')),
  current_session_start timestamptz,
  qr_code               text not null default '',
  max_parallel_games    integer not null default 1
);

-- ============================================================
-- 4. ТАБЛИЦА: queue_entries (записи в очереди)
-- ============================================================
create table if not exists queue_entries (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references game_tables(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  event_id         uuid not null references events(id) on delete cascade,
  position         integer not null default 0,
  status           text not null default 'waiting'
                   check (status in ('waiting','notified','confirmed','playing','completed','cancelled','expired','skipped')),
  joined_at        timestamptz not null default now(),
  notified_at      timestamptz,
  confirmed_at     timestamptz,
  completed_at     timestamptz,
  confirm_deadline timestamptz,
  walk_deadline    timestamptz
);

-- Индекс для быстрой выборки активной очереди стола
create index if not exists idx_queue_table_status on queue_entries(table_id, status);
-- Индекс для очередей пользователя
create index if not exists idx_queue_user on queue_entries(user_id, status);

-- ============================================================
-- 5. ТАБЛИЦА: users_subscriptions (подписки на уведомления в мессенджере)
-- Теперь привязана к user_id, а не к queue_entry_id
-- ============================================================
create table if not exists users_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  messenger       text not null default 'telegram' check (messenger in ('telegram','max')),
  chat_id         text not null,
  created_at      timestamptz not null default now(),
  -- Один чат — одна подписка на юзера
  unique(user_id, messenger)
);

-- ============================================================
-- 6. RLS (Row Level Security)
-- ============================================================

-- Включаем RLS для всех таблиц
alter table events enable row level security;
alter table users enable row level security;
alter table game_tables enable row level security;
alter table queue_entries enable row level security;
alter table users_subscriptions enable row level security;

-- Политики для events: чтение для всех (anon), запись через сервис
create policy "events_read" on events for select using (true);
create policy "events_insert" on events for insert with check (true);
create policy "events_update" on events for update using (true);
create policy "events_delete" on events for delete using (true);

-- Политики для users: чтение для всех, запись через сервис
create policy "users_read" on users for select using (true);
create policy "users_insert" on users for insert with check (true);
create policy "users_update" on users for update using (true);

-- Политики для game_tables: чтение для всех, запись через сервис
create policy "tables_read" on game_tables for select using (true);
create policy "tables_insert" on game_tables for insert with check (true);
create policy "tables_update" on game_tables for update using (true);
create policy "tables_delete" on game_tables for delete using (true);

-- Политики для queue_entries: чтение для всех, запись через сервис
create policy "queue_read" on queue_entries for select using (true);
create policy "queue_insert" on queue_entries for insert with check (true);
create policy "queue_update" on queue_entries for update using (true);
create policy "queue_delete" on queue_entries for delete using (true);

-- Политики для users_subscriptions: чтение/запись через сервис
create policy "subs_read" on users_subscriptions for select using (true);
create policy "subs_insert" on users_subscriptions for insert with check (true);
create policy "subs_update" on users_subscriptions for update using (true);
create policy "subs_delete" on users_subscriptions for delete using (true);

-- ============================================================
-- 7. Realtime: включаем публикацию для нужных таблиц
-- ============================================================
-- Supabase Realtime слушает изменения через WAL.
-- Нужно добавить таблицы в publication supabase_realtime.

alter publication supabase_realtime add table queue_entries;
alter publication supabase_realtime add table game_tables;
alter publication supabase_realtime add table events;

-- ============================================================
-- МИГРАЦИЯ: если таблицы уже существуют, добавить новые колонки
-- ============================================================
-- Выполните эти ALTER отдельно, если schema.sql уже был запущен ранее:
--
-- ALTER TABLE game_tables ADD COLUMN IF NOT EXISTS max_parallel_games integer NOT NULL DEFAULT 1;
-- ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS walk_deadline timestamptz;
--
-- Для миграции users_subscriptions с queue_entry_id на user_id:
-- ALTER TABLE users_subscriptions DROP CONSTRAINT IF EXISTS users_subscriptions_queue_entry_id_fkey;
-- ALTER TABLE users_subscriptions DROP COLUMN IF EXISTS queue_entry_id;
-- ALTER TABLE users_subscriptions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE users_subscriptions DROP CONSTRAINT IF EXISTS users_subscriptions_queue_entry_id_messenger_key;
-- ALTER TABLE users_subscriptions ADD CONSTRAINT users_subscriptions_user_id_messenger_key UNIQUE (user_id, messenger);

-- ============================================================
-- Готово! Запустите этот скрипт в SQL Editor Supabase Dashboard.
-- ============================================================
