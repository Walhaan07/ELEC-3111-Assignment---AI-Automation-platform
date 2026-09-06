#!/usr/bin/env bash
# Restore a backup into a scratch database, so the restore path is tested
# before the day we need it. A backup you have never restored is not a backup.
#
#   ./infra/restore.sh backups/automation-2026-03-14-0300.sql.gz
set -euo pipefail

FILE=${1:-}
TARGET=${2:-automation_restore_test}
if [[ -z "$FILE" ]]; then
  echo "usage: $0 <backup.sql.gz> [target-database]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f infra/docker-compose.prod.yml"

echo "restoring $FILE into $TARGET"
$COMPOSE exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS $TARGET;"
$COMPOSE exec -T postgres psql -U postgres -c "CREATE DATABASE $TARGET;"
gunzip -c "$FILE" | $COMPOSE exec -T postgres psql -U postgres -d "$TARGET" >/dev/null

echo -n "workflows restored: "
$COMPOSE exec -T postgres psql -U postgres -d "$TARGET" -tAc 'SELECT count(*) FROM workflows;'
echo "restore ok - drop it with: DROP DATABASE $TARGET;"
