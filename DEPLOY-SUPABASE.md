# QueueFest — Настройка Supabase + Vercel

## 1. Supabase: Применить схему

Если таблицы ещё не созданы, выполните SQL из `supabase/schema.sql` в SQL Editor вашего Supabase проекта:
https://supabase.com/dashboard/project/_/sql

Также включите Realtime для таблиц:
1. Dashboard → Database → Replication
2. Включите `queue_entries`, `game_tables`, `events` в публикации `supabase_realtime`

## 2. Vercel: Установить переменные окружения

Перейдите в настройки проекта:
https://vercel.com/antilamo/queuefest/settings/environment-variables

Добавьте следующие переменные (Environment: Production + Preview):

| Переменная | Где взять |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role (secret) |
| `VITE_SUPABASE_URL` | То же что SUPABASE_URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon (public) |
| `BOT_TOKEN` | @BotFather в Telegram → /newbot → токен бота |
| `VITE_BOT_USERNAME` | Имя бота без @ (напр. `QueueFestBot`) |

## 3. Telegram бот

1. Откройте @BotFather в Telegram
2. `/newbot` → создайте бота (напр. QueueFestBot)
3. Скопируйте токен → вставьте в `BOT_TOKEN` в Vercel
4. Установите webhook:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://queuefest.vercel.app/api/telegram/webhook
   ```

## 4. Redeploy

После установки переменных — сделайте Redeploy в Vercel:
Deployments → Latest → ... → Redeploy
