#!/usr/bin/env node
/**
 * TJK sonuçlarını hesaplama kaydına BİTİŞ olarak yazar.
 *
 *   node scripts/sync-sonuclar-to-kayit.js --db atlar.db --kayit 169
 *   node scripts/sync-sonuclar-to-kayit.js --db atlar.db --tarih 04/09/2026 --hipodrom Bursa
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const publicSonucStore = require('../lib/public-sonuc-store');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    tarih: argVal('--tarih') || '',
    hipodrom: argVal('--hipodrom') || '',
    refresh: !args.includes('--no-refresh')
};

function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}

async function main() {
    if (!cli.kayitId && !(cli.tarih && cli.hipodrom)) {
        console.error('Kullanım: --kayit ID  veya  --tarih DD/MM/YYYY --hipodrom Adı');
        process.exit(1);
    }

    const db = await openDb(cli.dbPath);
    try {
        const result = await publicSonucStore.importSonuclarToKayit(db, {
            kayitId: cli.kayitId || undefined,
            tarih: cli.tarih || undefined,
            hipodrom: cli.hipodrom || undefined,
            refresh: cli.refresh
        });
        console.log('✓ Sonuç senkronu tamam');
        console.log('  Kayıt #' + result.kayitId + ' · ' + result.hipodrom + ' · ' + result.tarih);
        console.log('  Koşu: ' + result.raceCount + ' · BİTİŞ yazılan at: ' + result.bitisSynced);
        if (result.message) console.log('  Not: ' + result.message);
        process.exit(result.bitisSynced > 0 ? 0 : 2);
    } finally {
        db.close();
    }
}

main().catch((err) => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
