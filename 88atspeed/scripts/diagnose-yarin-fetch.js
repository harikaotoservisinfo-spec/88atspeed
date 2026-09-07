#!/usr/bin/env node
/**
 * Yarın programı çekim durumu — terminal özeti
 *   node scripts/diagnose-yarin-fetch.js
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const programScheduler = require('../lib/public-program-scheduler');
const publicProgram = require('../lib/public-program');

const LOG_FILE = '/var/log/88atspeed-program.log';
const DB_PATH = path.join(__dirname, '..', 'atlar.db');

function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h > 0) return h + ' sa ' + rm + ' dk';
    return m + ' dk';
}

function pidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function readLogTail(lines = 25) {
    try {
        if (!fs.existsSync(LOG_FILE)) return ['(log yok: ' + LOG_FILE + ')'];
        const text = fs.readFileSync(LOG_FILE, 'utf8');
        return text.trim().split('\n').slice(-lines);
    } catch (err) {
        return ['(log okunamadı: ' + err.message + ')'];
    }
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

(async () => {
    const state = programScheduler.loadState();
    const yarinTarih = publicProgram.tomorrowTr();
    const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : null;
    const elapsed = startedAt ? Date.now() - startedAt : null;
    const childAlive = pidAlive(state.childPid);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  YARIN PROGRAMI — DURUM RAPORU                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Yarın tarihi      :', yarinTarih);
    console.log('State status      :', state.status || '—');
    console.log('Phase             :', state.phase || '—');
    console.log('Child PID         :', state.childPid || '—', childAlive ? '(çalışıyor)' : '(yok/ölü)');
    console.log('Başlangıç         :', state.startedAt || '—');
    console.log('Geçen süre        :', fmtDuration(elapsed));
    console.log('Enrich            :', (state.enrichDone || 0) + '/' + (state.enrichTotal || 0),
        state.enrichHipodrom ? ('· ' + state.enrichHipodrom) : '');
    console.log('Son hata          :', state.error || '—');
    console.log('');

    const db = new sqlite3.Database(DB_PATH);
    try {
        const status = await programScheduler.getStatus(db);
        console.log('API status        :', status.status);
        console.log('API message       :', status.message);
        console.log('Tahmin hazır      :', status.tahminReady ? 'EVET ✓' : 'HAYIR');
        console.log('Skorlu atlar      :', status.scoredHorses + '/' + status.totalHorses);
        console.log('Hipodrom (DB)     :', status.hipodromSayisi);
        console.log('Arka plan aktif   :', status.backgroundActive);
        console.log('');

        const rows = await dbAll(
            db,
            `SELECT hipodrom, kosu_sayisi,
                    CASE WHEN tahmin_json IS NOT NULL AND length(tahmin_json) > 10 THEN 1 ELSE 0 END AS tahmin_var
             FROM public_gunluk_program
             WHERE tarih = ? AND durum = 'yayinda'
             ORDER BY hipodrom`,
            [yarinTarih]
        );
        console.log('DB kayıtları (' + yarinTarih + '):');
        if (!rows.length) {
            console.log('  (henüz kayıt yok)');
        } else {
            for (const r of rows) {
                console.log('  ·', r.hipodrom, '—', r.kosu_sayisi, 'koşu',
                    r.tahmin_var ? '· tahmin ✓' : '· tahmin yok');
            }
        }
    } finally {
        db.close();
    }

    console.log('');
    console.log('── Son log satırları (' + LOG_FILE + ') ──');
    for (const line of readLogTail(20)) console.log(line);
    console.log('');

    if (state.status === 'running' && !childAlive && elapsed > 20 * 60 * 1000) {
        console.log('⚠️  UYARI: Süreç ölmüş ama state hâlâ "running". Takılı kalmış olabilir.');
        console.log('    Kurtarma:');
        console.log('      pkill -f fetch-public-program || true');
        console.log('      node -e "require(\'./lib/public-program-scheduler\').markError(new Error(\'Manuel sıfırlandı\'))"');
        console.log('      nohup npm run fetch:public-program-yarin -- --force >> /var/log/88atspeed-program.log 2>&1 &');
        console.log('');
    } else if (childAlive && state.phase === 'program' && elapsed > 45 * 60 * 1000) {
        console.log('⚠️  UYARI: Program fazı 45+ dk sürdü — TJK/Puppeteer takılmış olabilir.');
        console.log('    tail -f /var/log/88atspeed-program.log ile izleyin.');
        console.log('');
    } else if (state.phase === 'enrich' && state.enrichTotal > 0) {
        const pct = Math.round((state.enrichDone / state.enrichTotal) * 100);
        const remain = state.enrichTotal - state.enrichDone;
        console.log('📊 Enrich ilerleme: %' + pct + ' · yaklaşık ' + remain + ' at kaldı');
        console.log('');
    }

    console.log('Canlı izleme: tail -f /var/log/88atspeed-program.log');
    console.log('');
})().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
