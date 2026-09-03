#!/bin/bash
# Sunucuda çalıştırın: bash /var/www/88atspeed/deploy/update-on-server.sh [branch]
set -euo pipefail

APP_DIR="/var/www/88atspeed"
BRANCH="${1:-cursor/t1dr-test1-go-hyb-b944}"
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

echo "🔧 PM2 (fork modu, ecosystem.config.js)..."
pm2 delete 88atspeed 2>/dev/null || true
pm2 delete 88atspeed-bitalih 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo "🌐 Nginx..."
if [ -f "/etc/letsencrypt/live/88atspeed.lerta.tr/fullchain.pem" ]; then
  cp "$APP_DIR/deploy/nginx-88atspeed.conf" /etc/nginx/sites-available/88atspeed.conf
else
  cp "$APP_DIR/deploy/nginx-88atspeed-http.conf" /etc/nginx/sites-available/88atspeed.conf
fi
cp "$APP_DIR/deploy/nginx-ip-default.conf" /etc/nginx/sites-available/88atspeed-ip.conf
ln -sf /etc/nginx/sites-available/88atspeed.conf /etc/nginx/sites-enabled/88atspeed.conf
ln -sf /etc/nginx/sites-available/88atspeed-ip.conf /etc/nginx/sites-enabled/88atspeed-ip.conf
nginx -t && systemctl reload nginx || echo "⚠️  Nginx reload atlandı — bash deploy/fix-server.sh çalıştırın"

echo "🔍 Bi'Talih sağlık:"
curl -s http://127.0.0.1:3023/api/public/bitalih/auto/health || true
echo ""

echo "✅ Güncelleme tamamlandı"
echo "📦 Branch: $BRANCH | Commit: $COMMIT_SHA"
echo "🔍 Doğrulama:"
curl -s http://127.0.0.1:3023/VERSION.txt
echo ""
curl -s "http://127.0.0.1:3023/istatistikler.html" | grep -oE '20260826m|·BS|successPct' | head -5 || true
echo ""
pm2 status 88atspeed
echo ""
echo "📋 Terminal testleri (önce cd $APP_DIR):"
echo "  cd $APP_DIR && node scripts/test-race-similarity.js --db $APP_DIR/atlar.db"
echo "  cd $APP_DIR && node scripts/test-race-similarity.js --db $APP_DIR/atlar.db --phase noise,features,rowflags,winner-field,deep10 --min-sample 3"
echo "  cd $APP_DIR && node scripts/test-race-similarity.js --db $APP_DIR/atlar.db --field-size 10 --phase deep10,winner-field --min-sample 2"
echo "  cd $APP_DIR && node scripts/test-race-segment-report.js --db $APP_DIR/atlar.db --field-size 10"
echo "  cd $APP_DIR && node scripts/test-tip-a-db-diagnose.js --db $APP_DIR/atlar.db --field-size 10 --verbose"
echo "  cd $APP_DIR && node scripts/repair-missing-kosular.js --db $APP_DIR/atlar.db --scan"
echo "  cd $APP_DIR && node scripts/repair-missing-kosular.js --db $APP_DIR/atlar.db --at-id 114236,104060,115482 --apply"
echo "  cd $APP_DIR && node scripts/purge-kosmaz-horses.js --db $APP_DIR/atlar.db --scan"
echo "  cd $APP_DIR && node scripts/test-dimension-finish-correlation.js --db $APP_DIR/atlar.db"
echo "  cd $APP_DIR && npm run test:dimension-finish"
echo "  cd $APP_DIR && npm run test:tahmin-buckets"
echo "  cd $APP_DIR && npm run test:kayit-basari"
echo "  cd $APP_DIR && npm run test:siklet-recency"
echo "  cd $APP_DIR && npm run test:siklet-maxpct"
echo "  cd $APP_DIR && npm run test:sehir-race"
echo "  cd $APP_DIR && node scripts/audit-horse-kosu-counts.js --kayit 148 --race 1"
echo "  cd $APP_DIR && node scripts/test-sehir-tab-race.js --kayit 148 --race 1 -v --horse \"KUZEYİN KRALI\""
echo "  cd $APP_DIR && npm run test:race-factors-demo"
echo "  cd $APP_DIR && node scripts/test-race-all-factors.js --kayit 148 --race 1 --dim siklet"
echo "  cd $APP_DIR && node scripts/test-siklet-maxpct-correlation.js --db $APP_DIR/atlar.db --kayit 148 --race 1 -v"
echo "  cd $APP_DIR && node scripts/test-kayit-basari-report.js --db $APP_DIR/atlar.db --kayit 148"
echo "  cd $APP_DIR && node scripts/test-tahmin-position-buckets.js --db $APP_DIR/atlar.db --kayit 148 --sweep"
echo "  cd $APP_DIR && npm run test:son-test-calib"
echo "  cd $APP_DIR && npm run test:son-test-calib-kayit"
echo "  cd $APP_DIR && node scripts/test-son-test-calibration-diagnose.js --db $APP_DIR/atlar.db --base-url http://127.0.0.1:3023"
