#!/usr/bin/env node
/**
 * Test sekmeleri — EKSAUSTİF BİTİŞ korelasyon raporu
 *
 * UI'daki TÜM sütunları test eder (KOŞU, %, MAX-*, cnt*, eşleşme oranı + S5–S1 pencereleri):
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
 *   node scripts/test-dimension-finish-correlation.js --all-races
 *   node scripts/test-dimension-finish-correlation.js --context
 *   node scripts/test-dimension-finish-correlation.js --windows
 *   node scripts/test-dimension-finish-correlation.js --phase windows --kayit 148
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
    allRaces: args.includes('--all-races'),
    context: args.includes('--context'),
    windows: args.includes('--windows'),
    listKayitlar: args.includes('--list-kayitlar'),
    engine: (argVal('--engine') || 'hybrid').toLowerCase(),
    phases: (() => {
        if (args.includes('--context')) return ['context'];
        if (args.includes('--all-races')) return ['per-race'];
        if (args.includes('--windows')) return ['windows'];
        if (phasesRaw === 'all') {
            return ['leader', 'bucket', 'corr', 'winner', 'agree', 'combo', 'compare', 'segment', 'race', 'plan'];
        }
        return phasesRaw.split(',').map(s => s.trim()).filter(Boolean);
    })()
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

const RECENT_WINDOWS = [5, 4, 3, 2, 1];
const WINDOW_LADDER = [null, 5, 4, 3, 2, 1];

const WINDOW_CORE_KEYS = {
    fieldSize: ['kosuSayisi', 'cnt123', 'cnt1', 'max123', '_cnt123rate'],
    sehir: ['sehirPct', 'inCityCount', 'cnt123', 'max123', 'matchHitPct'],
    default: ['matchPct', 'matchCount', 'cnt123', 'cnt1', 'max123', 'matchHitPct', '_max123xpct']
};

function windowLabel(w) {
    return w == null ? 'TÜM' : 'S' + w;
}

function catalogMetric(catalog, short, key, windowSize) {
    const winTag = windowSize ? '.S' + windowSize : '';
    return catalog.find(m => m.id === short + winTag + '.' + key) || null;
}

function recencyTrendLabel(delta) {
    if (delta == null || isNaN(delta)) return '—';
    if (delta > 0.04) return '↑↑ yakın güçlü';
    if (delta > 0.015) return '↑ yakın daha iyi';
    if (delta < -0.04) return '↓↓ uzak daha iyi';
    if (delta < -0.015) return '↓ uzak daha iyi';
    return '≈ fark yok';
}

function linearRecencySlope(scoresByWindow) {
    const xMap = { all: 0, 5: 1, 4: 2, 3: 3, 2: 4, 1: 5 };
    const pts = [];
    for (const w of WINDOW_LADDER) {
        const wKey = w == null ? 'all' : w;
        const y = scoresByWindow[wKey];
        if (y == null) continue;
        pts.push({ x: xMap[wKey], y });
    }
    if (pts.length < 3) return null;
    const n = pts.length;
    const sx = pts.reduce((a, p) => a + p.x, 0);
    const sy = pts.reduce((a, p) => a + p.y, 0);
    const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
    const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    return (n * sxy - sx * sy) / denom;
}

function buildWindowRankFusionScorer(catalog, tg, windowSize, entries) {
    const keys = tg.group === 'fieldSize' ? WINDOW_CORE_KEYS.fieldSize
        : tg.group === 'sehir' ? WINDOW_CORE_KEYS.sehir
            : WINDOW_CORE_KEYS.default;
    const rfKeys = keys.filter(k =>
        k.includes('Pct') || k.includes('Count') || k === 'matchHitPct'
        || k.startsWith('cnt') || k === 'kosuSayisi' || k.includes('rate')
    ).slice(0, 5);
    const getters = rfKeys.map(k => {
        const m = catalogMetric(catalog, tg.short, k, windowSize);
        return m ? e => m.get(e) : null;
    }).filter(Boolean);
    if (!getters.length) return null;
    return buildRankFusionScorer(entries, getters);
}

function printWindowCorrelationPhase(catalog, raceGroups, withBitis, host, minRaces, tahminBase) {
    hr('PENCERE KORELASYONU — TÜM vs S5→S1 · BİTİŞ başarısı');
    console.log('  Her sekme kendi metrikleriyle analiz edilir.');
    console.log('  Karışık = 80/12/8 (★/◆/·). Δ(S1-TÜM) pozitif → son 1 koşu sinyali daha başarılı.');
    console.log('  Eğim > 0 → yakın pencereye indikçe lider isabeti artıyor.');
    console.log('  minRaces=' + minRaces + ' · parantez = kullanılabilir koşu (beraberlik atlanır)\n');

    if (tahminBase) {
        console.log('  TAHMİN referans: karışık ' + pct(tahminBase.leaderBlended)
            + ' · ★ ' + pct(tahminBase.exactRate) + ' · n=' + tahminBase.leaderTotal + '\n');
    }

    const tabBestWindow = [];
    const recencyWins = { up: 0, down: 0, flat: 0 };
    const allComparisons = [];

    for (const tg of TAB_GROUPS) {
        const keys = tg.group === 'fieldSize' ? WINDOW_CORE_KEYS.fieldSize
            : tg.group === 'sehir' ? WINDOW_CORE_KEYS.sehir
                : WINDOW_CORE_KEYS.default;

        sub(tg.tab + ' — lider karışık oran (pencere × metrik)');
        const hdr = pad('Metrik', 16)
            + WINDOW_LADDER.map(w => pad(windowLabel(w), 8)).join('')
            + pad('Δ(S1-TÜM)', 10) + pad('Eğim', 8) + 'Yorum';
        console.log('  ' + hdr);
        console.log('  ' + '-'.repeat(Math.min(hdr.length, 100)));

        const windowWins = { all: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

        for (const key of keys) {
            const cells = [];
            const scoresByWindow = {};
            let allScore = null;
            let s1Score = null;

            for (const w of WINDOW_LADDER) {
                const m = catalogMetric(catalog, tg.short, key, w);
                if (!m) {
                    cells.push(pad('—', 8));
                    continue;
                }
                const r = evaluateRaceLeader(raceGroups, m.get, host);
                cells.push(formatLeaderCell(r, minRaces));
                if (r.leaderTotal < minRaces) continue;
                const wKey = w == null ? 'all' : w;
                scoresByWindow[wKey] = r.leaderBlended;
                if (w == null) allScore = r.leaderBlended;
                if (w === 1) s1Score = r.leaderBlended;
            }

            const delta = (allScore != null && s1Score != null) ? s1Score - allScore : null;
            const slope = linearRecencySlope(scoresByWindow);
            const trend = recencyTrendLabel(delta);

            if (delta != null) {
                allComparisons.push({ tg, key, delta, slope, allScore, s1Score, trend });
                if (delta > 0.015) recencyWins.up++;
                else if (delta < -0.015) recencyWins.down++;
                else recencyWins.flat++;
            }

            console.log('  ' + pad(key, 16) + cells.join('')
                + pad(delta != null ? ((delta >= 0 ? '+' : '') + pct(delta)) : '—', 10)
                + pad(slope != null ? slope.toFixed(3) : '—', 8)
                + trend);
        }

        sub(tg.tab + ' — Rank-Fusion (pencere içi çoklu metrik)');
        const fusionRows = [];
        for (const w of WINDOW_LADDER) {
            const sampleEntries = raceGroups[0] || [];
            const scorer = buildWindowRankFusionScorer(catalog, tg, w, sampleEntries);
            if (!scorer) continue;
            const r = evaluateRaceLeader(raceGroups, scorer, host);
            if (r.leaderTotal < minRaces) continue;
            fusionRows.push({ w, r });
            const wKey = w == null ? 'all' : w;
            windowWins[wKey] = (windowWins[wKey] || 0) + r.leaderBlended;
        }
        fusionRows.sort((a, b) => b.r.leaderBlended - a.r.leaderBlended);
        for (const row of fusionRows) {
            console.log('  ' + pad(windowLabel(row.w), 6)
                + ' RF karışık ' + pad(pct(row.r.leaderBlended), 7)
                + ' · ★ ' + pad(pct(row.exactRate), 7)
                + ' · n=' + row.r.leaderTotal);
        }
        if (fusionRows.length) {
            const best = fusionRows[0];
            tabBestWindow.push({
                tab: tg.tab,
                short: tg.short,
                window: best.w,
                blended: best.r.leaderBlended,
                exact: best.r.exactRate,
                n: best.r.leaderTotal
            });
        }

        sub(tg.tab + ' — Spearman (-ρ) pencere kıyası');
        const corrByWindow = [];
        for (const w of WINDOW_LADDER) {
            const matchM = catalogMetric(catalog, tg.short,
                tg.group === 'sehir' ? 'sehirPct' : tg.group === 'fieldSize' ? 'cnt123' : 'matchPct', w);
            const cntM = catalogMetric(catalog, tg.short, 'cnt123', w);
            const metrics = [matchM, cntM].filter(Boolean);
            let bestInv = null;
            let bestLabel = '';
            for (const m of metrics) {
                const c = evaluateRankCorrelation(raceGroups, m.get, host);
                if (c.n < minRaces || c.inverted == null) continue;
                if (bestInv == null || c.inverted > bestInv) {
                    bestInv = c.inverted;
                    bestLabel = m.col;
                }
            }
            if (bestInv != null) {
                corrByWindow.push({ w, inv: bestInv, label: bestLabel });
                console.log('  ' + pad(windowLabel(w), 6) + ' en iyi -ρ=' + bestInv.toFixed(3)
                    + ' (' + bestLabel + ')');
            }
        }
        if (corrByWindow.length >= 2) {
            const allC = corrByWindow.find(x => x.w == null);
            const s1C = corrByWindow.find(x => x.w === 1);
            if (allC && s1C) {
                const d = s1C.inv - allC.inv;
                console.log('  → S1 vs TÜM -ρ farkı: ' + (d >= 0 ? '+' : '') + d.toFixed(3)
                    + (d > 0.02 ? ' (yakın dönem daha iyi sıralıyor)' : d < -0.02 ? ' (tüm geçmiş daha iyi)' : ''));
            }
        }
    }

    sub('YAKIN DÖNEM HİPOTEZİ — S1 vs TÜM (tüm sekmeler)');
    console.log('  S1 > TÜM (+Δ): ' + recencyWins.up + ' metrik');
    console.log('  S1 < TÜM (-Δ): ' + recencyWins.down + ' metrik');
    console.log('  ≈ aynı       : ' + recencyWins.flat + ' metrik');
    const pctUp = allComparisons.length
        ? Math.round(1000 * recencyWins.up / allComparisons.length) / 10 : 0;
    console.log('  Sonuç: ' + (pctUp >= 55
        ? 'Yakın dönem (S1) çoğu metrikte TÜM geçmişten DAHA İYİ — form yakın dönemde daha ayırt edici.'
        : pctUp <= 45
            ? 'TÜM geçmiş çoğu metrikte S1\'den DAHA İYİ — uzun seri daha güvenilir.'
            : 'Karışık — sekme/metrik bazında seçim gerekir.'));

    allComparisons.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
    sub('EN ÇOK YAKIN DÖNEM KAZANANLARI — Δ(S1-TÜM) TOP');
    allComparisons.slice(0, 12).forEach((r, i) => {
        console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.tg.short + '.' + r.key, 18)
            + ' TÜM=' + pad(pct(r.allScore), 6) + ' S1=' + pad(pct(r.s1Score), 6)
            + ' Δ=' + pad((r.delta >= 0 ? '+' : '') + pct(r.delta), 7)
            + ' · ' + r.trend);
    });

    sub('EN ÇOK UZAK DÖNEM KAZANANLARI — TÜM geçmiş daha iyi');
    [...allComparisons].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 8).forEach((r, i) => {
        console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.tg.short + '.' + r.key, 18)
            + ' TÜM=' + pad(pct(r.allScore), 6) + ' S1=' + pad(pct(r.s1Score), 6)
            + ' Δ=' + pad(pct(r.delta), 7));
    });

    sub('SEKME BAZINDA EN İYİ PENCERE (Rank-Fusion)');
    tabBestWindow.sort((a, b) => b.blended - a.blended);
    for (const r of tabBestWindow) {
        const vsTah = tahminBase ? r.blended - tahminBase.leaderBlended : null;
        console.log('  ' + pad(r.tab, 18) + ' → ' + pad(windowLabel(r.window), 5)
            + ' karışık ' + pad(pct(r.blended), 7)
            + ' · ★ ' + pad(pct(r.exact), 7)
            + ' · n=' + r.n
            + (vsTah != null ? ' · vs TAHMİN ' + (vsTah >= 0 ? '+' : '') + pct(vsTah) : ''));
    }

    sub('SENARYO MATRİSİ — hangi pencere ne zaman?');
    const scenarios = [
        {
            label: 'S1 matchPct lideri',
            desc: 'Son koşuda hedefe en iyi uyan at',
            get: tg => catalogMetric(catalog, tg.short, tg.group === 'sehir' ? 'sehirPct' : tg.group === 'fieldSize' ? 'cnt123' : 'matchPct', 1)
        },
        {
            label: 'S3 cnt123 lideri',
            desc: 'Son 3 koşuda en çok plase',
            get: tg => catalogMetric(catalog, tg.short, 'cnt123', 3)
        },
        {
            label: 'TÜM matchPct lideri',
            desc: 'Tüm geçmişte hedef uyumu',
            get: tg => catalogMetric(catalog, tg.short, tg.group === 'sehir' ? 'sehirPct' : tg.group === 'fieldSize' ? 'cnt123' : 'matchPct', null)
        },
        {
            label: 'S5 RF birleşik',
            desc: 'Son 5 koşu çoklu metrik fusion',
            get: tg => null,
            rfWindow: 5
        }
    ];

    for (const sc of scenarios) {
        let best = null;
        for (const tg of TAB_GROUPS) {
            let r;
            if (sc.rfWindow != null) {
                const scorer = buildWindowRankFusionScorer(catalog, tg, sc.rfWindow, raceGroups[0] || []);
                if (!scorer) continue;
                r = evaluateRaceLeader(raceGroups, scorer, host);
            } else {
                const m = sc.get(tg);
                if (!m) continue;
                r = evaluateRaceLeader(raceGroups, m.get, host);
            }
            if (r.leaderTotal < minRaces) continue;
            if (!best || r.leaderBlended > best.r.leaderBlended) {
                best = { tg, r };
            }
        }
        if (best) {
            console.log('  ' + pad(sc.label, 22) + ' → ' + pad(best.tg.short, 4)
                + ' karışık ' + pad(pct(best.r.leaderBlended), 7)
                + ' · ★ ' + pad(pct(best.r.exactRate), 7)
                + ' · n=' + best.r.leaderTotal
                + '  (' + sc.desc + ')');
        }
    }

    sub('KAZANAN PROFİLİ — S1 vs TÜM ortalama fark (Δ)');
    for (const tg of TAB_GROUPS.filter(t => t.group !== 'fieldSize')) {
        const pctKey = tg.group === 'sehir' ? 'sehirPct' : 'matchPct';
        const mAll = catalogMetric(catalog, tg.short, pctKey, null);
        const mS1 = catalogMetric(catalog, tg.short, pctKey, 1);
        if (!mAll || !mS1) continue;
        const wAll = evaluateWinnerProfile(withBitis, mAll.get, host);
        const wS1 = evaluateWinnerProfile(withBitis, mS1.get, host);
        if (wAll.winN < 2 || wS1.winN < 2) continue;
        const d = (wS1.delta ?? 0) - (wAll.delta ?? 0);
        console.log('  ' + pad(tg.short + '.' + pctKey, 12)
            + ' TÜM Δ=' + pad(formatMetricVal(wAll.delta), 6)
            + ' S1 Δ=' + pad(formatMetricVal(wS1.delta), 6)
            + ' · 1.bitiş n=' + wAll.winN
            + (d > 1 ? ' → S1 kazananları daha yüksek%' : d < -1 ? ' → TÜM daha ayırt edici' : ''));
    }
}

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }
function hasPhase(p) { return cli.phases.includes(p); }

function effectiveMinRaces(raceCount) {
    if (argVal('--min-races') != null) return cli.minRaces;
    if (cli.raceNo || cli.windows) return 1;
    if (raceCount < cli.minRaces) return Math.max(1, raceCount);
    return cli.minRaces;
}

function formatLeaderCell(r, minRaces) {
    if (!r.leaderTotal) return pad('tie', 8);
    if (r.leaderTotal < minRaces) return pad('n<' + minRaces, 8);
    const s = pct(r.leaderBlended);
    return pad(r.leaderTotal < 7 ? s + '(' + r.leaderTotal + ')' : s, 8);
}

/** Üst skor beraberlikte (özellikle hepsi 0) en düşük at no ile sahte lider seçme */
function pickScoredLeader(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function isMatchOnlyMetric(m) {
    const k = m.key;
    if (k.startsWith('cnt') || k.startsWith('max') || k.includes('max123') || k === '_cnt123rate') return false;
    if (k === 'kosuSayisi') return false;
    return true;
}

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

function gval(entry, group, key, windowSize) {
    if (key === 'matchHitPct') return getMatchHitPct(entry, group, windowSize);
    return getMetric(entry, group, key, windowSize);
}

/** Forensics grid — sabit sekme UI sütunları (lider skoruna göre değil) */
const FORENSICS_COLUMNS = [
    { label: 'AS.KOŞU', get: e => gval(e, 'fieldSize', 'kosuSayisi') },
    { label: 'AS.1-2-3', get: e => gval(e, 'fieldSize', 'cnt123') },
    { label: 'SH.ŞEH%', get: e => gval(e, 'sehir', 'sehirPct') },
    { label: 'SH.1-2-3', get: e => gval(e, 'sehir', 'cnt123') },
    { label: 'KC.KC%', get: e => gval(e, 'kcins_kosu', 'matchPct') },
    { label: 'KC.1-2-3', get: e => gval(e, 'kcins_kosu', 'cnt123') },
    { label: 'TK.TK%', get: e => gval(e, 'taki', 'matchPct') },
    { label: 'TK.1-2-3', get: e => gval(e, 'taki', 'cnt123') },
    { label: 'PS.PİST%', get: e => gval(e, 'pist', 'matchPct') },
    { label: 'PS.1-2-3', get: e => gval(e, 'pist', 'cnt123') },
    { label: 'HP.HP%', get: e => gval(e, 'hp', 'matchPct') },
    { label: 'SK.SK%', get: e => gval(e, 'siklet', 'matchPct') }
];

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
        const leader = pickScoredLeader(scored);
        if (!leader) continue;
        const bitis = host.bitisValueForSort(leader.entry);
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

function bestSingleForTab(catalog, tab, raceGroups, host, minRaces) {
    const singles = catalog.filter(m => m.tab === tab);
    let best = null;
    for (const m of singles) {
        const r = evaluateRaceLeader(raceGroups, m.get, host);
        if (r.leaderTotal < minRaces) continue;
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
    function winTag(windowSize) {
        return windowSize ? '.S' + windowSize : '';
    }
    function add(group, key, col, tab, short, windowSize) {
        catalog.push({
            group, key, col, tab, short,
            windowSize: windowSize || null,
            id: short + winTag(windowSize) + '.' + key,
            label: tab + ' · ' + col + (windowSize ? ' (S' + windowSize + ')' : ''),
            get: e => getMetric(e, group, key, windowSize)
        });
    }
    function addGroupMetrics(tg, windowSize) {
        const winSuffix = windowSize ? '·S' + windowSize : '';
        add(tg.group, 'kosuSayisi', 'KOŞU' + winSuffix, tg.tab, tg.short, windowSize);
        if (tg.group === 'sehir') {
            add('sehir', 'sehirPct', 'ŞEH%' + winSuffix, tg.tab, tg.short, windowSize);
            add('sehir', 'inCityCount', 'Ş-KOŞU' + winSuffix, tg.tab, tg.short, windowSize);
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
            add(tg.group, 'matchPct', pctCol + winSuffix, tg.tab, tg.short, windowSize);
            add(tg.group, 'matchCount', cntCol + winSuffix, tg.tab, tg.short, windowSize);
        }
        for (const p of PLACEMENT_KEYS) {
            add(tg.group, p.key, p.col + winSuffix, tg.tab, tg.short, windowSize);
        }
        if (tg.group !== 'fieldSize') {
            catalog.push({
                group: tg.group, key: 'matchHitPct', col: 'EŞLEŞME%' + winSuffix, tab: tg.tab, short: tg.short,
                windowSize: windowSize || null,
                id: tg.short + winTag(windowSize) + '.matchHitPct',
                label: tg.tab + ' · EŞLEŞME%' + (windowSize ? ' (S' + windowSize + ')' : ''),
                get: e => getMatchHitPct(e, tg.group, windowSize)
            });
        }
    }
    for (const tg of TAB_GROUPS) {
        addGroupMetrics(tg, null);
        for (const w of RECENT_WINDOWS) {
            addGroupMetrics(tg, w);
        }
    }
    // türev metrikler (tüm zaman + pencere)
    function addDerived(group, short, tab, windowSize) {
        const winTag = windowSize ? '.S' + windowSize : '';
        const winLabel = windowSize ? ' (S' + windowSize + ')' : '';
        if (group === 'fieldSize') {
            catalog.push({
                group: 'fieldSize', key: '_cnt123rate', col: 'cnt123/KOŞU' + (windowSize ? '·S' + windowSize : ''),
                tab: 'KOŞU AT SAYISI', short: 'AS', windowSize: windowSize || null,
                id: 'AS' + winTag + '.cnt123rate',
                label: 'KOŞU AT SAYISI · cnt123/KOŞU' + winLabel,
                get: e => {
                    const k = getMetric(e, 'fieldSize', 'kosuSayisi', windowSize);
                    const c = getMetric(e, 'fieldSize', 'cnt123', windowSize);
                    return k > 0 && c != null ? c / k : null;
                }
            });
            return;
        }
        catalog.push({
            group, key: '_max123xpct', col: 'max123×%' + (windowSize ? '·S' + windowSize : ''),
            tab, short, windowSize: windowSize || null,
            id: short + winTag + '.max123xpct',
            label: tab + ' · max123×match%' + winLabel,
            get: e => {
                const m = getMetric(e, group, 'max123', windowSize);
                const p = group === 'sehir'
                    ? getMetric(e, group, 'sehirPct', windowSize)
                    : getMetric(e, group, 'matchPct', windowSize);
                return m != null && p != null ? m * p / 100 : null;
            }
        });
    }
    addDerived('fieldSize', 'AS', 'KOŞU AT SAYISI', null);
    for (const w of RECENT_WINDOWS) addDerived('fieldSize', 'AS', 'KOŞU AT SAYISI', w);
    for (const g of ['kcins_kosu', 'taki', 'pist', 'hp', 'siklet', 'sehir']) {
        const tg = TAB_GROUPS.find(t => t.group === g);
        addDerived(g, tg.short, tg.tab, null);
        for (const w of RECENT_WINDOWS) addDerived(g, tg.short, tg.tab, w);
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
    const programTarih = raw?.tarih || null;
    const out = {
        fieldSize: FieldSizeStatsEngine.computeStats(kosular, programTarih),
        sehir: SehirStatsEngine.computeStats(kosular, hipodrom, programTarih)
    };
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        out[key] = KosuDimensionStatsEngine.computeStats(
            kosular, key, dim.getTarget(horseCtx, race), programTarih
        );
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

function getMetric(entry, groupKey, metricKey, windowSize) {
    const g = entry._dim?.[groupKey];
    if (!g) return null;
    const src = windowSize ? g.windows?.[windowSize] : g;
    if (!src) return null;
    const v = src[metricKey];
    if (v == null || v === '' || v === '—') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function getMatchHitPct(entry, groupKey, windowSize) {
    const g = entry._dim?.[groupKey];
    if (!g) return null;
    const str = windowSize ? g.windows?.[windowSize]?.gecmisMatchStr : g.gecmisMatchStr;
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
        const leader = pickScoredLeader(scored);
        if (!leader) continue;
        const bitis = host.bitisValueForSort(leader.entry);
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

function attachTahminLeader(raceGroups, opts) {
    opts = opts || {};
    for (const entries of raceGroups) {
        const rows = entries.map(e => e.row);
        const pkg = {
            rows,
            depthCoverage: entries[0]?._pkg?.depthCoverage || null,
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null,
            skipDimensionBoost: opts.skipBoost === true
        };
        if (cli.engine === 'hybrid') HybridTahminScoringEngine.attachRaceTahmin(pkg);
        else GostergeScoringEngine.attachRaceTahmin(pkg);
    }
}

function evaluateTahminLeader(raceGroups, host, opts) {
    attachTahminLeader(raceGroups, opts);
    return evaluateRaceLeader(raceGroups, e => e.row?.tahmin?.score ?? null, host);
}

function formatMetricVal(v) {
    if (v == null) return '—';
    if (Math.abs(v) >= 100) return String(Math.round(v));
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(1);
}

function blendedSuccessFromBitis(bitis) {
    if (bitis == null || bitis < 1) return 0;
    if (bitis === 1) return SUCCESS_BLEND.b1;
    if (bitis <= 2) return SUCCESS_BLEND.b12;
    if (bitis <= 3) return SUCCESS_BLEND.b123;
    return 0;
}

function bitisMark(bitis) {
    if (bitis == null) return '?';
    if (bitis === 1) return '★';
    if (bitis <= 3) return '◆';
    return '·';
}

function shortHorseName(entry) {
    return (entry?.row?.name || '?').replace(/\(\d+\)/, '').trim();
}

function pickLeaderInRace(entries, getScore, host) {
    const scored = entries.map(e => ({ entry: e, score: getScore(e) }))
        .filter(s => s.score != null);
    const leader = pickScoredLeader(scored);
    if (!leader) {
        return { tie: true, bitis: null, name: '—', no: null, blended: 0, score: null };
    }
    const bitis = host.bitisValueForSort(leader.entry);
    return {
        tie: false,
        bitis,
        name: shortHorseName(leader.entry),
        no: leader.entry.row?.no,
        blended: blendedSuccessFromBitis(bitis),
        score: leader.score
    };
}

function formatPickCell(pick) {
    if (pick.tie) return pad('—', 9);
    const p = Math.round(pick.blended * 100);
    return pad(bitisMark(pick.bitis) + p + '%', 9);
}

function buildPerRaceSignals(comboCatalog, catalog) {
    const signals = [{ id: 'TAH', label: 'TAHMİN', kind: 'tahmin' }];
    for (const tg of TAB_GROUPS) {
        const rf = comboCatalog.find(c => c.id === tg.short + '.combo.rank-fusion');
        if (rf) signals.push({ id: tg.short + '-RF', label: tg.short + '-RF', combo: rf });
    }
    const mega = comboCatalog.find(c => c.id === 'MEGA.rank-fusion-all');
    if (mega) signals.push({ id: 'MEGA', label: 'MEGA-RF', combo: mega });
    for (const spec of [
        { id: 'TK.matchPct', label: 'TK%' },
        { id: 'HP.matchPct', label: 'HP%' },
        { id: 'KC.matchPct', label: 'KC%' }
    ]) {
        const m = catalog.find(c => c.id === spec.id);
        if (m) signals.push({ id: spec.id, label: spec.label, metric: m });
    }
    return signals;
}

function raceGroupSortKey(entries) {
    const e = entries[0];
    return [Number(e?.kayitId) || 0, Number(e?.raceNo) || 0];
}

function printPerRaceReport(raceGroups, host, comboCatalog, catalog) {
    attachTahminLeader(raceGroups);
    const signals = buildPerRaceSignals(comboCatalog, catalog);
    const sorted = [...raceGroups].sort((a, b) => {
        const [ka, ra] = raceGroupSortKey(a);
        const [kb, rb] = raceGroupSortKey(b);
        return ka - kb || ra - rb;
    });

    hr('9. KOŞU KOŞU BAŞARI — tüm koşular');
    console.log('  Hücre: ★/◆/· + karışık puan (80/12/8) · — = beraberlik · TAH# = kazananın TAHMİN sırası');
    console.log('  ' + pad('K#', 3) + pad('Kayıt', 6) + pad('At', 3) + pad('Kazanan (1.)', 18)
        + signals.map(s => pad(s.label, 9)).join('') + pad('TAH#', 5) + '  Lider atlar (kısa)');
    console.log('  ' + '-'.repeat(28 + signals.length * 9 + 5 + 24));

    const totals = signals.map(() => ({ n: 0, b1: 0, b12: 0, b123: 0, sum: 0 }));

    for (const entries of sorted) {
        const e0 = entries[0];
        const raw0 = e0?._dimRaw;
        const race = raw0?.race || {};
        const header = typeof AtMetaFields !== 'undefined'
            ? AtMetaFields.formatRaceHeader(race)
            : ((race.mesafe || '?') + ' ' + (race.pist || '')).trim();
        const winner = entries.find(e => host.bitisValueForSort(e) === 1);
        const winnerName = winner ? shortHorseName(winner).slice(0, 16) : '?';
        const tahRank = winner?.row?.tahmin?.rank ?? '—';

        const picks = signals.map(sig => {
            if (sig.kind === 'tahmin') {
                return pickLeaderInRace(entries, e => e.row?.tahmin?.score ?? null, host);
            }
            if (sig.combo) {
                const getScore = sig.combo.buildScorer(entries);
                return pickLeaderInRace(entries, getScore, host);
            }
            return pickLeaderInRace(entries, sig.metric.get, host);
        });

        picks.forEach((pick, i) => {
            if (pick.tie) return;
            totals[i].n++;
            totals[i].sum += pick.blended;
            if (pick.bitis === 1) totals[i].b1++;
            if (pick.bitis <= 2) totals[i].b12++;
            if (pick.bitis <= 3) totals[i].b123++;
        });

        const leaderSummary = picks.map((pick, i) => {
            if (pick.tie) return signals[i].label + ':—';
            return signals[i].label + ':' + pick.name.slice(0, 10) + '(B' + pick.bitis + ')';
        }).join(' ');

        let line = pad(String(e0.raceNo), 3) + pad('#' + e0.kayitId, 6)
            + pad(String(entries.length), 3) + pad(winnerName, 18);
        line += picks.map(formatPickCell).join('');
        line += pad(String(tahRank), 5);
        console.log('  ' + line);
        if (cli.verbose) {
            console.log('      ' + header);
            console.log('      ' + leaderSummary);
        }
    }

    sub('TOPLAM — yöntem başına karışık başarı');
    const totalRaces = sorted.length;
    signals.forEach((sig, i) => {
        const t = totals[i];
        const blended = t.n ? t.sum / t.n : 0;
        const exact = t.n ? t.b1 / t.n : 0;
        const tieSkip = totalRaces - t.n;
        console.log('  ' + pad(sig.label, 10)
            + ' karışık ' + pad(pct(blended), 7)
            + ' · 1. ' + pad(pct(exact), 7)
            + ' · n=' + t.n + '/' + totalRaces
            + (tieSkip ? ' · berab=' + tieSkip : ''));
    });

    sub('KOŞU BAZLI SAYIM — kaç koşuda ★ (1.)');
    const winCounts = signals.map((sig, i) => ({
        label: sig.label,
        wins: totals[i].b1,
        n: totals[i].n
    })).sort((a, b) => b.wins - a.wins);
    winCounts.forEach(w => {
        console.log('  ' + pad(w.label, 10) + ' ★ ' + w.wins + '/' + w.n + ' koşu'
            + (w.n ? ' (' + pct(w.wins / w.n) + ')' : ''));
    });
}

function getSignalScorer(sig, entries) {
    if (sig.kind === 'tahmin') return e => e.row?.tahmin?.score ?? null;
    if (sig.combo) return sig.combo.buildScorer(entries);
    return sig.metric.get;
}

function metricSpread(entries, getScore) {
    const vals = entries.map(e => getScore(e)).filter(v => v != null && Number.isFinite(v));
    if (!vals.length) return { n: 0, unique: 0, min: null, max: null, spread: 0 };
    const rounded = vals.map(v => Math.round(v * 10) / 10);
    const unique = new Set(rounded).size;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { n: vals.length, unique, min, max, spread: max - min };
}

function classifyRaceType(kcins) {
    const s = String(kcins || '').toLocaleLowerCase('tr-TR');
    if (/maiden|maid/i.test(s)) return 'Maiden';
    if (/kv[-\s]|kv\d/i.test(s)) return 'KV';
    if (/handikap|handicap|dhöw|dhö/i.test(s)) return 'Handikap/DHÖ';
    if (/şartlı|sartli/i.test(s)) return 'Şartlı';
    if (/grup|g\d/i.test(s)) return 'Grup';
    return 'Diğer';
}

function classifyBreed(kat) {
    const s = String(kat || '').toLocaleLowerCase('tr-TR');
    if (/arap/i.test(s)) return 'Arap';
    if (/ingiliz/i.test(s)) return 'İngiliz';
    return 'Diğer';
}

function mesafeBand(mesafe) {
    const n = parseInt(String(mesafe || '').replace(/\D/g, ''), 10);
    if (!n) return 'bilinmiyor';
    if (n <= 1200) return '≤1200m';
    if (n <= 1600) return '1201-1600m';
    if (n <= 2000) return '1601-2000m';
    return '2000m+';
}

function fieldMetricStats(entries, group, key) {
    const vals = entries.map(e => gval(e, group, key)).filter(v => v != null && Number.isFinite(v));
    if (!vals.length) return { n: 0, unique: 0, zero: 0, avg: null, min: null, max: null };
    const unique = new Set(vals.map(v => Math.round(v * 10) / 10)).size;
    const zero = vals.filter(v => v === 0).length;
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
        n: vals.length,
        unique,
        zero,
        avg: sum / vals.length,
        min: Math.min(...vals),
        max: Math.max(...vals)
    };
}

function extractRaceFactors(entries, raw) {
    const race = raw?.race || {};
    const rm = typeof AtMetaFields !== 'undefined'
        ? AtMetaFields.extractRaceMeta(race)
        : { mesafe: race.mesafe, pist: race.pist, kcins_kosu: race.kcins_kosu, kategori: race.kategori };
    const fieldSize = entries.length;
    const as = fieldMetricStats(entries, 'fieldSize', 'kosuSayisi');
    const tk = fieldMetricStats(entries, 'taki', 'matchPct');
    const kc = fieldMetricStats(entries, 'kcins_kosu', 'matchPct');
    const hp = fieldMetricStats(entries, 'hp', 'matchPct');
    const cnt123as = fieldMetricStats(entries, 'fieldSize', 'cnt123');

    const flags = [];
    if (as.n && as.zero === as.n) flags.push('AS_kosu_sifir');
    if (cnt123as.n && cnt123as.zero === cnt123as.n) flags.push('cnt123_sifir');
    if (tk.n && tk.unique <= 1) flags.push('TK_pct_duz');
    if (kc.n && kc.unique <= 1) flags.push('KC_pct_duz');
    if (hp.n && hp.unique <= 1) flags.push('HP_pct_duz');
    if (as.avg != null && as.avg < 3) flags.push('dusuk_AS_deneyim');
    const avgKosu = ['kcins_kosu', 'taki', 'pist', 'hp', 'siklet', 'sehir']
        .map(g => fieldMetricStats(entries, g, 'kosuSayisi').avg)
        .filter(v => v != null);
    const meanKosu = avgKosu.length ? avgKosu.reduce((a, b) => a + b, 0) / avgKosu.length : 0;
    if (meanKosu < 4) flags.push('dusuk_sekme_deneyim');

    return {
        fieldSize,
        fieldBand: fieldSize <= 7 ? '≤7 at' : fieldSize <= 9 ? '8-9 at' : '10+ at',
        mesafe: rm.mesafe,
        mesafeBand: mesafeBand(rm.mesafe),
        pist: rm.pist || '?',
        raceType: classifyRaceType(rm.kcins_kosu),
        breed: classifyBreed(rm.kategori),
        kcinsShort: String(rm.kcins_kosu || '—').slice(0, 28),
        katShort: String(rm.kategori || '—').slice(0, 24),
        hipodrom: raw?.hipodrom || '—',
        flags,
        as, tk, kc, hp, cnt123as,
        meanKosuExp: meanKosu
    };
}

function diagnoseSignalReason(pick, spread, winnerTahRank) {
    if (pick.tie) {
        if (spread.n === 0) return 'veri_yok — skor hesaplanamadı';
        if (spread.unique <= 1) return 'beraberlik — tüm atlar aynı değer (' + formatMetricVal(spread.max) + ')';
        return 'beraberlik — üst skor eşit (spread ' + formatMetricVal(spread.spread) + ')';
    }
    if (pick.bitis === 1) return 'isabet — lider 1. geldi';
    if (pick.bitis != null && pick.bitis <= 3) {
        return 'plase — lider B' + pick.bitis + ' (kazanan farklı)';
    }
    if (pick.bitis != null) {
        let msg = 'kaçtı — lider B' + pick.bitis;
        if (winnerTahRank != null && pick.score != null) msg += ' · kazanan TAH#' + winnerTahRank;
        return msg;
    }
    return 'bilinmiyor';
}

function diagnoseRaceRow(entries, signals, host) {
    attachTahminLeader([entries]);
    const raw = entries[0]?._dimRaw;
    const factors = extractRaceFactors(entries, raw);
    const winner = entries.find(e => host.bitisValueForSort(e) === 1);
    const winnerTahRank = winner?.row?.tahmin?.rank ?? null;

    const signalDiags = signals.map(sig => {
        const getScore = getSignalScorer(sig, entries);
        const pick = pickLeaderInRace(entries, getScore, host);
        const spread = metricSpread(entries, getScore);
        const reason = diagnoseSignalReason(pick, spread, winnerTahRank);
        const outcome = pick.tie ? 'tie' : pick.bitis === 1 ? 'hit' : pick.bitis <= 3 ? 'plase' : 'miss';
        return { id: sig.id, label: sig.label, pick, spread, reason, outcome };
    });

    return {
        raceNo: entries[0].raceNo,
        kayitId: entries[0].kayitId,
        factors,
        winnerName: winner ? shortHorseName(winner) : '?',
        winnerTahRank,
        header: typeof AtMetaFields !== 'undefined'
            ? AtMetaFields.formatRaceHeader(raw?.race || {})
            : '',
        signals: signalDiags
    };
}

function segmentStatsForSignal(rows, signalId) {
    let n = 0, sum = 0, b1 = 0, ties = 0;
    for (const row of rows) {
        const d = row.signals.find(s => s.id === signalId);
        if (!d) continue;
        if (d.pick.tie) { ties++; continue; }
        n++;
        sum += d.pick.blended;
        if (d.pick.bitis === 1) b1++;
    }
    return {
        n, ties, total: rows.length,
        blended: n ? sum / n : 0,
        exact: n ? b1 / n : 0,
        b1
    };
}

function bestMethodForSegment(rows, signalIds, labels) {
    let best = null;
    for (let i = 0; i < signalIds.length; i++) {
        const st = segmentStatsForSignal(rows, signalIds[i]);
        if (!st.n) continue;
        if (!best || st.blended > best.st.blended) {
            best = { id: signalIds[i], label: labels[i], st };
        }
    }
    return best;
}

const CONTEXT_SEGMENT_KEYS = [
    { key: 'fieldBand', label: 'At sayısı' },
    { key: 'mesafeBand', label: 'Mesafe' },
    { key: 'pist', label: 'Pist' },
    { key: 'raceType', label: 'Koşu tipi' },
    { key: 'breed', label: 'Irk/yaş' }
];

const CONTEXT_FLAG_LABELS = {
    AS_kosu_sifir: 'AS.KOŞU=0 (tüm atlar)',
    cnt123_sifir: 'cnt123=0 (placement yok)',
    TK_pct_duz: 'TK% düz (ayırt etmiyor)',
    KC_pct_duz: 'KC% düz',
    HP_pct_duz: 'HP% düz',
    dusuk_AS_deneyim: 'düşük AS deneyimi',
    dusuk_sekme_deneyim: 'düşük sekme deneyimi (<4 ort.koşu)'
};

function printContextReport(raceGroups, host, comboCatalog, catalog) {
    const signals = buildPerRaceSignals(comboCatalog, catalog);
    const signalIds = signals.map(s => s.id);
    const signalLabels = signals.map(s => s.label);
    const coreIds = ['TAH', 'AS-RF', 'TK-RF', 'KC-RF', 'PS-RF', 'SH-RF', 'MEGA-RF', 'HP%', 'TK%'];
    const coreLabels = coreIds.map(id => signals.find(s => s.id === id)?.label || id);

    const sorted = [...raceGroups].sort((a, b) => {
        const [ka, ra] = raceGroupSortKey(a);
        const [kb, rb] = raceGroupSortKey(b);
        return ka - kb || ra - rb;
    });

    const rows = sorted.map(entries => diagnoseRaceRow(entries, signals, host));

    hr('13. KOŞU ETİKEN ANALİZİ — neden çalışmadı / ne zaman işe yarar');
    console.log('  Her koşuda yöntem sonucu + kök neden · ardından etken segmentlerinde en iyi yöntem');

    for (const row of rows) {
        const f = row.factors;
        console.log('\n  🏁 K' + row.raceNo + ' · #' + row.kayitId + ' · ' + f.fieldSize + ' at · ' + row.header);
        console.log('  Kazanan: ' + row.winnerName + ' · TAHMİN sırası: ' + (row.winnerTahRank ?? '—'));
        console.log('  Etkenler: ' + f.fieldBand + ' · ' + f.mesafeBand + ' · ' + f.pist
            + ' · ' + f.raceType + ' · ' + f.breed
            + (f.katShort !== '—' ? ' · ' + f.katShort : ''));

        console.log('  Veri kalitesi: AS.koşu ort=' + formatMetricVal(f.as.avg)
            + ' (sıfır ' + f.as.zero + '/' + f.as.n + ')'
            + ' · TK% uniq=' + f.tk.unique + '/' + f.tk.n
            + ' · KC% uniq=' + f.kc.unique + '/' + f.kc.n
            + ' · HP% uniq=' + f.hp.unique + '/' + f.hp.n
            + ' · ort.sekmeKOŞU=' + formatMetricVal(f.meanKosuExp));
        if (f.flags.length) {
            console.log('  Bayraklar: ' + f.flags.map(fl => CONTEXT_FLAG_LABELS[fl] || fl).join(' · '));
        }

        console.log('  ' + pad('Yöntem', 10) + pad('Sonuç', 8) + pad('Lider', 18) + 'Neden');
        console.log('  ' + '-'.repeat(72));
        for (const d of row.signals.filter(s => coreIds.includes(s.id))) {
            const cell = d.pick.tie ? '—' : bitisMark(d.pick.bitis) + Math.round(d.pick.blended * 100) + '%';
            console.log('  ' + pad(d.label, 10) + pad(cell, 8)
                + pad(d.pick.tie ? '—' : d.pick.name.slice(0, 16), 18)
                + d.reason);
        }
    }

    sub('ETKEN SEGMENT — en iyi yöntem (karışık başarı)');
    const rules = [];
    for (const seg of CONTEXT_SEGMENT_KEYS) {
        const groups = new Map();
        for (const row of rows) {
            const val = row.factors[seg.key];
            if (!groups.has(val)) groups.set(val, []);
            groups.get(val).push(row);
        }
        console.log('\n  ▶ ' + seg.label);
        for (const [val, groupRows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
            const best = bestMethodForSegment(groupRows, coreIds, coreLabels);
            if (!best) {
                console.log('    ' + pad(String(val), 14) + ' n=' + groupRows.length + ' · ayırt edici koşu yok');
                continue;
            }
            const races = groupRows.map(r => 'K' + r.raceNo).join(',');
            console.log('    ' + pad(String(val), 14) + ' n=' + groupRows.length
                + ' → ' + pad(best.label, 10)
                + ' karışık ' + pct(best.st.blended)
                + ' · ★ ' + best.st.b1 + '/' + best.st.n
                + (best.st.ties ? ' · berab=' + best.st.ties : '')
                + ' · [' + races + ']');
            rules.push({
                segment: seg.label,
                value: val,
                n: groupRows.length,
                method: best.label,
                blended: best.st.blended,
                exact: best.st.exact,
                races: groupRows.map(r => r.raceNo)
            });
        }
    }

    sub('BAYRAK SEGMENT — veri sorunu varken en iyi yöntem');
    const allFlags = [...new Set(rows.flatMap(r => r.factors.flags))];
    for (const flag of allFlags) {
        const groupRows = rows.filter(r => r.factors.flags.includes(flag));
        const best = bestMethodForSegment(groupRows, coreIds, coreLabels);
        const label = CONTEXT_FLAG_LABELS[flag] || flag;
        if (!best) {
            console.log('  ' + pad(label.slice(0, 32), 34) + ' n=' + groupRows.length + ' · —');
            continue;
        }
        console.log('  ' + pad(label.slice(0, 32), 34) + ' n=' + groupRows.length
            + ' → ' + best.label + ' ' + pct(best.st.blended)
            + ' (★' + best.st.b1 + '/' + best.st.n + ')');
    }
    const noFlagRows = rows.filter(r => !r.factors.flags.length);
    if (noFlagRows.length) {
        const best = bestMethodForSegment(noFlagRows, coreIds, coreLabels);
        if (best) {
            console.log('  ' + pad('(bayrak yok — temiz veri)', 34) + ' n=' + noFlagRows.length
                + ' → ' + best.label + ' ' + pct(best.st.blended)
                + ' (★' + best.st.b1 + '/' + best.st.n + ')');
        }
    }

    sub('KURAL ÖZETİ — etkene göre tercih edilecek yöntem');
    rules.sort((a, b) => b.blended - a.blended || b.n - a.n);
    for (const r of rules) {
        if (r.n < 1) continue;
        console.log('  EĞER ' + r.segment + '=' + r.value + ' (n=' + r.n + ')'
            + ' → ' + r.method + ' (' + pct(r.blended) + ' karışık, ★' + pct(r.exact) + ')');
    }

    sub('TK% / HP% / KC% neden — koşu koşu teşhis');
    for (const row of rows) {
        const pctSigs = row.signals.filter(s => ['TK.matchPct', 'HP.matchPct', 'KC.matchPct'].includes(s.id));
        const lines = pctSigs.map(d => {
            const sp = d.spread;
            if (d.pick.tie && sp.unique <= 1) {
                return d.label + ': düz değer ' + formatMetricVal(sp.max) + ' (' + sp.n + ' at)';
            }
            if (d.pick.tie) return d.label + ': üst beraberlik';
            return d.label + ': ' + d.reason;
        });
        console.log('  K' + row.raceNo + ': ' + lines.join(' · '));
    }
}

function printRaceForensics(raceGroups, host, catalog) {
    attachTahminLeader(raceGroups);
    const forensicsMetrics = catalog.filter(m =>
        ['matchPct', 'matchCount', 'matchHitPct', 'sehirPct', 'inCityCount', 'cnt123', 'kosuSayisi'].includes(m.key)
    );

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
            + FORENSICS_COLUMNS.map(c => pad(c.label.slice(0, 9), 9)).join(''));
        console.log('  ' + '-'.repeat(22 + 4 + 5 + FORENSICS_COLUMNS.length * 9));

        for (const e of horses) {
            const bitis = host.bitisValueForSort(e);
            const name = (e.row?.name || '?').replace(/\(\d+\)/, '').trim().slice(0, 20);
            const tahRank = e.row?.tahmin?.rank ?? '—';
            let line = '  ' + pad(name, 22) + pad(bitis ?? '—', 4) + pad(String(tahRank), 5);
            for (const c of FORENSICS_COLUMNS) {
                line += pad(formatMetricVal(c.get(e)), 9);
            }
            console.log(line);
        }

        console.log('\n  Metrik liderleri (bu koşu — MATCH + deneyim):');
        for (const m of forensicsMetrics) {
            const scored = entries.map(e => ({ e, s: m.get(e) })).filter(x => x.s != null);
            const picked = pickScoredLeader(scored.map(x => ({ entry: x.e, score: x.s })));
            if (!picked) continue;
            const lb = host.bitisValueForSort(picked.entry);
            const mark = lb === 1 ? '★' : lb <= 3 ? '◆' : '·';
            console.log('    ' + mark + ' ' + pad(m.label, 28)
                + ' → ' + (picked.entry.row?.name || '?').slice(0, 25)
                + ' (' + formatMetricVal(picked.score) + ') BİTİŞ=' + (lb ?? '?'));
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

        const minRaces = effectiveMinRaces(raceGroups.length);
        if (minRaces !== cli.minRaces) {
            console.log('  minRaces (otomatik)  : ' + minRaces + ' (koşu=' + raceGroups.length + ')');
        }

        const needsTahmin = hasPhase('leader') || hasPhase('plan') || hasPhase('agree')
            || hasPhase('compare') || hasPhase('combo') || hasPhase('windows');
        let tahminBaseline = null;
        let tahminActive = null;
        if (needsTahmin) {
            if (hasPhase('windows') || hasPhase('plan') || hasPhase('compare')) {
                tahminBaseline = evaluateTahminLeader(raceGroups, host, { skipBoost: true });
            }
            tahminActive = evaluateTahminLeader(raceGroups, host);
        }
        const tahminBase = tahminBaseline || tahminActive;

        if (hasPhase('leader')) {
            hr('2. KOŞU LİDERİ — TÜM UI SÜTUNLARI (' + catalog.length + ' metrik)');
            console.log('  Her koşuda en yüksek değere sahip atın BİTİŞ\'i · karışık = 80/12/8');
            if (tahminActive) {
                console.log('  ' + pad('TAHMİN(hybrid+boost)', 32) + ' karışık ' + pad(pct(tahminActive.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(tahminActive.exactRate), 7) + ' · n=' + tahminActive.leaderTotal);
            }
            if (tahminBaseline) {
                console.log('  ' + pad('TAHMİN(baseline)', 32) + ' karışık ' + pad(pct(tahminBaseline.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(tahminBaseline.exactRate), 7) + ' · n=' + tahminBaseline.leaderTotal);
            }
            const leaderResults = catalog.map(m => ({
                m, ...evaluateRaceLeader(raceGroups, m.get, host)
            })).filter(r => r.leaderTotal >= minRaces)
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

            sub('MATCH-ONLY — cnt/max hariç (beraberlik atlanır)');
            const matchLeaderResults = leaderResults.filter(r => isMatchOnlyMetric(r.m));
            if (!matchLeaderResults.length) {
                console.log('  (yeterli ayırt edici koşu yok — tüm liderler beraberlikte)');
            }
            matchLeaderResults.slice(0, cli.top).forEach((r, idx) => {
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
                return c.n >= minRaces ? { m, ...c } : null;
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
                    const ms = entries.map(e => ({ entry: e, score: m.get(e) })).filter(x => x.score != null);
                    const ts = entries.map(e => ({ entry: e, score: e.row?.tahmin?.score })).filter(x => x.score != null);
                    const mLeader = pickScoredLeader(ms);
                    const tLeader = pickScoredLeader(ts);
                    if (!mLeader || !tLeader) continue;
                    if (mLeader.entry.row?.no !== tLeader.entry.row?.no) continue;
                    const bitis = host.bitisValueForSort(mLeader.entry);
                    if (bitis == null || bitis < 1) continue;
                    total++;
                    if (bitis === 1) b1++;
                    if (bitis <= 2) b12++;
                    if (bitis <= 3) b123++;
                }
                return total >= minRaces
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
            printRaceForensics(raceGroups, host, catalog);
        }

        const comboCatalog = buildComboCatalog();

        if (hasPhase('per-race')) {
            printPerRaceReport(raceGroups, host, comboCatalog, catalog);
            if (cli.phases.length === 1) {
                console.log('\nOK · ' + raceGroups.length + ' koşu · ' + withBitis.length + ' BİTİŞ · faz=per-race');
                return;
            }
        }

        if (hasPhase('context')) {
            printContextReport(raceGroups, host, comboCatalog, catalog);
            if (cli.phases.length === 1) {
                console.log('\nOK · ' + raceGroups.length + ' koşu · ' + withBitis.length + ' BİTİŞ · faz=context');
                return;
            }
        }

        if (hasPhase('windows')) {
            printWindowCorrelationPhase(catalog, raceGroups, withBitis, host, minRaces, tahminBase);
            if (tahminBaseline && tahminActive) {
                sub('TAHMİN BOYUT ENTEGRASYONU — hybrid baseline vs boost');
                console.log('  Baseline (boost kapalı): karışık ' + pct(tahminBaseline.leaderBlended)
                    + ' · ★ ' + pct(tahminBaseline.exactRate) + ' · n=' + tahminBaseline.leaderTotal);
                console.log('  Boost aktif           : karışık ' + pct(tahminActive.leaderBlended)
                    + ' · ★ ' + pct(tahminActive.exactRate) + ' · n=' + tahminActive.leaderTotal);
                const delta = tahminActive.leaderBlended - tahminBaseline.leaderBlended;
                console.log('  Δ boost               : ' + (delta >= 0 ? '+' : '') + pct(delta)
                    + (delta > 0.02 ? ' ✓' : delta < -0.02 ? ' ↓' : ' ≈'));
                if (typeof DimensionTahminBoostEngine !== 'undefined') {
                    console.log('  Rotalar: ' + DimensionTahminBoostEngine.ROUTES.map(r => r.label).join(' · '));
                    console.log('  maxBoost=' + Math.round(DimensionTahminBoostEngine.MAX_TOTAL_BOOST * 100) + '%');
                }
            }
            if (cli.phases.length === 1) {
                console.log('\nOK · ' + raceGroups.length + ' koşu · ' + withBitis.length + ' BİTİŞ · faz=windows');
                return;
            }
        }

        if (cli.phases.every(p => p === 'per-race' || p === 'context' || p === 'windows')) {
            console.log('\nOK · ' + raceGroups.length + ' koşu · ' + withBitis.length + ' BİTİŞ · faz='
                + cli.phases.join(','));
            return;
        }

        let comboResults = [];
        let tabSummaries = [];

        if (hasPhase('combo') || hasPhase('compare')) {
            hr('10. SEKME BİRLEŞİK SKORLAR — tek metrik vs varyasyon vs bütün');
            console.log('  Her sekmede birden fazla sütun birleştirilir (normalize ağırlıklı / rank fusion)');
            console.log('  Kombinasyon sayısı: ' + comboCatalog.length);

            comboResults = comboCatalog.map(c => ({
                combo: c,
                ...evaluateComboRaceLeader(raceGroups, c, host)
            })).filter(r => r.leaderTotal >= minRaces)
                .sort((a, b) => b.leaderBlended - a.leaderBlended);

            for (const tg of TAB_GROUPS) {
                sub(tg.tab + ' — tek vs birleşik');
                const singleBest = bestSingleForTab(catalog, tg.tab, raceGroups, host, minRaces);
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
            })).filter(r => r.leaderTotal >= minRaces)
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

            sub('MATCH-ONLY combo — PLACEMENT/cnt123 paketleri hariç');
            const matchCombos = comboResults.filter(r =>
                !r.combo.id.includes('placement')
                && !r.combo.id.includes('cnt123')
                && !r.combo.id.includes('max-ladder')
                && r.combo.kind !== 'mega'
            );
            matchCombos.slice(0, 15).forEach((r, i) => {
                const vsTahmin = tahminBase ? r.leaderBlended - tahminBase.leaderBlended : null;
                console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.combo.label.slice(0, 38), 40)
                    + ' karışık ' + pad(pct(r.leaderBlended), 7)
                    + ' · 1. ' + pad(pct(r.exactRate), 7)
                    + (vsTahmin != null && vsTahmin > 0.005 ? ' · vsTAH+' + pct(vsTahmin) : '')
                    + ' · n=' + r.leaderTotal);
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
                    })).filter(r => r.leaderTotal >= minRaces)
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
            })).filter(r => r.leaderTotal >= minRaces)
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
                return c.n >= minRaces ? { m, ...c } : null;
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
