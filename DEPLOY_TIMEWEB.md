# 🚀 Деплой на TimeWeb

Полная инструкция по развертыванию бота на TimeWeb сервере.

## 📋 Требования

- TimeWeb VPS/облачный сервер
- Ubuntu 20.04+ / Debian 11+
- Доступ по SSH
- Домен (опционально)

## 🔧 Подготовка сервера

### 1. Подключение к серверу

```bash
ssh root@your-server-ip
```

### 2. Обновление системы

```bash
apt update && apt upgrade -y
```

### 3. Установка Node.js 18+

```bash
# Добавляем NodeSource репозиторий
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -

# Устанавливаем Node.js
apt install -y nodejs

# Проверяем версию
node --version
npm --version
```

### 4. Установка Docker

```bash
# Устанавливаем Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Запускаем Docker
systemctl start docker
systemctl enable docker

# Устанавливаем Docker Compose
apt install -y docker-compose

# Проверяем
docker --version
docker-compose --version
```

### 5. Установка PM2 (для управления процессом)

```bash
npm install -g pm2
```

## 📦 Деплой проекта

### Способ 1: Docker (Рекомендуется)

```bash
# 1. Создаем директорию для проекта
mkdir -p /var/www/cal-ai-bot
cd /var/www/cal-ai-bot

# 2. Клонируем репозиторий
git clone https://github.com/JonyVibeAI/cal-ai-bot.git .

# 3. Создаем .env файл
cp .env.example .env
nano .env
```

**Заполни .env:**
```env
DATABASE_URL=postgresql://calai:password@postgres:5432/calai
OPENAI_API_KEY=sk-your-real-key
TELEGRAM_BOT_TOKEN=your-real-token
```

```bash
# 4. Запускаем через Docker
docker-compose up -d

# 5. Проверяем статус
docker-compose ps

# 6. Смотрим логи
docker-compose logs -f bot
```

### Способ 2: Без Docker (напрямую)

```bash
# 1. Устанавливаем PostgreSQL
apt install -y postgresql postgresql-contrib

# 2. Настраиваем PostgreSQL
sudo -u postgres psql

# В psql:
CREATE DATABASE calai;
CREATE USER calai WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE calai TO calai;
\q

# 3. Клонируем проект
cd /var/www
git clone https://github.com/JonyVibeAI/cal-ai-bot.git
cd cal-ai-bot

# 4. Настраиваем .env
cp .env.example .env
nano .env
```

**Заполни .env для локальной PostgreSQL:**
```env
DATABASE_URL=postgresql://calai:strong_password@localhost:5432/calai
OPENAI_API_KEY=sk-your-real-key
TELEGRAM_BOT_TOKEN=your-real-token
```

```bash
# 5. Устанавливаем зависимости и собираем
cd backend
npm install
npm run build

# 6. Запускаем миграции
npx prisma migrate deploy

# 7. Запускаем с PM2
pm2 start dist/index.js --name cal-ai-bot

# 8. Настраиваем автозапуск
pm2 startup
pm2 save
```

## 🔄 Управление ботом

### Docker команды

```bash
# Перезапустить
docker-compose restart

# Остановить
docker-compose down

# Остановить и удалить данные
docker-compose down -v

# Обновить код
git pull
docker-compose up -d --build

# Посмотреть логи
docker-compose logs -f
docker-compose logs -f bot      # только бот
docker-compose logs -f postgres # только БД
```

### PM2 команды

```bash
# Статус
pm2 status

# Логи
pm2 logs cal-ai-bot

# Перезапуск
pm2 restart cal-ai-bot

# Остановка
pm2 stop cal-ai-bot

# Удаление из PM2
pm2 delete cal-ai-bot

# Мониторинг
pm2 monit
```

## 🔐 Безопасность

### 1. Настройка файрвола

```bash
# Устанавливаем UFW
apt install -y ufw

# Разрешаем SSH
ufw allow 22/tcp

# Включаем файрвол
ufw enable

# Проверяем статус
ufw status
```

### 2. Настройка прав доступа

```bash
# Создаем пользователя для бота
adduser botuser

# Переносим проект
chown -R botuser:botuser /var/www/cal-ai-bot

# Запускаем от пользователя botuser
su - botuser
```

### 3. Защита .env файла

```bash
chmod 600 .env
chown botuser:botuser .env
```

## 📊 Мониторинг

### Логи

```bash
# Docker
docker-compose logs -f --tail=100

# PM2
pm2 logs cal-ai-bot --lines 100

# Системные логи
journalctl -u docker -f
```

### Проверка работы бота

```bash
# Docker
docker-compose ps

# PM2
pm2 status

# Проверка процесса
ps aux | grep node
```

## 🆘 Решение проблем

### Бот не запускается

```bash
# Проверь переменные окружения
cat .env

# Проверь логи
docker-compose logs bot
# или
pm2 logs cal-ai-bot

# Проверь подключение к БД
docker-compose exec postgres psql -U calai -d calai
```

### База данных не подключается

```bash
# Проверь, запущен ли PostgreSQL
docker-compose ps postgres
# или
systemctl status postgresql

# Проверь DATABASE_URL в .env
grep DATABASE_URL .env

# Пересоздай БД
docker-compose down -v
docker-compose up -d
```

### Нехватает памяти

```bash
# Проверь использование
free -h
df -h

# Добавь swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 🔄 Обновление бота

### Docker

```bash
cd /var/www/cal-ai-bot
git pull
docker-compose down
docker-compose up -d --build
docker-compose logs -f bot
```

### PM2

```bash
cd /var/www/cal-ai-bot
git pull
cd backend
npm install
npm run build
pm2 restart cal-ai-bot
pm2 logs cal-ai-bot
```

## 📈 Мониторинг производительности

### Установка monitoring tools

```bash
# htop
apt install -y htop

# Системный мониторинг
htop

# Docker stats
docker stats

# PM2 monitoring
pm2 monit
```

## 🔗 Дополнительные настройки

### Настройка домена (опционально)

Если у тебя есть домен для вебхуков:

```bash
# Установка Nginx
apt install -y nginx

# Установка Certbot для SSL
apt install -y certbot python3-certbot-nginx

# Получение SSL сертификата
certbot --nginx -d yourdomain.com
```

### Автообновление через GitHub Actions (опционально)

Создай `.github/workflows/deploy.yml`:

```yaml
name: Deploy to TimeWeb

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_IP }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /var/www/cal-ai-bot
            git pull
            docker-compose up -d --build
```

## ✅ Чеклист деплоя

- [ ] Сервер обновлен (apt update && upgrade)
- [ ] Установлены Node.js, Docker, PM2
- [ ] Клонирован репозиторий
- [ ] Создан и заполнен .env файл
- [ ] Запущен PostgreSQL
- [ ] Выполнены миграции БД
- [ ] Бот запущен (Docker/PM2)
- [ ] Проверены логи - нет ошибок
- [ ] Бот отвечает в Telegram
- [ ] Настроен автозапуск
- [ ] Настроен файрвол
- [ ] Настроены права доступа

## 📞 Поддержка TimeWeb

- Панель управления: https://timeweb.cloud/
- Документация: https://timeweb.com/ru/help/
- Поддержка: support@timeweb.ru

---

Готово! Бот развернут и работает 🚀
