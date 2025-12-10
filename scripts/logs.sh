#!/bin/bash

# Просмотр логов бота

if [ "$1" == "bot" ]; then
    docker-compose -f docker-compose.prod.yml logs -f bot
elif [ "$1" == "db" ]; then
    docker-compose -f docker-compose.prod.yml logs -f postgres
else
    docker-compose -f docker-compose.prod.yml logs -f
fi
