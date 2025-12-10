#!/bin/bash

# Создание бэкапа базы данных

set -e

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$DATE.sql"

# Создаем директорию для бэкапов
mkdir -p $BACKUP_DIR

echo "💾 Создание бэкапа БД..."

# Читаем переменные из .env
source .env

# Создаем бэкап
docker-compose -f docker-compose.prod.yml exec -T postgres pg_dump -U ${POSTGRES_USER:-calai} ${POSTGRES_DB:-calai_db} > $BACKUP_FILE

# Сжимаем
gzip $BACKUP_FILE

echo "✅ Бэкап создан: ${BACKUP_FILE}.gz"

# Удаляем старые бэкапы (старше 7 дней)
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "🗑️  Старые бэкапы удалены (старше 7 дней)"
