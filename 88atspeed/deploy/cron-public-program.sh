#!/bin/bash
# Sunucuda günlük program cron kurulumu
# Kullanım: bash /var/www/88atspeed/deploy/cron-public-program.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
MARKER="# 88atspeed-public-program"
CRON_LINE="0 20 * * * cd $APP_DIR && /usr/bin/npm run fetch:public-program >> /var/log/88atspeed-program.log 2>&1 $MARKER"
CRON_LINE2="30 20 * * * cd $APP_DIR && /usr/bin/npm run fetch:public-program >> /var/log/88atspeed-program.log 2>&1 $MARKER"

touch /var/log/88atspeed-program.log

if crontab -l 2>/dev/null | grep -q "$MARKER"; then
  echo "✅ Cron zaten kurulu:"
  crontab -l | grep "$MARKER"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE"; echo "$CRON_LINE2") | crontab -
  echo "✅ Cron kuruldu (her gün 20:00 ve 20:30 — yarının programı)"
fi

echo ""
echo "Log: tail -f /var/log/88atspeed-program.log"
echo "Durum: curl -s http://127.0.0.1:3023/api/public/program-sync | python3 -m json.tool"
