#!/bin/bash
# Sunucuya güncelleme göndermek için (yerel makineden çalıştırın)
set -euo pipefail

SERVER="root@168.231.109.27"
APP_DIR="/var/www/88atspeed"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "📦 Paketleniyor..."
tar -czf /tmp/88atspeed-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  -C "$SRC_DIR" .

echo "📤 Sunucuya yükleniyor..."
scp /tmp/88atspeed-deploy.tar.gz "$SERVER:/tmp/"

echo "🔄 Sunucuda güncelleniyor..."
ssh "$SERVER" bash -s << 'REMOTE'
set -e
cd /var/www/88atspeed
tar -xzf /tmp/88atspeed-deploy.tar.gz
rm -f /tmp/88atspeed-deploy.tar.gz
npm install --production
npm rebuild sqlite3
pm2 restart 88atspeed
echo "✅ Güncelleme tamamlandı!"
pm2 status 88atspeed
REMOTE

rm -f /tmp/88atspeed-deploy.tar.gz
echo "🎉 Deploy bitti: https://88atspeed.lerta.tr"
