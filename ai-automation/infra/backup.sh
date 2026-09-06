#!/usr/bin/env bash
# Daily database backup. Add to crontab at 03:00:
#   (crontab -l 2>/dev/null; echo "0 3 * * * $PWD/infra/backup.sh >> $PWD/backups/cron.log 2>&1") | crontab -
set -euo pipefail                      # stop on the first error, not after it

cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%F-%H%M)

docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres automation | gzip > "backups/automation-$STAMP.sql.gz"

find backups -name '*.sql.gz' -mtime +14 -delete    # keep a fortnight

SIZE=$(du -h "backups/automation-$STAMP.sql.gz" | cut -f1)
echo "backup ok: backups/automation-$STAMP.sql.gz ($SIZE)"
