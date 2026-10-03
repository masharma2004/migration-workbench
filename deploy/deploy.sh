#!/usr/bin/env bash
# Usage: SSH_KEY=~/.ssh/workbench.pem deploy/deploy.sh ubuntu@<elastic-ip>
set -euo pipefail
HOST="${1:?usage: deploy.sh ubuntu@<host>}"
KEY="${SSH_KEY:-$HOME/.ssh/workbench.pem}"
scp -i "$KEY" deploy/docker-compose.prod.yml deploy/Caddyfile "$HOST:/opt/workbench/"
ssh -i "$KEY" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/workbench
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T app wget -qO- http://127.0.0.1:3000/api/health; then echo; exit 0; fi
  sleep 2
done
echo "health check failed"; docker compose -f docker-compose.prod.yml logs --tail 100 app; exit 1
REMOTE
