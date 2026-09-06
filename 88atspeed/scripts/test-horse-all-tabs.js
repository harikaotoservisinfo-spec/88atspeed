#!/usr/bin/env node
/**
 * Tek at — tüm gösterge sekmeleri alan doluluk + UI ile aynı istatistik
 *
 *   node scripts/test-horse-all-tabs.js --db atlar.db --kayit 148 --race 7 --horse PATARA
 *   node scripts/test-horse-all-tabs.js --db atlar.db --kayit 148 --race 7 --horse PATARA --live
 */
const fs = require('fs');
const path = require('path');
const { openDb, dbGet } = require('./ptest-terminal-lib');
const {
    launchBrowser,
    fetchAtKosularFromPage,
    evaluateKosuKayit
} = require('../lib/tjk-scrape');

const args = process.argv.slice(2);
function argVal(flag) {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseName: argVal('--horse') || '',
    horseNo: argVal('--no') ? Number(argVal('--no')) : null,
    atId: argVal('--at-id') || '',
    live: args.includes('--live'),
    maxKosu: Number(argVal('--max-kosu') || '7')
};

const KOSU_CHECK = [
    'tarih', 'sehir', 'mesafe', 'sira', 'at_sayisi', 'siklet', 'taki', 'hp',
    'pist', 'pist_kosu', 'kcins_kosu', 'at_derece', 'son800_bir'
];

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function filled(v) {
    return v != null && v !== '' && v !== '-' && v !== '—';
}

function pad(s, n) {
    return String(s ?? '—').slice(0, n).padEnd(n);
}

