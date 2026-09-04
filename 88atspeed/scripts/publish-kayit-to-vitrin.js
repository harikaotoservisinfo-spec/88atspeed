#!/usr/bin/env node
/**
 * Hesaplama kaydını kamu vitrinine yayınlar (test için eski kayıt → bugün).
 *
 *   npm run publish:test-vitrin
 *   node scripts/publish-kayit-to-vitrin.js --kaynak 02/09/2026 --bugun --hipodrom İstanbul,Elazığ
 *   node scripts/publish-kayit-to-vitrin.js --kaynak 02/09/2026 --hedef 04/09/2026 --hipodrom İstanbul --build-tahmin
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');
const { buildPublicTahmin } = require('../lib/public-tahmin-build');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const sourceTarih = argVal('--kaynak') || argVal('--kaynak-tarih') || '02/09/2026';
let targetTarih = argVal('--hedef') || argVal('--hedef-tarih');
if (args.includes('--bugun')) targetTarih = publicProgram.todayTr();
if (!targetTarih) targetTarih = publicProgram.todayTr();

const hipArg = argVal('--hipodrom') || 'İstanbul,Elazığ';
const hipodromlar = hipArg.split(',').map((s) => s.trim()).filter(Boolean);
const buildTahmin = args.includes('--build-tahmin') || args.includes('--tahmin');

const db = new sqlite3.Database(path.join(__dirname, '..', 'atlar.db'));

(async function main() {
    console.log('📺 Hesaplama kaydı → kamu vitrin');
    console.log('   Kaynak:', sourceTarih, '· Hedef:', targetTarih);
    console.log('   Hipodrom:', hipodromlar.join(', '));

    const published = await publicProgram.publishHesaplamaKayitlarToVitrin(db, {
        sourceTarih,
        targetTarih,
        hipodromlar
    });

    for (const row of published) {
        console.log('  ✓', row.hipodrom, '— kayıt #' + row.kayitId
            + ' → vitrin ' + row.targetTarih
            + ' · ' + row.raceCount + ' koşu · veri:' + row.dataHits + ' at');
    }

    if (buildTahmin) {
        console.log('🎯 Tahmin üretiliyor:', targetTarih);
        const built = await buildPublicTahmin(db, targetTarih, {
            dbPath: path.join(__dirname, '..', 'atlar.db'),
            save: true
        });
        for (const r of built.results || []) {
            console.log('  ✓', r.hipodrom, r.scored + '/' + r.raceCount, 'koşu ·', r.engine
                + ' · veri:' + r.dataHits);
        }
    }

    console.log('✅ Tamamlandı — vitrin:', targetTarih);
    console.log('   Site: ana sayfa tarih', targetTarih, '→ Tahminler sekmesi');
    db.close();
    process.exit(0);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
