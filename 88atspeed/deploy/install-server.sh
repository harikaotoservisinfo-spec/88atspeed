#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/88atspeed"
DOMAIN="88atspeed.lerta.tr"
PORT=3023

echo "=== 88ATSPEED Sunucu Kurulumu ==="

# Puppeteer için gerekli sistem paketleri
apt-get update -qq
apt-get install -y -qq \
  ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0t64 \
  libatk1.0-0t64 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0t64 \
  libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
  libxss1 libxtst6 xdg-utils wget gnupg curl

# Google Chrome (Puppeteer için)
if ! command -v google-chrome &>/dev/null; then
  wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/google-chrome.deb || apt-get install -f -y -qq
  rm -f /tmp/google-chrome.deb
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi

# Uygulama dizini
mkdir -p "$APP_DIR"
chown -R root:root "$APP_DIR"

# Node bağımlılıkları
cd "$APP_DIR"
npm install --production
npm rebuild sqlite3

# PM2 servis
pm2 delete 88atspeed 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# Nginx (önce HTTP-only cert almak için geçici config)
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  cat > /etc/nginx/sites-available/88atspeed-temp.conf << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/88atspeed-temp.conf /etc/nginx/sites-enabled/88atspeed.conf
  nginx -t && systemctl reload nginx

  certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m admin@lerta.tr || \
  certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos -m admin@lerta.tr

  rm -f /etc/nginx/sites-enabled/88atspeed.conf
fi

# Kalıcı nginx config
cp "$APP_DIR/deploy/nginx-88atspeed.conf" /etc/nginx/sites-available/88atspeed.conf
ln -sf /etc/nginx/sites-available/88atspeed.conf /etc/nginx/sites-enabled/88atspeed.conf
rm -f /etc/nginx/sites-enabled/88atspeed-temp.conf 2>/dev/null || true
nginx -t && systemctl reload nginx

echo ""
echo "✅ 88ATSPEED kurulumu tamamlandı!"
echo "📍 https://${DOMAIN}"
echo "🔧 PM2: pm2 status 88atspeed"
echo "📋 Log: pm2 logs 88atspeed"
