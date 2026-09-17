#!/usr/bin/env bash
# Kayıt Test analiz / skor scriptleri (Node, API'ye fetch). Sunucuda bir kez çalıştırın.
#
# Her zaman bu dosyayı yeniden indirin (eski /tmp kopyası backtest içermez):
#   curl -fsSL "https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/cursor/gosterge-recency-columns-c989/88atspeed/scripts/deploy-analysis-scripts.sh" -o /tmp/deploy-analysis-scripts.sh
#   bash /tmp/deploy-analysis-scripts.sh /var/www/88atspeed
set -euo pipefail

DEPLOY_VERSION="20260917-backtest"
ROOT="${1:-/var/www/88atspeed}"
SCRIPTS="$ROOT/scripts"
BR="${BRANCH:-cursor/gosterge-recency-columns-c989}"
BASE="https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/${BR}/88atspeed/scripts"

echo "deploy-analysis-scripts.sh sürüm: $DEPLOY_VERSION (branch: $BR)"

mkdir -p "$SCRIPTS"

FILES=(
  score-today-son.js
  backtest-score-today-son.js
  backtest-son-r2.js
  analyze-mor-yanip-boost.js
  analyze-winner-son-competition.js
  analyze-race-markers.js
)

for f in "${FILES[@]}"; do
  echo "  indir: $f"
  curl -fsSL "$BASE/$f" -o "$SCRIPTS/$f"
  chmod +x "$SCRIPTS/$f" 2>/dev/null || true
  if [[ ! -s "$SCRIPTS/$f" ]]; then
    echo "Hata: $SCRIPTS/$f boş veya yok." >&2
    exit 1
  fi
done

if ! grep -q 'MOR_YANIP_BONUS' "$SCRIPTS/score-today-son.js"; then
  echo "Hata: score-today-son.js mor yanıp sürümü değil (BR=$BR)." >&2
  exit 1
fi

if ! grep -q 'walk-forward' "$SCRIPTS/backtest-score-today-son.js"; then
  echo "Hata: backtest-score-today-son.js eksik veya eski." >&2
  exit 1
fi

if ! grep -q 'TAHMİN' "$SCRIPTS/backtest-son-r2.js"; then
  echo "Hata: backtest-son-r2.js TAHMİN sürümü değil." >&2
  exit 1
fi

echo ""
echo "OK: scriptler → $SCRIPTS"
ls -la "$SCRIPTS"/*.js 2>/dev/null | awk '{print "  ", $9, $5"b"}'
echo ""
echo "Örnek:"
echo "  TARIH=17/09/2026 node $SCRIPTS/score-today-son.js"
echo "  node $SCRIPTS/backtest-score-today-son.js"
echo "  node $SCRIPTS/backtest-son-r2.js"
echo "  MOR_YANIP_BONUS=0 node $SCRIPTS/backtest-score-today-son.js"
echo "  node $SCRIPTS/analyze-mor-yanip-boost.js"
