#!/usr/bin/env node
/**
 * Ertesi günün kamu programını çeker (cron: her akşam 20:00)
 * Örnek: node scripts/fetch-public-program.js
 *        node scripts/fetch-public-program.js --tarih 04/09/2026
 *        node scripts/fetch-public-program.js --bugun --kosular   (TJK + at geçmişi)
 * Tam eski akış: npm run fetch:hesaplama-full
 */
const sqlite3 = require('sqlite3').verbose();
const publicProgram = require('../lib/public-program');

const args = process.argv.slice(2);
let tarih = publicProgram.tomorrowTr();
let hipodromFilter = null;
let source = 'tjk';
let enrichKosular = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
    if (args[i] === '--bugun') tarih = publicProgram.todayTr();
    if (args[i] === '--hipodrom' && args[i + 1]) hipodromFilter = args[i + 1];
    if (args[i] === '--source' && args[i + 1]) source = args[i + 1];
    if (args[i] === '--tjk') source = 'tjk';
    if (args[i] === '--kosular' || args[i] === '--full') enrichKosular = true;
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

    db.close();
    process.exit(result.basarili > 0 ? 0 : 1);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
