#!/usr/bin/env node
/**
 * Yarın programı kayıtlarını sıfırla (çift çekim / bozuk enrich sonrası)
 *   node scripts/reset-yarin-program.js              # ne silinecek (kuru)
 *   node scripts/reset-yarin-program.js --apply      # sil + state sıfırla
 *   node scripts/reset-yarin-program.js --apply --tarih 05/09/2026
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const publicProgram = require('../lib/public-program');
const programScheduler = require('../lib/public-program-scheduler');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tarih = (() => {
    const i = args.indexOf('--tarih');
    if (i >= 0 && args[i + 1]) return args[i + 1];
    return publicProgram.tomorrowTr();
})();

const STATE_FILE = path.join(__dirname, '..', 'data', 'yarin-fetch-state.json');
const DB_PATH = path.join(__dirname, '..', 'atlar.db');

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
}

function killFetchProcesses() {
    const { execSync } = require('child_process');
    const patterns = [
        'fetch-public-program',
        'npm run fetch:public-program-yarin'
    ];
    for (const p of patterns) {
        try {
            execSync("pkill -f '" + p.replace(/'/g, "'\\''") + "' || true", { stdio: 'ignore' });
        } catch (_) { /* */ }
    }
    try {
        execSync('pkill -f puppeteer || true', { stdio: 'ignore' });
        execSync('pkill -f "chrome.*headless" || true', { stdio: 'ignore' });
    } catch (_) { /* */ }
}

(async () => {
    console.log('');
    console.log('=== Yarın programı sıfırlama ===');
    console.log('Tarih:', tarih);
    console.log('Mod:', APPLY ? 'UYGULA (sil)' : 'kuru çalışma (--apply ile sil)');
    console.log('');

    const db = new sqlite3.Database(DB_PATH);
    try {
        const vitrinRows = await dbAll(
            db,
            `SELECT id, hipodrom_id, hipodrom, kosu_sayisi FROM public_gunluk_program
             WHERE tarih = ? AND durum = 'yayinda'`,
            [tarih]
        );
        const hesapRows = await dbAll(
            db,
            `SELECT id, hipodrom, race_count FROM hesaplama_kayitlari WHERE tarih = ?`,
            [tarih]
        );

        console.log('Silinecek public_gunluk_program:', vitrinRows.length, 'satır');
        for (const r of vitrinRows) {
            console.log('  ·', r.hipodrom, '(' + r.kosu_sayisi + ' koşu)');
        }
        console.log('Silinecek hesaplama_kayitlari:', hesapRows.length, 'satır');
        for (const r of hesapRows) {
            console.log('  · id', r.id, r.hipodrom, '(' + (r.race_count || '?') + ' koşu)');
        }

        if (!APPLY) {
            console.log('');
            console.log('Silmek için: node scripts/reset-yarin-program.js --apply');
            return;
        }

        console.log('');
        console.log('Süreçler durduruluyor…');
        killFetchProcesses();

        const delVitrin = await dbRun(
            db,
            `DELETE FROM public_gunluk_program WHERE tarih = ?`,
            [tarih]
        );
        const delHesap = await dbRun(
            db,
            `DELETE FROM hesaplama_kayitlari WHERE tarih = ?`,
            [tarih]
        );

        try {
            programScheduler.markError(new Error('Manuel sıfırlandı — ' + tarih), {
                yarinTarih: tarih,
                resetAt: new Date().toISOString()
            });
        } catch (_) {
            fs.writeFileSync(STATE_FILE, JSON.stringify({
                status: 'idle',
                lastRunDate: null,
                resetAt: new Date().toISOString()
            }, null, 2));
        }

        console.log('✓ public_gunluk_program silindi:', delVitrin.changes);
        console.log('✓ hesaplama_kayitlari silindi:', delHesap.changes);
        console.log('✓ yarin-fetch-state sıfırlandı');
        console.log('');
        console.log('Yeniden başlatmak için:');
        console.log('  flock -n /tmp/88atspeed-yarin.lock npm run fetch:public-program-yarin -- --force');
        console.log('  veya: bash deploy/reset-yarin-fetch.sh --restart');
    } finally {
        db.close();
    }
})().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
