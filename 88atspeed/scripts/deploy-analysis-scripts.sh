#!/usr/bin/env bash
# Kayıt Test analiz / skor scriptleri (Node, API'ye fetch). Sunucuda bir kez çalıştırın.
set -euo pipefail

ROOT="${1:-/var/www/88atspeed}"
SCRIPTS="$ROOT/scripts"
BR="${BRANCH:-cursor/gosterge-recency-columns-c989}"
BASE="https://raw.githubusercontent.com/harikaotoservisinfo-spec/88atspeed/${BR}/88atspeed/scripts"

mkdir -p "$SCRIPTS"

FILES=(
  score-today-son.js
  backtest-score-today-son.js
  analyze-mor-yanip-boost.js
  analyze-winner-son-competition.js
)

for f in "${FILES[@]}"; do
  curl -fsSL "$BASE/$f" -o "$SCRIPTS/$f"
  chmod +x "$SCRIPTS/$f" 2>/dev/null || true
done

if ! grep -q 'MOR_YANIP_BONUS' "$SCRIPTS/score-today-son.js"; then
  echo "Hata: score-today-son.js mor yanıp sürümü değil (BR=$BR)." >&2
  exit 1
fi

echo "OK: scriptler → $SCRIPTS"
echo ""
echo "Örnek:"
echo "  TARIH=17/09/2026 node $SCRIPTS/score-today-son.js"
echo "  node $SCRIPTS/analyze-mor-yanip-boost.js"
