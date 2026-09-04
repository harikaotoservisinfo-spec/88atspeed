#!/usr/bin/env node
/**
 * hesaplama_kayitlari → public_gunluk_program (vitrin) senkronu
 *
 *   node scripts/sync-hesaplama-to-vitrin.js --db atlar.db --kayit 170
 *   node scripts/sync-hesaplama-to-vitrin.js --db atlar.db --tarih 04/09/2026 --hipodrom İzmir
 */
const path = require('path');
const publicProgram = require('../lib/public-program');
const { openDb } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    tarih: argVal('--tarih') || '',
    hipodrom: argVal('--hipodrom') || ''
};

async function main() {
    const db = openDb(cli.dbPath);
    try {
        if (!cli.kayitId && !(cli.tarih && cli.hipodrom)) {
            console.error('Kullanım: --kayit ID  veya  --tarih ... --hipodrom ...');
            process.exit(1);
        }
        const pub = await publicProgram.publishHesaplamaKayitToVitrin(db, {
            kayitId: cli.kayitId || undefined,
            sourceTarih: cli.tarih || undefined,
            targetTarih: cli.tarih || undefined,
            hipodrom: cli.hipodrom || undefined
        });
        console.log('✓ Vitrin güncellendi:', pub.hipodrom, pub.targetTarih);
        console.log('  hesaplama #' + pub.kayitId + ' · ' + pub.dataHits + ' at geçmişli · '
            + pub.raceCount + ' koşu');
    } finally {
        db.close();
    }
}

main().catch((err) => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
