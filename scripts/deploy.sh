#!/bin/bash

# Скрипт для деплоя на production сервер

set -e

echo "🚀 Начинаем деплой..."

# Проверка .env
if [ ! -f .env ]; then
    echo "❌ Файл .env не найден!"
    echo "📝 Создай .env из .env.example"
    exit 1
fi

# Остановка старых контейнеров
echo "🛑 Остановка старых контейнеров..."
docker-compose -f docker-compose.prod.yml down

# Обновление кода (если используется git)
if [ -d .git ]; then
    echo "📥 Обновление кода..."
    git pull origin main
fi

# Сборка образов
echo "🔨 Сборка Docker образов..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Запуск
echo "▶️  Запуск сервисов..."
docker-compose -f docker-compose.prod.yml up -d

# Ожидание запуска
echo "⏳ Ожидание запуска БД..."
sleep 5

# Миграции
echo "🔄 Применение миграций БД..."
docker-compose -f docker-compose.prod.yml exec -T bot npx prisma migrate deploy

# Проверка статуса
echo ""
echo "✅ Деплой завершен!"
echo ""
echo "📊 Статус сервисов:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "📝 Для просмотра логов:"
echo "   docker-compose -f docker-compose.prod.yml logs -f"
echo ""
echo "🔍 Проверь, что бот работает в Telegram!"
