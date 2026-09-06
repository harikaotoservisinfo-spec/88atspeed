#!/usr/bin/env node
/**
 * Mevcut kamu vitrin programlarını hesaplama_kayitlari'na aktarır.
 *   npm run sync:public-to-hesaplama
 *   node scripts/sync-public-to-hesaplama.js --tarih 04/09/2026
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');

const args = process.argv.slice(2);
let tarih = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
}

const db = new sqlite3.Database(path.join(__dirname, '..', 'atlar.db'));

(async function main() {
    console.log('🔄 Kamu program → hesaplama kayıtları', tarih ? ('· ' + tarih) : '(tümü)');
    const synced = await publicProgram.syncAllPublicProgramsToHesaplama(db, { tarih });
    if (!synced.length) {
        console.log('⚠️ Aktarılacak kamu programı yok');
        db.close();
        process.exit(1);
    }
    for (const row of synced) {
        console.log('  ✓', row.tarih, row.hipodrom, '— hesaplama #' + row.hesaplamaId
            + ' · ' + row.raceCount + ' koşu · ' + row.totalHorses + ' at'
            + (row.updated ? ' (güncellendi)' : ' (yeni)'));
    }
    console.log('✅ Tamamlandı:', synced.length, 'kayıt');
    db.close();
    process.exit(0);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
