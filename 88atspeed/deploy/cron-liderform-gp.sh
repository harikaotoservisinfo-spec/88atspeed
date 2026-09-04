#!/bin/bash
# Liderform GP (@2) önbellek cron kurulumu
# Kullanım: bash /var/www/88atspeed/deploy/cron-liderform-gp.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
MARKER="# 88atspeed-liderform-gp"
# Her gün 08:00 ve 12:00 — yarış öncesi GP önbelleği
CRON_LINE="0 8,12 * * * cd $APP_DIR && /usr/bin/node scripts/prefetch-liderform-gp.js >> /var/log/88atspeed-gp.log 2>&1 $MARKER"

touch /var/log/88atspeed-gp.log

if crontab -l 2>/dev/null | grep -q "$MARKER"; then
  echo "✅ GP cron zaten kurulu:"
  crontab -l | grep "$MARKER"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "✅ GP cron kuruldu (her gün 08:00 ve 12:00)"
fi

echo ""
echo "Manuel: node scripts/prefetch-liderform-gp.js --iso \$(date +%Y-%m-%d)"
echo "Test:   node scripts/test-liderform-gp.js --iso \$(date +%Y-%m-%d) --hipodrom Bursa --race 1"
echo "Log:    tail -f /var/log/88atspeed-gp.log"
