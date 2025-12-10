# 📦 Публикация проекта на GitHub

Чеклист для публикации проекта.

## ✅ Перед публикацией

### 1. Проверь, что все работает локально

```bash
# Запусти бота
npm run dev

# Проверь в Telegram:
# - /start
# - Отправь фото еды
# - Отправь текст
# - Проверь все меню
```

### 2. Проверь .gitignore

```bash
# Убедись, что .env не попадет в git
cat .gitignore | grep .env

# Проверь, что нет секретов в коде
git status
```

### 3. Обнови README.md

Замени в README.md:
- `your-username` на свой GitHub username
- Добавь реальные скриншоты (опционально)
- Проверь все ссылки

## 🚀 Публикация на GitHub

### Шаг 1: Создай репозиторий на GitHub

1. Перейди на https://github.com/new
2. Название: `CALAI_tg_bot` (или свое)
3. Описание: `🔥 AI Telegram-трекер калорий`
4. Public или Private
5. **НЕ** создавай README, .gitignore, LICENSE (они уже есть)
6. Нажми "Create repository"

### Шаг 2: Загрузи код

```bash
# Перейди в директорию проекта
cd "/Users/evgxo/BOT/CAL AI TG"

# Инициализируй git (если еще не)
git init

# Добавь все файлы
git add .

# Создай коммит
git commit -m "Initial commit: AI calorie tracker bot"

# Добавь remote
git remote add origin https://github.com/JonyVibeAI/CALAI_tg_bot.git

# Загрузи на GitHub
git branch -M main
git push -u origin main
```

### Шаг 3: Настрой репозиторий на GitHub

1. **About** (в правом верхнем углу):
   - Описание: `🔥 AI Telegram бот для отслеживания калорий`
   - Website: ссылка на бота (если есть)
   - Topics: `telegram-bot`, `ai`, `openai`, `calories`, `nutrition`, `typescript`, `nodejs`

2. **Settings → General**:
   - ✅ Issues
   - ✅ Discussions (опционально)
   - ✅ Projects (опционально)

3. **Settings → Secrets** (для GitHub Actions):
   - Не нужно для публичного репозитория
   - Для деплоя через Actions добавь секреты

## 📝 После публикации

### 1. Создай первый Release

```bash
# Создай тег
git tag -a v1.0.0 -m "First release"
git push origin v1.0.0
```

На GitHub:
1. Перейди в Releases
2. Draft a new release
3. Choose tag: v1.0.0
4. Release title: `v1.0.0 - Initial Release`
5. Описание:
   ```
   🎉 Первая версия AI Telegram-трекера калорий!
   
   Возможности:
   - 📸 Распознавание еды по фото с помощью AI
   - 📝 Текстовый ввод продуктов
   - 🤖 Автоопределение типа приема пищи
   - 📊 Детальная статистика
   - 🎯 Персональные цели
   ```
6. Publish release

### 2. Проверь CI/CD

- Перейди в Actions на GitHub
- Убедись, что CI проходит

### 3. Обнови документацию

В README.md замени:
```
git clone https://github.com/JonyVibeAI/CALAI_tg_bot.git
```
на реальный URL:
```
git clone https://github.com/JonyVibeAI/CALAI_tg_bot.git
```

Закоммить и запушить:
```bash
git add README.md
git commit -m "docs: update repository URL"
git push
```

## 🌟 Продвижение

### 1. Добавь бейджи в README

```markdown
[![GitHub stars](https://img.shields.io/github/stars/YOUR_USERNAME/CALAI_tg_bot.svg)](https://github.com/YOUR_USERNAME/CALAI_tg_bot/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/YOUR_USERNAME/CALAI_tg_bot.svg)](https://github.com/YOUR_USERNAME/CALAI_tg_bot/network)
[![GitHub issues](https://img.shields.io/github/issues/YOUR_USERNAME/CALAI_tg_bot.svg)](https://github.com/YOUR_USERNAME/CALAI_tg_bot/issues)
```

### 2. Поделись проектом

- Reddit: r/nodejs, r/telegram, r/SideProject
- Twitter/X
- Dev.to
- Habr.com (на русском)

### 3. Добавь на awesome-lists

- awesome-telegram-bots
- awesome-nodejs

## 🔐 Безопасность

### ⚠️ ВАЖНО: Никогда не коммить

- `.env` файлы
- API ключи
- Пароли
- Секреты

### Если случайно закоммитил секрет:

```bash
# 1. Удали секрет из кода
# 2. Удали из истории
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# 3. Force push (ОСТОРОЖНО!)
git push origin --force --all

# 4. СМЕНИ все ключи, которые были в коммите!
```

## 📊 Мониторинг

После публикации следи за:
- GitHub Stars ⭐
- Issues 🐛
- Pull Requests 🔀
- Discussions 💬

## 🎉 Готово!

Твой проект опубликован на GitHub! 🚀

**Следующие шаги:**
1. Деплой на TimeWeb (см. DEPLOY_TIMEWEB.md)
2. Собирай обратную связь
3. Улучшай проект
4. Отвечай на Issues

---

**Полезные ссылки:**
- [GitHub Docs](https://docs.github.com/)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
