# ✅ Чек-лист: Проект готов к Timeweb деплою

## 📦 Что было сделано:

### 1. docker-compose.yml
- ✅ Убраны все `volumes` (Timeweb не поддерживает)
- ✅ Убраны порты (не нужны для Telegram бота)
- ✅ Добавлен healthcheck для postgres
- ✅ Настроена внутренняя сеть `cal-ai-network`
- ✅ Все данные через ENV переменные

### 2. backend/Dockerfile
- ✅ Multi-stage build (builder + production)
- ✅ Использует `npm install --omit=dev` (новый синтаксис)
- ✅ Prisma генерируется в обоих stage
- ✅ Добавлен healthcheck на `/health`

### 3. backend/src/index.ts
- ✅ Добавлен HTTP сервер для health endpoint
- ✅ Слушает порт 4000
- ✅ Endpoint: `GET /health` → `{"status":"ok","timestamp":"..."}`

### 4. backend/package-lock.json
- ✅ Существует и актуален

---

## 🧪 Локальная проверка

### Шаг 1: Создай `.env`

```bash
cat > .env << 'EOF'
POSTGRES_USER=calai
POSTGRES_PASSWORD=test_password_123
POSTGRES_DB=calai_db
OPENAI_API_KEY=sk-твой-ключ
TELEGRAM_BOT_TOKEN=123456789:ABC-твой-токен
OPENAI_MODEL_TEXT=gpt-4o-mini
OPENAI_MODEL_VISION=gpt-4o
NODE_ENV=production
EOF
```

### Шаг 2: Запусти Docker Compose

```bash
# Построй и запусти
docker-compose up --build
```

**Ожидаемый вывод:**
```
✓ База данных подключена
✓ Health server на порту 4000
✓ Бот запущен
```

### Шаг 3: Проверь health endpoint

В **новом** терминале:
```bash
curl http://localhost:4000/health
```

**Ожидаемый ответ:**
```json
{"status":"ok","timestamp":"2025-12-10T05:45:00.000Z"}
```

### Шаг 4: Проверь бота в Telegram

1. Открой своего бота в Telegram
2. Отправь `/start`
3. Скинь фото еды
4. Бот должен распознать и ответить

### Шаг 5: Останови контейнеры

```bash
docker-compose down
```

---

## 🌐 Деплой на Timeweb

### Шаг 1: Push на GitHub

```bash
git push -u origin main --force
```

⚠️ Используй `--force`, если на GitHub есть старые коммиты

### Шаг 2: Зайди на Timeweb

1. https://timeweb.cloud/
2. **Cloud → App Platform**
3. **"Создать приложение"**

### Шаг 3: Настрой приложение

**Основные параметры:**
- **Тип**: Docker Compose
- **Репозиторий**: `https://github.com/JonyVibeAI/CALAI_tg_bot`
- **Ветка**: `main`
- **Файл**: `docker-compose.yml`

**Переменные окружения (обязательно!):**

```
POSTGRES_USER=calai
POSTGRES_PASSWORD=ТВОЙ_СЛОЖНЫЙ_ПАРОЛЬ_123
POSTGRES_DB=calai_db
OPENAI_API_KEY=sk-твой-реальный-ключ
TELEGRAM_BOT_TOKEN=твой-реальный-токен
OPENAI_MODEL_TEXT=gpt-4o-mini
OPENAI_MODEL_VISION=gpt-4o
NODE_ENV=production
```

**Дополнительно:**
- ✅ Автодеплой при пуше в `main`
- 📍 Регион: любой (например, Москва)
- 💰 План: минимум **Standard** (для 2 контейнеров)

### Шаг 4: Деплой и мониторинг

1. Нажми **"Создать"**
2. Жди ~5-10 минут (сборка образа)
3. Проверь логи:
   - Вкладка **"Логи"**
   - Должно быть: `✓ Бот запущен`
4. Проверь health:
   - Вкладка **"Метрики"**
   - Статус: `healthy`

### Шаг 5: Проверь бота

Открой бота в Telegram и протестируй все функции!

---

## 📊 Diff основных файлов

### docker-compose.yml
```diff
- volumes:
-   postgres_data:/var/lib/postgresql/data
+ # volumes удалены для Timeweb

- ports:
-   - "5432:5432"
+ # порты удалены (не нужны)

+ healthcheck:
+   test: ["CMD-SHELL", "pg_isready..."]
+ networks:
+   - cal-ai-network
```

### backend/Dockerfile
```diff
+ FROM node:18-alpine AS builder
+ # Multi-stage build

- RUN npm install --only=production
+ RUN npm install --omit=dev

+ HEALTHCHECK --interval=30s...
+ CMD node -e "require('http').get('http://localhost:4000/health'..."
```

### backend/src/index.ts
```diff
+ import http from 'http';
+
+ const healthServer = http.createServer((req, res) => {
+   if (req.url === '/health') {
+     res.writeHead(200);
+     res.end(JSON.stringify({ status: 'ok', ... }));
+   }
+ });
+
+ healthServer.listen(4000);
```

---

## 🔄 Автообновление

После деплоя любой `git push` в `main` автоматически обновит бота на Timeweb! 🚀

```bash
# Внёс изменения
git add .
git commit -m "улучшил распознавание еды"
git push origin main

# Timeweb автоматически пересоберёт и задеплоит!
```

---

## 📝 Итого

| Файл | Статус |
|------|--------|
| `docker-compose.yml` | ✅ Без volumes, готов для Timeweb |
| `backend/Dockerfile` | ✅ Multi-stage, --omit=dev, healthcheck |
| `backend/src/index.ts` | ✅ Health endpoint на /health |
| `backend/package-lock.json` | ✅ Существует |
| `.env` | ⚠️ Создай локально для тестов |
| Timeweb ENV | ⚠️ Настрой в панели Timeweb |

**Проект полностью готов к деплою на Timeweb Cloud App Platform!** 🎉

Читай подробную инструкцию: [TIMEWEB_DEPLOY.md](TIMEWEB_DEPLOY.md)
