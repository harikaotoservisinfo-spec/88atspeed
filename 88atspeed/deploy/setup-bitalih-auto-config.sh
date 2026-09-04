#!/bin/bash
# Bi'Talih otomatik giriş + kupon ayarları (bir kez çalıştırın)
APP_DIR="${1:-/var/www/88atspeed}"
CFG="$APP_DIR/data/bitalih-auto-config.json"
EXAMPLE="$APP_DIR/deploy/bitalih-auto-config.example.json"

mkdir -p "$APP_DIR/data"
if [ -f "$CFG" ]; then
  echo "Zaten var: $CFG"
  exit 0
fi
cp "$EXAMPLE" "$CFG"
chmod 600 "$CFG"
echo "Oluşturuldu: $CFG"
echo "Düzenleyin: nano $CFG"
echo "  username: TC kimlik no"
echo "  password: Bi'Talih şifresi"
echo "Sonra: pm2 restart 88atspeed"
