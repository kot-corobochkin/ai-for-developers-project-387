# Calendar Service

Calendar Service состоит из React-клиента, TypeSpec/OpenAPI-контракта и
in-memory backend на Fastify.

## Требования

- Node.js 20+ и npm (в CI используется Node.js 22)

## Запуск backend

```bash
cd backend
npm install
npm run dev
```

API будет доступен на `http://localhost:8000/api`. Данные хранятся в памяти и
сбрасываются после перезапуска. При старте создаются владелец календаря и два
типа встреч: на 30 и 60 минут.

Рабочие часы владельца: понедельник–пятница, 09:00–18:00, часовой пояс
`Europe/Moscow`.

## Запуск frontend

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:8000/api npm run dev
```

Публичная запись открывается на `/`, административный раздел — на `/#/admin`.

Для запуска только mock API используется `npm run dev:mock` в `frontend`.

## Проверки

```bash
cd backend && npm test
cd frontend && npm run build
cd typespec && npm run compile
```

## Интеграционные тесты и релизы

E2E-сценарии запускаются в настоящем Chromium и проверяют связку frontend +
backend:

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

Коммиты оформляются по Conventional Commits, например:

```text
feat: add calendar availability rules
fix: reject overlapping bookings
test: cover public booking flow
```

Workflow `CI` запускает backend-тесты, frontend/TypeSpec проверки и Playwright.
Workflow `Release Please` после изменений в `main` создаёт или обновляет release
PR с changelog и версией по Conventional Commits.

## Docker и деплой

Собрать и запустить production-контейнер локально:

```bash
docker build -t calendar-service .
docker run --rm -p 8000:8000 -e PORT=8000 calendar-service
```

Проверка:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/public/owner
```

Контейнер слушает порт из переменной `PORT` и подходит для Render Web Service.
Готовый Render Blueprint находится в [render.yaml](render.yaml).

Опубликованный backend:

- [https://calendar-service-api.onrender.com](https://calendar-service-api.onrender.com)
- Healthcheck: [https://calendar-service-api.onrender.com/health](https://calendar-service-api.onrender.com/health)

Для frontend используется `.env` со значением
`VITE_API_BASE_URL=<PUBLIC_URL>/api`.

Для автодеплоя в GitHub добавьте secret `RENDER_DEPLOY_HOOK_URL` из настроек
Render Web Service. Workflow `Deploy to Render` будет запускать деплой после
push в `main` или вручную через `workflow_dispatch`. Без этого secret workflow
не выполняет шаг деплоя.

### Hexlet tests and linter status:
[![Actions Status](https://github.com/kot-corobochkin/ai-for-developers-project-387/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/kot-corobochkin/ai-for-developers-project-387/actions)
