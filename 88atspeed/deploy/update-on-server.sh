#!/bin/bash
# Sunucuda çalıştırın: bash /var/www/88atspeed/deploy/update-on-server.sh [branch] [--skip-npm]
set -euo pipefail

APP_DIR="/var/www/88atspeed"
BRANCH="${1:-cursor/t1dr-test1-go-hyb-b944}"
SKIP_NPM=0
for arg in "$@"; do
  if [ "$arg" = "--skip-npm" ]; then SKIP_NPM=1; fi
done
if [ "${1:-}" = "--skip-npm" ]; then BRANCH="cursor/t1dr-test1-go-hyb-b944"; fi
REPO="https://github.com/harikaotoservisinfo-spec/88atspeed.git"
TMP="/tmp/88atspeed-deploy-$$"

modules_ok() {
  [ -f "$APP_DIR/node_modules/express/package.json" ] \
    && [ -f "$APP_DIR/node_modules/sqlite3/package.json" ] \
    && [ -f "$APP_DIR/node_modules/cheerio/package.json" ]
}

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

LOCK_HASH="$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')"
LOCK_STAMP="$APP_DIR/.deploy-package-lock.sha256"
NEED_NPM=0

if [ "$SKIP_NPM" = "1" ]; then
  echo "📦 --skip-npm: npm install atlandı"
elif ! modules_ok; then
  NEED_NPM=1
  echo "📦 node_modules eksik — npm install gerekli"
else
  OLD_HASH="$(cat "$LOCK_STAMP" 2>/dev/null || true)"
  if [ -z "$OLD_HASH" ]; then
    echo "📦 node_modules mevcut — ilk stamp oluşturuluyor, npm atlandı"
    echo "$LOCK_HASH" > "$LOCK_STAMP"
  elif [ "$LOCK_HASH" != "$OLD_HASH" ]; then
    NEED_NPM=1
    echo "📦 package-lock değişti — npm install gerekli"
  else
    echo "📦 node_modules güncel (package-lock değişmedi) — npm install atlandı"
  fi
fi

if [ "$NEED_NPM" = "1" ]; then
  echo "📦 npm install başlıyor (--ignore-scripts, puppeteer indirilmez)..."
  export PUPPETEER_SKIP_DOWNLOAD=1
  export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
  export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/usr/bin/google-chrome-stable}"
  npm install --production --no-audit --ignore-scripts --loglevel=error
  if ! node -e "require('sqlite3')" 2>/dev/null; then
    echo "📦 sqlite3 native modülü derleniyor..."
    npm rebuild sqlite3 --loglevel=error
  fi
  echo "$LOCK_HASH" > "$LOCK_STAMP"
fi

wait_for_app() {
  for i in $(seq 1 45); do
    if curl -sf "http://127.0.0.1:3023/api/public/ping" >/dev/null 2>&1; then
      echo "✅ Uygulama hazır (${i}x2sn)"
      return 0
    fi
    sleep 2
  done
  echo "⚠️  Uygulama 3023 portunda yanıt vermiyor — pm2 logs 88atspeed"
  return 1
}

echo "🔧 PM2 (fork modu, ecosystem.config.js)..."
if pm2 describe 88atspeed >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "⏳ Uygulama ayağa kalkıyor..."
wait_for_app || true

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

echo "⏰ Yarın programı cron (18:30 TR)..."
bash "$APP_DIR/deploy/cron-public-program.sh" || echo "⚠️  Cron kurulumu atlandı"

echo "🧹 Haftalık disk temizliği cron..."
bash "$APP_DIR/deploy/cron-disk-cleanup.sh" || echo "⚠️  Disk cron atlandı"

HOUR_TR="$(TZ=Europe/Istanbul date +%H)"
MIN_TR="$(TZ=Europe/Istanbul date +%M)"
if [ "$HOUR_TR" -gt 18 ] || { [ "$HOUR_TR" -eq 18 ] && [ "$MIN_TR" -ge 30 ]; }; then
  echo "📡 18:30 geçti — yarın tam veri kontrolü..."
  touch /var/log/88atspeed-program.log
  if node -e "
    const sqlite3=require('sqlite3');
    const pp=require('./lib/public-program');
    const {assessTahminReadiness}=require('./lib/public-tahmin-build');
    const db=new sqlite3.Database('atlar.db');
    assessTahminReadiness(db, pp.tomorrowTr()).then(q=>{console.log(q.ready?'ready':'incomplete');process.exit(q.ready?0:1);}).catch(()=>process.exit(1)).finally(()=>db.close());
  " 2>/dev/null; then
    echo "  ✓ Yarın programı tam veriyle hazır"
  else
    echo "  ↻ Eksik veri — tam çekim başlatılıyor (arka plan, uzun sürebilir)..."
    nohup bash -c "cd '$APP_DIR' && /usr/bin/npm run fetch:public-program-yarin -- --force" \
      >> /var/log/88atspeed-program.log 2>&1 &
    echo "  Log: tail -f /var/log/88atspeed-program.log"
  fi
fi

echo "🔥 Kalibrasyon bundle ısıtılıyor (arka plan, ~40sn)..."
nohup node "$APP_DIR/scripts/warm-calibration-bundle.js" --db "$APP_DIR/atlar.db" \
  >> "$APP_DIR/data/calib-warm.log" 2>&1 &
echo "  Log: $APP_DIR/data/calib-warm.log"

echo "⭐ T1×DR=TEST1 bayrakları (arka plan, siteyi kilitlemez)..."
mkdir -p "$APP_DIR/data"
nohup node --max-old-space-size=2048 "$APP_DIR/scripts/backfill-t1dr-test1-flags.js" --bugun --yarin --force \
  >> "$APP_DIR/data/t1dr-backfill.log" 2>&1 &

echo "🔍 Bi'Talih sağlık:"
wait_for_app || true
curl -s "http://127.0.0.1:3023/api/public/bitalih/auto/health" || echo "(yanıt yok)"

echo "✅ Güncelleme tamamlandı"
echo "📦 Branch: $BRANCH | Commit: $COMMIT_SHA"
echo "🔍 Doğrulama:"
curl -s http://127.0.0.1:3023/VERSION.txt
echo ""
if [ -f "$APP_DIR/lib/public-sonuc-store.js" ]; then
  echo "✓ public-sonuc-store.js mevcut (BİTİŞ senkronu)"
else
  echo "⚠️  public-sonuc-store.js YOK — eski commit olabilir"
fi
if [ -f "$APP_DIR/lib/public-program-scheduler.js" ]; then
  echo "✓ public-program-scheduler.js mevcut (18:30 yarın programı)"
else
  echo "⚠️  public-program-scheduler.js YOK"
fi
if grep -q 'col-bitis-hdr' "$APP_DIR/public/panel.html" 2>/dev/null; then
  echo "✓ panel.html SON TEST BİTİŞ sütunu mevcut"
else
  echo "⚠️  panel.html BİTİŞ sütunu YOK — deploy commit kontrol edin"
fi
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
echo "  cd $APP_DIR && node scripts/sync-sonuclar-to-kayit.js --db $APP_DIR/atlar.db --kayit 169"
