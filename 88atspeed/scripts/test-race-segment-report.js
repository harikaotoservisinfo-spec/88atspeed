#!/usr/bin/env node
/**
 * Kazanan profil segment raporu — at sayısı + metrik kırılım + benzer koşu analizi
 *
 * Her boyut (Renk, Δ, BS, SON·Δ, %) ayrı ayrı segmentlenir; segment içinde
 * alt faktörler, sahadaki at yoğunluğu ve benzer koşu kümeleri raporlanır.
 *
 * Kullanım:
 *   node scripts/test-race-segment-report.js --db /var/www/88atspeed/atlar.db --field-size 10
 *   node scripts/test-race-segment-report.js --field-size 10 --metric son8001 --dimension visual
 *   node scripts/test-race-segment-report.js --field-size 10 --bucket yesil
 *   node scripts/test-race-segment-report.js --field-size 10 --phase overview,detail
 */
const {
    loadSimilarityEngines,
    buildFlatEntriesWithFlagsFromDb,
    buildAllRaceProfiles,
    buildWinnerProfileSegments,
    formatToken,
    DEEP_TEN_METRICS,
    pct,
    pad
} = require('./race-similarity-lib');
const { makeGostergeHost, openDb } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || require('path').join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : 10,
    metric: argVal('--metric') || null,
    dimension: argVal('--dimension') || null,
    bucket: argVal('--bucket') || null,
    minDetail: argVal('--min-detail') ? Number(argVal('--min-detail')) : 1,
    minJaccard: argVal('--min-jaccard') ? Number(argVal('--min-jaccard')) : 0.4,
    phases: (argVal('--phase') || 'overview,detail').split(',').map(s => s.trim()).filter(Boolean),
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
    if (cli.bucket) segs = segs.filter(s => s.bucket === cli.bucket);
    return segs;
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
        if (parts.length) {
            console.log('      ' + c.label + ': ' + parts.join(' · '));
        }
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

    if (a.fieldSameCounts.length) {
        const counts = a.fieldSameCounts.map(x => x.same + '/' + x.total).join(', ');
        console.log('  Koşu bazında (aynı/toplam): ' + counts);
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
    } else if (a.n >= 2) {
        console.log('  Benzer koşu kümesi: yok (Jaccard<' + cli.minJaccard + ')');
    }

    console.log('  Koşu listesi:');
    for (const r of a.raceDetails) {
        console.log('    ' + pad(r.label, 32)
            + ' saha ' + r.sameInField + '/' + r.fieldSize + ' (' + r.fieldPct + ')'
            + ' · dom S1:' + (r.domSon || '—')
            + ' · lider:' + (r.leaderSonWon ? '✓' : '✗'));
        if (cli.verbose) {
            console.log('      ' + r.winnerCombo);
            console.log('      archetype: ' + r.archetype);
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

    for (const seg of ordered) {
        printSegmentDetail(seg, report.poolSize);
    }
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
            const otherMetrics = DEEP_TEN_METRICS.filter(x => x.id !== m.id);
            for (const om of otherMetrics) {
                const c = a.cross[om.id];
                if (!c?.visuals.length) continue;
                console.log('    Kazanan ' + om.label + ' renk: '
                    + c.visuals.map(v => v.key + ' ' + pct(v.count / a.n)).join(' · '));
            }
            if (a.similarClusters.length) {
                console.log('    Benzer: ' + a.similarClusters.map((cl, i) =>
                    'K' + (i + 1) + '(' + cl.length + ')').join(' '));
            }
            console.log('    Koşular: ' + a.raceDetails.map(r => r.label).join(' · '));
        }
    }
}

async function main() {
    loadSimilarityEngines();
    const db = openDb(cli.dbPath);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Kazanan profil segment raporu — ' + cli.fieldSize + ' at                          ║');
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

        const segs = filterSegments(report);

        if (cli.phases.includes('overview')) printOverview(report, segs);
        if (cli.phases.includes('renk')) printRenkFocus(report, segs);
        if (cli.phases.includes('detail')) printDetail(report, segs);

        console.log('\n── Kullanım ──');
        console.log('  node scripts/test-race-segment-report.js --field-size 10');
        console.log('  node scripts/test-race-segment-report.js --metric son8001 --dimension visual --bucket yesil');
        console.log('  node scripts/test-race-segment-report.js --phase renk,detail --verbose');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
