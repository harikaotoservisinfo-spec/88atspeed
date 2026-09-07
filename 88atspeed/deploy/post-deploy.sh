#!/bin/bash
# rsync sonrası arka plan işleri — güncel dosya diskten çalıştırılır.
# Manuel: bash /var/www/88atspeed/deploy/post-deploy.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
cd "$APP_DIR"
mkdir -p "$APP_DIR/data"

echo "=== post-deploy ($(date -u +"%Y-%m-%dT%H:%M:%SZ")) ==="

echo "🔥 Kalibrasyon bundle ısıtılıyor (arka plan)..."
nohup node "$APP_DIR/scripts/warm-calibration-bundle.js" --db "$APP_DIR/atlar.db" \
  >> "$APP_DIR/data/calib-warm.log" 2>&1 &

echo "📊 Kamu tahmin sütunları yeniden hesaplanıyor (arka plan)..."
: > "$APP_DIR/data/public-tahmin-rebuild.log"
nohup node --max-old-space-size=3072 "$APP_DIR/scripts/rebuild-public-tahmin-safe.js" --bugun \
  >> "$APP_DIR/data/public-tahmin-rebuild.log" 2>&1 &
echo "  Log: tail -f $APP_DIR/data/public-tahmin-rebuild.log"

echo "⭐ T1×DR=TEST1 bayrakları (arka plan)..."
nohup node --max-old-space-size=2048 "$APP_DIR/scripts/backfill-t1dr-test1-flags.js" --bugun --yarin --force \
  >> "$APP_DIR/data/t1dr-backfill.log" 2>&1 &

echo "✅ post-deploy arka plan işleri başlatıldı"
