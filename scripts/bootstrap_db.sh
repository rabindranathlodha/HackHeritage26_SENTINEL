#!/usr/bin/env bash
# Bring the database to a ready state: apply migrations, then set the login
# password for the least-privilege request-path role from the environment.
#
# The password is deliberately NOT in the migration SQL — migrations are
# committed, secrets are not.
#
#   ./scripts/bootstrap_db.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${SENTINEL_APP_PASSWORD:?SENTINEL_APP_PASSWORD must be set (see .env.example)}"
: "${POSTGRES_USER:=sentinel}"
: "${POSTGRES_DB:=sentinel}"

echo "==> applying migrations"
docker compose exec -T \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD:-sentinel}@db:5432/${POSTGRES_DB}" \
  api npx prisma migrate deploy

echo "==> granting login to sentinel_app"
docker compose exec -T -e PW="$SENTINEL_APP_PASSWORD" db \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "ALTER ROLE sentinel_app WITH LOGIN PASSWORD '$SENTINEL_APP_PASSWORD';"

echo "==> done"
