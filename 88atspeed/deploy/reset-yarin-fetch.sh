#!/bin/bash
# Yarın programı: süreçleri durdur, DB kayıtlarını sil, isteğe bağlı tek çekim başlat
#   bash /var/www/88atspeed/deploy/reset-yarin-fetch.sh
#   bash /var/www/88atspeed/deploy/reset-yarin-fetch.sh --restart
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/88atspeed}"
LOCK_FILE="/tmp/88atspeed-yarin.lock"
RESTART=0
for arg in "$@"; do
  [ "$arg" = "--restart" ] && RESTART=1
done

cd "$APP_DIR"

echo "=== 88ATSPEED yarın programı sıfırlama ==="

echo "1) Çalışan çekim süreçleri durduruluyor…"
pkill -f 'fetch-public-program' 2>/dev/null || true
pkill -f 'npm run fetch:public-program-yarin' 2>/dev/null || true
pkill -f 'puppeteer' 2>/dev/null || true
pkill -f 'chrome.*headless' 2>/dev/null || true
sleep 2
pkill -9 -f 'fetch-public-program' 2>/dev/null || true

echo "2) Yarın kayıtları siliniyor…"
node "$APP_DIR/scripts/reset-yarin-program.js" --apply

echo "3) PM2 yenileniyor…"
pm2 restart 88atspeed 2>/dev/null || true

if [ "$RESTART" = "1" ]; then
  echo "4) Tek çekim başlatılıyor (flock ile çift süreç engelli)…"
  touch /var/log/88atspeed-program.log
  if flock -n "$LOCK_FILE" bash -c "cd '$APP_DIR' && nohup npm run fetch:public-program-yarin -- --force >> /var/log/88atspeed-program.log 2>&1 &"; then
    echo "   ✓ Arka planda başladı"
  else
    echo "   ⚠ Başka bir çekim zaten çalışıyor olabilir"
  fi
  echo "   Log: tail -f /var/log/88atspeed-program.log"
else
  echo "4) Çekim başlatılmadı. Başlatmak için:"
  echo "   bash $APP_DIR/deploy/reset-yarin-fetch.sh --restart"
fi

echo "✅ Sıfırlama tamam"
