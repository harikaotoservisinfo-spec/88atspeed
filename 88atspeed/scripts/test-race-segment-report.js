#!/usr/bin/env node
/**
 * Kazanan profil segment raporu — at sayısı + kırılım + teşhis + 10-at hibrit tip
 *
 * Kullanım:
 *   node scripts/test-race-segment-report.js --db atlar.db --field-size 10
 *   node scripts/test-race-segment-report.js --phase types,diagnose,raw,detail --verbose
 *   node scripts/test-race-segment-report.js --metric son8001 --dimension visual --bucket yesil
 *   node scripts/test-race-segment-report.js --metric son8001 --dimension visual --bucket -
 */
const {
    loadSimilarityEngines,
    buildFlatEntriesWithFlagsFromDb,
    buildAllRaceProfiles,
    buildWinnerProfileSegments,
    buildTenAtHybridTypeReport,
    formatToken,
    DEEP_TEN_METRICS,
    normalizeBucketFilter,
    pct,
    pad
} = require('./race-similarity-lib');
const { makeGostergeHost, openDb } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const DEFAULT_PHASES = 'overview,types,diagnose,raw,detail,renk';

const cli = {
    dbPath: argVal('--db') || require('path').join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : 10,
    metric: argVal('--metric') || null,
    dimension: argVal('--dimension') || null,
    bucket: argVal('--bucket') != null ? normalizeBucketFilter(argVal('--bucket')) : null,
    minDetail: argVal('--min-detail') ? Number(argVal('--min-detail')) : 1,
    minJaccard: argVal('--min-jaccard') ? Number(argVal('--min-jaccard')) : 0.4,
    phases: (argVal('--phase') || DEFAULT_PHASES).split(',').map(s => s.trim()).filter(Boolean),
    verbose: args.includes('--verbose') || args.includes('-v')
};

function hr(title) {
    console.log('\n══ ' + title + ' ══');
}

function sub(title) {
    console.log('\n── ' + title + ' ──');
}

function dimLabel(d) {
    return { visual: 'Renk', gap: 'Δ', bs: 'BS', delta: 'SON·Δ', pct: '%' }[d] || d;
}

function filterSegments(report) {
    let segs = report.segments;
    if (cli.metric) segs = segs.filter(s => s.metricId === cli.metric);
    if (cli.dimension) segs = segs.filter(s => s.dimension === cli.dimension);
    if (cli.bucket != null) segs = segs.filter(s => s.bucket === cli.bucket);
    return segs;
}

function printRawCellDump(raw, metricId) {
    const c = raw[metricId];
    if (!c) return;
    console.log('      ' + c.label + ': visual=' + c.visual
        + ' · pct=' + (c.pct != null ? c.pct : 'null') + '(' + c.pctTier + ')'
        + ' · gap=' + (c.gap != null ? c.gap : 'null') + '(' + c.gapBucket + ')'
        + ' · BS=' + (c.bs != null ? c.bs : 'null') + '(' + c.bsBucket + ')');
    console.log('        ton=' + c.tone + ' · kenar=' + c.border
        + ' · SON·Δ=' + c.delta);
    if (c.flags.length) console.log('        hücre bayrak: ' + c.flags.join(', '));
    if (c.rowFlags.length) console.log('        satır bayrak: ' + c.rowFlags.join(', '));
    if (c.visual === '—' && c.visualDiagnosis) {
        console.log('        teşhis: [' + c.visualDiagnosis.reason + '] ' + c.visualDiagnosis.detail);
    }
}

function printOverview(report, segs) {
    hr(cli.fieldSize + ' at · Kazanan profil segment özeti');
    console.log('  Toplam koşu: ' + report.poolSize);
    console.log('  Metrikler: ' + DEEP_TEN_METRICS.map(m => m.label).join(' · '));
    console.log('  Boyutlar: Renk · Δ · BS · SON·Δ · %');
    console.log('  Segment sayısı: ' + segs.length);

    for (const m of DEEP_TEN_METRICS) {
        sub(m.label + ' — kazanan dağılımı (tüm boyutlar)');
        const mSegs = segs.filter(s => s.metricId === m.id);
        for (const dim of ['visual', 'gap', 'bs', 'delta', 'pct']) {
            const dimSegs = mSegs.filter(s => s.dimension === dim)
                .sort((a, b) => b.races.length - a.races.length);
            if (!dimSegs.length) continue;
            console.log('  ▶ ' + dimLabel(dim) + ':');
            for (const s of dimSegs) {
                const share = report.poolSize ? (s.races.length / report.poolSize * 100).toFixed(1) : '0';
                const a = s.analysis;
                console.log('    ' + pad(s.bucket, 14)
                    + pad(s.races.length + ' koşu', 8)
                    + pad(share + '%', 7)
                    + ' saha ort ' + (a ? a.avgSameInField.toFixed(1) : '—') + '/' + cli.fieldSize + ' at'
                    + ' · lider ' + pct(a?.leaderSonWinRate));
            }
        }
    }
}

