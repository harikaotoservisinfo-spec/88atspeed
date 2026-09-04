#!/usr/bin/env node
/**
 * Ertesi günün kamu programını çeker (cron: her gün 18:30 TR)
 * Örnek: node scripts/fetch-public-program.js
 *        node scripts/fetch-public-program.js --tarih 04/09/2026
 *        node scripts/fetch-public-program.js --bugun --kosular   (TJK + at geçmişi)
 *        node scripts/fetch-public-program.js --tahmin            (yarın + tahmin)
 * Tam eski akış: npm run fetch:hesaplama-full
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');
const { buildPublicTahmin } = require('../lib/public-tahmin-build');
const programScheduler = require('../lib/public-program-scheduler');

const args = process.argv.slice(2);
let tarih = publicProgram.tomorrowTr();
let hipodromFilter = null;
let source = 'tjk';
let enrichKosular = false;
let buildTahmin = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
    if (args[i] === '--bugun') tarih = publicProgram.todayTr();
    if (args[i] === '--yarin') tarih = publicProgram.tomorrowTr();
    if (args[i] === '--hipodrom' && args[i + 1]) hipodromFilter = args[i + 1];
    if (args[i] === '--source' && args[i + 1]) source = args[i + 1];
    if (args[i] === '--tjk') source = 'tjk';
    if (args[i] === '--kosular' || args[i] === '--full') enrichKosular = true;
    if (args[i] === '--tahmin') buildTahmin = true;
}

const db = new sqlite3.Database('atlar.db');

const opts = {
    onlyDomestic: true,
    publish: true,
    source,
    enrichKosular: enrichKosular && source === 'tjk',
    syncHesaplama: source === 'tjk',
    timeoutMs: 90000,
    maxAttempts: 5,
    hipDelayMs: source === 'hipodrom' ? 400 : 3000,
    hipodromFilter
};

(async function main() {
    const isNightlyYarin = !args.includes('--bugun')
        && !hipodromFilter
        && tarih === publicProgram.tomorrowTr();
    if (isNightlyYarin && !args.includes('--force') && programScheduler.wasTodayFetchDone()) {
        console.log('⏭ Yarın programı bugün zaten çekildi — atlandı (yeniden için --force)');
        db.close();
        process.exit(0);
    }

    console.log('📡 Kamu programı çekiliyor:', tarih, '· kaynak:', source,
        enrichKosular ? '· kosular[]' : '');
    if (hipodromFilter) {
        await publicProgram.ensureTables(db);
        const result = await publicProgram.buildPublicProgram(db, tarih, {
            ...opts,
            trigger: 'cli-single'
        });
        db.close();
        process.exit(result.basarili > 0 ? 0 : 1);
    }

    const result = await publicProgram.buildPublicProgram(db, tarih, { ...opts, trigger: 'cli' });
    console.log('📋 Hipodrom kaynağı:', result.hipodromKaynagi);
    console.log('✅ Tamamlandı:', result.basarili + '/' + result.hipodromSayisi, 'hipodrom');

    const failed = result.results.filter((r) => !r.ok);
    if (failed.length) {
        console.warn('⚠️ Başarısız:', failed.map((f) => f.hipodrom + ' (' + f.error + ')').join(', '));
    }

    if (buildTahmin && result.basarili > 0) {
        console.log('🎯 Tahmin üretiliyor…');
        const tahmin = await buildPublicTahmin(db, tarih, {
            hipodrom: hipodromFilter || undefined,
            dbPath: path.join(__dirname, '..', 'atlar.db'),
            save: true
        });
        if (!tahmin.hipodromSayisi) {
            console.warn('⚠️ Tahmin üretilemedi:', tahmin.error || 'program yok');
        } else {
            for (const r of tahmin.results) {
                console.log('  ✓', r.hipodrom, '—', r.scored + '/' + r.raceCount, 'koşu');
            }
        }
    }

    if (isNightlyYarin && result.basarili > 0) {
        programScheduler.markTodayFetchDone({
            yarinTarih: tarih,
            hipodromSayisi: result.hipodromSayisi,
            basarili: result.basarili,
            source: 'cli'
        });
    }

    db.close();
    process.exit(result.basarili > 0 ? 0 : 1);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
