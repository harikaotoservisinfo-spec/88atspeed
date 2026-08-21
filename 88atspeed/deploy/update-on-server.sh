#!/bin/bash
# Sunucuda çalıştırın: bash /var/www/88atspeed/deploy/update-on-server.sh [branch]
set -euo pipefail

APP_DIR="/var/www/88atspeed"
BRANCH="${1:-cursor/fix-birinci-son800-c2e4}"
REPO="https://github.com/harikaotoservisinfo-spec/88atspeed.git"
TMP="/tmp/88atspeed-deploy-$$"

echo "=== 88ATSPEED güncelleme (branch: $BRANCH) ==="

rm -rf "$TMP"
git clone --depth 1 -b "$BRANCH" "$REPO" "$TMP"

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
pm2 status 88atspeed
