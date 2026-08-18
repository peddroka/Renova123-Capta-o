#!/usr/bin/env bash
set -euo pipefail

EVOLUTION_DIR="/opt/evolution-api"
SETUP_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-evolution-wsl.sh"

bash "$SETUP_SCRIPT" >/dev/null

if [[ -f /run/evolution-api.pid ]] && kill -0 "$(cat /run/evolution-api.pid)" 2>/dev/null; then
  echo "Evolution API ja esta em execucao."
  exit 0
fi

cd "$EVOLUTION_DIR"
export PRISMA_CLIENT_ENGINE_TYPE=binary
setsid -f env PRISMA_CLIENT_ENGINE_TYPE=binary node dist/main </dev/null >> /var/log/evolution-api.log 2>&1
sleep 1
pgrep -o -f "node dist/main" > /run/evolution-api.pid

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8080 >/dev/null 2>&1; then
    echo "Evolution API pronta na porta 8080."
    exit 0
  fi
  sleep 1
done

tail -n 80 /var/log/evolution-api.log >&2
exit 1
