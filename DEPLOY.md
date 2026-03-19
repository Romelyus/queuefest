# QueueFest — Инструкция по развертыванию

## Быстрый старт (для тестирования)

```bash
git clone <repo-url> queuefest
cd queuefest
npm install
npm run dev
```

Приложение будет доступно на `http://localhost:5000`.

---

## Production-развертывание

### Вариант 1: Docker (рекомендуется)

Создайте файл `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
```

Создайте `docker-compose.yml`:

```yaml
version: "3.8"
services:
  queuefest:
    build: .
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

Запуск:

```bash
docker compose up -d
```

### Вариант 2: Системный сервис (systemd)

```bash
# Сборка
npm ci && npm run build

# Копировать файлы
sudo mkdir -p /opt/queuefest
sudo cp -r dist node_modules package.json /opt/queuefest/

# Создать systemd-сервис
sudo tee /etc/systemd/system/queuefest.service << EOF
[Unit]
Description=QueueFest Queue Management
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/queuefest
ExecStart=/usr/bin/node dist/index.cjs
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable queuefest
sudo systemctl start queuefest
```

### Вариант 3: PM2

```bash
npm ci && npm run build
pm2 start dist/index.cjs --name queuefest
pm2 save
pm2 startup
```

---

## Обратный прокси (Nginx)

Создайте конфигурацию `/etc/nginx/sites-available/queuefest`:

```nginx
server {
    listen 80;
    server_name queuefest.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Для HTTPS через Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d queuefest.example.com
```

> **Важно:** WebSocket требует `proxy_set_header Upgrade` и `proxy_set_header Connection "upgrade"`. Без этого уведомления в реальном времени не будут работать.

---

## Рекомендованные хостинги (РФ)

| Хостинг | Тип | Подходит для | Цена от |
|---------|-----|-------------|---------|
| **Selectel** | VPS | Продакшен, стабильность | ~500₽/мес |
| **Timeweb Cloud** | VPS | Простота настройки | ~300₽/мес |
| **REG.RU VPS** | VPS | Широкая поддержка | ~400₽/мес |
| **Firstvds** | VPS | Бюджетный вариант | ~200₽/мес |
| **Yandex Cloud** | Cloud | Масштабируемость | Pay-as-you-go |

### Минимальные требования к серверу

- **OS:** Ubuntu 22.04+ / Debian 12+
- **RAM:** 512 MB
- **CPU:** 1 vCPU
- **Диск:** 1 GB
- **Node.js:** 20+

---

## Настройка данных

### Хранилище

Текущая реализация использует **in-memory storage** — данные хранятся в оперативной памяти и сбрасываются при перезапуске. Это идеально подходит для однодневных фестивалей.

Для постоянного хранения данных (многодневные фесты):
1. Раскомментировать/модифицировать `server/storage.ts` — заменить `MemStorage` на `PgStorage`
2. Настроить переменную окружения `DATABASE_URL`
3. Использовать PostgreSQL

### Учетные записи по умолчанию

| Роль | Пароль | Доступ |
|------|--------|--------|
| Администратор | `admin2026` | Полный доступ: события, столы, аналитика, очереди |
| Менеджер | `manager2026` | Управление очередями: старт/завершение партий, добавление/удаление |

> **Не забудьте сменить пароли** перед использованием на реальном фестивале! Измените в `server/routes.ts`, строки 119 и 125.

---

## Сценарий использования на фестивале

### Подготовка (за день до фестиваля)

1. Развернуть приложение на сервере
2. Войти как админ → создать событие (напр. «ИгроКон 2026»)
3. Добавить все столы с играми (название стола, игра, мин/макс игроков, примерное время партии)
4. Перейти во вкладку «Столы» → скачать QR-коды → распечатать
5. Разместить QR-коды на каждом столе

### Во время фестиваля

**Посетители:**
1. Подходят к столу → сканируют QR-код телефоном
2. Вводят номер с браслета → записываются в очередь
3. Получают уведомление, когда подходит очередь
4. Подтверждают в течение 3 минут → идут играть

**Менеджеры:**
1. Входят с паролем менеджера
2. Видят все столы и очереди в реальном времени
3. Нажимают «Начать партию» когда игроки садятся за стол
4. Нажимают «Завершить» когда партия окончена → следующий в очереди автоматически уведомляется
5. Могут добавлять/удалять людей из очереди, менять порядок

**Администратор:**
1. Доступ к полной аналитике: посетители, записи, отказы, среднее ожидание
2. Может создавать/удалять события и столы
3. Видит статистику по каждому столу отдельно

---

## Техническая архитектура

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Телефон   │────▶│    Nginx     │────▶│   Node.js      │
│  (браузер)  │◀────│  (reverse    │◀────│   Express      │
│             │     │   proxy)     │     │   + WebSocket  │
└─────────────┘     └──────────────┘     └────────────────┘
      │                                        │
      │  QR scan → /#/join/:tableId            │
      │  WebSocket → /ws                       │  In-memory
      │  API → /api/*                          │  storage
      └──────────────────────────────────────  │
                                               ▼
                                     ┌────────────────┐
                                     │   Data Store   │
                                     │ (memory / PG)  │
                                     └────────────────┘
```

### Стек

- **Frontend:** React, Tailwind CSS, shadcn/ui, wouter, TanStack Query
- **Backend:** Express, WebSocket (ws)
- **Хранилище:** In-memory (заменяемо на PostgreSQL)
- **Сборка:** Vite + esbuild
- **PWA:** Service Worker, Web App Manifest

### API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/auth/login | Вход по браслету |
| POST | /api/auth/admin-login | Вход персонала |
| GET | /api/events | Список событий |
| POST | /api/events | Создать событие |
| GET | /api/events/:id/tables | Столы события |
| POST | /api/tables | Создать стол |
| POST | /api/queue/join | Записаться в очередь |
| POST | /api/queue/:id/confirm | Подтвердить очередь |
| POST | /api/queue/:id/cancel | Отменить запись |
| POST | /api/queue/:id/skip | Пропустить (менеджер) |
| POST | /api/queue/force-add | Добавить в очередь (менеджер) |
| POST | /api/tables/:id/start-session | Начать партию |
| POST | /api/tables/:id/end-session | Завершить партию |
| POST | /api/tables/:id/reorder | Изменить порядок |
| GET | /api/events/:id/analytics | Аналитика |
| GET | /api/events/:id/stats | Статистика |
| GET | /api/tables/:id/qr | QR-код стола (SVG) |
| GET | /api/events/:id/qr-codes | Все QR-коды |

### WebSocket сообщения

| Тип | Направление | Описание |
|-----|-------------|----------|
| auth | Client → Server | Авторизация соединения |
| your_turn | Server → Client | Уведомление о наступлении очереди |
| queue_updated | Server → Client | Обновление очереди |
| confirm_timeout | Server → Client | Истечение времени подтверждения |
| removed_from_queue | Server → Client | Удаление из очереди |
| session_started | Server → Client | Начало партии |
| session_ended | Server → Client | Завершение партии |

---

## Миграция на PostgreSQL

Для постоянного хранения данных создайте `PgStorage` класс в `server/storage.ts`, реализующий интерфейс `IStorage`. Схема Drizzle уже готова в `shared/schema.ts`.

```bash
# Установить PostgreSQL driver
npm install @neondatabase/serverless

# Задать переменную окружения
export DATABASE_URL="postgresql://user:pass@localhost:5432/queuefest"

# Запустить миграции
npx drizzle-kit push
```
