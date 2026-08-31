#!/usr/bin/env node
/**
 * ŞEHİR sekmesi — koşu bazlı veri raporu (UI ile aynı engine)
 * Her at: toplam geçmiş koşu + hedef şehirde kaç koşu
 *
 *   node scripts/test-sehir-tab-race.js --kayit 148 --race 1
 *   node scripts/test-sehir-tab-race.js --kayit 148
 *   node scripts/test-sehir-tab-race.js --kayit 148 --race 1 --horse "KUZEYİN KRALI" -v
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    openDb,
    dbAll,
    rowKeyParts,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 148,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseFilter: argVal('--horse') || null,
    verbose: args.includes('-v') || args.includes('--verbose')
};

function loadEngines() {
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8')
        + '\n; global.SehirStatsEngine = SehirStatsEngine;');
}

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function horseBitis(name) {
    const m = String(name || '').match(/\((\d+)\)\s*$/);
    return m ? Number(m[1]) : null;
}

function auditHorse(kosular, hedefSehir, programTarih) {
    const raw = kosular || [];
    const calc = FieldSizeStatsEngine.filterKosularForCalc(raw, programTarih);
    const st = SehirStatsEngine.computeStats(raw, hedefSehir, programTarih);
    const stCalc = SehirStatsEngine.computeStats(calc, hedefSehir, programTarih);
    const inCityList = SehirStatsEngine.inCityRaces(calc, hedefSehir);
    return {
        rawLen: raw.length,
        calcLen: calc.length,
        programExcluded: raw.length - calc.length,
        validSehir: stCalc.kosuSayisi,
        inCity: stCalc.inCityCount,
        sehirPct: stCalc.sehirPct,
        missingSehir: stCalc.missingSehir,
        hedefAbbrev: SehirStatsEngine.abbrevSehir(hedefSehir),
        gecmisSehir: stCalc.gecmisSehirStr,
        gecmisMatch: stCalc.gecmisMatchStr,
        inCityList,
        st: stCalc
    };
}

function printRace(kayit, race, programTarih) {
    const hedefSehir = kayit.hipodrom || '';
    const hedefAbbrev = SehirStatsEngine.abbrevSehir(hedefSehir);
    const horses = [...(race.horses || [])].sort((a, b) => Number(a.no) - Number(b.no));
    const filter = cli.horseFilter ? normName(cli.horseFilter) : null;

    console.log('\n── K' + race.raceNo + ' · ' + (race.mesafe || '?') + ' · '
        + horses.length + ' at · hedef: ' + hedefSehir + ' ──');
    console.log('  Program: ' + programTarih + ' · hesap geçmişi: program günü hariç');
    console.log('  ' + pad('#', 4) + pad('AT İSMİ', 22) + pad('HEDEF', 8)
        + pad('TÜM', 5) + pad(hedefAbbrev, 6) + pad('ŞEH%', 6)
        + pad('1.', 4) + pad('1-2', 4) + pad('1-3', 4) + pad('1-4', 4)
        + pad('ham[]', 6) + 'GEÇMİŞ ŞEHİR');
    console.log('  ' + '-'.repeat(88));

    for (const h of horses) {
        if (filter && !normName(h.name).includes(filter)) continue;
        const kosular = h.kosular || [];
        const a = auditHorse(kosular, hedefSehir, programTarih);
        const bitis = horseBitis(h.name);
        const bitMark = bitis === 1 ? '★' : (bitis && bitis <= 3 ? '◆' : '·');

        console.log('  ' + pad(String(h.no), 4) + pad((h.name || '').replace(/\(\d+\)/, '').trim().slice(0, 20), 22)
            + pad(a.hedefAbbrev, 8)
            + pad(String(a.validSehir), 5)
            + pad(String(a.inCity), 6)
            + pad(a.sehirPct != null ? a.sehirPct + '%' : '—', 6)
            + pad(String(a.st.cnt1), 4)
            + pad(String(a.st.cnt2 ?? 0), 4)
            + pad(String(a.st.cnt3 ?? 0), 4)
            + pad(String(a.st.cnt4 ?? 0), 4)
            + pad(String(a.rawLen), 6)
            + (a.gecmisSehir || '—').slice(0, 28)
            + ' ' + bitMark + (bitis ?? ''));

        if (cli.verbose) {
            console.log('      ham kosular[]=' + a.rawLen
                + ' · program hariç=' + a.calcLen
                + (a.programExcluded ? ' (bugün çıkarıldı=' + a.programExcluded + ')' : ''));
            if (a.inCityList.length) {
                console.log('      ' + hedefAbbrev + ' koşuları (' + a.inCityList.length + '):');
                for (const k of a.inCityList.slice(0, 8)) {
                    console.log('        ' + pad(k.tarih || '?', 12) + pad(k.sehir || '?', 10)
                        + pad(String(k.mesafe || '?'), 6) + 'sira=' + (k.sira ?? '—')
                        + ' fs=' + (k.at_sayisi ?? '—'));
                }
                if (a.inCityList.length > 8) console.log('        ... +' + (a.inCityList.length - 8));
            } else {
                console.log('      ⚠ Hedef şehirde geçmiş koşu yok');
            }
            if (a.missingSehir > 0) {
                console.log('      ⚠ ' + a.missingSehir + ' koşuda sehir alanı boş');
            }
        }
    }

    console.log('\n  Sütunlar: 1.=1.lik · 1-2=2.lik · 1-3=3.lük · 1-4=4.lük adet (hedef şehirde, kümülatif değil)');
}

function runGerardFixture() {
    const gerardKosular = [
        { tarih: '29.08.2026', sehir: 'İzmir', mesafe: '2000', sira: '5', at_sayisi: 9 },
        { tarih: '09.08.2026', sehir: 'İzmir', mesafe: '1400', sira: '7', at_sayisi: 15 },
        { tarih: '14.06.2026', sehir: 'İzmir', mesafe: '1600', sira: '7', at_sayisi: 12 },
        { tarih: '06.06.2026', sehir: 'İzmir', mesafe: '1900', sira: '9', at_sayisi: 7 },
        { tarih: '21.05.2026', sehir: 'İzmir', mesafe: '2000', sira: '4', at_sayisi: 9 },
        { tarih: '09.05.2026', sehir: 'İzmir', mesafe: '1900', sira: '9', at_sayisi: 8 }
    ];
    const st = SehirStatsEngine.computeStats(gerardKosular, 'İzmir', '29.08.2026');
    const ok = st.cnt1 === 0 && st.cnt2 === 0 && st.cnt3 === 0 && st.cnt4 === 1 && st.inCityCount === 5;
    console.log('GERARD fixture (TJK İzmir, program günü hariç):');
    console.log('  cnt1=' + st.cnt1 + ' cnt2=' + st.cnt2 + ' cnt3=' + st.cnt3 + ' cnt4=' + st.cnt4
        + ' · inCity=' + st.inCityCount + ' · ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
}

async function main() {
    loadEngines();
    if (args.includes('--fixture-gerard')) {
        runGerardFixture();
        return;
    }
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
        console.log('║  ŞEHİR sekmesi — koşu / hedef şehir veri raporu                   ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt #' + kayit.id + ' · ' + kayit.tarih + ' · 🏟️ ' + kayit.hipodrom);
        console.log('Hedef hipodrom = HEDEF sütunu · TÜM = geçmişte şehir bilgili koşu sayısı');
        console.log('Ş-KOŞU (UI) = ' + SehirStatsEngine.abbrevSehir(kayit.hipodrom) + ' sütunu = hedef şehirde koşu');

        for (const race of races) {
            printRace(kayit, race, kayit.tarih);
        }
        console.log('');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
