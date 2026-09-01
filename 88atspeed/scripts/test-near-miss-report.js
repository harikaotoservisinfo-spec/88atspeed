#!/usr/bin/env node
/**
 * TAHMİN vs BİTİŞ — yakın isabet (±1) nüans raporu
 *
 * Varsayılan motor: gösterge (PUANLAMA TEST ile aynı yol)
 *
 *   node scripts/test-near-miss-report.js --db atlar.db --kayit 133 --race 6 --verbose
 *   node scripts/test-near-miss-report.js --db atlar.db --field-size 10
 *   node scripts/test-near-miss-report.js --engine hybrid --field-size 10
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
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
    engine: (argVal('--engine') || 'gosterge').toLowerCase(),
    verbose: args.includes('--verbose') || args.includes('-v')
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }

function loadHybridEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8')
        + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8')
        + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function raceKey(entry) {
    return String(entry.kayitId) + '|' + entry.raceNo;
}

function metricSnap(row) {
    const s = row.son8001Depths?.[0];
    const t = row.test1Depths?.[0];
    const d = row.t1drDepths?.[0];
    return {
        son8001: s?.pct ?? null,
        son8001v: s?.visual ?? '—',
        test1: t?.pct ?? null,
        t1dr: d?.pct ?? null,
        sonGap: s?.gapPct ?? null,
        t1Gap: d?.gapPct ?? null
    };
}

function topTerms(tahmin, n) {
    return (tahmin?.topTerms || tahmin?.terms || []).slice(0, n).map(t =>
        (t.label || t.ruleLabel || '?') + '(' + (t.points || 0) + ')'
    );
}

function attachRaceTahminForEngine(entries) {
    const rows = entries.map(e => e.row);
    const srcPkg = entries[0]?._pkg;
    const pkg = {
        rows,
        depthCoverage: srcPkg?.depthCoverage || null,
        kosuHistorySummary: srcPkg?.kosuHistorySummary || null
    };

    if (cli.engine === 'hybrid') {
        global.HybridTahminScoringEngine.attachRaceTahmin(pkg);
        return;
    }
    global.GostergeScoringEngine.attachRaceTahmin(pkg);
}

function fmtScore(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 100000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n));
}

function filterEntriesForAnalysis(allEntries) {
    let out = allEntries;
    if (cli.kayitId) out = out.filter(e => Number(e.kayitId) === cli.kayitId);
    if (cli.raceNo) out = out.filter(e => Number(e.raceNo) === cli.raceNo);
    if (cli.fieldSize) {
        const byRace = new Map();
        for (const e of out) {
            const rk = raceKey(e);
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(e);
        }
        out = [];
        for (const [, entries] of byRace) {
            if (entries.length === cli.fieldSize) out.push(...entries);
        }
    }
    return out;
}

function analyzeRace(entries, host, label) {
    // Gösterge: global applyToFlatEntries sıralamasını kullan (PUANLAMA TEST ile aynı)
    const needsRescore = cli.engine === 'hybrid'
        || !entries.every(e => e.row?.tahmin?.rank != null);
    if (needsRescore) attachRaceTahminForEngine(entries);

    const rows = entries.map(e => {
        const bitis = host.bitisValueForSort(e);
        const t = e.row.tahmin || {};
        const pred = t.rank != null ? Number(t.rank) : null;
        const delta = (pred != null && bitis != null && bitis >= 1) ? bitis - pred : null;
        return {
            entry: e,
            no: e.row.no,
            name: e.row.name,
            pred,
            bitis,
            delta,
            score: t.score ?? 0,
            pct: t.pct ?? null,
            basariPct: t.basariPct ?? null,
            gostergePct: t.gostergePct ?? null,
            basariWeight: t.basariWeight ?? null,
            metrics: metricSnap(e.row),
            terms: topTerms(t, 3)
        };
    }).sort((a, b) => (a.pred ?? 99) - (b.pred ?? 99));

    const withBitis = rows.filter(r => r.bitis != null && r.bitis >= 1);
    let exact = 0, pm1 = 0, pm2 = 0, worse = 0;
    for (const r of withBitis) {
        if (r.delta === 0) exact++;
        else if (r.delta === 1 || r.delta === -1) pm1++;
        else if (r.delta === 2 || r.delta === -2) pm2++;
        else if (r.delta != null) worse++;
    }

    const pctGroups = new Map();
    for (const r of rows) {
        const p = r.pct ?? '—';
        if (!pctGroups.has(p)) pctGroups.set(p, []);
        pctGroups.get(p).push(r);
    }
    const pctClusters = [...pctGroups.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([pct, list]) => ({ pct, count: list.length, horses: list.map(r => '#' + r.no) }));

    const gaps = [];
    for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i];
        const b = rows[i + 1];
        if (a.pred == null || b.pred == null) continue;
        gaps.push({
            from: a.pred,
            to: b.pred,
            scoreGap: a.score - b.score,
            pctGap: (a.pct ?? 0) - (b.pct ?? 0),
            aNo: a.no,
            bNo: b.no
        });
    }

    const swaps = [];
    for (const r of withBitis) {
        if (r.delta !== 1 && r.delta !== -1) continue;
        const tookMySlot = rows.find(x => x.bitis === r.pred && x.no !== r.no);
        const iTookTheirSlot = rows.find(x => x.pred === r.bitis && x.no !== r.no);
        swaps.push({
            horse: '#' + r.no + ' ' + (r.name || ''),
            pred: r.pred,
            bitis: r.bitis,
            delta: r.delta,
            tookMySlot: tookMySlot
                ? '#' + tookMySlot.no + ' ' + (tookMySlot.name || '') + ' (T' + tookMySlot.pred + '→B' + tookMySlot.bitis + ')'
                : '—',
            iTookTheirSlot: iTookTheirSlot
                ? '#' + iTookTheirSlot.no + ' ' + (iTookTheirSlot.name || '') + ' (T' + iTookTheirSlot.pred + '→B' + iTookTheirSlot.bitis + ')'
                : '—',
            scoreDiff: tookMySlot ? r.score - tookMySlot.score : null,
            pctDiff: tookMySlot ? (r.pct ?? 0) - (tookMySlot.pct ?? 0) : null,
            metricDiff: tookMySlot ? {
                son8001: (r.metrics.son8001 ?? '—') + ' vs ' + (tookMySlot.metrics.son8001 ?? '—'),
                test1: (r.metrics.test1 ?? '—') + ' vs ' + (tookMySlot.metrics.test1 ?? '—'),
                t1dr: (r.metrics.t1dr ?? '—') + ' vs ' + (tookMySlot.metrics.t1dr ?? '—')
            } : null
        });
    }

    return {
        label,
        rows,
        withBitis: withBitis.length,
        exact,
        pm1,
        pm2,
        worse,
        pctClusters,
        gaps,
        swaps,
        ozet: entries[0] ? {
            hipodrom: entries[0].hipodrom,
            tarih: entries[0].tarih,
            kayitId: entries[0].kayitId,
            raceNo: entries[0].raceNo
        } : {}
    };
}

function printRaceReport(rep) {
    const o = rep.ozet;
    hr((o.hipodrom || '?') + ' ' + (o.tarih || '') + ' K' + o.raceNo + ' · kayit#' + o.kayitId);
    console.log('  At: ' + rep.rows.length + ' · bitişli: ' + rep.withBitis);
    console.log('  Tam: ' + rep.exact + ' · ±1: ' + rep.pm1 + ' · ±2: ' + rep.pm2 + ' · ≥3: ' + rep.worse);
    if (rep.withBitis) {
        const rate = (n) => (100 * n / rep.withBitis).toFixed(1) + '%';
        console.log('  Oran → tam ' + rate(rep.exact) + ' · ±1 ' + rate(rep.pm1) + ' · ±2 ' + rate(rep.pm2));
    }

    const showBlendCols = cli.engine === 'hybrid';
    console.log('\n  ' + pad('TAHMİN', 6) + pad('BİTİŞ', 6) + pad('Δ', 4)
        + pad('skor', 6) + pad('%', 4)
        + (showBlendCols ? pad('B%', 4) + pad('G%', 4) : '')
        + '  At');
    for (const r of rep.rows) {
        const mark = r.delta === 0 ? '✓' : (r.delta === 1 || r.delta === -1 ? '~' : (r.delta != null ? '✗' : ' '));
        let line = '  ' + mark + ' ' + pad(r.pred != null ? r.pred + '.' : '—', 5)
            + pad(r.bitis != null ? r.bitis + '.' : '—', 5)
            + pad(r.delta != null ? (r.delta > 0 ? '+' + r.delta : String(r.delta)) : '—', 4)
            + pad(fmtScore(r.score), 6)
            + pad(r.pct ?? '—', 4);
        if (showBlendCols) {
            line += pad(r.basariPct ?? '—', 4) + pad(r.gostergePct ?? '—', 4);
        }
        line += '  #' + r.no + ' ' + (r.name || '');
        console.log(line);
        if (cli.verbose && r.terms.length) {
            console.log('      ' + r.terms.join(' · '));
            console.log('      S800=' + (r.metrics.son8001 ?? '—') + ' T1=' + (r.metrics.test1 ?? '—')
                + ' T1DR=' + (r.metrics.t1dr ?? '—') + ' gapS=' + (r.metrics.sonGap ?? '—'));
        }
    }

    if (rep.pctClusters.length) {
        console.log('\n  ⚠ pct kümesi (aynı % → sıra kırılgan):');
        for (const c of rep.pctClusters) {
            console.log('    %' + c.pct + ' × ' + c.count + ' → ' + c.horses.join(', '));
        }
    }

    if (rep.gaps.length && cli.verbose) {
        console.log('\n  Komşu tahmin skor aralığı:');
        for (const g of rep.gaps) {
            if (g.scoreGap <= 3 || g.pctGap === 0) {
                console.log('    ' + g.from + '→' + g.to + ': skorΔ=' + g.scoreGap
                    + ' pctΔ=' + g.pctGap + ' (#' + g.aNo + '→#' + g.bNo + ')');
            }
        }
    }

    if (rep.swaps.length) {
        console.log('\n  ±1 komşu çift analizi:');
        for (const s of rep.swaps) {
            console.log('    ' + s.horse + ' T' + s.pred + '→B' + s.bitis + ' (Δ' + (s.delta > 0 ? '+' : '') + s.delta + ')');
            console.log('      yerime giren: ' + s.tookMySlot + ' | benim geçtiğim: ' + s.iTookTheirSlot
                + (s.scoreDiff != null ? ' skorΔ=' + s.scoreDiff + ' pctΔ=' + s.pctDiff : ''));
            if (cli.verbose && s.metricDiff) {
                console.log('      SON800-1: ' + s.metricDiff.son8001);
                console.log('      TEST1: ' + s.metricDiff.test1);
                console.log('      T1×DR: ' + s.metricDiff.t1dr);
            }
        }
    }
}

async function calibrateScoring(flatEntries, host) {
    if (cli.engine === 'hybrid') {
        return global.HybridTahminScoringEngine.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort, { host }
        );
    }
    await global.GostergeScoringEngine.calibrate(flatEntries, host);
    if (global.GostergeScoringEngine.isCalibrated?.()) {
        global.GostergeScoringEngine.applyToFlatEntries(flatEntries);
    }
    return global.GostergeScoringEngine.getCalibration?.();
}

async function main() {
    if (cli.engine === 'hybrid') {
        loadHybridEngines();
    } else {
        loadGostergeEngines();
    }

    const db = openDb(cli.dbPath);
    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  TAHMİN yakın isabet (±1) nüans raporu                      ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Motor: ' + cli.engine + (cli.engine === 'gosterge' ? ' (PUANLAMA TEST ile aynı)' : ''));

        const { flatEntries: allEntries, bitisMap } = await buildFlatEntriesFromDb(db, {});
        if (!allEntries.length) {
            console.error('Veri yok.');
            process.exit(1);
        }

        const calHost = makeGostergeHost(allEntries, bitisMap);
        const bitisCount = allEntries.filter(e => calHost.bitisValueForSort(e) >= 1).length;
        const raceCount = new Set(allEntries.map(e => raceKey(e))).size;
        console.log('⏳ Kalibrasyon… (' + allEntries.length + ' satır · ' + bitisCount + ' bitişli · ' + raceCount + ' koşu)');
        const cal = await calibrateScoring(allEntries, calHost);
        if (!cal) {
            console.error('Kalibrasyon başarısız — bitiş verisi yetersiz olabilir.');
            process.exit(1);
        }

        const flatEntries = filterEntriesForAnalysis(allEntries);
        const host = makeGostergeHost(flatEntries, bitisMap);
        if (!flatEntries.length) {
            console.error('Filtreye uyan koşu/at yok.');
            process.exit(1);
        }

        const byRace = new Map();
        for (const e of flatEntries) {
            const rk = raceKey(e);
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(e);
        }

        let gExact = 0, gPm1 = 0, gPm2 = 0, gWorse = 0, gTotal = 0;
        let clusterRaces = 0;
        const reports = [];

        for (const [rk, entries] of byRace) {
            if (cli.raceNo && Number(entries[0]?.raceNo) !== cli.raceNo) continue;
            if (cli.kayitId && Number(entries[0]?.kayitId) !== cli.kayitId) continue;
            const rep = analyzeRace(entries, host, rk);
            if (!rep.withBitis) continue;
            reports.push(rep);
            gExact += rep.exact;
            gPm1 += rep.pm1;
            gPm2 += rep.pm2;
            gWorse += rep.worse;
            gTotal += rep.withBitis;
            if (rep.pctClusters.length) clusterRaces++;
        }

        if (cli.kayitId || cli.raceNo || reports.length <= 3) {
            for (const rep of reports) printRaceReport(rep);
        } else {
            hr('Öne çıkan ±1 yoğun koşular');
            const sorted = reports.slice().sort((a, b) => b.pm1 - a.pm1 || b.exact - a.exact);
            for (const rep of sorted.slice(0, 5)) {
                printRaceReport(rep);
            }
        }

        hr('Genel özet');
        if (!gTotal) {
            console.log('  Bitiş verisi olan koşu/at yok.');
            console.log('  → PUANLAMA TEST bitiş sıralarını kaydedin.');
            return;
        }
        const pct = n => (100 * n / gTotal).toFixed(1) + '%';
        console.log('  Koşu: ' + reports.length + ' · at (bitişli): ' + gTotal);
        console.log('  Tam isabet: ' + gExact + ' (' + pct(gExact) + ')');
        console.log('  ±1 yakın:   ' + gPm1 + ' (' + pct(gPm1) + ') ← birlikte ' + pct(gExact + gPm1));
        console.log('  ±2:         ' + gPm2 + ' (' + pct(gPm2) + ')');
        console.log('  ≥3 sapma:   ' + gWorse + ' (' + pct(gWorse) + ')');
        console.log('  pct kümeli koşu: ' + clusterRaces + '/' + reports.length
            + ' (aynı % → sıra tie-break kırılgan)');

        console.log('\n── Yorum ──');
        console.log('  ~ = ±1 yakın isabet (6 tahmin → 7 bitiş vb.)');
        console.log('  pct kümesi = skor normalize sonrası orta sıra atlar birbirine yapışık');
        console.log('  ±1 çiftlerde SON800/TEST1 farkına bak — tie-break: SON800→TEST1→T1×DR');

        hr('Kullanım');
        console.log('  node scripts/test-near-miss-report.js --kayit 133 --race 6 --verbose');
        console.log('  node scripts/test-near-miss-report.js --field-size 10');
        console.log('  node scripts/test-near-miss-report.js --engine hybrid --field-size 10');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
