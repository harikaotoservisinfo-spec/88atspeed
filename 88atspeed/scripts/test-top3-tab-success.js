#!/usr/bin/env node
/**
 * Test sekmeleri — ilk 3 (1-3) başarı raporu
 * Her sekme tek tek + hepsi bir arada (MEGA rank fusion)
 *
 *   node scripts/test-top3-tab-success.js
 *   node scripts/test-top3-tab-success.js --kayit 148
 *   node scripts/test-top3-tab-success.js --all-kayitlar
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
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
    allKayitlar: args.includes('--all-kayitlar') || !argVal('--kayit')
};

const BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

const TAB_SIGNALS = [
    { id: 'TAH', label: 'TAHMİN', kind: 'tahmin', get: e => e.row?.tahmin?.score ?? null },
    { id: 'AS', label: 'KOŞU AT SAYISI', group: 'fieldSize', key: 'cnt123' },
    { id: 'SH', label: 'ŞEHİR', group: 'sehir', key: 'sehirPct' },
    { id: 'KC', label: 'KOŞU CİNSİ', group: 'kcins_kosu', key: 'matchPct' },
    { id: 'TK', label: 'TAKİ', group: 'taki', key: 'matchPct' },
    { id: 'PS', label: 'PİST', group: 'pist', key: 'matchPct' },
    { id: 'HP', label: 'HP', group: 'hp', key: 'matchPct' },
    { id: 'SK', label: 'SİKLET', group: 'siklet', key: 'matchPct' }
];

const TAB_RANK_FUSION = {
    AS: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'fieldSize', 'max123'),
        e => getMetric(e, 'fieldSize', 'cnt123'),
        e => getMetric(e, 'fieldSize', 'max12'),
        e => getMetric(e, 'fieldSize', 'kosuSayisi')
    ]),
    SH: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'sehir', 'sehirPct'),
        e => getMetric(e, 'sehir', 'inCityCount'),
        e => getMetric(e, 'sehir', 'max123'),
        e => getMetric(e, 'sehir', 'cnt123')
    ]),
    KC: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'kcins_kosu', 'matchPct'),
        e => getMetric(e, 'kcins_kosu', 'max123'),
        e => getMetric(e, 'kcins_kosu', 'cnt123')
    ]),
    TK: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'taki', 'matchPct'),
        e => getMetric(e, 'taki', 'max123'),
        e => getMetric(e, 'taki', 'cnt123')
    ]),
    PS: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'pist', 'matchPct'),
        e => getMetric(e, 'pist', 'max123'),
        e => getMetric(e, 'pist', 'cnt123')
    ]),
    HP: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'hp', 'matchPct'),
        e => getMetric(e, 'hp', 'max123'),
        e => getMetric(e, 'hp', 'cnt123')
    ]),
    SK: entries => buildRankFusionScorer(entries, [
        e => getMetric(e, 'siklet', 'matchPct'),
        e => getMetric(e, 'siklet', 'max123'),
        e => getMetric(e, 'siklet', 'cnt123')
    ])
};

function loadAllEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8') + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8') + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8') + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/dimension-tahmin-boost-engine.js'), 'utf8') + '\n; global.DimensionTahminBoostEngine = DimensionTahminBoostEngine;');
}

function blendedFromCounts(total, b1, b12, b123) {
    if (!total) return 0;
    return BLEND.b1 * (b1 / total) + BLEND.b12 * (b12 / total) + BLEND.b123 * (b123 / total);
}

function pickScoredLeader(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function getMetric(entry, group, key, win) {
    const g = entry._dim?.[group];
    if (!g) return null;
    const src = win ? g.windows?.[win] : g;
    if (!src) return null;
    const v = src[key];
    if (v == null || v === '' || v === '—') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function signalGetter(sig) {
    if (sig.get) return sig.get;
    return e => getMetric(e, sig.group, sig.key, sig.win);
}

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
        let sum = 0, n = 0;
        for (const map of rankMaps) {
            const r = map.get(entry);
            if (r != null) { sum += r; n++; }
        }
        if (!n) return null;
        return 1000 / (sum / n);
    };
}

function buildMegaScorer(entries) {
    return buildRankFusionScorer(entries, [
        e => getMetric(e, 'fieldSize', 'cnt123'),
        e => getMetric(e, 'sehir', 'cnt123'),
        e => getMetric(e, 'kcins_kosu', 'cnt123'),
        e => getMetric(e, 'taki', 'cnt123'),
        e => getMetric(e, 'pist', 'cnt123'),
        e => getMetric(e, 'hp', 'cnt123'),
        e => getMetric(e, 'siklet', 'cnt123'),
        e => getMetric(e, 'fieldSize', 'max123'),
        e => getMetric(e, 'sehir', 'sehirPct'),
        e => getMetric(e, 'taki', 'matchPct')
    ]);
}

function evaluatePerRaceSignal(raceGroups, buildGetScore, host) {
    let n = 0, b1 = 0, b12 = 0, b123 = 0, ties = 0;
    for (const entries of raceGroups) {
        const getScore = buildGetScore(entries);
        const scored = entries.map(e => ({ entry: e, score: getScore(e) })).filter(s => s.score != null);
        const leader = pickScoredLeader(scored);
        if (!leader) { ties++; continue; }
        const bitis = host.bitisValueForSort(leader.entry);
        if (bitis == null || bitis < 1) continue;
        n++;
        if (bitis === 1) b1++;
        if (bitis <= 2) b12++;
        if (bitis <= 3) b123++;
    }
    return {
        n, b1, b12, b123, ties,
        exact: n ? b1 / n : 0,
        top2: n ? b12 / n : 0,
        top3: n ? b123 / n : 0,
        blended: blendedFromCounts(n, b1, b12, b123)
    };
}

function evaluateSignal(raceGroups, getScore, host) {
    return evaluatePerRaceSignal(raceGroups, () => getScore, host);
}

async function loadRawHorseLookup(db, kayitId) {
    const lookup = new Map();
    let sql = 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari';
    const params = [];
    if (kayitId) { sql += ' WHERE id = ?'; params.push(kayitId); }
    const kayitlar = await dbAll(db, sql, params);
    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) { continue; }
        for (let i = 0; i < races.length; i++) {
            const race = races[i];
            const raceNo = race.raceNo || (i + 1);
            for (const horse of race.horses || []) {
                lookup.set(rowKeyParts(kayit.id, raceNo, horse.no), {
                    horse, race, hipodrom: kayit.hipodrom, tarih: kayit.tarih
                });
            }
        }
    }
    return lookup;
}

function computeDimensionBundle(raw) {
    const kosular = raw?.horse?.kosular || [];
    const horseCtx = Object.assign({}, raw.horse, { kosular });
    const programTarih = raw?.tarih || null;
    const out = {
        fieldSize: FieldSizeStatsEngine.computeStats(kosular, programTarih),
        sehir: SehirStatsEngine.computeStats(kosular, raw.hipodrom, programTarih)
    };
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        out[key] = KosuDimensionStatsEngine.computeStats(
            kosular, key, dim.getTarget(horseCtx, raw.race), programTarih);
    }
    return out;
}

function attachDimensionStats(entries, lookup) {
    for (const entry of entries) {
        const raw = lookup.get(rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no));
        if (!raw) continue;
        entry._dimRaw = raw;
        entry._dim = computeDimensionBundle(raw);
    }
}

function attachTahmin(raceGroups) {
    for (const entries of raceGroups) {
        const pkg = {
            rows: entries.map(e => e.row),
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null
        };
        HybridTahminScoringEngine.attachRaceTahmin(pkg);
    }
}

function formatRow(label, r, note) {
    return '  ' + pad(label, 16)
        + pad(pct(r.top3), 8)
        + pad(pct(r.exact), 8)
        + pad(pct(r.top2), 8)
        + pad(pct(r.blended), 10)
        + pad(String(r.n), 4)
        + (note || '');
}

async function main() {
    loadAllEngines();
    const db = openDb(cli.dbPath);
    try {
        const lookup = await loadRawHorseLookup(db, cli.kayitId);
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        attachDimensionStats(flatEntries, lookup);

        const withBitis = flatEntries.filter(e => host.bitisValueForSort(e) != null && e._dim);
        const raceMap = new Map();
        for (const e of withBitis) {
            const k = String(e.kayitId) + '|' + e.raceNo;
            if (!raceMap.has(k)) raceMap.set(k, []);
            raceMap.get(k).push(e);
        }
        const raceGroups = [...raceMap.values()].sort((a, b) => {
            const ka = Number(a[0].kayitId), kb = Number(b[0].kayitId);
            return ka - kb || Number(a[0].raceNo) - Number(b[0].raceNo);
        });
        attachTahmin(raceGroups);

        const kayitIds = [...new Set(withBitis.map(e => e.kayitId))].sort((a, b) => a - b);

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  İlk 3 başarı raporu — test sekmeleri (tek tek + birleşik)       ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Kapsam: ' + (cli.kayitId ? 'Kayıt #' + cli.kayitId : 'Tüm kayıtlar (#' + kayitIds.join(', #') + ')'));
        console.log('Koşu: ' + raceGroups.length + ' · BİTİŞ kayıtlı at: ' + withBitis.length);
        console.log('Yöntem: her koşuda metrik lideri → BİTİŞ kontrolü');
        console.log('Metrik: UI lider sütunu (AS=cnt123, SH=ŞEH%, diğer=match%) + RF = rank fusion\n');

        console.log('── SEKME SEKME — lider at ilk 3\'te mi? ──');
        console.log('  ' + pad('Sekme', 16) + pad('1-3%', 8) + pad('★1.%', 8) + pad('1-2%', 8) + pad('Karışık', 10) + pad('n', 4) + 'Not');
        console.log('  ' + '-'.repeat(72));

        const results = [];
        for (const sig of TAB_SIGNALS) {
            const r = evaluateSignal(raceGroups, signalGetter(sig), host);
            results.push({ sig, mode: 'tek', ...r });
            const note = r.ties ? 'berab=' + r.ties : '';
            console.log(formatRow(sig.label, r, note));
        }

        console.log('\n── SEKME RANK FUSION (tüm sütunlar birleşik) ──');
        console.log('  ' + pad('Sekme', 16) + pad('1-3%', 8) + pad('★1.%', 8) + pad('1-2%', 8) + pad('Karışık', 10) + pad('n', 4) + 'Not');
        console.log('  ' + '-'.repeat(72));
        const rfResults = [];
        for (const sig of TAB_SIGNALS.filter(s => TAB_RANK_FUSION[s.id])) {
            const r = evaluatePerRaceSignal(raceGroups, TAB_RANK_FUSION[sig.id], host);
            rfResults.push({ sig, mode: 'rf', ...r });
            const note = r.ties ? 'berab=' + r.ties : '';
            console.log(formatRow(sig.id + ' RF', r, note));
        }

        const megaEval = evaluatePerRaceSignal(raceGroups, buildMegaScorer, host);

        console.log('\n── HEPSİ BİRLİKTE (MEGA) ──');
        console.log('  ' + pad('Sekme', 16) + pad('1-3%', 8) + pad('★1.%', 8) + pad('1-2%', 8) + pad('Karışık', 10) + pad('n', 4) + 'Not');
        console.log('  ' + '-'.repeat(72));
        console.log(formatRow('MEGA (7 sekme)', megaEval, megaEval.ties ? 'berab=' + megaEval.ties : ''));

        const allRanked = [...results, ...rfResults, { sig: { label: 'MEGA' }, mode: 'mega', ...megaEval }]
            .filter(r => r.n > 0)
            .sort((a, b) => b.top3 - a.top3 || b.exact - a.exact);

        console.log('\n── SIRALAMA (1-3% ye göre, en iyi yöntemler) ──');
        for (let i = 0; i < Math.min(12, allRanked.length); i++) {
            const r = allRanked[i];
            const tag = r.mode === 'rf' ? ' [RF]' : (r.mode === 'mega' ? ' [MEGA]' : '');
            console.log('  ' + (i + 1) + '. ' + pad(r.sig.label + tag, 18) + ' 1-3=' + pct(r.top3) + '  ★=' + pct(r.exact) + '  1-2=' + pct(r.top2) + '  n=' + r.n);
        }

        const best = allRanked[0];
        const baseline = withBitis.length / raceGroups.length;
        console.log('\n── BAĞLAM ──');
        console.log('  Rastgele tek at seçimi (ilk 3): ~' + pct(Math.min(1, 3 / baseline)));
        console.log('  Ortalama alan: ' + baseline.toFixed(1) + ' at/koşu');
        if (best) {
            console.log('  En iyi yöntem (1-3): ' + best.sig.label + (best.mode === 'rf' ? ' rank fusion' : best.mode === 'mega' ? ' MEGA' : '') + ' → ' + pct(best.top3));
            console.log('  MEGA vs en iyi: ' + (megaEval.top3 >= best.top3 ? '+' : '') + pct(megaEval.top3 - best.top3));
        }

        console.log('\n── KOŞU KOŞU (ilk 10) ──');
        console.log('  ' + pad('Kayıt', 6) + pad('K#', 4) + pad('At', 3)
            + TAB_SIGNALS.map(s => pad(s.id, 7)).join('') + pad('MEGA', 7) + '  Kazanan');
        console.log('  ' + '-'.repeat(28 + TAB_SIGNALS.length * 7 + 7 + 16));
        const mark = b => b == null ? '?' : (b === 1 ? '★' : (b <= 3 ? '◆' : '·'));

        for (const entries of raceGroups.slice(0, 10)) {
            const e0 = entries[0];
            const winner = entries.find(e => host.bitisValueForSort(e) === 1);
            const wName = winner ? (winner.row?.name || '?').replace(/\(\d+\)/, '').trim().slice(0, 14) : '?';
            let line = pad('#' + e0.kayitId, 6) + pad('K' + e0.raceNo, 4) + pad(String(entries.length), 3);

            for (const sig of TAB_SIGNALS) {
                const scored = entries.map(e => ({ entry: e, score: signalGetter(sig)(e) })).filter(s => s.score != null);
                const leader = pickScoredLeader(scored);
                const b = leader ? host.bitisValueForSort(leader.entry) : null;
                line += pad(leader ? mark(b) : '—', 7);
            }
            const getMega = buildMegaScorer(entries);
            const megaScored = entries.map(e => ({ entry: e, score: getMega(e) })).filter(s => s.score != null);
            const megaLeader = pickScoredLeader(megaScored);
            const mb = megaLeader ? host.bitisValueForSort(megaLeader.entry) : null;
            line += pad(megaLeader ? mark(mb) : '—', 7) + '  ' + wName;
            console.log('  ' + line);
        }
        if (raceGroups.length > 10) console.log('  ... +' + (raceGroups.length - 10) + ' koşu daha');

        console.log('\n★=1. ◆=2-3 ·=4+ · —=beraberlik');
        console.log('Detay: npm run test:dimension-finish -- --phase leader,combo,compare --min-races 1\n');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
