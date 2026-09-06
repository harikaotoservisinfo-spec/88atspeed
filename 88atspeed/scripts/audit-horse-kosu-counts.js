#!/usr/bin/env node
/**
 * Kayıttaki her at için kosular[] kaç koşu içeriyor — GETİR limiti ile karşılaştır
 *
 *   node scripts/audit-horse-kosu-counts.js --kayit 148 --race 1
 *   node scripts/audit-horse-kosu-counts.js --kayit 148
 */
const path = require('path');
const { ROOT, openDb, dbAll, pad } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 148,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null
};

const FETCH_MAX_DETAIL = 7;
const FETCH_MAX_ALL = 40;

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

function hasFullDetail(k) {
    return !!(k.son800_bir && k.son800_bir !== '-')
        || !!(k.at_derece && k.at_derece !== '-');
}

async function main() {
    const db = openDb(cli.dbPath);
    try {
        const rows = await dbAll(db,
            'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
        if (!rows.length) {
            console.error('Kayıt #' + cli.kayitId + ' bulunamadı');
            process.exit(1);
        }
        const kayit = rows[0];
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) {
            console.error('Kayıt verisi okunamadı');
            process.exit(1);
        }
        if (cli.raceNo) races = races.filter((r, i) => Number(r.raceNo || i + 1) === cli.raceNo);

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  At başına kosular[] sayısı — GETİR limiti denetimi              ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt #' + kayit.id + ' · ' + kayit.tarih + ' · ' + kayit.hipodrom);
        console.log('GETİR varsayılanı: ilk ' + FETCH_MAX_DETAIL + ' koşu tam detay · toplam max ' + FETCH_MAX_ALL + ' koşu\n');

        const allCounts = [];

        for (const race of races) {
            const horses = [...(race.horses || [])].sort((a, b) => Number(a.no) - Number(b.no));
            console.log('── K' + (race.raceNo || '?') + ' · ' + horses.length + ' at ──');
            console.log('  ' + pad('#', 4) + pad('AT İSMİ', 24) + pad('ham[]', 6)
                + pad('prog-', 6) + pad('tam≥7', 6) + pad('tamDet', 7) + 'NOT');
            console.log('  ' + '-'.repeat(72));

            for (const h of horses) {
                const kosular = h.kosular || [];
                const ham = kosular.length;
                const programNorm = String(kayit.tarih || '').trim().replace(/\//g, '.');
                const progExcluded = kosular.filter(k =>
                    String(k.tarih || '').trim().replace(/\//g, '.') === programNorm
                ).length;
                const tamDet = kosular.filter(hasFullDetail).length;
                let note = '';
                if (ham === 0) note = 'veri yok';
                else if (ham < FETCH_MAX_DETAIL) note = 'TJK≤' + ham + ' veya eksik çekim';
                else if (ham === FETCH_MAX_DETAIL) note = '=7 tam detay limiti';
                else if (ham > FETCH_MAX_DETAIL && ham < FETCH_MAX_ALL) note = '7+ hafif ek koşu';
                else if (ham >= FETCH_MAX_ALL) note = '40 tavan';

                console.log('  ' + pad(String(h.no), 4) + pad(normName(h.name).slice(0, 22), 24)
                    + pad(String(ham), 6) + pad(String(progExcluded), 6)
                    + pad(tamDet >= FETCH_MAX_DETAIL ? '✓' : String(tamDet), 6)
                    + pad(String(tamDet), 7) + note);
                allCounts.push(ham);
            }
            console.log('');
        }

        if (allCounts.length) {
            const min = Math.min(...allCounts);
            const max = Math.max(...allCounts);
            const eq7 = allCounts.filter(n => n === 7).length;
            const lt7 = allCounts.filter(n => n > 0 && n < 7).length;
            const gt7 = allCounts.filter(n => n > 7).length;
            const zero = allCounts.filter(n => n === 0).length;
            console.log('ÖZET (' + allCounts.length + ' at):');
            console.log('  ham[] min=' + min + ' max=' + max + ' · ort=' + (allCounts.reduce((a, b) => a + b, 0) / allCounts.length).toFixed(1));
            console.log('  tam 7 koşu: ' + eq7 + ' at · 7\'den az: ' + lt7 + ' · 7\'den fazla: ' + gt7 + ' · kosular=0: ' + zero);
            if (eq7 === allCounts.length - zero && zero === 0) {
                console.log('\n  → Evet: bu kayıtta her at için ham[]=7 (GETİR tam detay limiti).');
            } else if (eq7 > 0) {
                console.log('\n  → Karışık: çoğu at 7; kariyeri kısa olanlar veya eski kayıtlar farklı olabilir.');
            }
        }
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
