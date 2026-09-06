#!/bin/bash
# Haftalık disk temizliği cron (Pazar 04:00 TR)
# Kullanım: bash /var/www/88atspeed/deploy/cron-disk-cleanup.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
MARKER="# 88atspeed-disk-cleanup"
CRON_LINE="0 4 * * 0 cd $APP_DIR && bash deploy/disk-cleanup.sh --apply >> /var/log/88atspeed-cleanup.log 2>&1 $MARKER"

touch /var/log/88atspeed-cleanup.log
trim_log() {
  local f="/var/log/88atspeed-cleanup.log"
  [ -f "$f" ] || return 0
  local sz
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt 5242880 ]; then
    tail -n 2000 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
  fi
}
trim_log

EXISTING="$(crontab -l 2>/dev/null || true)"
if echo "$EXISTING" | grep -q "$MARKER"; then
  echo "✅ Disk cleanup cron zaten kurulu"
  crontab -l | grep "$MARKER"
else
  {
    echo "$EXISTING"
    echo "CRON_TZ=Europe/Istanbul"
    echo "$CRON_LINE"
  } | sed '/^$/d' | crontab -
  echo "✅ Haftalık disk temizliği kuruldu (Pazar 04:00 TR)"
fi

echo ""
echo "Manuel: bash $APP_DIR/deploy/disk-cleanup.sh --apply --vacuum"
