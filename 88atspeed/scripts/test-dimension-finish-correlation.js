#!/usr/bin/env node
/**
 * Test sekmeleri — EKSAUSTİF BİTİŞ korelasyon raporu
 *
 * UI'daki TÜM sütunları test eder (KOŞU, %, MAX-*, cnt*, eşleşme oranı):
 *   KOŞU AT SAYISI · ŞEHİR · KCİNS · TAKİ · PİST · HP · SİKLET
 *
 * Analiz türleri:
 *   A) Koşu lideri — alan içinde metrik liderinin BİTİŞ'i
 *   B) Bucket taraması — eşik ≥X gruplarının BİTİŞ dağılımı
 *   C) Sıralama korelasyonu — metrik sırası ↔ BİTİŞ sırası (Spearman)
 *   D) Kazanan profili — 1. bitiren vs diğerleri ortalama metrik
 *   E) Koşu forensics — --race ile at-at tüm sütunlar + BİTİŞ
 *
 *   F) Sekme birleşik skorları — tek metrik vs varyasyon vs bütün (combo fazı)
 *
 *   node scripts/test-dimension-finish-correlation.js --db atlar.db
 *   node scripts/test-dimension-finish-correlation.js --phase combo,compare
 *   node scripts/test-dimension-finish-correlation.js --race 1 -v
 *   node scripts/test-dimension-finish-correlation.js --list-kayitlar
 *   node scripts/test-dimension-finish-correlation.js --phase leader,bucket,corr,winner,race
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

const phasesRaw = argVal('--phase') || 'all';
const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
    minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 5,
    minRaces: argVal('--min-races') ? Number(argVal('--min-races')) : 3,
    top: argVal('--top') ? Number(argVal('--top')) : 25,
    verbose: args.includes('--verbose') || args.includes('-v'),
    listKayitlar: args.includes('--list-kayitlar'),
    engine: (argVal('--engine') || 'hybrid').toLowerCase(),
    phases: phasesRaw === 'all'
        ? ['leader', 'bucket', 'corr', 'winner', 'agree', 'combo', 'compare', 'segment', 'race', 'plan']
        : phasesRaw.split(',').map(s => s.trim()).filter(Boolean)
};

const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

const TAB_GROUPS = [
    { group: 'fieldSize', tab: 'KOŞU AT SAYISI', short: 'AS' },
    { group: 'sehir', tab: 'ŞEHİR DURUMU', short: 'SH' },
    { group: 'kcins_kosu', tab: 'KOŞU CİNSİ', short: 'KC' },
    { group: 'taki', tab: 'TAKİ', short: 'TK' },
    { group: 'pist', tab: 'PİST', short: 'PS' },
    { group: 'hp', tab: 'HP', short: 'HP' },
    { group: 'siklet', tab: 'SİKLET', short: 'SK' }
];

const PLACEMENT_KEYS = [
    { key: 'max1', col: 'MAX-1' },
    { key: 'max12', col: 'MAX-12' },
    { key: 'max123', col: 'MAX-123' },
    { key: 'max1234', col: 'MAX-1234' },
    { key: 'cnt1', col: '1.' },
    { key: 'cnt12', col: '1-2' },
    { key: 'cnt123', col: '1-2-3' },
    { key: 'cnt1234', col: '1-2-3-4' }
];

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }
function hasPhase(p) { return cli.phases.includes(p); }

function loadAllEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8') + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8') + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8') + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function gval(entry, group, key) {
    if (key === 'matchHitPct') return getMatchHitPct(entry, group);
    return getMetric(entry, group, key);
}

/** Koşu içi min-max normalize ağırlıklı birleşik skor */
function buildWeightedScorer(entries, parts) {
    const stats = parts.map(p => {
        const vals = entries.map(e => p.get(e)).filter(v => v != null && Number.isFinite(v));
        const min = vals.length ? Math.min(...vals) : 0;
        const max = vals.length ? Math.max(...vals) : 0;
        return Object.assign({}, p, { min, max });
    });
    return (entry) => {
        let sum = 0;
        let wSum = 0;
        for (const p of stats) {
            const v = p.get(entry);
            if (v == null || !Number.isFinite(v)) continue;
            const norm = p.max === p.min ? 0.5 : (v - p.min) / (p.max - p.min);
            sum += norm * p.weight;
            wSum += p.weight;
        }
        return wSum > 0 ? (sum / wSum) * 100 : null;
    };
}

/** Borda rank fusion — birden fazla metriğin sıra ortalaması (düşük rank = iyi) */
function buildRankFusionScorer(entries, getters) {
    const rankMaps = getters.map(get => {
        const scored = entries.map((e, i) => ({ e, v: get(e), i }))
            .filter(x => x.v != null && Number.isFinite(x.v));
        scored.sort((a, b) => b.v - a.v || (a.e.row?.no ?? 0) - (b.e.row?.no ?? 0));
        const map = new Map();
        scored.forEach((x, rank) => map.set(x.e, rank + 1));
        return map;
    });
    return (entry) => {
        let sum = 0;
        let n = 0;
        for (const map of rankMaps) {
            const r = map.get(entry);
            if (r != null) { sum += r; n++; }
        }
        if (!n) return null;
        const avgRank = sum / n;
        return 1000 / avgRank;
    };
}

function part(group, key, weight) {
    return { get: e => gval(e, group, key), weight };
}

