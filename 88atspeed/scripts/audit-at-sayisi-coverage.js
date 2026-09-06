#!/usr/bin/env node
/**
 * kosular[] içinde at_sayisi doluluk denetimi — SİKLET MAX-* için gerekli
 *
 *   node scripts/audit-at-sayisi-coverage.js --db atlar.db
 *   node scripts/audit-at-sayisi-coverage.js --db atlar.db --kayit 148
 */
const path = require('path');
const { openDb, dbAll, parseCliArgs } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null
};

function parseVeri(raw) {
    try {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(d) ? d : null;
    } catch (_) {
        return null;
    }
}

async function main() {
    const db = openDb(cli.dbPath);
    try {
        let rows = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id DESC');
        if (cli.kayitId) rows = rows.filter(r => Number(r.id) === cli.kayitId);

        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║  at_sayisi doluluk — SİKLET MAX-* için                  ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('');

        let totalKosu = 0;
        let withFs = 0;
        let withSiklet = 0;
        let horsesMissingFs = 0;
        const horseSamples = [];

        for (const row of rows) {
            const races = parseVeri(row.veri);
            if (!races) continue;
            for (const race of races) {
                for (const horse of race.horses || []) {
                    const kosular = horse.kosular || [];
                    if (!kosular.length) continue;
                    let hTotal = 0;
                    let hFs = 0;
                    let hSiklet = 0;
                    for (const k of kosular) {
                        totalKosu++;
                        hTotal++;
                        if (k.siklet && k.siklet !== '-') hSiklet++;
                        if (Number(k.at_sayisi) > 0) hFs++;
                    }
                    withFs += hFs;
                    withSiklet += hSiklet;
                    if (hFs < hTotal) {
                        horsesMissingFs++;
                        if (horseSamples.length < 8) {
                            horseSamples.push({
                                kayit: row.id,
                                race: race.raceNo,
                                name: horse.name,
                                kosu: hTotal,
                                fs: hFs,
                                siklet: hSiklet
                            });
                        }
                    }
                }
            }
        }

        const pct = totalKosu ? Math.round(1000 * withFs / totalKosu) / 10 : 0;
        console.log('Toplam geçmiş koşu kaydı : ' + totalKosu);
        console.log('at_sayisi dolu           : ' + withFs + ' (' + pct + '%)');
        console.log('siklet dolu              : ' + withSiklet);
        console.log('at_sayisi eksik at       : ' + horsesMissingFs);
        console.log('');

        if (horseSamples.length) {
            console.log('Örnek eksik atlar:');
            for (const s of horseSamples) {
                console.log('  kayıt #' + s.kayit + ' K' + s.race + ' ' + s.name
                    + ' — ' + s.fs + '/' + s.kosu + ' at_sayisi, ' + s.siklet + ' siklet');
            }
        }

        if (pct < 80) {
            console.log('\n⚠ MAX-* sütunları için GETİR yenile veya:');
            console.log('  node scripts/repair-missing-kosular.js --db ' + cli.dbPath + ' --refresh --apply');
        } else {
            console.log('\nOK · at_sayisi kapsamı yeterli');
        }
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
