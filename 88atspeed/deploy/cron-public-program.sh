#!/bin/bash
# Sunucuda günlük yarın programı cron kurulumu (18:30 TR)
# Kullanım: bash /var/www/88atspeed/deploy/cron-public-program.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
MARKER="# 88atspeed-public-program"
LOG_FILE="/var/log/88atspeed-program.log"
LOCK_FILE="/var/run/88atspeed-yarin-fetch.lock"

rotate_log_if_large() {
  local f="$1" max_mb="${2:-30}"
  [ -f "$f" ] || return 0
  local sz
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt $((max_mb * 1024 * 1024)) ]; then
    tail -n 5000 "$f" > "${f}.rot" && mv "${f}.rot" "$f"
  fi
}
rotate_log_if_large "$LOG_FILE" 25
CRON_CMD="flock -n $LOCK_FILE bash -c 'cd $APP_DIR && /usr/bin/npm run fetch:public-program-yarin' >> $LOG_FILE 2>&1 $MARKER"
CRON_LINE="30 18 * * * $CRON_CMD"

touch "$LOG_FILE"

EXISTING="$(crontab -l 2>/dev/null || true)"
NEW_CRON="$(echo "$EXISTING" | grep -v "$MARKER" | grep -v '88atspeed-public-program' | grep -v 'CRON_TZ=Europe/Istanbul' || true)"
{
  echo "$NEW_CRON"
  echo "CRON_TZ=Europe/Istanbul"
  echo "$CRON_LINE"
} | sed '/^$/d' | crontab -

echo "✅ Cron kuruldu (her gün 18:30 TR — yarının programı + tahmin)"
crontab -l | grep -E '88atspeed-public-program|CRON_TZ' || true

echo ""
echo "Manuel: npm run fetch:public-program-yarin"
echo "Zorla:  npm run fetch:public-program-yarin -- --force"
echo "Log: tail -f $LOG_FILE"
