#!/bin/sh
set -e

echo "🔄 Применение схемы БД..."

# Retry логика для Supabase pooler
MAX_RETRIES=5
RETRY_COUNT=0

until npx prisma db push --skip-generate 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Не удалось применить схему после $MAX_RETRIES попыток"
    exit 1
  fi
  echo "⏳ Попытка $RETRY_COUNT/$MAX_RETRIES не удалась, ждём 5 сек..."
  sleep 5
done

echo "✅ Схема БД применена"

# Запускаем команду из CMD
exec "$@"
