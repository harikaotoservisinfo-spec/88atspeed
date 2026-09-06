#!/usr/bin/env node
/**
 * Sunucu depolama budama — fetch log, eski arşiv programlar (opsiyonel VACUUM)
 *   node scripts/prune-server-storage.js --db atlar.db --scan
 *   node scripts/prune-server-storage.js --db atlar.db --apply
 *   node scripts/prune-server-storage.js --db atlar.db --apply --vacuum
 */
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const vacuum = args.includes('--vacuum');
const dbArg = args.find((a, i) => args[i - 1] === '--db') || 'atlar.db';
const dbPath = path.resolve(dbArg);

const KEEP_FETCH_LOG = 150;
const ARCHIVE_DAYS = 21;

function human(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

function dbSize() {
    try {
        const st = fs.statSync(dbPath);
        return st.size;
    } catch (_) {
        return 0;
    }
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

(async function main() {
    const before = dbSize();
    console.log('📦 Veritabanı:', dbPath, '·', human(before));

    await run(`CREATE TABLE IF NOT EXISTS public_program_fetch_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME,
        tarih TEXT NOT NULL,
        trigger_name TEXT DEFAULT 'cli',
        hipodrom_sayisi INTEGER DEFAULT 0,
        basarili INTEGER DEFAULT 0,
        results_json TEXT,
        ok INTEGER DEFAULT 1
    )`);

    const fetchCount = await get('SELECT COUNT(*) AS c FROM public_program_fetch_log');
    const fetchTotal = fetchCount?.c || 0;
    const fetchPrune = Math.max(0, fetchTotal - KEEP_FETCH_LOG);

    const archiveRow = await get(
        `SELECT COUNT(*) AS c FROM public_gunluk_program
         WHERE durum = 'arsiv' AND date(cekilme_tarihi) < date('now', '-' || ? || ' days')`,
        [ARCHIVE_DAYS]
    ).catch(() => ({ c: 0 }));
    const archivePrune = archiveRow?.c || 0;

    console.log('  public_program_fetch_log:', fetchTotal, 'kayıt → budanacak:', fetchPrune);
    console.log('  public_gunluk_program arşiv (>' + ARCHIVE_DAYS + ' gün):', archivePrune, 'satır');

    if (!apply) {
        console.log('\nUygulamak için: --apply' + (vacuum ? '' : ' (isteğe bağlı: --vacuum)'));
        db.close();
        return;
    }

    if (fetchPrune > 0) {
        await run(
            `DELETE FROM public_program_fetch_log WHERE id NOT IN (
                SELECT id FROM public_program_fetch_log ORDER BY id DESC LIMIT ?
            )`,
            [KEEP_FETCH_LOG]
        );
        console.log('  ✓ fetch log budandı');
    }

    if (archivePrune > 0) {
        await run(
            `DELETE FROM public_gunluk_program
             WHERE durum = 'arsiv' AND date(cekilme_tarihi) < date('now', '-' || ? || ' days')`,
            [ARCHIVE_DAYS]
        );
        console.log('  ✓ eski arşiv programlar silindi');
    }

    if (vacuum) {
        console.log('  ⏳ VACUUM (veritabanı sıkıştırılıyor)…');
        await run('VACUUM');
    }

    const after = dbSize();
    console.log('✅ Tamam ·', human(before), '→', human(after),
        '(' + (before > after ? '-' : '+') + human(Math.abs(before - after)) + ')');
    db.close();
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
