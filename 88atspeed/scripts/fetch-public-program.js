#!/usr/bin/env node
/**
 * Ertesi günün kamu programını çeker (cron: her akşam 20:00)
 * Örnek: node scripts/fetch-public-program.js
 *        node scripts/fetch-public-program.js --tarih 04/09/2026
 */
const sqlite3 = require('sqlite3').verbose();
const publicProgram = require('../lib/public-program');

const args = process.argv.slice(2);
let tarih = publicProgram.tomorrowTr();
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
    if (args[i] === '--bugun') tarih = publicProgram.todayTr();
}

const db = new sqlite3.Database('atlar.db');

publicProgram.buildPublicProgram(db, tarih, { onlyDomestic: true, publish: true })
    .then((result) => {
        console.log('✅ Kamu programı:', tarih);
        for (const r of result.results) {
            if (r.ok) console.log('  ·', r.hipodrom, '—', r.kosuSayisi, 'koşu');
            else console.warn('  ✗', r.hipodrom, '—', r.error);
        }
        db.close();
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌', err.message);
        db.close();
        process.exit(1);
    });
