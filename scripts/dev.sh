#!/bin/bash

set -e

echo "🚀 Запуск бота..."

# Проверка .env
if [ ! -f .env ]; then
    echo "❌ Файл .env не найден!"
    echo "📝 Создай .env из ENV_TEMPLATE.txt"
    exit 1
fi

# Проверка Docker
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker не запущен!"
    echo "🐳 Запусти Docker и попробуй снова"
    exit 1
fi

# Запуск PostgreSQL
echo "🐘 Запуск PostgreSQL..."
docker-compose up -d

echo "⏳ Ожидание БД..."
sleep 3

# Миграции
if [ ! -d "backend/prisma/migrations" ] || [ -z "$(ls -A backend/prisma/migrations)" ]; then
    echo "🔄 Миграции БД..."
    cd backend && npx prisma migrate dev --name init && cd ..
fi

# Зависимости
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Установка зависимостей..."
    cd backend && npm install && cd ..
fi

echo ""
echo "✅ Готово!"
echo ""
echo "🤖 Бот запущен"
echo "Press Ctrl+C для остановки"
echo ""

# Запуск
npm run dev





