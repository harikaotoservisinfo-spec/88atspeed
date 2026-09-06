#!/bin/bash
# Sadece kod güncelle + PM2 restart (npm install YOK — JS/CSS değişiklikleri için)
# Kullanım: bash /var/www/88atspeed/deploy/quick-update-on-server.sh [branch]
exec bash "$(dirname "$0")/update-on-server.sh" "${1:-cursor/t1dr-test1-go-hyb-b944}" --skip-npm