function buildComboCatalog() {
    const combos = [];
    function addCombo(short, tab, id, label, buildFn, kind) {
        combos.push({ short, tab, id, label, kind: kind || 'combo', buildScorer: buildFn });
    }

    const placementParts = (group, w) => PLACEMENT_KEYS.map(p => part(group, p.key, w));
    const matchPartsDim = (group) => [
        part(group, 'matchPct', 0.4),
        part(group, 'matchCount', 0.35),
        part(group, 'matchHitPct', 0.25)
    ];
    const matchPartsSehir = () => [
        part('sehir', 'sehirPct', 0.45),
        part('sehir', 'inCityCount', 0.35),
        part('sehir', 'matchHitPct', 0.20)
    ];

    // ── KOŞU AT SAYISI ──
    addCombo('AS', 'KOŞU AT SAYISI', 'AS.combo.placement', 'AS · PLACEMENT bütün (MAX+cnt eşit)',
        entries => buildWeightedScorer(entries, [
            ...placementParts('fieldSize', 1),
            part('fieldSize', 'kosuSayisi', 0.5)
        ]));
    addCombo('AS', 'KOŞU AT SAYISI', 'AS.combo.max-ladder', 'AS · MAX merdiven (max123 ağırlıklı)',
        entries => buildWeightedScorer(entries, [
            part('fieldSize', 'max123', 0.30),
            part('fieldSize', 'max12', 0.20),
            part('fieldSize', 'max1', 0.15),
            part('fieldSize', 'cnt123', 0.20),
            part('fieldSize', 'cnt12', 0.10),
            part('fieldSize', 'cnt1', 0.05)
        ]));
    addCombo('AS', 'KOŞU AT SAYISI', 'AS.combo.cnt123-focus', 'AS · cnt123+koşu deneyimi',
        entries => buildWeightedScorer(entries, [
            part('fieldSize', 'cnt123', 0.45),
            part('fieldSize', 'cnt12', 0.20),
            part('fieldSize', 'cnt1', 0.15),
            part('fieldSize', 'kosuSayisi', 0.20)
        ]));
    addCombo('AS', 'KOŞU AT SAYISI', 'AS.combo.rank-fusion', 'AS · rank fusion (tüm sütunlar)',
        entries => buildRankFusionScorer(entries, [
            e => gval(e, 'fieldSize', 'max123'),
            e => gval(e, 'fieldSize', 'cnt123'),
            e => gval(e, 'fieldSize', 'max12'),
            e => gval(e, 'fieldSize', 'kosuSayisi')
        ]));

    // ── ŞEHİR ──
    addCombo('SH', 'ŞEHİR DURUMU', 'SH.combo.match', 'SH · MATCH bütün (ŞEH%+Ş-KOŞU+EŞLEŞME%)',
        entries => buildWeightedScorer(entries, matchPartsSehir()));
    addCombo('SH', 'ŞEHİR DURUMU', 'SH.combo.placement', 'SH · PLACEMENT (hedef şehir MAX+cnt)',
        entries => buildWeightedScorer(entries, placementParts('sehir', 1)));
    addCombo('SH', 'ŞEHİR DURUMU', 'SH.combo.full', 'SH · TAM SEKME (match 50% + placement 50%)',
        entries => buildWeightedScorer(entries, [
            ...matchPartsSehir().map(p => ({ get: p.get, weight: p.weight * 0.5 })),
            ...placementParts('sehir', 0.5)
        ]));
    addCombo('SH', 'ŞEHİR DURUMU', 'SH.combo.match-heavy', 'SH · match ağırlıklı (70/30)',
        entries => buildWeightedScorer(entries, [
            ...matchPartsSehir().map(p => ({ get: p.get, weight: p.weight * 0.7 })),
            ...placementParts('sehir', 0.3)
        ]));
    addCombo('SH', 'ŞEHİR DURUMU', 'SH.combo.rank-fusion', 'SH · rank fusion (tüm sütunlar)',
        entries => buildRankFusionScorer(entries, [
            e => gval(e, 'sehir', 'sehirPct'),
            e => gval(e, 'sehir', 'inCityCount'),
            e => gval(e, 'sehir', 'max123'),
            e => gval(e, 'sehir', 'cnt123'),
            e => getMatchHitPct(e, 'sehir')
        ]));

    // ── BOYUT SEKMELERİ (KC, TK, PS, HP, SK) ──
    for (const tg of TAB_GROUPS.filter(t => !['fieldSize', 'sehir'].includes(t.group))) {
        const g = tg.group;
        const s = tg.short;
        addCombo(s, tg.tab, s + '.combo.match', s + ' · MATCH bütün (%+adet+EŞLEŞME%)',
            entries => buildWeightedScorer(entries, matchPartsDim(g)));
        addCombo(s, tg.tab, s + '.combo.placement', s + ' · PLACEMENT bütün (MAX+cnt)',
            entries => buildWeightedScorer(entries, placementParts(g, 1)));
        addCombo(s, tg.tab, s + '.combo.ui-classic', s + ' · UI klasik (%+adet+max123+cnt123)',
            entries => buildWeightedScorer(entries, [
                part(g, 'matchPct', 0.22),
                part(g, 'matchCount', 0.18),
                part(g, 'max123', 0.22),
                part(g, 'cnt123', 0.18),
                part(g, 'max1', 0.10),
                part(g, 'cnt1', 0.10)
            ]));
        addCombo(s, tg.tab, s + '.combo.max-x-pct', s + ' · max123×% + cnt123',
            entries => buildWeightedScorer(entries, [
                part(g, 'max123', 0.35),
                part(g, 'matchPct', 0.25),
                part(g, 'cnt123', 0.25),
                part(g, 'matchCount', 0.15)
            ]));
        addCombo(s, tg.tab, s + '.combo.match-heavy', s + ' · match 70% + placement 30%',
            entries => buildWeightedScorer(entries, [
                ...matchPartsDim(g).map(p => ({ get: p.get, weight: p.weight * 0.7 })),
                ...placementParts(g, 0.3)
            ]));
        addCombo(s, tg.tab, s + '.combo.placement-heavy', s + ' · placement 70% + match 30%',
            entries => buildWeightedScorer(entries, [
                ...placementParts(g, 0.7),
                ...matchPartsDim(g).map(p => ({ get: p.get, weight: p.weight * 0.3 }))
            ]));
        addCombo(s, tg.tab, s + '.combo.full', s + ' · TAM SEKME (match+placement+koşu eşit)',
            entries => buildWeightedScorer(entries, [
                ...matchPartsDim(g),
                ...placementParts(g, 1),
                part(g, 'kosuSayisi', 1)
            ]));
        addCombo(s, tg.tab, s + '.combo.experience', s + ' · deneyim (koşu+match adet+cnt123)',
            entries => buildWeightedScorer(entries, [
                part(g, 'kosuSayisi', 0.25),
                part(g, 'matchCount', 0.30),
                part(g, 'cnt123', 0.30),
                part(g, 'matchPct', 0.15)
            ]));
        addCombo(s, tg.tab, s + '.combo.rank-fusion', s + ' · rank fusion (tüm sütunlar)',
            entries => buildRankFusionScorer(entries, [
                e => gval(e, g, 'matchPct'),
                e => gval(e, g, 'matchCount'),
                e => gval(e, g, 'max123'),
                e => gval(e, g, 'cnt123'),
                e => gval(e, g, 'max1'),
                e => getMatchHitPct(e, g)
            ]));
    }

    // ── MEGA (çapraz sekme) ──
    addCombo('MEGA', 'TÜM SEKMELER', 'MEGA.full-all', 'MEGA · 7 sekme TAM birleşik (eşit)',
        entries => {
            const tabScorers = combos.filter(c => c.id.endsWith('.combo.full') && c.short !== 'MEGA')
                .map(c => c.buildScorer(entries));
            return (entry) => {
                const vals = tabScorers.map(fn => fn(entry)).filter(v => v != null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
        }, 'mega');

    addCombo('MEGA', 'TÜM SEKMELER', 'MEGA.match-all', 'MEGA · tüm MATCH paketleri',
        entries => {
            const fns = combos.filter(c => c.id.endsWith('.combo.match') && c.short !== 'MEGA')
                .map(c => c.buildScorer(entries));
            return (entry) => {
                const vals = fns.map(fn => fn(entry)).filter(v => v != null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
        }, 'mega');

    addCombo('MEGA', 'TÜM SEKMELER', 'MEGA.placement-all', 'MEGA · tüm PLACEMENT paketleri',
        entries => {
            const fns = combos.filter(c => c.id.endsWith('.combo.placement') && c.short !== 'MEGA')
                .map(c => c.buildScorer(entries));
            return (entry) => {
                const vals = fns.map(fn => fn(entry)).filter(v => v != null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
        }, 'mega');

    addCombo('MEGA', 'TÜM SEKMELER', 'MEGA.ui-classic-all', 'MEGA · tüm UI-klasik paketleri',
        entries => {
            const fns = combos.filter(c => c.id.endsWith('.combo.ui-classic'))
                .map(c => c.buildScorer(entries));
            return (entry) => {
                const vals = fns.map(fn => fn(entry)).filter(v => v != null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
        }, 'mega');

    addCombo('MEGA', 'TÜM SEKMELER', 'MEGA.rank-fusion-all', 'MEGA · 7 sekme rank fusion ortalaması',
        entries => buildRankFusionScorer(entries, [
            e => gval(e, 'fieldSize', 'cnt123'),
            e => gval(e, 'sehir', 'sehirPct'),
            e => gval(e, 'kcins_kosu', 'matchPct'),
            e => gval(e, 'taki', 'matchPct'),
            e => gval(e, 'pist', 'matchPct'),
            e => gval(e, 'hp', 'matchPct'),
            e => gval(e, 'siklet', 'matchPct'),
            e => gval(e, 'taki', 'max123'),
            e => gval(e, 'pist', 'max123'),
            e => gval(e, 'fieldSize', 'max123')
        ]), 'mega');

    return combos;
}

function evaluateComboRaceLeader(raceGroups, combo, host) {
    let leaderTotal = 0, b1 = 0, b12 = 0, b123 = 0;
    for (const entries of raceGroups) {
        const getScore = combo.buildScorer(entries);
        const scored = entries.map(e => ({ entry: e, score: getScore(e) }))
            .filter(s => s.score != null);
        if (scored.length < 2) continue;
        scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
        const bitis = host.bitisValueForSort(scored[0].entry);
        if (bitis == null || bitis < 1) continue;
        leaderTotal++;
        if (bitis === 1) b1++;
        if (bitis <= 2) b12++;
        if (bitis <= 3) b123++;
    }
    return {
        leaderTotal, b1, b12, b123,
        leaderBlended: blendedFromCounts(leaderTotal, b1, b12, b123),
        exactRate: leaderTotal ? b1 / leaderTotal : 0
    };
}

function bestSingleForTab(catalog, tab, raceGroups, host) {
    const singles = catalog.filter(m => m.tab === tab);
    let best = null;
    for (const m of singles) {
        const r = evaluateRaceLeader(raceGroups, m.get, host);
        if (r.leaderTotal < cli.minRaces) continue;
        if (!best || r.leaderBlended > best.leaderBlended) {
            best = { m, ...r };
        }
    }
    return best;
}

function printComboCompareTable(tabSummaries, tahminBase) {
    console.log('  ' + pad('SEKME', 18) + pad('EN İYİ TEK', 12) + pad('TEK METRİK', 14)
        + pad('EN İYİ COMBO', 12) + pad('COMBO', 22) + pad('Δ', 8) + 'TAHMİN');
    console.log('  ' + '-'.repeat(96));
    for (const row of tabSummaries) {
        const delta = row.combo && row.single
            ? row.combo.leaderBlended - row.single.leaderBlended : 0;
        const deltaStr = delta > 0.005 ? '+' + pct(delta) : (delta < -0.005 ? pct(delta) : '—');
        console.log('  ' + pad(row.tab.slice(0, 18), 18)
            + pad(row.single ? pct(row.single.leaderBlended) : '—', 12)
            + pad(row.single ? row.single.m.col : '—', 14)
            + pad(row.combo ? pct(row.combo.leaderBlended) : '—', 12)
            + pad(row.combo ? row.combo.label.slice(0, 22) : '—', 22)
            + pad(deltaStr, 8)
            + (tahminBase ? pct(tahminBase.leaderBlended) : '—'));
    }
}

function blendedFromCounts(total, b1, b12, b123) {
    if (!total) return 0;
    return SUCCESS_BLEND.b1 * (b1 / total) + SUCCESS_BLEND.b12 * (b12 / total) + SUCCESS_BLEND.b123 * (b123 / total);
}

function blendedFromStats(stats) {
    const t = stats.withBitis || 0;
    if (!t) return 0;
    return blendedFromCounts(t, stats.b1, stats.b12, stats.b123);
}

function buildMetricCatalog() {
    const catalog = [];
    function add(group, key, col, tab, short) {
        catalog.push({
            group, key, col, tab, short,
            id: short + '.' + key,
            label: tab + ' · ' + col,
            get: e => getMetric(e, group, key)
        });
    }
    for (const tg of TAB_GROUPS) {
        add(tg.group, 'kosuSayisi', 'KOŞU', tg.tab, tg.short);
        if (tg.group === 'sehir') {
            add('sehir', 'sehirPct', 'ŞEH%', tg.tab, tg.short);
            add('sehir', 'inCityCount', 'Ş-KOŞU', tg.tab, tg.short);
        } else if (tg.group !== 'fieldSize') {
            const pctCol = tg.group === 'kcins_kosu' ? 'KC%'
                : tg.group === 'taki' ? 'TK%'
                    : tg.group === 'pist' ? 'PİST%'
                        : tg.group === 'hp' ? 'HP%'
                            : tg.group === 'siklet' ? 'SK%' : '%';
            const cntCol = tg.group === 'kcins_kosu' ? 'KC-KOŞU'
                : tg.group === 'taki' ? 'TK-KOŞU'
                    : tg.group === 'pist' ? 'P-KOŞU'
                        : tg.group === 'hp' ? 'HP-KOŞU'
                            : tg.group === 'siklet' ? 'SK-KOŞU' : 'MATCH-KOŞU';
            add(tg.group, 'matchPct', pctCol, tg.tab, tg.short);
            add(tg.group, 'matchCount', cntCol, tg.tab, tg.short);
        }
        for (const p of PLACEMENT_KEYS) {
            add(tg.group, p.key, p.col, tg.tab, tg.short);
        }
        if (tg.group !== 'fieldSize') {
            catalog.push({
                group: tg.group, key: 'matchHitPct', col: 'EŞLEŞME%', tab: tg.tab, short: tg.short,
                id: tg.short + '.matchHitPct',
                label: tg.tab + ' · EŞLEŞME%',
                get: e => getMatchHitPct(e, tg.group)
            });
        }
    }
    // türev metrikler
    catalog.push({
        group: 'fieldSize', key: '_cnt123rate', col: 'cnt123/KOŞU', tab: 'KOŞU AT SAYISI', short: 'AS',
        id: 'AS.cnt123rate', label: 'KOŞU AT SAYISI · cnt123/KOŞU',
        get: e => {
            const k = getMetric(e, 'fieldSize', 'kosuSayisi');
            const c = getMetric(e, 'fieldSize', 'cnt123');
            return k > 0 && c != null ? c / k : null;
        }
    });
    for (const g of ['kcins_kosu', 'taki', 'pist', 'hp', 'siklet', 'sehir']) {
        const tg = TAB_GROUPS.find(t => t.group === g);
        catalog.push({
            group: g, key: '_max123xpct', col: 'max123×%', tab: tg.tab, short: tg.short,
            id: tg.short + '.max123xpct',
            label: tg.tab + ' · max123×match%',
            get: e => {
                const m = getMetric(e, g, 'max123');
                const p = g === 'sehir' ? getMetric(e, g, 'sehirPct') : getMetric(e, g, 'matchPct');
                return m != null && p != null ? m * p / 100 : null;
            }
        });
    }
    return catalog;
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
                lookup.set(rowKeyParts(kayit.id, raceNo, horse.no), {
                    horse, race, hipodrom: kayit.hipodrom, tarih: kayit.tarih, kayitId: kayit.id
                });
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
    const out = {
        fieldSize: FieldSizeStatsEngine.computeStats(kosular),
        sehir: SehirStatsEngine.computeStats(kosular, hipodrom)
    };
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        out[key] = KosuDimensionStatsEngine.computeStats(kosular, key, dim.getTarget(horseCtx, race));
    }
    return out;
}

function attachDimensionStats(flatEntries, lookup) {
    let hit = 0;
    for (const entry of flatEntries) {
        const raw = lookup.get(rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no));
        if (!raw) continue;
        entry._dimRaw = raw;
        entry._dim = computeDimensionBundle(raw);
        hit++;
    }
    return hit;
}

function getMetric(entry, groupKey, metricKey) {
    const g = entry._dim?.[groupKey];
    if (!g) return null;
    const v = g[metricKey];
    if (v == null || v === '' || v === '—') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function getMatchHitPct(entry, groupKey) {
    const str = entry._dim?.[groupKey]?.gecmisMatchStr;
    if (!str || str === '—') return null;
    const parts = str.split('→');
    const hits = parts.filter(p => p.trim() === '✓').length;
    return parts.length ? Math.round(1000 * hits / parts.length) / 10 : null;
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

function evaluateRaceLeader(raceGroups, getScore, host) {
    let leaderTotal = 0, b1 = 0, b12 = 0, b123 = 0;
    for (const entries of raceGroups) {
        const scored = entries.map(e => ({ entry: e, score: getScore(e) })).filter(s => s.score != null);
        if (scored.length < 2) continue;
        scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
        const bitis = host.bitisValueForSort(scored[0].entry);
        if (bitis == null || bitis < 1) continue;
        leaderTotal++;
        if (bitis === 1) b1++;
        if (bitis <= 2) b12++;
        if (bitis <= 3) b123++;
    }
    return {
        leaderTotal, b1, b12, b123,
        leaderBlended: blendedFromCounts(leaderTotal, b1, b12, b123),
        exactRate: leaderTotal ? b1 / leaderTotal : 0
    };
}

function rankArray(values) {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(values.length);
    for (let r = 0; r < indexed.length; r++) {
        ranks[indexed[r].i] = r + 1;
    }
    return ranks;
}

function spearmanFromPairs(pairs) {
    if (pairs.length < 3) return null;
    const xs = pairs.map(p => p.x);
    const ys = pairs.map(p => p.y);
    const rx = rankArray(xs);
    const ry = rankArray(ys);
    const n = pairs.length;
    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
        const d = rx[i] - ry[i];
        sumD2 += d * d;
    }
    return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function evaluateRankCorrelation(raceGroups, getScore, host) {
    const corrs = [];
    for (const entries of raceGroups) {
        const pairs = [];
        for (const e of entries) {
            const m = getScore(e);
            const b = host.bitisValueForSort(e);
            if (m != null && b != null && b >= 1) pairs.push({ x: m, y: b });
        }
        const rho = spearmanFromPairs(pairs);
        if (rho != null && !isNaN(rho)) corrs.push(rho);
    }
    if (!corrs.length) return { avg: null, n: 0, inverted: null };
    const avg = corrs.reduce((a, b) => a + b, 0) / corrs.length;
    return { avg, n: corrs.length, inverted: -avg };
}

function evaluateWinnerProfile(entries, getScore, host) {
    let wSum = 0, wN = 0, rSum = 0, rN = 0;
    for (const e of entries) {
        const m = getScore(e);
        const b = host.bitisValueForSort(e);
        if (m == null || b == null || b < 1) continue;
        if (b === 1) { wSum += m; wN++; }
        else { rSum += m; rN++; }
    }
    const winAvg = wN ? wSum / wN : null;
    const restAvg = rN ? rSum / rN : null;
    return {
        winAvg, restAvg, winN: wN, restN: rN,
        delta: winAvg != null && restAvg != null ? winAvg - restAvg : null
    };
}

function thresholdCandidates(metric) {
    const k = metric.key;
    if (k.includes('Pct') || k === 'sehirPct' || k === 'matchHitPct' || k.includes('rate')) {
        return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    }
    if (k.startsWith('max') || k.startsWith('cnt') || k === 'kosuSayisi' || k.includes('Count')) {
        return [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];
    }
    if (k.includes('max123xpct')) return [50, 100, 200, 400, 800];
    return [1, 2, 3, 5, 8];
}

function evaluateBestBucket(entries, metric, host) {
    let best = null;
    for (const th of thresholdCandidates(metric)) {
        const pred = e => {
            const v = metric.get(e);
            return v != null && v >= th;
        };
        const matched = entries.filter(pred);
        const stats = host.buildBitisStatsFromEntries(matched);
        if ((stats.withBitis || 0) < cli.minSample) continue;
        const sr = blendedFromStats(stats);
        if (!best || sr > best.successRate) {
            best = { threshold: th, successRate: sr, b1Rate: stats.b1 / stats.withBitis, n: stats.withBitis, matched: matched.length };
        }
    }
    return best;
}

function attachTahminLeader(raceGroups) {
    for (const entries of raceGroups) {
        const rows = entries.map(e => e.row);
        const pkg = {
            rows,
            depthCoverage: entries[0]?._pkg?.depthCoverage || null,
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null
        };
        if (cli.engine === 'hybrid') HybridTahminScoringEngine.attachRaceTahmin(pkg);
        else GostergeScoringEngine.attachRaceTahmin(pkg);
    }
}

function evaluateTahminLeader(raceGroups, host) {
    attachTahminLeader(raceGroups);
    return evaluateRaceLeader(raceGroups, e => e.row?.tahmin?.score ?? null, host);
}

function formatMetricVal(v) {
    if (v == null) return '—';
    if (Math.abs(v) >= 100) return String(Math.round(v));
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(1);
}

function printRaceForensics(raceGroups, host, catalog, tahminBase) {
    attachTahminLeader(raceGroups);
    const topMetrics = catalog
        .map(m => {
            const r = evaluateRaceLeader(raceGroups, m.get, host);
            return { m, ...r };
        })
        .filter(r => r.leaderTotal > 0)
        .sort((a, b) => b.leaderBlended - a.leaderBlended)
        .slice(0, 12);

    for (const entries of raceGroups) {
        const raw0 = entries[0]?._dimRaw;
        const race = raw0?.race || {};
        const header = typeof AtMetaFields !== 'undefined'
            ? AtMetaFields.formatRaceHeader(race)
            : ((race.mesafe || '?') + ' ' + (race.pist || '')).trim();
        console.log('\n  🏁 K' + entries[0].raceNo + ' · kayit #' + entries[0].kayitId
            + ' · ' + entries.length + ' at · ' + header);

        const horses = [...entries].sort((a, b) => {
            const ba = host.bitisValueForSort(a) ?? 99;
            const bb = host.bitisValueForSort(b) ?? 99;
            return ba - bb;
        });

        console.log('  ' + pad('AT', 22) + pad('BİT', 4) + pad('TAH#', 5)
            + topMetrics.map(t => pad(t.m.short + '.' + t.m.col.slice(0, 6), 9)).join(''));
        console.log('  ' + '-'.repeat(22 + 4 + 5 + topMetrics.length * 9));

        for (const e of horses) {
            const bitis = host.bitisValueForSort(e);
            const name = (e.row?.name || '?').replace(/\(\d+\)/, '').trim().slice(0, 20);
            const tahRank = e.row?.tahmin?.rank ?? '—';
            let line = '  ' + pad(name, 22) + pad(bitis ?? '—', 4) + pad(String(tahRank), 5);
            for (const t of topMetrics) {
                line += pad(formatMetricVal(t.m.get(e)), 9);
            }
            console.log(line);
        }

        console.log('\n  Metrik liderleri (bu koşu):');
        for (const t of topMetrics.slice(0, 8)) {
            const scored = entries.map(e => ({ e, s: t.m.get(e) })).filter(x => x.s != null);
            if (!scored.length) continue;
            scored.sort((a, b) => b.s - a.s);
            const leader = scored[0];
            const lb = host.bitisValueForSort(leader.e);
            const mark = lb === 1 ? '★' : lb <= 3 ? '◆' : '·';
            console.log('    ' + mark + ' ' + pad(t.m.label, 28)
                + ' → ' + (leader.e.row?.name || '?').slice(0, 25)
                + ' (' + formatMetricVal(leader.s) + ') BİTİŞ=' + (lb ?? '?'));
        }
    }
}

async function listKayitlar(db) {
    const rows = await dbAll(db, 'SELECT id, hipodrom, tarih, race_count, total_horses FROM hesaplama_kayitlari ORDER BY id DESC LIMIT 30');
    hr('HESAPLAMA KAYITLARI (son 30)');
    for (const k of rows) {
        console.log('  #' + pad(k.id, 4) + ' ' + pad(k.tarih || '', 12) + pad(k.hipodrom || '', 14)
            + k.race_count + ' koşu · ' + k.total_horses + ' at');
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Test sekmeleri — EKSAUSTİF BİTİŞ korelasyon raporu             ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);
    console.log('Fazlar: ' + cli.phases.join(', '));

    loadAllEngines();
    const db = openDb(cli.dbPath);

    try {
        if (cli.listKayitlar) {
            await listKayitlar(db);
            return;
        }

        const catalog = buildMetricCatalog();
        console.log('Metrik sayısı (UI sütunları + türev): ' + catalog.length);

        const lookup = await loadRawHorseLookup(db);
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId,
            filterRace: cli.raceNo
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        attachDimensionStats(flatEntries, lookup);

        const entries = filterEntries(flatEntries);
        const withBitis = entries.filter(e => host.bitisValueForSort(e) != null);
        const raceGroups = buildRaceGroups(withBitis);

        hr('1. VERİ ÖZETİ');
        console.log('  Flat at satırı      : ' + flatEntries.length);
        console.log('  Boyut istat. dolu   : ' + entries.length);
        console.log('  BİTİŞ bilgili at    : ' + withBitis.length);
        console.log('  Analiz koşusu       : ' + raceGroups.length);
        if (cli.kayitId && flatEntries.length === 0) {
            console.log('\n  ⚠ Kayıt #' + cli.kayitId + ' bulunamadı. Mevcut kayıtlar:');
            await listKayitlar(db);
            return;
        }
        if (withBitis.length < cli.minSample) {
            console.log('\n⚠ Yeterli BİTİŞ yok (min ' + cli.minSample + '). --list-kayitlar ile kayıtları görün.');
            return;
        }

        const tahminBase = hasPhase('leader') || hasPhase('plan') || hasPhase('agree')
            ? evaluateTahminLeader(raceGroups, host) : null;

        if (hasPhase('leader')) {
            hr('2. KOŞU LİDERİ — TÜM UI SÜTUNLARI (' + catalog.length + ' metrik)');
            console.log('  Her koşuda en yüksek değere sahip atın BİTİŞ\'i · karışık = 80/12/8');
            if (tahminBase) {
                console.log('  ' + pad('TAHMİN(hybrid)', 32) + ' karışık ' + pad(pct(tahminBase.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(tahminBase.exactRate), 7) + ' · n=' + tahminBase.leaderTotal);
            }
            const leaderResults = catalog.map(m => ({
                m, ...evaluateRaceLeader(raceGroups, m.get, host)
            })).filter(r => r.leaderTotal >= cli.minRaces)
                .sort((a, b) => b.leaderBlended - a.leaderBlended);

            for (const tg of TAB_GROUPS) {
                sub(tg.tab);
                const tabRows = leaderResults.filter(r => r.m.tab === tg.tab);
                let i = 1;
                for (const r of tabRows) {
                    console.log('  ' + pad(i++ + '.', 4) + pad(r.m.col, 10)
                        + pad(r.m.key, 14) + ' karışık ' + pad(pct(r.leaderBlended), 7)
                        + ' · 1. ' + pad(pct(r.exactRate), 7)
                        + ' · n=' + r.leaderTotal);
                }
            }
            sub('GENEL TOP ' + cli.top);
            leaderResults.slice(0, cli.top).forEach((r, idx) => {
                console.log('  ' + pad(String(idx + 1) + '.', 4) + pad(r.m.label, 32)
                    + ' karışık ' + pad(pct(r.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(r.exactRate), 7)
                    + ' · n=' + r.leaderTotal);
            });
        }

        if (hasPhase('bucket')) {
            hr('3. BUCKET TARAMASI — her metrik için en iyi eşik');
            console.log('  At bazlı: eşik ≥X koşulunu sağlayan atların BİTİŞ dağılımı');
            const baseStats = host.buildBitisStatsFromEntries(withBitis);
            console.log('  Baz (tüm atlar): karışık ' + pct(blendedFromStats(baseStats)) + ' · n=' + baseStats.withBitis);

            const bucketResults = catalog.map(m => {
                const best = evaluateBestBucket(withBitis, m, host);
                return best ? { m, ...best } : null;
            }).filter(Boolean).sort((a, b) => b.successRate - a.successRate);

            for (const tg of TAB_GROUPS) {
                sub(tg.tab + ' — en iyi eşikler');
                const rows = bucketResults.filter(r => r.m.tab === tg.tab).slice(0, 8);
                for (const r of rows) {
                    console.log('  ' + pad(r.m.col, 10) + pad('≥' + r.threshold, 6)
                        + ' karışık ' + pad(pct(r.successRate), 7)
                        + ' · 1. ' + pad(pct(r.b1Rate), 7)
                        + ' · n=' + r.n + '/' + r.matched);
                }
            }
            sub('GENEL TOP bucket');
            bucketResults.slice(0, 15).forEach(r => {
                console.log('  ' + pad(r.m.label, 32) + ' ≥' + r.threshold
                    + ' → karışık ' + pct(r.successRate) + ' · 1. ' + pct(r.b1Rate) + ' · n=' + r.n);
            });
        }

        if (hasPhase('corr')) {
            hr('4. SIRALAMA KORELASYONU — metrik sırası ↔ BİTİŞ sırası');
            console.log('  Negatif ρ = yüksek metrik → düşük BİTİŞ (iyi). Pozitif ρ = ters (kötü sinyal).');
            console.log('  Rapor: -ρ (mutlak yönlendirme; büyük = metrik bitişi iyi sıralıyor)');

            const corrResults = catalog.map(m => {
                const c = evaluateRankCorrelation(raceGroups, m.get, host);
                return c.n >= cli.minRaces ? { m, ...c } : null;
            }).filter(Boolean).sort((a, b) => b.inverted - a.inverted);

            for (const tg of TAB_GROUPS) {
                sub(tg.tab);
                corrResults.filter(r => r.m.tab === tg.tab).slice(0, 6).forEach((r, i) => {
                    console.log('  ' + pad(i + 1 + '.', 4) + pad(r.m.col, 10)
                        + ' ρ=' + pad((r.avg ?? 0).toFixed(3), 7)
                        + ' · -ρ=' + pad((r.inverted ?? 0).toFixed(3), 7)
                        + ' · koşu ' + r.n);
                });
            }
            sub('GENEL TOP korelasyon');
            corrResults.slice(0, 15).forEach((r, i) => {
                console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.m.label, 32)
                    + ' -ρ=' + (r.inverted ?? 0).toFixed(3) + ' · koşu ' + r.n);
            });
        }

        if (hasPhase('winner')) {
            hr('5. KAZANAN PROFİLİ — 1. bitiren vs diğerleri ortalama');
            const winResults = catalog.map(m => {
                const w = evaluateWinnerProfile(withBitis, m.get, host);
                return w.winN >= 3 ? { m, ...w } : null;
            }).filter(Boolean).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

            for (const tg of TAB_GROUPS) {
                sub(tg.tab);
                winResults.filter(r => r.m.tab === tg.tab).slice(0, 6).forEach((r, i) => {
                    console.log('  ' + pad(i + 1 + '.', 4) + pad(r.m.col, 10)
                        + ' 1.ort=' + pad(formatMetricVal(r.winAvg), 6)
                        + ' diğer=' + pad(formatMetricVal(r.restAvg), 6)
                        + ' Δ=' + pad(formatMetricVal(r.delta), 6)
                        + ' (n1=' + r.winN + ')');
                });
            }
            sub('GENEL TOP kazanan farkı (Δ)');
            winResults.slice(0, 15).forEach((r, i) => {
                console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.m.label, 32)
                    + ' Δ=' + formatMetricVal(r.delta)
                    + ' · 1.ort=' + formatMetricVal(r.winAvg) + ' · n1=' + r.winN);
            });
        }

        if (hasPhase('agree') && tahminBase) {
            hr('6. TAHMİN UYUMU — metrik lideri = TAHMİN lideri');
            attachTahminLeader(raceGroups);
            const agreeResults = catalog.map(m => {
                let total = 0, b1 = 0, b12 = 0, b123 = 0;
                for (const entries of raceGroups) {
                    const ms = entries.map(e => ({ e, s: m.get(e) })).filter(x => x.s != null);
                    const ts = entries.map(e => ({ e, s: e.row?.tahmin?.score })).filter(x => x.s != null);
                    if (ms.length < 2 || !ts.length) continue;
                    ms.sort((a, b) => b.s - a.s);
                    ts.sort((a, b) => b.s - a.s);
                    if (ms[0].e.row?.no !== ts[0].e.row?.no) continue;
                    const bitis = host.bitisValueForSort(ms[0].e);
                    if (bitis == null || bitis < 1) continue;
                    total++;
                    if (bitis === 1) b1++;
                    if (bitis <= 2) b12++;
                    if (bitis <= 3) b123++;
                }
                return total >= cli.minRaces
                    ? { m, leaderTotal: total, leaderBlended: blendedFromCounts(total, b1, b12, b123) }
                    : null;
            }).filter(Boolean).sort((a, b) => b.leaderBlended - a.leaderBlended);

            agreeResults.slice(0, 20).forEach((r, i) => {
                console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.m.label, 32)
                    + ' karışık ' + pct(r.leaderBlended) + ' · uyum koşu ' + r.leaderTotal);
            });
        }

        if (hasPhase('segment') && !cli.fieldSize) {
            hr('7. AT SAYISINA GÖRE — sekme başına en iyi metrik');
            const { entriesByField, fieldSizes } = buildEntriesByFieldSize(withBitis);
            for (const fs of fieldSizes.filter(n => n >= 6 && n <= 14)) {
                const subEntries = entriesByField[fs].filter(e => e._dim);
                const subGroups = buildRaceGroups(subEntries);
                if (subGroups.length < 2) continue;
                console.log('\n  ' + fs + ' atlı koşu (' + subGroups.length + ' koşu):');
                for (const tg of TAB_GROUPS) {
                    const tabMetrics = catalog.filter(c => c.tab === tg.tab);
                    const best = tabMetrics.map(m => ({
                        m, ...evaluateRaceLeader(subGroups, m.get, host)
                    })).filter(r => r.leaderTotal >= 2)
                        .sort((a, b) => b.leaderBlended - a.leaderBlended)[0];
                    if (best) {
                        console.log('    ' + pad(tg.short, 4) + pad(best.m.col, 10)
                            + ' karışık ' + pct(best.leaderBlended)
                            + ' · 1. ' + pct(best.exactRate));
                    }
                }
            }
        }

        if (hasPhase('race') && (cli.raceNo || cli.verbose)) {
            hr('8. KOŞU FORENSİCS — at-at metrik vs BİTİŞ');
            printRaceForensics(raceGroups, host, catalog, tahminBase);
        }

        const comboCatalog = buildComboCatalog();
        let comboResults = [];
        let tabSummaries = [];

        if (hasPhase('combo') || hasPhase('compare')) {
            hr('10. SEKME BİRLEŞİK SKORLAR — tek metrik vs varyasyon vs bütün');
            console.log('  Her sekmede birden fazla sütun birleştirilir (normalize ağırlıklı / rank fusion)');
            console.log('  Kombinasyon sayısı: ' + comboCatalog.length);

            comboResults = comboCatalog.map(c => ({
                combo: c,
                ...evaluateComboRaceLeader(raceGroups, c, host)
            })).filter(r => r.leaderTotal >= cli.minRaces)
                .sort((a, b) => b.leaderBlended - a.leaderBlended);

            for (const tg of TAB_GROUPS) {
                sub(tg.tab + ' — tek vs birleşik');
                const singleBest = bestSingleForTab(catalog, tg.tab, raceGroups, host);
                const tabCombos = comboResults.filter(r => r.combo.tab === tg.tab);
                const bestCombo = tabCombos[0] || null;

                if (singleBest) {
                    console.log('  EN İYİ TEK     : ' + pad(singleBest.m.col, 10)
                        + ' karışık ' + pct(singleBest.leaderBlended)
                        + ' · 1. ' + pct(singleBest.exactRate) + ' · n=' + singleBest.leaderTotal);
                }
                if (bestCombo) {
                    const gain = singleBest
                        ? bestCombo.leaderBlended - singleBest.leaderBlended : 0;
                    console.log('  EN İYİ COMBO   : ' + pad(bestCombo.combo.label.slice(0, 40), 42)
                        + ' karışık ' + pct(bestCombo.leaderBlended)
                        + ' · 1. ' + pct(bestCombo.exactRate)
                        + (gain > 0.005 ? ' · Δ+' + pct(gain) : ''));
                }
                console.log('  Tüm varyasyonlar:');
                for (const r of tabCombos) {
                    const gain = singleBest ? r.leaderBlended - singleBest.leaderBlended : 0;
                    console.log('    ' + pad(r.combo.label.slice(0, 38), 40)
                        + ' karışık ' + pad(pct(r.leaderBlended), 7)
                        + ' · 1. ' + pad(pct(r.exactRate), 7)
                        + (gain > 0.005 ? ' · Δ+' + pct(gain) : '')
                        + ' · n=' + r.leaderTotal);
                }
                tabSummaries.push({
                    tab: tg.tab,
                    single: singleBest,
                    combo: bestCombo ? { label: bestCombo.combo.label, ...bestCombo } : null
                });
            }

            sub('MEGA — çapraz sekme birleşik');
            const megaCombos = comboResults.filter(r => r.combo.kind === 'mega');
            const bestSingleGlobal = catalog.map(m => ({
                m, ...evaluateRaceLeader(raceGroups, m.get, host)
            })).filter(r => r.leaderTotal >= cli.minRaces)
                .sort((a, b) => b.leaderBlended - a.leaderBlended)[0];

            for (const r of megaCombos) {
                const vsSingle = bestSingleGlobal
                    ? r.leaderBlended - bestSingleGlobal.leaderBlended : 0;
                const vsTahmin = tahminBase ? r.leaderBlended - tahminBase.leaderBlended : 0;
                console.log('  ' + pad(r.combo.label.slice(0, 38), 40)
                    + ' karışık ' + pad(pct(r.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(r.exactRate), 7)
                    + (vsSingle > 0.005 ? ' · vsTek+' + pct(vsSingle) : '')
                    + (vsTahmin > 0.005 ? ' · vsTAH+' + pct(vsTahmin) : '')
                    + ' · n=' + r.leaderTotal);
            }
            tabSummaries.push({
                tab: 'MEGA (çapraz)',
                single: bestSingleGlobal,
                combo: megaCombos[0] ? { label: megaCombos[0].combo.label, ...megaCombos[0] } : null
            });
        }

        if (hasPhase('compare') && tabSummaries.length) {
            hr('11. KARŞILAŞTIRMA ÖZET — TEK vs COMBO vs TAHMİN');
            printComboCompareTable(tabSummaries, tahminBase);

            sub('En iyi birleşik skorlar (genel TOP ' + cli.top + ')');
            comboResults.slice(0, cli.top).forEach((r, i) => {
                console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.combo.label.slice(0, 42), 44)
                    + ' karışık ' + pad(pct(r.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(r.exactRate), 7)
                    + ' · n=' + r.leaderTotal);
            });

            if (tahminBase && comboResults.length) {
                const bestCombo = comboResults[0];
                const bestSingleAll = tabSummaries.find(t => t.tab === 'MEGA (çapraz)')?.single
                    || catalog.map(m => ({
                        m, ...evaluateRaceLeader(raceGroups, m.get, host)
                    })).filter(r => r.leaderTotal >= cli.minRaces)
                        .sort((a, b) => b.leaderBlended - a.leaderBlended)[0];
                console.log('\n  Sonuç:');
                console.log('    TAHMİN hybrid     : ' + pct(tahminBase.leaderBlended));
                if (bestSingleAll) {
                    console.log('    En iyi tek metrik : ' + pct(bestSingleAll.leaderBlended)
                        + ' (' + (bestSingleAll.m?.label || '—') + ')');
                }
                console.log('    En iyi combo      : ' + pct(bestCombo.leaderBlended)
                    + ' (' + bestCombo.combo.label + ')');
                const comboVsTahmin = bestCombo.leaderBlended - tahminBase.leaderBlended;
                console.log('    Combo vs TAHMİN   : ' + (comboVsTahmin >= 0 ? '+' : '') + pct(comboVsTahmin));
            }
        }

        if (hasPhase('plan') && tahminBase) {
            hr('12. TAHMİN SKORU — entegrasyon önceliği');
            const leaderResults = catalog.map(m => ({
                m, ...evaluateRaceLeader(raceGroups, m.get, host)
            })).filter(r => r.leaderTotal >= cli.minRaces)
                .sort((a, b) => b.leaderBlended - a.leaderBlended);

            console.log('  TAHMİN baseline: ' + pct(tahminBase.leaderBlended) + ' (n=' + tahminBase.leaderTotal + ')');
            console.log('\n  Öncelik 1 — koşu lideri TAHMİN\'den üstün:');
            leaderResults.filter(r => r.leaderBlended > tahminBase.leaderBlended + 0.02)
                .slice(0, 10).forEach(r => {
                    console.log('    ★ ' + r.m.label + ' → ' + pct(r.leaderBlended)
                        + ' (+' + pct(r.leaderBlended - tahminBase.leaderBlended) + ')');
                });

            const corrTop = catalog.map(m => {
                const c = evaluateRankCorrelation(raceGroups, m.get, host);
                return c.n >= cli.minRaces ? { m, ...c } : null;
            }).filter(Boolean).sort((a, b) => b.inverted - a.inverted).slice(0, 5);

            console.log('\n  Öncelik 2 — sıralama korelasyonu (bitişi en iyi ayıran):');
            corrTop.forEach(r => {
                console.log('    ◆ ' + r.m.label + ' · -ρ=' + (r.inverted ?? 0).toFixed(3));
            });

            const winTop = catalog.map(m => {
                const w = evaluateWinnerProfile(withBitis, m.get, host);
                return w.winN >= 2 ? { m, ...w } : null;
            }).filter(Boolean).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 5);

            console.log('\n  Öncelik 3 — kazananlarda belirgin yüksek:');
            winTop.forEach(r => {
                console.log('    ▲ ' + r.m.label + ' · Δ=' + formatMetricVal(r.delta)
                    + ' (1.ort=' + formatMetricVal(r.winAvg) + ')');
            });

            console.log('\n  Öncelik 4 — sekme birleşik skorlar (combo):');
            if (comboResults.length) {
                comboResults.slice(0, 8).forEach(r => {
                    console.log('    ◈ ' + r.combo.label + ' → ' + pct(r.leaderBlended)
                        + ' (+' + pct(r.leaderBlended - tahminBase.leaderBlended) + ' vs TAHMİN)');
                });
            }
        }

        const comboCount = comboCatalog ? comboCatalog.length : 0;
        console.log('\nOK · ' + catalog.length + ' tek metrik · ' + comboCount + ' combo · '
            + raceGroups.length + ' koşu · ' + withBitis.length + ' BİTİŞ');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
