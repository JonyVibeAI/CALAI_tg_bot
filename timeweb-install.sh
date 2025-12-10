#!/bin/bash

# Автоматическая установка на TimeWeb сервер
# Использование: bash timeweb-install.sh

set -e

echo "🚀 Установка Cal AI Bot на TimeWeb сервер"
echo "=========================================="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Запусти скрипт от root: sudo bash timeweb-install.sh"
   exit 1
fi

# Обновление системы
echo "📦 Обновление системы..."
apt update && apt upgrade -y

# Установка Node.js
echo "📦 Установка Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Установка Docker
echo "🐳 Установка Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

# Установка Docker Compose
echo "🐳 Установка Docker Compose..."
apt install -y docker-compose

# Запуск Docker
systemctl start docker
systemctl enable docker

# Установка PM2
echo "📦 Установка PM2..."
npm install -g pm2

# Создание директории
PROJECT_DIR="/var/www/CALAI_tg_bot"
echo "📁 Создание директории проекта: $PROJECT_DIR"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# Клонирование проекта (замени URL на свой)
echo "📥 Клонирование проекта..."
read -p "Введи URL GitHub репозитория: " REPO_URL
git clone $REPO_URL .

# Настройка .env
echo ""
echo "⚙️  Настройка переменных окружения"
echo "====================================="

cp .env.example .env

read -p "Введи OPENAI_API_KEY: " OPENAI_KEY
read -p "Введи TELEGRAM_BOT_TOKEN: " TG_TOKEN

# Генерация случайного пароля для БД
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

# Заполнение .env
cat > .env << EOF
DATABASE_URL=postgresql://calai:${DB_PASSWORD}@postgres:5432/calai_db
OPENAI_API_KEY=${OPENAI_KEY}
TELEGRAM_BOT_TOKEN=${TG_TOKEN}
OPENAI_MODEL_TEXT=gpt-4o-mini
OPENAI_MODEL_VISION=gpt-4o
POSTGRES_USER=calai
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=calai_db
EOF

echo "✅ .env файл создан"

# Установка зависимостей
echo ""
echo "📦 Установка зависимостей..."
cd backend
npm install
cd ..

# Запуск через Docker
echo ""
echo "🐳 Запуск через Docker..."
docker-compose -f docker-compose.prod.yml up -d --build

# Ожидание запуска
echo "⏳ Ожидание запуска сервисов..."
sleep 10

# Применение миграций
echo "🔄 Применение миграций БД..."
docker-compose -f docker-compose.prod.yml exec -T bot npx prisma migrate deploy

# Настройка файрвола
echo ""
echo "🔒 Настройка файрвола..."
apt install -y ufw
ufw allow 22/tcp
ufw --force enable

# Настройка автозапуска
echo ""
echo "🔄 Настройка автозапуска..."
cat > /etc/systemd/system/CALAI_tg_bot.service << EOF
[Unit]
Description=Cal AI Telegram Bot
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable CALAI_tg_bot.service

# Создание директории для бэкапов
mkdir -p backups

# Настройка cron для автобэкапа
echo ""
echo "💾 Настройка автоматических бэкапов..."
(crontab -l 2>/dev/null; echo "0 2 * * * cd $PROJECT_DIR && bash scripts/backup.sh") | crontab -

echo ""
echo "✅ Установка завершена!"
echo "========================"
echo ""
echo "📊 Статус сервисов:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "📝 Полезные команды:"
echo "   Логи:        docker-compose -f docker-compose.prod.yml logs -f"
echo "   Перезапуск:  docker-compose -f docker-compose.prod.yml restart"
echo "   Остановка:   docker-compose -f docker-compose.prod.yml down"
echo "   Бэкап:       bash scripts/backup.sh"
echo ""
echo "🎉 Бот готов к работе! Проверь его в Telegram."
echo ""
