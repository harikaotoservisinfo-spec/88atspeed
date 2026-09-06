#!/usr/bin/env node
/**
 * Kamu vitrini tahmin üretimi (hibrit motor)
 *   npm run build:public-tahmin
 *   node scripts/build-public-tahmin.js --tarih 04/09/2026
 *   node scripts/build-public-tahmin.js --hipodrom Bursa --race 1
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

const tarih = argVal('--tarih')
    || (args.includes('--bugun') ? publicProgram.todayTr() : publicProgram.tomorrowTr());
const hipodrom = argVal('--hipodrom');
const raceNo = argVal('--race');

const db = new sqlite3.Database(path.join(__dirname, '..', 'atlar.db'));

(async function main() {
    console.log('🎯 Kamu tahmin üretiliyor:', tarih, hipodrom ? ('· ' + hipodrom) : '');
    const result = await buildPublicTahmin(db, tarih, {
        hipodrom,
        raceNo,
        dbPath: path.join(__dirname, '..', 'atlar.db'),
        save: true
    });
    if (!result.hipodromSayisi) {
        console.error('❌', result.error || 'Program yok');
        db.close();
        process.exit(1);
    }
    for (const r of result.results) {
        console.log('  ✓', r.hipodrom, '—', r.scored + '/' + r.raceCount, 'koşu ·', r.engine
            + ' · veri:' + r.dataHits + ' at');
        if (r.sample?.length) {
            console.log('    örnek:', r.sample.map((t) => t.rank + '.' + t.horseNo + ' ' + t.horseName
                + (t.pct != null ? ' %' + t.pct : '')).join(' · '));
        }
    }
    console.log('✅ Tamamlandı');
    db.close();
    process.exit(0);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
