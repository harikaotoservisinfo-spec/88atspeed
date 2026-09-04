#!/bin/bash
# Tam veri çekimini arka planda başlat / izle (prod sunucu)
# Kullanım:
#   bash deploy/run-fetch-hesaplama.sh start
#   bash deploy/run-fetch-hesaplama.sh status
#   bash deploy/run-fetch-hesaplama.sh attach
#   bash deploy/run-fetch-hesaplama.sh log
#   bash deploy/run-fetch-hesaplama.sh stop
#
# Ek argümanlar start'a iletilir, örn:
#   bash deploy/run-fetch-hesaplama.sh start --hipodrom Bursa
#   bash deploy/run-fetch-hesaplama.sh start --tahmin

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="fetch-hesaplama"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/fetch-hesaplama-$(date +%Y%m%d).log"
CMD="${1:-status}"
shift || true

mkdir -p "$LOG_DIR"

run_fetch() {
    cd "$ROOT"
    echo "===== $(date -Iseconds) fetch başladı =====" | tee -a "$LOG_FILE"
    exec npm run fetch:hesaplama-full -- "$@" 2>&1 | tee -a "$LOG_FILE"
}

case "$CMD" in
    start)
        if tmux has-session -t "$SESSION" 2>/dev/null; then
            echo "Zaten çalışıyor: tmux attach -t $SESSION"
            echo "Log: $LOG_FILE"
            exit 0
        fi
        tmux new-session -d -s "$SESSION" -c "$ROOT" "bash '$ROOT/deploy/run-fetch-hesaplama.sh' _worker $*"
        echo "Başlatıldı."
        echo "  İzle:  bash deploy/run-fetch-hesaplama.sh attach"
        echo "  Log:   bash deploy/run-fetch-hesaplama.sh log"
        echo "  Durum: bash deploy/run-fetch-hesaplama.sh status"
        echo "  Dosya: $LOG_FILE"
        ;;
    _worker)
        run_fetch "$@"
        ;;
    attach)
        if ! tmux has-session -t "$SESSION" 2>/dev/null; then
            echo "Aktif oturum yok. Önce: bash deploy/run-fetch-hesaplama.sh start"
            exit 1
        fi
        exec tmux attach -t "$SESSION"
        ;;
    log)
        touch "$LOG_FILE"
        exec tail -f "$LOG_FILE"
        ;;
    status)
        if tmux has-session -t "$SESSION" 2>/dev/null; then
            echo "ÇALIŞIYOR (tmux: $SESSION)"
        else
            echo "ÇALIŞMIYOR"
        fi
        if [ -f "$LOG_FILE" ]; then
            echo "--- son 25 satır: $LOG_FILE ---"
            tail -n 25 "$LOG_FILE"
        else
            echo "Log dosyası yok: $LOG_FILE"
        fi
        ;;
    stop)
        if tmux has-session -t "$SESSION" 2>/dev/null; then
            tmux kill-session -t "$SESSION"
            echo "Durduruldu: $SESSION"
        else
            echo "Aktif oturum yok."
        fi
        ;;
    *)
        echo "Kullanım: bash deploy/run-fetch-hesaplama.sh {start|status|attach|log|stop} [fetch args]"
        exit 1
        ;;
esac
