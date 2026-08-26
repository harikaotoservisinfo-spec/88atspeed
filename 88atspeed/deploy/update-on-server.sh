#!/bin/bash
# Sunucuda çalıştırın: bash /var/www/88atspeed/deploy/update-on-server.sh [branch]
set -euo pipefail

APP_DIR="/var/www/88atspeed"
BRANCH="${1:-cursor/testsira-linear-scale-b004}"
REPO="https://github.com/harikaotoservisinfo-spec/88atspeed.git"
TMP="/tmp/88atspeed-deploy-$$"

echo "=== 88ATSPEED güncelleme (branch: $BRANCH) ==="

rm -rf "$TMP"
git clone --depth 1 -b "$BRANCH" "$REPO" "$TMP"

COMMIT_SHA="$(git -C "$TMP" rev-parse --short HEAD)"
COMMIT_MSG="$(git -C "$TMP" log -1 --pretty=%s)"
echo "Kaynak commit: $COMMIT_SHA — $COMMIT_MSG"

mkdir -p "$TMP/88atspeed/public"
cat > "$TMP/88atspeed/public/VERSION.txt" <<EOF
branch=$BRANCH
commit=$COMMIT_SHA
message=$COMMIT_MSG
deployed=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

rsync -av --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude atlar.db \
  "$TMP/88atspeed/" "$APP_DIR/"

rm -rf "$TMP"

cd "$APP_DIR"
npm install --production
npm rebuild sqlite3
pm2 restart 88atspeed

echo "✅ Güncelleme tamamlandı"
echo "📦 Branch: $BRANCH | Commit: $COMMIT_SHA"
echo "🔍 Doğrulama:"
curl -s http://127.0.0.1:3023/VERSION.txt
echo ""
curl -s "http://127.0.0.1:3023/istatistikler.html" | grep -oE '20260826c|testsiraMinRulePct|oranKotuDerece' | head -5 || true
echo ""
pm2 status 88atspeed
