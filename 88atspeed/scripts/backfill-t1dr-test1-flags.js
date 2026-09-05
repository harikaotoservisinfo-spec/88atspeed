#!/usr/bin/env node
/**
 * program_json içindeki atlara t1drTest1 bayrağını yazar.
 * Panel ile aynı veri kaynağı: at üzerindeki kosular[] + DB at geçmişi.
 *
 *   node scripts/backfill-t1dr-test1-flags.js --bugun --yarin
 *   node scripts/backfill-t1dr-test1-flags.js --tarih 05/09/2026
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');
const { annotateKosular } = require('../lib/t1dr-test1-match');
const { buildAtIdKosularIndex, veriCacheFromAtIndex } = require('../lib/public-tahmin-build');

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

function mergeInlineKosular(kosular, veriCache) {
    for (const race of kosular || []) {
        for (const h of race.horses || []) {
            const atId = h.atId != null && h.atId !== '' ? String(h.atId) : '';
            if (atId && (h.kosular || []).length && !veriCache[atId]?.length) {
                veriCache[atId] = h.kosular;
            }
        }
    }
    return veriCache;
}

async function backfillDate(db, tarih, veriCache, force) {
    const rows = await dbAll(db,
        `SELECT hipodrom_id, hipodrom, program_json FROM public_gunluk_program
         WHERE tarih = ? AND durum = 'yayinda'`,
        [tarih]
    );
    let updated = 0;
    let totalStars = 0;
    for (const row of rows) {
        let kosular = [];
        try {
            kosular = JSON.parse(row.program_json || '[]');
        } catch (_) {
            continue;
        }
        const cache = mergeInlineKosular(kosular, Object.assign({}, veriCache));
        const annotated = annotateKosular(kosular, { tarih, hipodrom: row.hipodrom, veriCache: cache, force });
        const stars = countStars(annotated);
        if (JSON.stringify(kosular) === JSON.stringify(annotated)) {
            console.log('  ·', row.hipodrom, '—', stars, '★ at (değişiklik yok)');
            totalStars += stars;
            continue;
        }
        await dbRun(db,
            `UPDATE public_gunluk_program SET program_json = ?, cekilme_tarihi = CURRENT_TIMESTAMP
             WHERE tarih = ? AND hipodrom_id = ?`,
            [JSON.stringify(annotated), tarih, row.hipodrom_id]
        );
        console.log('  ✓', row.hipodrom, '—', stars, '★ at');
        totalStars += stars;
        updated++;
    }
    return { updated, totalStars };
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

    console.log('📚 At geçmişi indeksi oluşturuluyor…');
    const atIndex = await buildAtIdKosularIndex(db);
    const veriCache = veriCacheFromAtIndex(atIndex);
    console.log('  →', Object.keys(veriCache).length, 'at geçmişi kaydı');

    const force = args.includes('--force');

    let totalUpdated = 0;
    let grandStars = 0;
    for (const tarih of dates) {
        console.log('⭐ T1×DR=TEST1 backfill:', tarih, force ? '(force)' : '');
        const { updated, totalStars } = await backfillDate(db, tarih, veriCache, force);
        totalUpdated += updated;
        grandStars += totalStars;
    }
    console.log(totalUpdated
        ? `✅ ${totalUpdated} hipodrom güncellendi · toplam ${grandStars} ★ at`
        : `✓ Bayraklar güncel · toplam ${grandStars} ★ at`);
    db.close();
}

main().catch((err) => {
    console.error('backfill-t1dr-test1-flags:', err.message || err);
    process.exit(1);
});