function printHybridTypes(hybrid) {
    hr(cli.fieldSize + ' at · Hibrit kazanan tipleri (A/B/C/D)');
    console.log('  Toplam: ' + hybrid.poolSize + ' koşu');
    console.log('  Tip A = SON800-1 renk — (görünmez) · Tip B = yesil kalabalık (≥5/10) · Tip C = seyrek yesilKirmizi (≤2/10)');

    for (const key of ['A', 'B', 'C', 'D']) {
        const t = hybrid.types[key];
        if (!t.n) continue;
        sub(t.typeLabel + ' · ' + t.n + ' koşu (' + pct(t.share) + ')');
        console.log('  SON800-1 lider kazandı: ' + pct(t.leaderSonWinRate));
        if (t.diagnosisCounts?.length) {
            console.log('  Renk — teşhis: ' + t.diagnosisCounts
                .map(d => d.key + '×' + d.count).join(' · '));
        }
        if (t.rowFlags?.length) {
            console.log('  Satır bayrakları: ' + t.rowFlags
                .map(r => r.key + ' ' + r.count + '/' + t.n).join(' · '));
        }
        if (t.similarClusters?.length) {
            console.log('  Benzer koşu kümeleri:');
            for (let i = 0; i < t.similarClusters.length; i++) {
                const cl = t.similarClusters[i];
                console.log('    K' + (i + 1) + ' · ' + cl.length + ' koşu: '
                    + cl.map(r => r.hipodrom + ' K' + r.raceNo + ' #' + r.winnerSig?.horseNo).join(' · '));
            }
        }
        console.log('  Koşular:');
        for (const r of t.races) {
            console.log('    ' + pad(r.label, 34)
                + ' saha yesil ' + r.yesilInField + '/' + r.fieldSize
                + ' · yk ' + r.ykInField
                + ' · dom ' + (r.domSon || '—')
                + ' · lider ' + (r.leaderSonWon ? '✓' : '✗'));
            if (cli.verbose && r.raw) {
                printRawCellDump(r.raw, 'son8001');
            }
        }
    }
}

function printDiagnose(segs, poolSize) {
    hr('Renk — teşhis (neden visual = — ?)');
    const dashSegs = segs.filter(s => s.dimension === 'visual' && s.bucket === '—');
    if (!dashSegs.length) {
        console.log('  (— segmenti yok veya filtre dışında)');
        return;
    }
    for (const seg of dashSegs) {
        const a = seg.analysis;
        if (!a) continue;
        sub(seg.metricLabel + ' · Renk = — (' + a.n + ' koşu)');
        const reasonCounts = {};
        for (const r of a.raceDetails) {
            const d = r.visualDiagnosis || r.rawDump?.[seg.metricId]?.visualDiagnosis;
            if (d) reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
        }
        console.log('  Teşhis özeti: ' + Object.entries(reasonCounts)
            .map(([k, v]) => k + '×' + v).join(' · '));
        for (const r of a.raceDetails) {
            const d = r.visualDiagnosis || r.rawDump?.[seg.metricId]?.visualDiagnosis;
            console.log('    ' + pad(r.label, 34)
                + (d ? '[' + d.reason + '] ' + d.detail : '—'));
            if (r.winnerType) {
                console.log('      hibrit tip: ' + r.winnerType.typeLabel);
            }
        }
    }
}

function printRawDump(segs) {
    hr('Kazanan ham hücre dump (SON800-1 · TEST1 · T1×DR)');
    const seen = new Set();
    for (const seg of segs) {
        for (const r of seg.analysis?.raceDetails || []) {
            if (seen.has(r.label)) continue;
            seen.add(r.label);
            console.log('\n  ' + r.label + (r.winnerType ? ' · ' + r.winnerType.type : ''));
            if (r.rawDump) {
                for (const m of DEEP_TEN_METRICS) {
                    printRawCellDump(r.rawDump, m.id);
                }
            }
        }
    }
}

