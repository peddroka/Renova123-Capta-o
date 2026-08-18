#!/usr/bin/env bash
set -euo pipefail

EVOLUTION_DIR="/opt/evolution-api"

if [[ ! -f "$EVOLUTION_DIR/.env" ]]; then
  echo "Arquivo de configuração da Evolution não encontrado." >&2
  exit 1
fi

set -a
source "$EVOLUTION_DIR/.env"
set +a

service postgresql start >/dev/null

if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USERNAME}'" | grep -q 1; then
  runuser -u postgres -- createuser --login "$POSTGRES_USERNAME"
fi

runuser -u postgres -- psql --set=role_password="$POSTGRES_PASSWORD" --set=role_name="$POSTGRES_USERNAME" <<'SQL' >/dev/null
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role_name', :'role_password') \gexec
SQL

if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DATABASE}'" | grep -q 1; then
  runuser -u postgres -- createdb --owner="$POSTGRES_USERNAME" "$POSTGRES_DATABASE"
fi

if [[ -f /run/redis/redis-server.pid ]]; then
  kill "$(cat /run/redis/redis-server.pid)" 2>/dev/null || true
  sleep 1
fi

install -d -o redis -g redis /run/redis
runuser -u redis -- redis-server /etc/redis/redis.conf --daemonize yes --requirepass "$REDIS_PASSWORD"

runuser -u postgres -- pg_isready -q
PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USERNAME" -d "$POSTGRES_DATABASE" -tAc "SELECT 1" | grep -q 1
redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping | grep -q PONG

echo "PostgreSQL e Redis prontos."
