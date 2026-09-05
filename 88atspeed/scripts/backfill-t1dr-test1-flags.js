#!/usr/bin/env node
/**
 * program_json içindeki atlara t1drTest1 bayrağını yazar.
 * Vitrin API isteğinde hesaplanmaz — deploy veya tahmin üretiminde çalıştırılır.
 *
 *   node scripts/backfill-t1dr-test1-flags.js --bugun --yarin
 *   node scripts/backfill-t1dr-test1-flags.js --tarih 05/09/2026
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');
const { annotateKosular } = require('../lib/t1dr-test1-match');

const args = process.argv.slice(2);

function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function countStars(kosular) {
    let n = 0;
    for (const race of kosular || []) {
        for (const h of race.horses || []) {
            if (h.t1drTest1) n++;
        }
    }
    return n;
}

async function backfillDate(db, tarih) {
    const rows = await dbAll(db,
        `SELECT hipodrom_id, hipodrom, program_json FROM public_gunluk_program
         WHERE tarih = ? AND durum = 'yayinda'`,
        [tarih]
    );
    let updated = 0;
    for (const row of rows) {
        let kosular = [];
        try {
            kosular = JSON.parse(row.program_json || '[]');
        } catch (_) {
            continue;
        }
        const annotated = annotateKosular(kosular, { tarih, hipodrom: row.hipodrom });
        if (JSON.stringify(kosular) === JSON.stringify(annotated)) continue;
        await dbRun(db,
            `UPDATE public_gunluk_program SET program_json = ?, cekilme_tarihi = CURRENT_TIMESTAMP
             WHERE tarih = ? AND hipodrom_id = ?`,
            [JSON.stringify(annotated), tarih, row.hipodrom_id]
        );
        console.log('  ✓', row.hipodrom, '—', countStars(annotated), '★ at');
        updated++;
    }
    return updated;
}

async function main() {
    const dates = [];
    if (args.includes('--bugun')) dates.push(publicProgram.todayTr());
    if (args.includes('--yarin')) dates.push(publicProgram.tomorrowTr());
    const tarihArg = argVal('--tarih');
    if (tarihArg) dates.push(tarihArg);
    if (!dates.length) {
        dates.push(publicProgram.todayTr(), publicProgram.tomorrowTr());
    }

    const dbPath = argVal('--db') || path.join(__dirname, '..', 'atlar.db');
    const db = new sqlite3.Database(dbPath);
    await publicProgram.ensureTables(db);

    let total = 0;
    for (const tarih of dates) {
        console.log('⭐ T1×DR=TEST1 backfill:', tarih);
        total += await backfillDate(db, tarih);
    }
    console.log(total ? `✅ ${total} hipodrom güncellendi` : '✓ Bayraklar zaten güncel');
    db.close();
}

main().catch((err) => {
    console.error('backfill-t1dr-test1-flags:', err.message || err);
    process.exit(1);
});
