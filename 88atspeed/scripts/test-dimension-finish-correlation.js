#!/usr/bin/env node
/**
 * Test sekmeleri (AT SAYISI, ŞEHİR, KCİNS, TAKİ, PİST, HP, SİKLET) ↔ BİTİŞ korelasyon raporu
 *
 * Her boyut için:
 *  - Koşu lideri: alan içinde en yüksek göstergeye sahip atın gerçek bitişi (80/12/8 karışık)
 *  - Bucket: yüksek gösterge grubunun 1./1-2/1-3 oranları
 *  - Mevcut TAHMİN (hybrid) ile karşılaştırma
 *
 *   node scripts/test-dimension-finish-correlation.js --db atlar.db
 *   node scripts/test-dimension-finish-correlation.js --field-size 10 --verbose
 *   node scripts/test-dimension-finish-correlation.js --kayit 133 --race 6 -v
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    buildEntriesByFieldSize,
    rowKeyParts,
    openDb,
    dbAll,
    pct,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
    minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 8,
    minRaces: argVal('--min-races') ? Number(argVal('--min-races')) : 5,
    verbose: args.includes('--verbose') || args.includes('-v'),
    engine: (argVal('--engine') || 'hybrid').toLowerCase()
};

const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }

function loadAllEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8')
        + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8')
        + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8')
        + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function blendedFromCounts(total, b1, b12, b123) {
    if (!total) return 0;
    const blend = SUCCESS_BLEND;
    return blend.b1 * (b1 / total) + blend.b12 * (b12 / total) + blend.b123 * (b123 / total);
}

function blendedFromStats(stats) {
    const t = stats.withBitis || 0;
    if (!t) return 0;
    return blendedFromCounts(t, stats.b1, stats.b12, stats.b123);
}

async function loadRawHorseLookup(db) {
    const lookup = new Map();
    let kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
    if (cli.kayitId) kayitlar = kayitlar.filter(k => Number(k.id) === cli.kayitId);
    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) { continue; }
        if (!Array.isArray(races)) continue;
        for (let i = 0; i < races.length; i++) {
            const race = races[i];
            const raceNo = race.raceNo || (i + 1);
            if (cli.raceNo && Number(raceNo) !== cli.raceNo) continue;
            for (const horse of race.horses || []) {
                const key = rowKeyParts(kayit.id, raceNo, horse.no);
                lookup.set(key, { horse, race, hipodrom: kayit.hipodrom, tarih: kayit.tarih });
            }
        }
    }
    return lookup;
}

function computeDimensionBundle(raw) {
    const kosular = raw?.horse?.kosular || [];
    const horse = raw?.horse || {};
    const race = raw?.race || {};
    const hipodrom = raw?.hipodrom || '';
    const horseCtx = Object.assign({}, horse, { kosular });
    const dims = KosuDimensionStatsEngine.DIMENSIONS;
    const out = {
        fieldSize: FieldSizeStatsEngine.computeStats(kosular),
        sehir: SehirStatsEngine.computeStats(kosular, hipodrom)
    };
    for (const key of Object.keys(dims)) {
        const dim = dims[key];
        const hedef = dim.getTarget(horseCtx, race);
        out[key] = KosuDimensionStatsEngine.computeStats(kosular, key, hedef);
        out[key]._hedef = hedef;
    }
    out._kosuCount = kosular.length;
    return out;
}

function attachDimensionStats(flatEntries, lookup) {
    let hit = 0;
    for (const entry of flatEntries) {
        const key = rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no);
        const raw = lookup.get(key);
        if (!raw) continue;
        entry._dimRaw = raw;
        entry._dim = computeDimensionBundle(raw);
        hit++;
    }
    return hit;
}

function filterEntries(entries) {
    let out = entries;
    if (cli.kayitId) out = out.filter(e => Number(e.kayitId) === cli.kayitId);
    if (cli.raceNo) out = out.filter(e => Number(e.raceNo) === cli.raceNo);
    if (cli.fieldSize) {
        const byRace = new Map();
        for (const e of out) {
            const rk = String(e.kayitId) + '|' + e.raceNo;
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(e);
        }
        out = [];
        for (const [, g] of byRace) {
            if (g.length === cli.fieldSize) out.push(...g);
        }
    }
    return out.filter(e => e._dim);
}

function buildRaceGroups(entries) {
    const map = new Map();
    for (const e of entries) {
        const rk = String(e.kayitId) + '|' + e.raceNo;
        if (!map.has(rk)) map.set(rk, []);
        map.get(rk).push(e);
    }
    return [...map.values()];
}

function getMetric(entry, groupKey, metricKey) {
    const g = entry._dim?.[groupKey];
    if (!g) return null;
    const v = g[metricKey];
    if (v == null || v === '' || v === '—') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function evaluateRaceLeader(raceGroups, getScore, host, opts) {
    opts = opts || {};
    let leaderTotal = 0;
    let b1 = 0, b12 = 0, b123 = 0;
    let exactMatch = 0;
    const raceDetails = [];

    for (const entries of raceGroups) {
        const scored = entries.map(e => ({ entry: e, score: getScore(e) }))
            .filter(s => s.score != null);
        if (scored.length < 2) continue;

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0);
        });

        const leader = scored[0].entry;
        const bitis = host.bitisValueForSort(leader);
        if (bitis == null || bitis < 1) continue;

        leaderTotal++;
        if (bitis === 1) b1++;
        if (bitis <= 2) b12++;
        if (bitis <= 3) b123++;

        if (opts.collectDetails) {
            raceDetails.push({
                kayitId: leader.kayitId,
                raceNo: leader.raceNo,
                leaderName: leader.row?.name,
                leaderScore: scored[0].score,
                bitis,
                field: entries.length,
                runnerUp: scored[1]?.entry?.row?.name,
                runnerUpScore: scored[1]?.score
            });
        }
    }

    return {
        leaderTotal,
        b1, b12, b123,
        leaderBlended: blendedFromCounts(leaderTotal, b1, b12, b123),
        exactRate: leaderTotal ? b1 / leaderTotal : 0,
        raceDetails
    };
}

function evaluateBucket(entries, predicate, host) {
    const matched = entries.filter(predicate);
    const stats = host.buildBitisStatsFromEntries(matched);
    if ((stats.withBitis || 0) < cli.minSample) return null;
    return {
        matched: matched.length,
        stats,
        successRate: blendedFromStats(stats),
        b1Rate: stats.b1 / stats.withBitis,
        b12Rate: stats.b12 / stats.withBitis,
        b123Rate: stats.b123 / stats.withBitis
    };
}

function attachTahminLeader(raceGroups) {
    for (const entries of raceGroups) {
        const rows = entries.map(e => e.row);
        const pkg = {
            rows,
            depthCoverage: entries[0]?._pkg?.depthCoverage || null,
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null
        };
        if (cli.engine === 'hybrid') {
            HybridTahminScoringEngine.attachRaceTahmin(pkg);
        } else {
            GostergeScoringEngine.attachRaceTahmin(pkg);
        }
    }
}

function evaluateTahminLeader(raceGroups, host) {
    attachTahminLeader(raceGroups);
    return evaluateRaceLeader(raceGroups, e => e.row?.tahmin?.score ?? null, host);
}

function evaluateDimLeaderAgreesTahmin(raceGroups, getDimScore, host) {
    attachTahminLeader(raceGroups);
    let agreeTotal = 0;
    let agreeB1 = 0, agreeB12 = 0, agreeB123 = 0;

    for (const entries of raceGroups) {
        const dimScored = entries.map(e => ({ e, s: getDimScore(e) }))
            .filter(x => x.s != null);
        if (dimScored.length < 2) continue;
        dimScored.sort((a, b) => b.s - a.s || (a.e.row?.no ?? 0) - (b.e.row?.no ?? 0));
        const dimLeader = dimScored[0].e;

        const tahScored = entries.map(e => ({ e, s: e.row?.tahmin?.score }))
            .filter(x => x.s != null);
        if (!tahScored.length) continue;
        tahScored.sort((a, b) => b.s - a.s || (a.e.row?.no ?? 0) - (b.e.row?.no ?? 0));
        const tahLeader = tahScored[0].e;

        if (dimLeader.row?.no !== tahLeader.row?.no) continue;

        const bitis = host.bitisValueForSort(dimLeader);
        if (bitis == null || bitis < 1) continue;
        agreeTotal++;
        if (bitis === 1) agreeB1++;
        if (bitis <= 2) agreeB12++;
        if (bitis <= 3) agreeB123++;
    }

    return {
        leaderTotal: agreeTotal,
        leaderBlended: blendedFromCounts(agreeTotal, agreeB1, agreeB12, agreeB123),
        b1: agreeB1, b12: agreeB12, b123: agreeB123
    };
}

const METRIC_SPECS = [
    { group: 'fieldSize', key: 'max123', label: 'AT-SAYISI max123', desc: 'En geniş alanda 1-2-3 bitiren max field' },
    { group: 'fieldSize', key: 'max12', label: 'AT-SAYISI max12', desc: '1-2 bitiren max field' },
    { group: 'fieldSize', key: 'max1', label: 'AT-SAYISI max1', desc: '1. bitiren max field' },
    { group: 'fieldSize', key: 'cnt123', label: 'AT-SAYISI cnt123', desc: '1-2-3 bitirme sayısı' },
    { group: 'fieldSize', key: 'kosuSayisi', label: 'AT-SAYISI koşu', desc: 'Geçmiş koşu sayısı' },
    { group: 'sehir', key: 'sehirPct', label: 'ŞEHİR %', desc: 'Hedef hipodromda koşma oranı' },
    { group: 'sehir', key: 'inCityCount', label: 'ŞEHİR adet', desc: 'Hedef şehirdeki koşu sayısı' },
    { group: 'sehir', key: 'max123', label: 'ŞEHİR max123', desc: 'Hedef şehirde 1-2-3 max field' },
    { group: 'kcins_kosu', key: 'matchPct', label: 'KCİNS %', desc: 'Aynı koşu cinsinde koşma oranı' },
    { group: 'kcins_kosu', key: 'matchCount', label: 'KCİNS adet', desc: 'Aynı koşu cinsinde koşu sayısı' },
    { group: 'kcins_kosu', key: 'max123', label: 'KCİNS max123', desc: 'Eşleşen koşularda 1-2-3 max field' },
    { group: 'taki', key: 'matchPct', label: 'TAKİ %', desc: 'Aynı takı ile koşma oranı' },
    { group: 'taki', key: 'max123', label: 'TAKİ max123', desc: 'Eşleşen koşularda 1-2-3 max field' },
    { group: 'pist', key: 'matchPct', label: 'PİST %', desc: 'Aynı pistte koşma oranı' },
    { group: 'pist', key: 'max123', label: 'PİST max123', desc: 'Eşleşen pistte 1-2-3 max field' },
    { group: 'hp', key: 'matchPct', label: 'HP %', desc: 'Aynı HP ile koşma oranı' },
    { group: 'hp', key: 'max123', label: 'HP max123', desc: 'Eşleşen HP max field 1-2-3' },
    { group: 'siklet', key: 'matchPct', label: 'SİKLET %', desc: 'Aynı sıklet ile koşma oranı' },
    { group: 'siklet', key: 'max123', label: 'SİKLET max123', desc: 'Eşleşen sıklette 1-2-3 max field' }
];

const BUCKET_SPECS = [
    { group: 'fieldSize', key: 'max123', op: '>=', val: 8, label: 'max123≥8' },
    { group: 'fieldSize', key: 'max123', op: '>=', val: 10, label: 'max123≥10' },
    { group: 'sehir', key: 'sehirPct', op: '>=', val: 50, label: 'şehir%≥50' },
    { group: 'sehir', key: 'inCityCount', op: '>=', val: 3, label: 'şehir≥3 koşu' },
    { group: 'kcins_kosu', key: 'matchPct', op: '>=', val: 30, label: 'kcins%≥30' },
    { group: 'kcins_kosu', key: 'matchCount', op: '>=', val: 2, label: 'kcins≥2' },
    { group: 'taki', key: 'matchPct', op: '>=', val: 50, label: 'taki%≥50' },
    { group: 'pist', key: 'matchPct', op: '>=', val: 40, label: 'pist%≥40' },
    { group: 'hp', key: 'matchCount', op: '>=', val: 2, label: 'hp≥2 eşleşme' },
    { group: 'siklet', key: 'matchCount', op: '>=', val: 2, label: 'siklet≥2' }
];

function bucketPredicate(spec) {
    return (e) => {
        const v = getMetric(e, spec.group, spec.key);
        if (v == null) return false;
        if (spec.op === '>=') return v >= spec.val;
        if (spec.op === '>') return v > spec.val;
        return false;
    };
}

function printLeaderRow(rank, spec, result) {
    if (!result || result.leaderTotal < cli.minRaces) return;
    console.log('  ' + pad(String(rank) + '.', 4)
        + pad(spec.label, 18)
        + ' karışık ' + pad(pct(result.leaderBlended), 7)
        + ' · 1. ' + pad(pct(result.exactRate), 7)
        + ' · koşu ' + pad(String(result.leaderTotal), 4)
        + ' · ' + spec.desc);
}

function printBucketRow(spec, ev) {
    if (!ev) return;
    console.log('  ' + pad(spec.label, 18)
        + ' karışık ' + pad(pct(ev.successRate), 7)
        + ' · 1. ' + pad(pct(ev.b1Rate), 7)
        + ' · n=' + ev.stats.withBitis
        + ' (toplam ' + ev.matched + ' at)');
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Test sekmeleri ↔ BİTİŞ korelasyon raporu (TAHMİN planlama)     ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);
    if (cli.fieldSize) console.log('Filtre: ' + cli.fieldSize + ' atlı koşular');
    if (cli.kayitId) console.log('Kayıt #' + cli.kayitId + (cli.raceNo ? ' K' + cli.raceNo : ''));

    loadAllEngines();
    const db = openDb(cli.dbPath);

    try {
        const lookup = await loadRawHorseLookup(db);
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId,
            filterRace: cli.raceNo
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        const enriched = attachDimensionStats(flatEntries, lookup);

        let entries = filterEntries(flatEntries);
        const withBitis = entries.filter(e => host.bitisValueForSort(e) != null);
        const raceGroups = buildRaceGroups(withBitis);
        const racesWithBitis = raceGroups.filter(g => g.some(e => host.bitisValueForSort(e) != null)).length;

        hr('1. VERİ ÖZETİ');
        console.log('  Flat at satırı      : ' + flatEntries.length);
        console.log('  Boyut istat. dolu   : ' + enriched);
        console.log('  BİTİŞ bilgili at    : ' + withBitis.length);
        console.log('  Analiz koşusu       : ' + racesWithBitis);
        console.log('  BİTİŞ kaynağı       : puanlama_bitis_sonuclari + at adı (N) suffix');

        if (withBitis.length < cli.minSample) {
            console.log('\n⚠ Yeterli BİTİŞ verisi yok (min ' + cli.minSample + '). PUANLAMA TEST\'te bitiş girin.');
            return;
        }

        hr('2. KOŞU LİDERİ — hangi gösterge kazananı seçiyor?');
        console.log('  Her koşuda gösterge liderinin gerçek bitişi · karışık = 80%×1. + 12%×1-2 + 8%×1-3');
        sub('Baseline: mevcut TAHMİN (' + cli.engine + ')');
        const tahminBase = evaluateTahminLeader(raceGroups, host);
        console.log('  ' + pad('TAHMİN', 18) + ' karışık ' + pad(pct(tahminBase.leaderBlended), 7)
            + ' · 1. ' + pad(pct(tahminBase.exactRate), 7)
            + ' · koşu ' + tahminBase.leaderTotal);

        sub('Test sekmesi göstergeleri (yüksek = daha iyi tahmin)');
        const leaderResults = [];
        for (const spec of METRIC_SPECS) {
            const getScore = e => getMetric(e, spec.group, spec.key);
            const r = evaluateRaceLeader(raceGroups, getScore, host);
            leaderResults.push({ spec, ...r });
        }
        leaderResults.sort((a, b) => b.leaderBlended - a.leaderBlended);
        let rank = 1;
        for (const item of leaderResults) {
            printLeaderRow(rank++, item.spec, item);
        }

        hr('3. BUCKET — yüksek gösterge grubunun bitiş dağılımı');
        console.log('  Tüm atlar içinde koşu bazlı değil; gösterge eşiğini geçen atların BİTİŞ oranları');
        const allWithBitis = withBitis;
        const baseBucket = host.buildBitisStatsFromEntries(allWithBitis);
        console.log('  ' + pad('Tüm atlar (baz)', 18) + ' karışık ' + pad(pct(blendedFromStats(baseBucket)), 7)
            + ' · n=' + baseBucket.withBitis);
        for (const spec of BUCKET_SPECS) {
            printBucketRow(spec, evaluateBucket(allWithBitis, bucketPredicate(spec), host));
        }

        hr('4. TAHMİN + BOYUT UYUMU — ikisi aynı lideri seçince');
        console.log('  Boyut lideri = TAHMİN lideri olduğunda gerçek bitiş başarısı');
        const agreeResults = [];
        for (const spec of METRIC_SPECS.slice(0, 12)) {
            const getScore = e => getMetric(e, spec.group, spec.key);
            const r = evaluateDimLeaderAgreesTahmin(raceGroups, getScore, host);
            if (r.leaderTotal >= cli.minRaces) {
                agreeResults.push({ spec, ...r });
            }
        }
        agreeResults.sort((a, b) => b.leaderBlended - a.leaderBlended);
        for (const item of agreeResults.slice(0, 10)) {
            console.log('  ' + pad(item.spec.label, 18)
                + ' karışık ' + pad(pct(item.leaderBlended), 7)
                + ' · uyum koşu ' + item.leaderTotal);
        }

        if (cli.fieldSize == null) {
            hr('5. AT SAYISINA GÖRE — en iyi 3 gösterge (koşu lideri)');
            const { entriesByField, fieldSizes } = buildEntriesByFieldSize(withBitis);
            for (const fs of fieldSizes.filter(n => n >= 6 && n <= 14)) {
                const subEntries = entriesByField[fs].filter(e => e._dim);
                const subGroups = buildRaceGroups(subEntries);
                if (subGroups.length < cli.minRaces) continue;
                const top = [];
                for (const spec of METRIC_SPECS) {
                    const r = evaluateRaceLeader(subGroups, e => getMetric(e, spec.group, spec.key), host);
                    if (r.leaderTotal >= cli.minRaces) top.push({ spec, ...r });
                }
                top.sort((a, b) => b.leaderBlended - a.leaderBlended);
                console.log('\n  ' + fs + ' atlı koşu (' + subGroups.length + ' koşu):');
                for (let i = 0; i < Math.min(3, top.length); i++) {
                    const t = top[i];
                    console.log('    ' + pad(t.spec.label, 16) + ' karışık ' + pct(t.leaderBlended)
                        + ' · 1. ' + pct(t.exactRate) + ' · n=' + t.leaderTotal);
                }
            }
        }

        if (cli.verbose && (cli.kayitId || cli.raceNo)) {
            hr('6. KOŞU DETAYI');
            const topSpec = leaderResults[0]?.spec;
            if (topSpec) {
                const r = evaluateRaceLeader(raceGroups, e => getMetric(e, topSpec.group, topSpec.key), host, { collectDetails: true });
                attachTahminLeader(raceGroups);
                for (const d of (r.raceDetails || []).slice(0, 20)) {
                    console.log('  K' + d.raceNo + ' · lider: ' + (d.leaderName || '?')
                        + ' (gösterge=' + d.leaderScore + ') → BİTİŞ ' + d.bitis
                        + ' · ' + d.field + ' at');
                }
            }
        }

        hr('7. TAHMİN SKORU PLANLAMA ÖNERİSİ');
        const betterThanTahmin = leaderResults.filter(r =>
            r.leaderTotal >= cli.minRaces && r.leaderBlended > tahminBase.leaderBlended + 0.02
        );
        const promising = leaderResults.filter(r =>
            r.leaderTotal >= cli.minRaces && r.leaderBlended >= 0.35
        );
        console.log('  Mevcut TAHMİN karışık başarı: ' + pct(tahminBase.leaderBlended));
        if (betterThanTahmin.length) {
            console.log('  TAHMİN\'den daha iyi koşu-lideri göstergeler:');
            for (const r of betterThanTahmin.slice(0, 5)) {
                console.log('    ★ ' + r.spec.label + ' → ' + pct(r.leaderBlended)
                    + ' (+' + pct(r.leaderBlended - tahminBase.leaderBlended) + ')');
            }
        } else {
            console.log('  ⚠ Hiçbir test göstergesi tek başına TAHMİN liderinden belirgin üstün değil.');
            console.log('    → Hibrit skora ek ağırlık (boost) veya TAHMİN uyumu filtresi düşünülebilir.');
        }
        if (promising.length) {
            console.log('  Skora eklenebilecek adaylar (karışık≥35%):');
            for (const r of promising.slice(0, 8)) {
                console.log('    · ' + r.spec.label + ' (' + pct(r.leaderBlended) + ', n=' + r.leaderTotal + ')');
            }
        }
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
