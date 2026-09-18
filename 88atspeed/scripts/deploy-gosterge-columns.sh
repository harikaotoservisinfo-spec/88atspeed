#!/usr/bin/env bash
# Public site: Günün Koşuları sütunları + Tahminler SON sole (public-home.js, sole-son-scoring.js).
#
# Sunucuda script yoksa — her seferinde GitHub'dan indirin:
#   curl -fsSL "https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/cursor/gosterge-recency-columns-c989/88atspeed/scripts/deploy-gosterge-columns.sh" -o /tmp/deploy-gosterge-columns.sh
#   bash /tmp/deploy-gosterge-columns.sh /var/www/88atspeed
#
# Alternatif (script indirmeden, tek blok):
#   ROOT=/var/www/88atspeed
#   BR=cursor/gosterge-recency-columns-c989
#   BASE="https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/${BR}/88atspeed/public"
#   curl -fsSL "$BASE/js/sole-son-scoring.js" -o "$ROOT/public/js/sole-son-scoring.js"
#   curl -fsSL "$BASE/js/public-home.js" -o "$ROOT/public/js/public-home.js"
#   curl -fsSL "$BASE/css/public-site.css" -o "$ROOT/public/css/public-site.css"
#   curl -fsSL "$BASE/gunluk-program-index.html" -o "$ROOT/public/index.html"
#   pm2 restart 88atspeed 2>/dev/null || true
set -euo pipefail

DEPLOY_VERSION="20260918-soleSon"
ROOT="${1:-/var/www/88atspeed}"
PUB="$ROOT/public"
BR="${BRANCH:-cursor/gosterge-recency-columns-c989}"
BASE="https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/${BR}/88atspeed/public"

if [[ ! -d "$PUB/js" ]]; then
  echo "Hata: $PUB/js bulunamadı. ROOT doğru mu? (örn. /var/www/88atspeed)" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp -a "$PUB/js/public-home.js" "$PUB/js/public-home.js.bak-$STAMP"
cp -a "$PUB/css/public-site.css" "$PUB/css/public-site.css.bak-$STAMP"
cp -a "$PUB/index.html" "$PUB/index.html.bak-$STAMP"
if [[ -f "$PUB/js/sole-son-scoring.js" ]]; then
  cp -a "$PUB/js/sole-son-scoring.js" "$PUB/js/sole-son-scoring.js.bak-$STAMP"
fi

curl -fsSL "$BASE/js/sole-son-scoring.js" -o "$PUB/js/sole-son-scoring.js"
curl -fsSL "$BASE/js/public-home.js" -o "$PUB/js/public-home.js"
curl -fsSL "$BASE/css/public-site.css" -o "$PUB/css/public-site.css"
curl -fsSL "$BASE/gunluk-program-index.html" -o "$PUB/index.html"

if ! grep -q "yildizGosK" "$PUB/js/public-home.js"; then
  echo "Hata: indirilen public-home.js yeni sütun kodunu içermiyor." >&2
  exit 1
fi
if ! grep -q "buildDayIndex" "$PUB/js/sole-son-scoring.js"; then
  echo "Hata: indirilen sole-son-scoring.js eksik." >&2
  exit 1
fi

echo "deploy-gosterge-columns.sh sürüm: $DEPLOY_VERSION (branch: $BR)"
echo "OK: yildizGosK + Tahminler SON sole yüklendi."
if ! grep -q "soleSon" "$PUB/index.html"; then
  echo "Uyarı: index.html ?v= soleSon değil — gunluk-program-index yeniden indirildi mi kontrol edin." >&2
fi
grep -E "public-home|public-site" "$PUB/index.html" | tail -2
if grep -q "pub-yk-depth-inline" "$PUB/js/public-home.js"; then
  echo "OK: yan yana işaret düzeni (pub-yk-depth-inline)."
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart 88atspeed || true
fi

echo "Tarayıcıda Ctrl+Shift+R yapın."
