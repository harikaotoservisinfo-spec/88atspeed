#!/usr/bin/env node
/**
 * Tüm hipodromlar için Liderform GP önbelleğini doldurur (cron / manuel).
 *
 * Kullanım:
 *   node scripts/prefetch-liderform-gp.js --iso 2026-09-04
 *   node scripts/prefetch-liderform-gp.js --iso 2026-09-04 --hipodrom Bursa
 */
const publicProgram = require('../lib/public-program');
const liderformGp = require('../lib/liderform-gp');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'atlar.db');

function parseArgs(argv) {
    const opts = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--iso' && argv[i + 1]) opts.iso = argv[++i];
        else if (a === '--hipodrom' && argv[i + 1]) opts.hipodrom = argv[++i];
        else if (a === '--help' || a === '-h') opts.help = true;
    }
    if (!opts.iso) {
        const d = new Date();
        opts.iso = d.toISOString().slice(0, 10);
    }
    return opts;
}

function openDb() {
    return new sqlite3.Database(DB_PATH);
}

function queryHipodromlar(db, tarih) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT DISTINCT hipodrom AS name FROM at_verileri WHERE tarih = ?
            UNION
            SELECT DISTINCT hipodrom AS name FROM hesaplama_kayitlari WHERE tarih = ?
            ORDER BY name`;
        const trTarih = publicProgram.isoToTr(tarih);
        db.all(sql, [trTarih, trTarih], (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map((r) => r.name).filter(Boolean));
        });
    });
}

function getRaceCount(db, tarih, hipodrom) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT veri FROM at_verileri WHERE tarih = ? AND hipodrom = ? ORDER BY id DESC LIMIT 1`;
        db.get(sql, [publicProgram.isoToTr(tarih), hipodrom], (err, row) => {
            if (err) return reject(err);
            if (!row?.veri) return resolve(0);
            try {
                const data = JSON.parse(row.veri);
                const kosular = data.kosular || data.races || [];
                resolve(kosular.length || data.race_count || 0);
            } catch (_) {
                resolve(0);
            }
        });
    });
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        console.log('Kullanım: node scripts/prefetch-liderform-gp.js [--iso YYYY-MM-DD] [--hipodrom Bursa]');
        process.exit(0);
    }

    const db = openDb();
    const t0 = Date.now();
    console.log(`[prefetch-gp] ${opts.iso} başlıyor…`);

    try {
        let hipodromlar = [];
        if (opts.hipodrom) {
            hipodromlar = [opts.hipodrom];
        } else {
            hipodromlar = await queryHipodromlar(db, opts.iso);
        }

        if (!hipodromlar.length) {
            console.log('[prefetch-gp] hipodrom bulunamadı');
            return;
        }

        for (const hip of hipodromlar) {
            const raceCount = await getRaceCount(db, opts.iso, hip);
            if (!raceCount) {
                console.log(`[prefetch-gp] ${hip}: koşu yok, atlanıyor`);
                continue;
            }
            const raceNos = Array.from({ length: raceCount }, (_, i) => String(i + 1));
            console.log(`[prefetch-gp] ${hip}: ${raceNos.length} koşu…`);
            try {
                const result = await liderformGp.fetchGpForHipodrom({
                    iso: opts.iso,
                    hipodrom: hip,
                    raceNos,
                    refresh: true,
                    onRace: (raceNo, _data, idx, total) => {
                        process.stdout.write(`\r  → koşu ${raceNo} (${idx}/${total})`);
                    }
                });
                console.log(`\r  ✓ ${hip}: ${result.raceCount} koşu${result.partial ? ' (kısmi)' : ''}`);
            } catch (err) {
                console.log(`\r  ✗ ${hip}: ${err.message}`);
            }
        }
    } finally {
        db.close();
        await liderformGp.closeLfBrowser();
        console.log(`[prefetch-gp] bitti (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
}

main().catch((err) => {
    console.error('[prefetch-gp] fatal:', err.message);
    process.exit(1);
});