function printCrossBreakdown(analysis, primaryMetric) {
    for (const m of DEEP_TEN_METRICS) {
        const c = analysis.cross[m.id];
        if (!c) continue;
        const parts = [];
        if (m.id !== primaryMetric && c.visuals.length) {
            parts.push('Renk:' + c.visuals.map(v => v.key + '×' + v.count).join('/'));
        }
        if (c.gaps.length) parts.push('Δ:' + c.gaps.slice(0, 3).map(v => v.key + '×' + v.count).join(' '));
        if (c.bs.length) parts.push('BS:' + c.bs.slice(0, 3).map(v => v.key + '×' + v.count).join(' '));
        if (c.deltas.length && c.deltas[0].key !== '—') {
            parts.push('SON·Δ:' + c.deltas.slice(0, 2).map(v => v.key + '×' + v.count).join(' '));
        }
        if (parts.length) console.log('      ' + c.label + ': ' + parts.join(' · '));
    }
}

function printSegmentDetail(seg, poolSize) {
    const a = seg.analysis;
    if (!a || a.n < cli.minDetail) return;

    const share = poolSize ? (a.n / poolSize * 100).toFixed(1) : '0';
    sub(seg.metricLabel + ' · ' + seg.dimensionLabel + ' = ' + seg.bucket
        + ' (' + a.n + ' koşu · ' + share + '%)');

    console.log('  SON800-1 lider kazandı: ' + pct(a.leaderSonWinRate));
    console.log('  Sahada aynı profil: ort ' + a.avgSameInField.toFixed(1) + ' at/koşu'
        + ' (' + pct(a.avgSamePctInField) + ' saha payı)');

    if (seg.bucket === '—' && seg.dimension === 'visual') {
        const reasons = {};
        for (const r of a.raceDetails) {
            const d = r.visualDiagnosis || r.rawDump?.[seg.metricId]?.visualDiagnosis;
            if (d) reasons[d.reason] = (reasons[d.reason] || 0) + 1;
        }
        if (Object.keys(reasons).length) {
            console.log('  Teşhis özeti: ' + Object.entries(reasons).map(([k, v]) => k + '×' + v).join(' · '));
        }
    }

    if (a.fieldSameCounts.length) {
        console.log('  Koşu bazında (aynı/toplam): '
            + a.fieldSameCounts.map(x => x.same + '/' + x.total).join(', '));
    }

    if (a.rowFlags.length) {
        console.log('  Kazanan satır bayrakları: ' + a.rowFlags
            .map(r => formatToken(r.key) + ' ' + r.count + '/' + a.n).join(' · '));
    }

    console.log('  Alt kırılımlar (kazanan diğer metrikler):');
    printCrossBreakdown(a, seg.metricId);

    if (a.archetypes.length) {
        console.log('  Archetype: ' + a.archetypes
            .slice(0, 4).map(x => x.key.slice(0, 40) + '×' + x.count).join(' · '));
    }

    if (a.similarClusters.length) {
        console.log('  Benzer koşu kümeleri (Jaccard≥' + cli.minJaccard + '):');
        for (let i = 0; i < a.similarClusters.length; i++) {
            const cl = a.similarClusters[i];
            console.log('    Küme ' + (i + 1) + ' · ' + cl.length + ' koşu: '
                + cl.map(r => r.hipodrom + ' K' + r.raceNo).join(' · '));
        }
    }

    console.log('  Koşu listesi:');
    for (const r of a.raceDetails) {
        console.log('    ' + pad(r.label, 34)
            + ' saha ' + r.sameInField + '/' + r.fieldSize + ' (' + r.fieldPct + ')'
            + ' · dom S1:' + (r.domSon || '—')
            + ' · lider:' + (r.leaderSonWon ? '✓' : '✗')
            + (r.winnerType ? ' · ' + r.winnerType.type : ''));
        if (seg.bucket === '—' && seg.dimension === 'visual') {
            const d = r.visualDiagnosis || r.rawDump?.[seg.metricId]?.visualDiagnosis;
            if (d) console.log('      teşhis: [' + d.reason + '] ' + d.detail);
        }
        if (cli.verbose && r.rawDump) {
            printRawCellDump(r.rawDump, 'son8001');
            if (seg.dimension === 'visual') {
                printRawCellDump(r.rawDump, 'test1');
                printRawCellDump(r.rawDump, 't1dr');
            }
        } else if (cli.verbose) {
            console.log('      ' + r.winnerCombo);
        }
    }
}

