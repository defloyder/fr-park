#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/fr-park}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE in $APP_DIR"
    exit 1
fi

git fetch origin "$BRANCH"

LOCAL_REV="$(git rev-parse HEAD)"
REMOTE_REV="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
    echo "No updates. Current revision: $LOCAL_REV"
    exit 0
fi

echo "Updating $APP_DIR from $LOCAL_REV to $REMOTE_REV"
git reset --hard "origin/$BRANCH"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T app php artisan migrate --force
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T app php artisan optimize:clear
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T app php artisan config:cache
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T app php artisan route:cache
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T app php artisan view:cache

echo "Updated successfully to $REMOTE_REV"
