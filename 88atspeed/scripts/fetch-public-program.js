#!/usr/bin/env node
/**
 * Ertesi günün kamu programını çeker (cron: her akşam 20:00)
 * Örnek: node scripts/fetch-public-program.js
 *        node scripts/fetch-public-program.js --tarih 04/09/2026
 *        node scripts/fetch-public-program.js --bugun --hipodrom Ankara
 */
const sqlite3 = require('sqlite3').verbose();
const publicProgram = require('../lib/public-program');

const args = process.argv.slice(2);
let tarih = publicProgram.tomorrowTr();
let hipodromFilter = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
    if (args[i] === '--bugun') tarih = publicProgram.todayTr();
    if (args[i] === '--hipodrom' && args[i + 1]) hipodromFilter = args[i + 1];
}

const db = new sqlite3.Database('atlar.db');

const opts = {
    onlyDomestic: true,
    publish: true,
    timeoutMs: 90000,
    maxAttempts: 5,
    hipDelayMs: 3000
};

(async function main() {
    console.log('📡 Kamu programı çekiliyor:', tarih);
    const startedAt = new Date().toISOString();
    if (hipodromFilter) {
        const hip = publicProgram.FALLBACK_HIPODROMS.find((h) =>
            h.name.toLowerCase().includes(hipodromFilter.toLowerCase()));
        if (!hip) {
            console.error('❌ Bilinmeyen hipodrom:', hipodromFilter);
            process.exit(1);
        }
        await publicProgram.ensureTables(db);
        const prog = await publicProgram.fetchHipodromProgram(tarih, hip, opts);
        await new Promise((resolve, reject) => {
            const sql = `INSERT INTO public_gunluk_program
                (tarih, hipodrom_id, hipodrom, kosu_sayisi, ilk_kosu_saat, program_json, durum, yayin_tarihi)
                VALUES (?, ?, ?, ?, ?, ?, 'yayinda', datetime('now'))
                ON CONFLICT(tarih, hipodrom_id) DO UPDATE SET
                    kosu_sayisi=excluded.kosu_sayisi,
                    program_json=excluded.program_json,
                    durum='yayinda',
                    cekilme_tarihi=CURRENT_TIMESTAMP`;
            db.run(sql, [
                tarih, hip.id, hip.name, prog.kosuSayisi,
                prog.races[0]?.saat || '', JSON.stringify(prog.races)
            ], (err) => err ? reject(err) : resolve());
        });
        console.log('✅', hip.name, '—', prog.kosuSayisi, 'koşu kaydedildi');
        await publicProgram.logFetchRun(db, {
            startedAt,
            tarih,
            trigger: 'cli-single',
            hipodromSayisi: 1,
            basarili: 1,
            results: [{ hipodrom: hip.name, kosuSayisi: prog.kosuSayisi, ok: true }],
            ok: true
        });
        db.close();
        process.exit(0);
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
