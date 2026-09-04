#!/usr/bin/env node
/**
 * Hesaplama kayıtlarında eksik koşu mesafe/pist alanlarını TJK programından tamamlar.
 *
 *   node scripts/repair-race-mesafe.js --db atlar.db --kayit 169
 *   node scripts/repair-race-mesafe.js --tarih 04/09/2026 --hipodrom Bursa --apply
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const publicProgram = require('../lib/public-program');
const raceMetaEnrich = require('../lib/race-meta-enrich');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    tarih: argVal('--tarih') || null,
    hipodrom: argVal('--hipodrom') || null,
    apply: args.includes('--apply')
};

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
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

async function repairKayit(db, kayit) {
    let veri = [];
    try { veri = JSON.parse(kayit.veri || '[]'); } catch (_) {
        throw new Error('Kayıt verisi okunamadı #' + kayit.id);
    }
    const before = veri.filter((r) => !raceMetaEnrich.raceMetaFilled(r.mesafe)).length;
    const enriched = await publicProgram.enrichHesaplamaVeriMesafe(db, veri, kayit);
    const after = enriched.filter((r) => !raceMetaEnrich.raceMetaFilled(r.mesafe)).length;

    console.log('  Kayıt #' + kayit.id + ' · ' + kayit.hipodrom + ' · ' + kayit.tarih);
    console.log('    mesafe eksik: ' + before + ' → ' + after + ' / ' + enriched.length + ' koşu');
    for (const r of enriched) {
        if (raceMetaEnrich.raceMetaFilled(r.mesafe)) {
            console.log('    ✓ Koşu ' + r.raceNo + ': ' + r.mesafe + ' ' + (r.pist || '') + ' · ' + (r.kcins_kosu || ''));
        }
    }

    if (cli.apply && before > after) {
        await dbRun(
            db,
            `UPDATE hesaplama_kayitlari SET veri = ?, kayit_tarihi = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(enriched), kayit.id]
        );
        console.log('    💾 Kayıt güncellendi');
    } else if (!cli.apply && before > after) {
        console.log('    (önizleme — kaydetmek için --apply ekleyin)');
    }
    return { id: kayit.id, before, after, raceCount: enriched.length };
}

async function main() {
    const db = new sqlite3.Database(cli.dbPath);
    try {
        let kayitlar = [];
        if (cli.kayitId) {
            const row = await dbGet(db, 'SELECT * FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
            if (!row) throw new Error('Kayıt bulunamadı #' + cli.kayitId);
            kayitlar = [row];
        } else if (cli.tarih && cli.hipodrom) {
            const row = await publicProgram.findHesaplamaKayit(db, {
                tarih: cli.tarih,
                hipodrom: cli.hipodrom
            });
            if (!row) throw new Error('Kayıt bulunamadı: ' + cli.tarih + ' ' + cli.hipodrom);
            kayitlar = [row];
        } else {
            kayitlar = await new Promise((resolve, reject) => {
                db.all('SELECT * FROM hesaplama_kayitlari ORDER BY id DESC', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
        }

        console.log('🔧 Koşu mesafe/pist onarımı — ' + kayitlar.length + ' kayıt'
            + (cli.apply ? ' (kaydet)' : ' (önizleme)'));
        const results = [];
        for (const kayit of kayitlar) {
            results.push(await repairKayit(db, kayit));
        }
        const fixed = results.filter((r) => r.before > r.after).length;
        console.log('\n✅ Tamamlandı — ' + fixed + ' kayıtta mesafe tamamlandı');
    } finally {
        db.close();
    }
}

main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
