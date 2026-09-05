#!/bin/bash
# Sunucuda çalıştırın: bash /var/www/88atspeed/deploy/fix-server.sh
set -euo pipefail

APP_DIR="/var/www/88atspeed"
DOMAIN="88atspeed.lerta.tr"
cd "$APP_DIR"

echo "=== 88ATSPEED sunucu onarımı ==="

# 1) Chrome
if ! command -v google-chrome-stable &>/dev/null && ! command -v google-chrome &>/dev/null; then
  echo "📦 Google Chrome kuruluyor..."
  apt-get update -qq
  apt-get install -y -qq wget ca-certificates fonts-liberation \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libdbus-1-3 \
    libdrm2 libgbm1 libgtk-3-0t64 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 libxss1 libxtst6 xdg-utils || true
  wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/google-chrome.deb || apt-get install -f -y -qq
  rm -f /tmp/google-chrome.deb
fi

CHROME=""
for p in /usr/bin/google-chrome-stable /usr/bin/google-chrome /usr/bin/chromium-browser; do
  if [ -x "$p" ]; then CHROME="$p"; break; fi
done
echo "Chrome: ${CHROME:-BULUNAMADI}"

# 1b) Swap (OOM önleme — Puppeteer için)
if ! swapon --show 2>/dev/null | grep -q .; then
  echo "💾 Swap alanı oluşturuluyor (2GB)..."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show 2>/dev/null || true

# 2) PM2 — cluster modundan çık, ecosystem ile başlat
echo "🔧 PM2 yeniden yapılandırılıyor (fork modu)..."
if pm2 describe 88atspeed >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start "$APP_DIR/ecosystem.config.js"
fi
pm2 save
pm2 reset 88atspeed 2>/dev/null || true
pm2 reset 88atspeed-bitalih 2>/dev/null || true
sleep 2
pm2 status

# 3) Nginx — SSL yoksa HTTP kullan (SSL config nginx'i kırar)
echo "🌐 Nginx yapılandırması..."
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  cp "$APP_DIR/deploy/nginx-88atspeed.conf" /etc/nginx/sites-available/88atspeed.conf
  echo "   SSL config kullanılıyor"
else
  echo "   SSL sertifikası yok — HTTP config kullanılıyor"
  cp "$APP_DIR/deploy/nginx-88atspeed-http.conf" /etc/nginx/sites-available/88atspeed.conf
fi
cp "$APP_DIR/deploy/nginx-ip-default.conf" /etc/nginx/sites-available/88atspeed-ip.conf
ln -sf /etc/nginx/sites-available/88atspeed.conf /etc/nginx/sites-enabled/88atspeed.conf
ln -sf /etc/nginx/sites-available/88atspeed-ip.conf /etc/nginx/sites-enabled/88atspeed-ip.conf
nginx -t
systemctl reload nginx
echo "   Nginx OK"

# 4) Sağlık kontrolü
wait_for_app() {
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:3023/api/public/ping" >/dev/null 2>&1; then
      echo "✅ Uygulama hazır (${i}x2sn)"
      return 0
    fi
    sleep 2
  done
  echo "⚠️  Uygulama 3023 portunda yanıt vermiyor — pm2 logs 88atspeed --lines 80"
  return 1
}

echo ""
echo "🔍 Sağlık:"
wait_for_app || true
curl -s "http://127.0.0.1:3023/api/public/bitalih/auto/health" || echo "(yanıt yok)"
echo ""
pm2 status 88atspeed-bitalih 2>/dev/null || true
echo ""
echo "✅ Onarım tamam. PM2 restart sayısı (↺) birkaç dakika içinde artmamalı."
echo "   Hâlâ artıyorsa: pm2 logs 88atspeed --lines 80"
