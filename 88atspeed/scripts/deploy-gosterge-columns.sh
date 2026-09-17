#!/usr/bin/env bash
# Günün Koşuları — SON / 1 ÖNCE… sütunları (public-home.js). Sadece 88atspeed public dosyaları.
set -euo pipefail

ROOT="${1:-/var/www/88atspeed}"
PUB="$ROOT/public"
BR="cursor/gosterge-recency-columns-c989"
BASE="https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/${BR}/88atspeed/public"

if [[ ! -d "$PUB/js" ]]; then
  echo "Hata: $PUB/js bulunamadı. ROOT doğru mu? (örn. /var/www/88atspeed)" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp -a "$PUB/js/public-home.js" "$PUB/js/public-home.js.bak-$STAMP"
cp -a "$PUB/css/public-site.css" "$PUB/css/public-site.css.bak-$STAMP"
cp -a "$PUB/index.html" "$PUB/index.html.bak-$STAMP"

curl -fsSL "$BASE/js/public-home.js" -o "$PUB/js/public-home.js"
curl -fsSL "$BASE/css/public-site.css" -o "$PUB/css/public-site.css"
curl -fsSL "$BASE/gunluk-program-index.html" -o "$PUB/index.html"

if ! grep -q "yildizGosK" "$PUB/js/public-home.js"; then
  echo "Hata: indirilen public-home.js yeni sütun kodunu içermiyor." >&2
  exit 1
fi

echo "OK: yildizGosK sütunları yüklendi."
grep -E "public-home|public-site" "$PUB/index.html" | tail -2

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart 88atspeed || true
fi

echo "Tarayıcıda Ctrl+Shift+R yapın."
