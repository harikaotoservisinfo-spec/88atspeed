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
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
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
    console.log('  ' + pad('#', 4) + pad('AT İSMİ', 22) + pad('HEDEF', 8) + pad('BAŞ+', 7)
        + pad('TÜM', 5) + pad(hedefAbbrev, 6) + pad('ŞEH%', 6) + pad('Ş-FORM', 8) + pad('ŞEH+', 7)
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
            + pad((a.st.basSuccess && a.st.basSuccess.display) || '—', 7)
            + pad(String(a.validSehir), 5)
            + pad(String(a.inCity), 6)
            + pad(a.sehirPct != null ? a.sehirPct + '%' : '—', 6)
            + pad((a.st.formTrend && a.st.formTrend.display) || '—', 8)
            + pad((a.st.sehirAdj && a.st.sehirAdj.display) || '—', 7)
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

function runKafkasFixture() {
    const kafkas = [
        { tarih: '29.08.2026', sehir: 'İzmir', sira: '1' },
        { tarih: '16.08.2026', sehir: 'İstanbul', sira: '3' },
        { tarih: '07.08.2026', sehir: 'İstanbul', sira: '8' },
        { tarih: '26.07.2026', sehir: 'İstanbul', sira: '2' },
        { tarih: '17.07.2026', sehir: 'İstanbul', sira: '5' },
        { tarih: '13.05.2026', sehir: 'İstanbul', sira: '8' },
        { tarih: '26.04.2026', sehir: 'İstanbul', sira: '6' }
    ];
    const st = SehirStatsEngine.computeStats(kafkas, 'İzmir', '29/08/2026');
    console.log('KAFKAS YÜREKLİ fixture (program günü hariç, hedef İzmir):');
    console.log('  ŞEH: inCity=' + st.inCityCount + ' cnt1-4='
        + [st.cnt1, st.cnt2, st.cnt3, st.cnt4].join('/') + ' ŞEH+=' + (st.sehirAdj?.display || '—'));
    console.log('  GEN: genBase=' + st.genBasePct + '% gen1-4='
        + [st.genCnt1, st.genCnt2, st.genCnt3, st.genCnt4].join('/')
        + ' GEN+=' + (st.genAdj?.display || '—') + ' G-FORM=' + (st.genForm?.display || '—'));
    console.log('  BAŞ+: ' + (st.basSuccess?.display || '—')
        + ' (güven %' + Math.round((st.basSuccess?.cityTrust || 0) * 100) + ')');
    const ok = st.inCityCount === 0
        && st.cnt1 === 0 && st.cnt2 === 0 && st.cnt3 === 0 && st.cnt4 === 0
        && st.genCnt2 >= 1 && st.genCnt3 >= 1
        && st.genBasePct != null && st.genBasePct > 40
        && st.genAdj?.pct != null && st.genAdj.pct > 0
        && st.basSuccess?.pct != null && st.basSuccess.pct > 40
        && st.basSuccess.cityTrust === 0;
    console.log('  ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
}

function runSehirAdjFixture() {
    const cases = [
        {
            name: 'BY MUTLU tipi (ŞEH67 FORM98)',
            kosular: [
                { tarih: '01.08.2026', sehir: 'İzmir', sira: '2' },
                { tarih: '02.07.2026', sehir: 'İzmir', sira: '3' },
                { tarih: '03.06.2026', sehir: 'Ankara', sira: '5' },
                { tarih: '04.05.2026', sehir: 'İzmir', sira: '2' },
                { tarih: '05.04.2026', sehir: 'İzmir', sira: '4' },
                { tarih: '06.03.2026', sehir: 'Bursa', sira: '6' }
            ],
            expect: st => st.sehirPct === 67 && st.formTrend?.pct > 55 && st.sehirAdj?.pct > st.sehirPct
        },
        {
            name: 'BRAVE tipi (ŞEH100 FORM6)',
            kosular: [
                { tarih: '01.08.2026', sehir: 'İzmir', sira: '8' },
                { tarih: '02.07.2026', sehir: 'İzmir', sira: '4' },
                { tarih: '03.06.2026', sehir: 'İzmir', sira: '1' },
                { tarih: '04.05.2026', sehir: 'İzmir', sira: '2' },
                { tarih: '05.04.2026', sehir: 'İzmir', sira: '2' },
                { tarih: '06.03.2026', sehir: 'İzmir', sira: '1' }
            ],
            expect: st => st.sehirPct === 100 && st.formTrend?.pct < 20
                && st.sehirAdj?.formAdj < 0 && st.sehirAdj?.lastCityAdj === 8
        },
        {
            name: 'FORM yok ceza (ŞEH17)',
            kosular: [
                { tarih: '01.08.2026', sehir: 'Ankara', sira: '5' },
                { tarih: '02.07.2026', sehir: 'Bursa', sira: '6' },
                { tarih: '03.06.2026', sehir: 'Ankara', sira: '7' },
                { tarih: '04.05.2026', sehir: 'Bursa', sira: '8' },
                { tarih: '05.04.2026', sehir: 'İzmir', sira: '1' },
                { tarih: '06.03.2026', sehir: 'Ankara', sira: '9' }
            ],
            expect: st => st.sehirPct === 17 && st.formTrend?.pct == null && st.sehirAdj?.pct < st.sehirPct
        },
        {
            name: 'Son koşu Bursa → İzmir ceza',
            kosular: [
                { tarih: '01.08.2026', sehir: 'Bursa', sira: '5' },
                { tarih: '02.07.2026', sehir: 'İzmir', sira: '4' },
                { tarih: '03.06.2026', sehir: 'İzmir', sira: '3' }
            ],
            expect: st => st.sehirAdj?.lastCityAdj === -10 && !st.sehirAdj?.lastCity?.inTarget
        },
        {
            name: 'Son koşu İzmir → İzmir ödül',
            kosular: [
                { tarih: '01.08.2026', sehir: 'İzmir', sira: '4' },
                { tarih: '02.07.2026', sehir: 'Bursa', sira: '6' },
                { tarih: '03.06.2026', sehir: 'İzmir', sira: '2' }
            ],
            expect: st => st.sehirAdj?.lastCityAdj === 8 && st.sehirAdj?.lastCity?.inTarget === true
        }
    ];

    console.log('ŞEH+ fixture:');
    let ok = true;
    for (const c of cases) {
        const st = SehirStatsEngine.computeStats(c.kosular, 'İzmir', null);
        const pass = c.expect(st);
        console.log('  ' + c.name + ': ŞEH%=' + st.sehirPct + ' FORM=' + (st.formTrend?.display || '—')
            + ' ŞEH+=' + (st.sehirAdj?.display || '—')
            + (st.sehirAdj?.lastCityAdj ? ' sonŞehir=' + st.sehirAdj.lastCityAdj : '')
            + ' · ' + (pass ? 'OK' : 'HATA'));
        if (!pass) ok = false;
    }

    const izmirLast = [
        { tarih: '01.08.2026', sehir: 'İzmir', sira: '5' },
        { tarih: '02.07.2026', sehir: 'İzmir', sira: '4' },
        { tarih: '03.06.2026', sehir: 'Ankara', sira: '6' }
    ];
    const bursaLast = [
        { tarih: '01.08.2026', sehir: 'Bursa', sira: '5' },
        { tarih: '02.07.2026', sehir: 'İzmir', sira: '4' },
        { tarih: '03.06.2026', sehir: 'İzmir', sira: '3' }
    ];
    const stIz = SehirStatsEngine.computeStats(izmirLast, 'İzmir', null);
    const stBu = SehirStatsEngine.computeStats(bursaLast, 'İzmir', null);
    if (!(stIz.sehirAdj?.pct > stBu.sehirAdj?.pct)) {
        console.log('  Son koşu İzmir vs Bursa karşılaştırma HATA: '
            + stIz.sehirAdj?.display + ' vs ' + stBu.sehirAdj?.display);
        ok = false;
    } else {
        console.log('  Son koşu karşılaştırma: İzmi son=' + stIz.sehirAdj?.display
            + ' > Bursa son=' + stBu.sehirAdj?.display + ' · OK');
    }
    if (!ok) process.exit(1);
}

function runBasSuccessFixture() {
    const kafkas = [
        { tarih: '29.08.2026', sehir: 'İzmir', sira: '1' },
        { tarih: '16.08.2026', sehir: 'İstanbul', sira: '3' },
        { tarih: '07.08.2026', sehir: 'İstanbul', sira: '8' },
        { tarih: '26.07.2026', sehir: 'İstanbul', sira: '2' },
        { tarih: '17.07.2026', sehir: 'İstanbul', sira: '5' },
        { tarih: '13.05.2026', sehir: 'İstanbul', sira: '8' }
    ];
    const izmirVeteran = [
        { tarih: '01.08.2026', sehir: 'İzmir', sira: '2' },
        { tarih: '02.07.2026', sehir: 'İzmir', sira: '3' },
        { tarih: '03.06.2026', sehir: 'İzmir', sira: '4' },
        { tarih: '04.05.2026', sehir: 'İzmir', sira: '2' },
        { tarih: '05.04.2026', sehir: 'İzmir', sira: '1' },
        { tarih: '06.03.2026', sehir: 'İzmir', sira: '2' }
    ];
    const stK = SehirStatsEngine.computeStats(kafkas, 'İzmir', '29/08/2026');
    const stV = SehirStatsEngine.computeStats(izmirVeteran, 'İzmir', null);
    console.log('BAŞ+ fixture:');
    console.log('  KAFKAS (0 İzmir, genel form): BAŞ+=' + (stK.basSuccess?.display || '—')
        + ' · güven %' + Math.round((stK.basSuccess?.cityTrust || 0) * 100));
    console.log('  İzmir veteran (6/6): BAŞ+=' + (stV.basSuccess?.display || '—')
        + ' · güven %' + Math.round((stV.basSuccess?.cityTrust || 0) * 100));
    const ok = stK.basSuccess?.pct != null && stV.basSuccess?.pct != null
        && stK.basSuccess.cityTrust === 0
        && stV.basSuccess.cityTrust >= 0.9
        && stV.basSuccess.pct > stK.basSuccess.pct;
    console.log('  ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
}

function runDimScoringFixture() {
    const kosular = [
        { tarih: '01.08.2026', siklet: '59', sira: '2', at_sayisi: 10 },
        { tarih: '02.07.2026', siklet: '59', sira: '3', at_sayisi: 12 },
        { tarih: '03.06.2026', siklet: '57', sira: '5', at_sayisi: 11 },
        { tarih: '04.05.2026', siklet: '59', sira: '1', at_sayisi: 9 },
        { tarih: '05.04.2026', siklet: '58', sira: '4', at_sayisi: 10 },
        { tarih: '06.03.2026', siklet: '59', sira: '2', at_sayisi: 8 }
    ];
    const st = KosuDimensionStatsEngine.computeStats(kosular, 'siklet', '59', null);
    console.log('SİKLET scoring fixture (hedef 59 kg):');
    console.log('  SK%=' + st.matchPct + ' SK-KOŞU=' + st.matchCount
        + ' SK-FORM=' + (st.formTrend?.display || '—')
        + ' SK+=' + (st.dimAdj?.display || '—')
        + ' BAŞ+=' + (st.basSuccess?.display || '—'));
    console.log('  cnt1-4=' + [st.cnt1, st.cnt2, st.cnt3, st.cnt4].join('/')
        + ' GEN+=' + (st.genAdj?.display || '—'));
    const ok = st.matchCount === 4 && st.cnt1 === 1 && st.cnt2 === 2
        && st.dimAdj?.pct != null && st.basSuccess?.pct != null
        && st.formTrend?.pct != null;
    console.log('  ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
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
        + ' · inCity=' + st.inCityCount + ' · Ş-FORM=' + (st.formTrend?.display || '—')
        + ' · ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
}

function runFormTrendFixture() {
    const improving = [
        { tarih: '05.08.2026', sehir: 'İzmir', sira: '2' },
        { tarih: '04.07.2026', sehir: 'İzmir', sira: '4' },
        { tarih: '03.06.2026', sehir: 'Ankara', sira: '6' },
        { tarih: '02.05.2026', sehir: 'İzmir', sira: '7' },
        { tarih: '01.04.2026', sehir: 'İzmir', sira: '8' }
    ];
    const declining = [
        { tarih: '05.08.2026', sehir: 'İzmir', sira: '8' },
        { tarih: '04.07.2026', sehir: 'İzmir', sira: '9' },
        { tarih: '03.06.2026', sehir: 'İzmir', sira: '1' },
        { tarih: '02.05.2026', sehir: 'İzmir', sira: '1' },
        { tarih: '01.04.2026', sehir: 'İzmir', sira: '2' }
    ];
    const imp = SehirStatsEngine.computeStats(improving, 'İzmir', null).formTrend;
    const dec = SehirStatsEngine.computeStats(declining, 'İzmir', null).formTrend;
    console.log('Form trend fixture:');
    console.log('  4→2 iyileşen: ' + (imp?.display || '—') + ' (>' + (dec?.pct ?? 0) + ' olmalı)');
    console.log('  2→1→1→9→8 düşen: ' + (dec?.display || '—'));
    const ok = imp?.pct != null && dec?.pct != null && imp.pct > dec.pct && imp.pct > 50 && dec.pct < 50;
    console.log('  ' + (ok ? 'OK' : 'HATA'));
    if (!ok) process.exit(1);
}

async function main() {
    loadEngines();
    if (args.includes('--fixture-dim-siklet')) {
        runDimScoringFixture();
        return;
    }
    if (args.includes('--fixture-bas')) {
        runBasSuccessFixture();
        return;
    }
    if (args.includes('--fixture-gerard')) {
        runGerardFixture();
        return;
    }
    if (args.includes('--fixture-form')) {
        runFormTrendFixture();
        return;
    }
    if (args.includes('--fixture-kafkas')) {
        runKafkasFixture();
        return;
    }
    if (args.includes('--fixture-sehir-adj')) {
        runSehirAdjFixture();
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
