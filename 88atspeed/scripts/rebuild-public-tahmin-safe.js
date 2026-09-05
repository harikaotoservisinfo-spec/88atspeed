#!/usr/bin/env node
/**
 * Kamu tahminini üretirken kalibrasyonu HER hipodrom öncesi yeniden uygular.
 *
 * Neden: ilk hipodrom skorlanırken GostergeScoringEngine'in kalibrasyon
 * bayrağı yan etki olarak kapanıyor; bu yüzden sıradaki hipodromlar (ör.
 * Ankara) 0 skor sütunu üretiyordu. Bu script, mevcut lib dosyalarına
 * dokunmadan, her hipodrom skorlanmadan hemen önce kalibrasyon paketini
 * yeniden içe aktararak sorunu çözer.
 *
 *   node --max-old-space-size=3072 scripts/rebuild-public-tahmin-safe.js --bugun
 *   node --max-old-space-size=3072 scripts/rebuild-public-tahmin-safe.js --tarih 05/09/2026
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const ptb = require('../lib/public-tahmin-build');
const { buildCalibrationBundle } = require('../lib/calibration-bundle');
const publicProgram = require('../lib/public-program');

const DB_PATH = path.join(__dirname, '..', 'atlar.db');
const args = process.argv.slice(2);
const argVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const tarih = argVal('--tarih')
    || (args.includes('--bugun') ? publicProgram.todayTr() : publicProgram.tomorrowTr());

const db = new sqlite3.Database(DB_PATH);
const all = (q, p) => new Promise((r, j) => db.all(q, p, (e, x) => e ? j(e) : r(x || [])));
const run = (q, p) => new Promise((r, j) => db.run(q, p, function (e) { e ? j(e) : r(this); }));

function calState() {
    return {
        gos: !!(global.GostergeScoringEngine && global.GostergeScoringEngine.isCalibrated && global.GostergeScoringEngine.isCalibrated()),
        hyb: !!(global.HybridTahminScoringEngine && global.HybridTahminScoringEngine.isCalibrated && global.HybridTahminScoringEngine.isCalibrated())
    };
}

// lib/public-tahmin-build.js icindeki applyScoringBundle ile ayni islem
function reimportBundle(b) {
    if (!b) return false;
    const G = global.GostergeScoringEngine;
    if (!G || !G.importCalibrationBundle) return false;
    G.importCalibrationBundle(b.gosterge);
    if (global.BasariPctScoringEngine && b.basari && b.basari.weightsBySize) {
        global.BasariPctScoringEngine.importBundle && global.BasariPctScoringEngine.importBundle(b.basari);
    }
    if (global.HybridTahminScoringEngine && b.hybrid) {
        global.HybridTahminScoringEngine.importCalibrationBundle && global.HybridTahminScoringEngine.importCalibrationBundle(b.hybrid);
    }
    if (global.AtestSonGosterge1Tahmin && b.g1) {
        global.AtestSonGosterge1Tahmin.importRates && global.AtestSonGosterge1Tahmin.importRates(b.g1);
    }
    if (global.AtestSonRenkTahmin && global.AtestSonRenkTahmin.onBundleLoaded) {
        global.AtestSonRenkTahmin.onBundleLoaded();
    }
    G.loadSharedCalibrationBundle = async () => true;
    return calState().gos;
}

function scoredCount(races) {
    let w = 0;
    for (const r of races || []) for (const h of (r.horses || [])) {
        const sc = h.scores || {};
        if (Object.keys(sc).some((k) => sc[k] != null)) w++;
    }
    return w;
}

(async () => {
    console.log('🎯 Güvenli kamu tahmin üretimi:', tarih);
    // 1) Motorları yükle + kalibrasyonu bir kez kur (disk cache varsa hızlı)
    await ptb.ensureCalibration(db, DB_PATH);
    // 2) Yeniden içe aktarmak için bundle nesnesini al (disk cache -> hızlı)
    const built = await buildCalibrationBundle(DB_PATH);
    const bundle = built.bundle;
    console.log('   kalibrasyon hazır:', JSON.stringify(calState()));

    const rows = await all(
        'SELECT tarih, hipodrom_id, hipodrom, program_json FROM public_gunluk_program WHERE tarih = ? AND durum = "yayinda"',
        [tarih]);
    if (!rows.length) {
        console.error('❌ Program bulunamadı:', tarih);
        db.close(); process.exit(1);
    }

    for (const row of rows) {
        const ok = reimportBundle(bundle); // <-- HER hipodrom öncesi kalibrasyonu geri getir
        const b = await ptb.buildTahminForHipodrom(db, tarih, row, { save: false });
        await run(
            'UPDATE public_gunluk_program SET program_json = ?, tahmin_json = ?, cekilme_tarihi = CURRENT_TIMESTAMP WHERE tarih = ? AND hipodrom_id = ?',
            [JSON.stringify(b.races || []), JSON.stringify(b.tahminPayload || null), tarih, row.hipodrom_id]);
        console.log('  ✓', row.hipodrom, '— skor_hucreli=' + scoredCount(b.races)
            + ' dataHits=' + b.dataHits + ' (kalibrasyon önce: gos=' + ok + ')');
    }
    console.log('✅ Tamamlandı');
    db.close();
    process.exit(0);
})().catch((e) => { console.error('❌', e); db.close(); process.exit(1); });
