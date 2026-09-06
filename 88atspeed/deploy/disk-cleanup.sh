#!/bin/bash
# 88ATSPEED sunucu disk temizliği — loglar, önbellek, geçici dosyalar
# Kullanım:
#   bash /var/www/88atspeed/deploy/disk-cleanup.sh          # ne silineceğini göster
#   bash /var/www/88atspeed/deploy/disk-cleanup.sh --apply  # temizle
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/88atspeed}"
APPLY=0
VACUUM=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --vacuum) VACUUM=1 ;;
  esac
done

human_size() {
  local f="$1"
  if [ -f "$f" ]; then
    du -h "$f" 2>/dev/null | awk '{print $1}'
  elif [ -d "$f" ]; then
    du -sh "$f" 2>/dev/null | awk '{print $1}'
  else
    echo "0"
  fi
}

trim_log() {
  local f="$1"
  local max_mb="${2:-15}"
  [ -f "$f" ] || return 0
  local bytes
  bytes=$(stat -c%s "$f" 2>/dev/null || echo 0)
  local limit=$((max_mb * 1024 * 1024))
  if [ "$bytes" -gt "$limit" ]; then
    echo "  📄 $f ($(human_size "$f") → son 3000 satır)"
    if [ "$APPLY" = "1" ]; then
      tail -n 3000 "$f" > "${f}.trim.$$" && mv "${f}.trim.$$" "$f"
    fi
  fi
}

echo "=== 88ATSPEED disk temizliği ==="
echo "Disk:"
df -h / | tail -1
echo ""

echo "📋 Kontrol edilen alanlar:"

LOGS=(
  "/var/log/88atspeed-program.log"
  "/var/log/88atspeed-gp.log"
  "$APP_DIR/data/calib-warm.log"
)
for f in "${LOGS[@]}"; do
  if [ -f "$f" ]; then
    echo "  log: $f ($(human_size "$f"))"
  fi
done

if [ -d "$HOME/.pm2/logs" ]; then
  echo "  pm2 logs: $HOME/.pm2/logs ($(human_size "$HOME/.pm2/logs"))"
fi

TMP_COUNT=$(find /tmp -maxdepth 1 -name '88atspeed-deploy-*' 2>/dev/null | wc -l)
echo "  /tmp/88atspeed-deploy-* : $TMP_COUNT klasör"

PUPPET_TMP=$(find /tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' 2>/dev/null | wc -l)
echo "  puppeteer profil /tmp : $PUPPET_TMP adet"

for d in /root/.cache/puppeteer "$HOME/.cache/puppeteer"; do
  [ -d "$d" ] && echo "  $d ($(human_size "$d"))"
done

if [ -f "$APP_DIR/atlar.db" ]; then
  echo "  atlar.db ($(human_size "$APP_DIR/atlar.db"))"
  [ -f "$APP_DIR/atlar.db-wal" ] && echo "  atlar.db-wal ($(human_size "$APP_DIR/atlar.db-wal"))"
fi

echo ""
if [ "$APPLY" != "1" ]; then
  echo "⚠️  Kuru çalışma — silmek için: bash $APP_DIR/deploy/disk-cleanup.sh --apply"
  echo "    Veritabanı sıkıştırma: --apply --vacuum"
  exit 0
fi

echo "🧹 Temizlik uygulanıyor…"

for f in "${LOGS[@]}"; do
  trim_log "$f" 10
done

if command -v pm2 >/dev/null 2>&1; then
  pm2 flush 2>/dev/null || true
  echo "  ✓ pm2 flush"
fi

rm -rf /tmp/88atspeed-deploy-* 2>/dev/null || true
find /tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -mtime +0 -exec rm -rf {} + 2>/dev/null || true
echo "  ✓ geçici deploy / puppeteer profilleri"

# Eski chrome crash raporları (güvenli)
find /root/.config/google-chrome -name 'Crash Reports' -type d 2>/dev/null | while read -r d; do
  find "$d" -type f -mtime +7 -delete 2>/dev/null || true
done

if [ -f "$APP_DIR/scripts/prune-server-storage.js" ]; then
  VACUUM_ARGS=""
  [ "$VACUUM" = "1" ] && VACUUM_ARGS="--vacuum"
  node "$APP_DIR/scripts/prune-server-storage.js" --db "$APP_DIR/atlar.db" --apply $VACUUM_ARGS || true
fi

npm cache clean --force --prefix "$APP_DIR" 2>/dev/null || true

echo ""
echo "Disk (sonra):"
df -h / | tail -1
echo "✅ Temizlik tamamlandı"
