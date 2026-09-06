#!/usr/bin/env node
/**
 * PUANLAMA çıkan-at listesindeki atları hesaplama_kayitlari.veri'den kalıcı sil
 *
 *   node scripts/purge-cikan-from-kayitlar.js --db atlar.db --scan
 *   node scripts/purge-cikan-from-kayitlar.js --db atlar.db --apply
 */
const path = require('path');
const {
    openDb,
    dbAll,
    dbGet,
    parsePuanlamaStore
} = require('./ptest-terminal-lib');

global.AtSpeedUtils = require(path.join(__dirname, '..', 'public/js/utils.js'));
const U = global.AtSpeedUtils;

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    apply: args.includes('--apply')
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }

async function loadCikanMap(db) {
    try {
        const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (row?.veri) return parsePuanlamaStore(JSON.parse(row.veri)).cikan || {};
    } catch (_) { /* tablo yok */ }
    return {};
}

async function main() {
    const db = openDb(cli.dbPath);
    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  Çıkan atları kayıt verisinden kalıcı silme                 ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Mod: ' + (cli.apply ? 'APPLY' : 'DRY-RUN'));

        const cikanMap = await loadCikanMap(db);
        const cikanHorseTotal = Object.values(cikanMap).reduce((s, a) => s + (a?.length || 0), 0);
        hr('PUANLAMA çıkan-at listesi');
        console.log('  Koşu anahtarı: ' + Object.keys(cikanMap).length);
        console.log('  Toplam at: ' + cikanHorseTotal);
        if (!cikanHorseTotal) {
            console.log('\n✅ Çıkan at kaydı yok.');
            return;
        }

        const kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
        let totalRemoved = 0;
        const plan = [];

        for (const kayit of kayitlar) {
            let races;
            try {
                races = JSON.parse(kayit.veri);
            } catch (_) {
                continue;
            }
            if (!Array.isArray(races)) continue;

            let removedHere = 0;
            for (const [rk, horseNos] of Object.entries(cikanMap)) {
                const [kayitIdStr, raceNoStr] = String(rk).split('|');
                if (Number(kayitIdStr) !== Number(kayit.id)) continue;
                const raceNo = Number(raceNoStr);
                for (const horseNo of horseNos || []) {
                    const horse = U.removeHorseFromKayitVeri(races, raceNo, horseNo);
                    if (horse) {
                        removedHere++;
                        plan.push({
                            kayitId: kayit.id,
                            hipodrom: kayit.hipodrom,
                            tarih: kayit.tarih,
                            raceNo,
                            horseNo,
                            horseName: horse.name || '—'
                        });
                    }
                }
            }
            if (!removedHere) continue;
            totalRemoved += removedHere;
            const totals = U.recountKayitTotals(races);

            if (cli.apply) {
                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE hesaplama_kayitlari SET veri = ?, race_count = ?, total_horses = ? WHERE id = ?',
                        [JSON.stringify(races), totals.raceCount, totals.totalHorses, kayit.id],
                        err => (err ? reject(err) : resolve())
                    );
                });
            }
        }

        hr('Silinen atlar');
        for (const p of plan) {
            console.log('  ' + p.tarih + ' ' + p.hipodrom + ' K' + p.raceNo
                + ' #' + p.horseNo + ' ' + p.horseName + ' · kayit#' + p.kayitId);
        }

        hr('Özet');
        console.log('  Silinen at: ' + totalRemoved + (cli.apply ? '' : ' (dry-run — --apply ile yaz)'));
        if (cli.apply && totalRemoved) {
            const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
            if (row?.veri) {
                const parsed = parsePuanlamaStore(JSON.parse(row.veri));
                const veri = JSON.stringify({ bitis: parsed.bitis || {}, cikan: {} });
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`,
                        [veri],
                        err => (err ? reject(err) : resolve())
                    );
                });
                console.log('  PUANLAMA cikan listesi temizlendi');
            }
        }
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