function printDetail(report, segs) {
    hr(cli.fieldSize + ' at · Segment detay raporu');
    const ordered = segs.slice().sort((a, b) => {
        const dimOrder = { visual: 0, gap: 1, bs: 2, delta: 3, pct: 4 };
        const ma = DEEP_TEN_METRICS.findIndex(m => m.id === a.metricId);
        const mb = DEEP_TEN_METRICS.findIndex(m => m.id === b.metricId);
        if (ma !== mb) return ma - mb;
        if (dimOrder[a.dimension] !== dimOrder[b.dimension]) {
            return dimOrder[a.dimension] - dimOrder[b.dimension];
        }
        return b.races.length - a.races.length;
    });
    for (const seg of ordered) printSegmentDetail(seg, report.poolSize);
}

function printRenkFocus(report, segs) {
    hr('Renk segmentleri — derin analiz (SON800-1 / TEST1 / T1×DR)');
    for (const m of DEEP_TEN_METRICS) {
        sub(m.label + ' · Renk kırılımı');
        const renkSegs = segs.filter(s => s.metricId === m.id && s.dimension === 'visual')
            .sort((a, b) => b.races.length - a.races.length);
        for (const s of renkSegs) {
            if (!s.analysis || s.analysis.n < 1) continue;
            const a = s.analysis;
            console.log('\n  ◆ ' + s.bucket + ' — ' + a.n + ' koşu');
            console.log('    Saha yoğunluğu: ort ' + a.avgSameInField.toFixed(1) + ' at aynı renk');
            if (s.bucket === '—') {
                const reasons = {};
                for (const r of a.raceDetails) {
                    const d = r.visualDiagnosis || r.rawDump?.son8001?.visualDiagnosis;
                    if (d) reasons[d.reason] = (reasons[d.reason] || 0) + 1;
                }
                if (Object.keys(reasons).length) {
                    console.log('    Teşhis: ' + Object.entries(reasons).map(([k, v]) => k + '×' + v).join(' · '));
                }
            }
            for (const om of DEEP_TEN_METRICS.filter(x => x.id !== m.id)) {
                const c = a.cross[om.id];
                if (!c?.visuals.length) continue;
                console.log('    Kazanan ' + om.label + ' renk: '
                    + c.visuals.map(v => v.key + ' ' + pct(v.count / a.n)).join(' · '));
            }
            if (a.similarClusters.length) {
                console.log('    Benzer: ' + a.similarClusters.map((cl, i) =>
                    'K' + (i + 1) + '(' + cl.length + ')').join(' '));
            }
            console.log('    Koşular: ' + a.raceDetails.map(r => r.label
                + (r.winnerType ? '(' + r.winnerType.type + ')' : '')).join(' · '));
        }
    }
}

async function main() {
    loadSimilarityEngines();
    const db = openDb(cli.dbPath);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Kazanan profil segment raporu v2 — ' + cli.fieldSize + ' at                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesWithFlagsFromDb(db, {});
        const host = makeGostergeHost(flatEntries, bitisMap);
        const profiles = buildAllRaceProfiles(flatEntries, host);

        const report = buildWinnerProfileSegments(profiles, {
            fieldSize: cli.fieldSize,
            minJaccard: cli.minJaccard
        });

        if (!report.poolSize) {
            console.log('\n' + cli.fieldSize + ' at koşu bulunamadı.');
            process.exit(0);
        }

        const hybrid = buildTenAtHybridTypeReport(profiles, {
            fieldSize: cli.fieldSize,
            minJaccard: cli.minJaccard
        });

        const segs = filterSegments(report);

        if (cli.phases.includes('overview')) printOverview(report, segs);
        if (cli.phases.includes('types')) printHybridTypes(hybrid);
        if (cli.phases.includes('diagnose')) printDiagnose(segs, report.poolSize);
        if (cli.phases.includes('raw')) printRawDump(segs);
        if (cli.phases.includes('renk')) printRenkFocus(report, segs);
        if (cli.phases.includes('detail')) printDetail(report, segs);

        console.log('\n── Kullanım ──');
        console.log('  node scripts/test-race-segment-report.js --field-size 10 --phase types,diagnose,raw,detail --verbose');
        console.log('  node scripts/test-race-segment-report.js --metric son8001 --dimension visual --bucket yesil');
        console.log('  node scripts/test-race-segment-report.js --metric son8001 --dimension visual --bucket -');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