function loadEngines() {
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/sehir-stats-engine.js'), 'utf8')
        + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

async function loadHorseFromDb() {
    if (!cli.kayitId) return null;
    const db = openDb(cli.dbPath);
    try {
        const row = await dbGet(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
        if (!row?.veri) return null;
        const races = JSON.parse(row.veri);
        const targetName = normName(cli.horseName);
        for (const race of races) {
            const rn = Number(race.raceNo);
            if (cli.raceNo && rn !== cli.raceNo) continue;
            for (const h of race.horses || []) {
                if (cli.atId && String(h.atId) !== String(cli.atId)) continue;
                if (cli.horseNo && Number(h.no) !== cli.horseNo) continue;
                if (cli.horseName && !normName(h.name).includes(targetName) && normName(h.name) !== targetName) continue;
                if (!cli.atId && !cli.horseNo && !cli.horseName) continue;
                return {
                    kayitId: row.id,
                    hipodrom: row.hipodrom,
                    tarih: row.tarih,
                    race,
                    horse: h
                };
            }
        }
        return null;
    } finally {
        db.close();
    }
}

function auditKosular(kosular, label) {
    console.log('\n── kosular[] alan doluluk: ' + label + ' (' + kosular.length + ' koşu) ──');
    if (!kosular.length) {
        console.log('  ✗ kosular[] boş');
        return;
    }
    for (const f of KOSU_CHECK) {
        let n = 0;
        for (const k of kosular) {
            if (f === 'at_sayisi' ? Number(k.at_sayisi) > 0 : filled(k[f])) n++;
        }
        const pct = kosular.length ? Math.round(1000 * n / kosular.length) / 10 : 0;
        const ok = pct >= 95;
        console.log('  ' + (ok ? '✓' : '△') + ' ' + pad(f, 14) + n + '/' + kosular.length + ' (' + pct + '%)');
    }
    console.log('\n  Son ' + Math.min(7, kosular.length) + ' koşu:');
    console.log('  ' + pad('tarih', 12) + pad('S', 4) + pad('fs', 5) + pad('sk', 5)
        + pad('taki', 12) + pad('hp', 5) + pad('pist', 8) + 'kcins_kosu');
    for (const k of kosular.slice(0, cli.maxKosu)) {
        console.log('  ' + pad(k.tarih, 12) + pad(k.sira, 4) + pad(k.at_sayisi, 5)
            + pad(k.siklet, 5) + pad((k.taki || '').slice(0, 10), 12)
            + pad(k.hp, 5) + pad(k.pist || k.pist_kosu, 8)
            + String(k.kcins_kosu || '—').slice(0, 24));
    }
}

function explainMax(st, label) {
    const parts = [];
    if (st.atSayisiMissing > 0) parts.push('at_sayisi eksik=' + st.atSayisiMissing);
    if (st.fieldSizeMissingOnMatch > 0) parts.push('eşleşmede fs eksik=' + st.fieldSizeMissingOnMatch);
    if (st.max1 == null && st.cnt1 === 0) parts.push('MAX-1 boş: hiç 1.lik yok (veri değil)');
    if (st.max12 == null && st.cnt12 === 0 && st.matchCount > 0) parts.push('MAX-12 boş: 1-2 yok');
    return parts.length ? parts.join(' · ') : 'OK';
}

function printTabStats(kosular, horse, race, hipodrom, programTarih) {
    const horseCtx = Object.assign({}, horse, { kosular });
    const hm = AtMetaFields.extractHorseMeta(horseCtx);
    const rm = AtMetaFields.extractRaceMeta(race);

    console.log('\n── Program HEDEF meta ──');
    console.log('  hipodrom   : ' + (hipodrom || '—'));
    if (programTarih) console.log('  program    : ' + programTarih + ' (MAX geçmişten hariç)');
    console.log('  race pist  : ' + rm.pist + ' · kcins: ' + rm.kcins_kosu);
    console.log('  horse taki : ' + hm.taki + ' · hp: ' + hm.hp + ' · siklet: ' + hm.siklet);

    const tabs = [
        {
            label: 'AT SAYISI',
            st: FieldSizeStatsEngine.computeStats(kosular, programTarih),
            hedef: '—',
            dim: null
        },
        {
            label: 'ŞEHİR',
            st: SehirStatsEngine.computeStats(kosular, hipodrom, programTarih),
            hedef: hipodrom,
            dim: null
        }
    ];
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        tabs.push({
            label: dim.label,
            st: KosuDimensionStatsEngine.computeStats(
                kosular, key, dim.getTarget(horseCtx, race), programTarih),
            hedef: dim.getTarget(horseCtx, race),
            dim: key
        });
    }

    console.log('\n── Sekme istatistikleri (UI ile aynı engine) ──');
    console.log('  ' + pad('Sekme', 12) + pad('HEDEF', 14) + pad('KOŞU', 6)
        + pad('EŞLEŞ', 6) + pad('MAX-1', 6) + pad('MAX-12', 6) + pad('1.', 4)
        + pad('1-2', 4) + 'Not');
    for (const t of tabs) {
        const st = t.st;
        const pct = st.matchPct != null ? '%' + st.matchPct : (st.sehirPct != null ? '%' + st.sehirPct : '—');
        const matchN = st.matchCount != null ? st.matchCount : (st.inCityCount != null ? st.inCityCount : st.kosuSayisi);
        console.log('  ' + pad(t.label, 12) + pad(String(t.hedef || '—').slice(0, 12), 14)
            + pad(st.kosuSayisi ?? st.kosuSayisiSira ?? '—', 6)
            + pad(matchN + (t.label !== 'AT SAYISI' ? ' ' + pct : ''), 6)
            + pad(st.max1 ?? '—', 6) + pad(st.max12 ?? '—', 6)
            + pad(st.cnt1 ?? '—', 4) + pad(st.cnt12 ?? '—', 4)
            + explainMax(st, t.label));
    }

    console.log('\n── Son 5 koşu pencere (S5) — TAKİ örneği ──');
    const takiSt = KosuDimensionStatsEngine.computeStats(kosular, 'taki', hm.taki, programTarih);
    const w5 = takiSt.windows?.[5];
    if (w5) {
        console.log('  TK-KOŞU=' + w5.matchCount + ' · MAX-1=' + (w5.max1 ?? '—')
            + ' · MAX-1234=' + (w5.max1234 ?? '—') + ' · 1.=' + w5.cnt1);
        console.log('  GEÇMİŞ: ' + (w5.gecmisValStr || '—'));
        console.log('  EŞLEŞME: ' + (w5.gecmisMatchStr || '—'));
    }
}

async function main() {
    loadEngines();
    let ctx = await loadHorseFromDb();
    if (!ctx && cli.atId) {
        ctx = {
            kayitId: cli.kayitId,
            hipodrom: '',
            tarih: '',
            race: { pist: '?', kcins_kosu: '' },
            horse: { atId: cli.atId, name: cli.horseName || cli.atId, kosular: [] }
        };
    }
    if (!ctx) {
        console.error('At bulunamadı. Örnek:');
        console.error('  node scripts/test-horse-all-tabs.js --db atlar.db --kayit 148 --race 7 --horse PATARA');
        process.exit(1);
    }

    const { horse, race, hipodrom, kayitId, tarih } = ctx;
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Tek at — tüm sekmeler teşhis                                   ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('Kayıt  : #' + kayitId + ' · ' + hipodrom + ' · ' + tarih);
    console.log('Koşu   : K' + race.raceNo + ' · ' + AtMetaFields.formatRaceHeaderShort(race));
    console.log('At     : #' + horse.no + ' ' + horse.name + ' · atId=' + horse.atId);

    const dbKosular = horse.kosular || [];
    auditKosular(dbKosular, 'DB kayıtlı');

    if (cli.live && horse.atId) {
        console.log('\n⏳ TJK canlı fetch (--live)…');
        const browser = await launchBrowser();
        const page = await browser.newPage();
        try {
            const res = await fetchAtKosularFromPage(page, horse.atId, horse.name, {
                maxKosu: cli.maxKosu,
                maxRetry: 1,
                fetchAllFieldSizes: false
            });
            if (res.success && res.kosular?.length) {
                auditKosular(res.kosular, 'TJK canlı');
                console.log('\n── Canlı vs DB ──');
                const dbFs = dbKosular.filter(k => Number(k.at_sayisi) > 0).length;
                const liveFs = res.kosular.filter(k => Number(k.at_sayisi) > 0).length;
                console.log('  DB at_sayisi   : ' + dbFs + '/' + dbKosular.length);
                console.log('  Canlı at_sayisi: ' + liveFs + '/' + res.kosular.length);
            } else {
                console.log('  ✗ Canlı fetch başarısız: ' + (res.error || 'boş'));
            }
        } finally {
            await browser.close();
        }
    }

    printTabStats(dbKosular, horse, race, hipodrom, tarih);

    console.log('\n── Özet ──');
    const fsOk = dbKosular.filter(k => Number(k.at_sayisi) > 0).length;
    const metaOk = dbKosular.filter(k => filled(k.taki) && filled(k.siklet)).length;
    if (!dbKosular.length) {
        console.log('  ✗ kosular[] boş — repair veya GETİR gerekli');
    } else if (fsOk < dbKosular.length * 0.8) {
        console.log('  △ at_sayisi eksik (' + fsOk + '/' + dbKosular.length + ') — MAX-* kısmen boş kalır');
    } else if (metaOk < dbKosular.length * 0.8) {
        console.log('  △ taki/siklet eksik — TAKİ/SİKLET sekmesi zayıf');
    } else {
        console.log('  ✓ Veri dolu — MAX-* boşsa çoğunlukla at hiç 1./2. bitmemiş (normal)');
        console.log('    Örn. PATARA: TK%29, MAX-1234=10 var, MAX-1=— çünkü cnt1=0');
    }
    console.log('');
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
