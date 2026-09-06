#!/usr/bin/env node
/**
 * TAHMİN lideri — İlk-1/2/3 vs Son-1/2/3 ayrı başarı ölçümü + blend taraması
 *
 *   npm run test:tahmin-buckets
 *   node scripts/test-tahmin-position-buckets.js --db atlar.db
 *   node scripts/test-tahmin-position-buckets.js --kayit 148
 *   node scripts/test-tahmin-position-buckets.js --sweep --dim-max 50
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    pct,
    pad,
    openDb
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    sweep: args.includes('--sweep'),
    dimMin: argVal('--dim-min') != null ? Number(argVal('--dim-min')) : 0,
    dimMax: argVal('--dim-max') != null ? Number(argVal('--dim-max')) : 50,
    step: argVal('--step') != null ? Number(argVal('--step')) : 1
};

const BUCKETS = [
    { id: 'ilk1', label: 'İLK-1', kind: 'top', n: 1, col: '★1.' },
    { id: 'son1', label: 'SON-1', kind: 'bottom', n: 1, col: 'son1' },
    { id: 'ilk2', label: 'İLK-2', kind: 'top', n: 2, col: '1-2' },
    { id: 'son2', label: 'SON-2', kind: 'bottom', n: 2, col: 'son2' },
    { id: 'ilk3', label: 'İLK-3', kind: 'top', n: 3, col: '1-3' },
    { id: 'son3', label: 'SON-3', kind: 'bottom', n: 3, col: 'son3' }
];

function loadEngines() {
    loadGostergeEngines();
    for (const [file, name] of [
        ['public/js/at-meta-fields.js', 'AtMetaFields'],
        ['public/js/field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['public/js/sehir-stats-engine.js', 'SehirStatsEngine'],
        ['public/js/kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['public/js/basari-pct-scoring-engine.js', 'BasariPctScoringEngine'],
        ['public/js/dimension-tahmin-boost-engine.js', 'DimensionTahminBoostEngine'],
        ['public/js/hybrid-tahmin-scoring-engine.js', 'HybridTahminScoringEngine']
    ]) {
        eval(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n; global.' + name + ' = ' + name + ';');
    }
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

function pickScoredLeader(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function pickScoredTail(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => a.score - b.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function isTopN(bitis, fieldSize, n) {
    return bitis != null && bitis >= 1 && bitis <= n;
}

function isBottomN(bitis, fieldSize, n) {
    if (bitis == null || bitis < 1 || fieldSize < 1) return false;
    return bitis >= fieldSize - n + 1;
}

function matchesBucket(bitis, fieldSize, bucket) {
    if (bucket.kind === 'top') return isTopN(bitis, fieldSize, bucket.n);
    return isBottomN(bitis, fieldSize, bucket.n);
}

function evaluatePositionBuckets(raceGroups, host, opts) {
    opts = opts || {};
    const who = opts.who || 'leader';
    const counts = {};
    for (const b of BUCKETS) counts[b.id] = { hit: 0, total: 0 };

    let racesUsed = 0;
    let ties = 0;

    for (const entries of raceGroups) {
        const fieldSize = entries.length;
        const scored = entries.map(e => ({
            entry: e,
            score: e.row?.tahmin?.score ?? null
        })).filter(s => s.score != null);

        const pick = who === 'tail' ? pickScoredTail(scored) : pickScoredLeader(scored);
        if (!pick) {
            ties++;
            continue;
        }

        const bitis = host.bitisValueForSort(pick.entry);
        if (bitis == null || bitis < 1) continue;

        racesUsed++;
        for (const b of BUCKETS) {
            counts[b.id].total++;
            if (matchesBucket(bitis, fieldSize, b)) counts[b.id].hit++;
        }
    }

    const rates = {};
    for (const b of BUCKETS) {
        const c = counts[b.id];
        rates[b.id] = {
            label: b.label,
            kind: b.kind,
            n: b.n,
            hit: c.hit,
            total: c.total,
            rate: c.total ? c.hit / c.total : 0
        };
    }

    return { rates, racesUsed, ties, who };
}

function clearTahminState(entries) {
    for (const e of entries) {
        if (e.row) {
            delete e.row.tahmin;
            delete e.row._dim;
        }
    }
}

function attachTahminWithDimWeight(raceGroups, dimPct) {
    const dimW = dimPct / 100;
    const hybridW = 1 - dimW;
    DimensionTahminBoostEngine.setBlendWeights(hybridW, dimW);
    DimensionTahminBoostEngine.setEnabled(dimW > 0);

    for (const entries of raceGroups) {
        const rows = entries.map(e => e.row);
        const pkg = {
            rows,
            skipDimensionBoost: true,
            forceDimensionBoost: dimW > 0,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null,
            depthCoverage: entries[0]?._pkg?.depthCoverage || null
        };
        HybridTahminScoringEngine.attachRaceTahmin(pkg);
        if (dimW > 0) {
            pkg.skipDimensionBoost = false;
            DimensionTahminBoostEngine.applyBoostToPkg(pkg);
        }
    }
}

function buildSweepSteps() {
    const steps = new Set();
    const step = Math.max(1, cli.step);
    for (let d = cli.dimMin; d <= cli.dimMax; d += step) steps.add(d);
    if (cli.sweep && cli.dimMax < 100) {
        for (let d = 55; d <= 100; d += 5) steps.add(d);
    }
    return [...steps].sort((a, b) => a - b);
}

function printBucketTable(rates, title) {
    console.log('\n── ' + title + ' ──');
    console.log('  ' + pad('Hedef', 8) + pad('İsabet', 8) + pad('Oran', 8) + 'Açıklama');
    console.log('  ' + '-'.repeat(52));
    for (const b of BUCKETS) {
        const r = rates[b.id];
        const desc = b.kind === 'top'
            ? 'TAHMİN #' + (b.n === 1 ? '1' : '1') + ' → bitiş ilk ' + b.n
            : 'TAHMİN #1 → bitiş son ' + b.n + ' (alttan)';
        console.log('  ' + pad(r.label, 8)
            + pad(r.hit + '/' + r.total, 8)
            + pad(pct(r.rate), 8)
            + desc);
    }
}

function printSweepSection(sweepResults, baseline) {
    console.log('\n══ BLEND TARAMASI — hedef bazında en iyi boyut % ══');
    console.log('  TAHMİN lideri (rank #1) · koşu başına tek at · beraberlik atlanır\n');

    const hdr = pad('Hedef', 8);
    const cols = BUCKETS.map(b => pad(b.col, 7)).join('');
    console.log('  ' + hdr + pad('En iyi', 8) + cols);
    console.log('  ' + '-'.repeat(8 + 8 + BUCKETS.length * 7));

    for (const b of BUCKETS) {
        let best = null;
        for (const row of sweepResults) {
            const rate = row.leader.rates[b.id].rate;
            if (!best || rate > best.rate) {
                best = { dimPct: row.dimPct, rate, hit: row.leader.rates[b.id].hit, total: row.leader.rates[b.id].total };
            }
        }
        const baseRate = baseline.leader.rates[b.id].rate;
        const cells = BUCKETS.map(bb => {
            const r = sweepResults.find(x => x.dimPct === best.dimPct).leader.rates[bb.id];
            return pad(pct(r.rate), 7);
        }).join('');
        console.log('  ' + pad(b.label, 8)
            + pad('%' + best.dimPct + '→' + pct(best.rate), 8)
            + cells
            + (best.rate - baseRate >= 0 ? ' +' + pct(best.rate - baseRate) : ' ' + pct(best.rate - baseRate)));
    }

    console.log('\n  Satır = o hedef için en iyi boyut%; sütun = o blenddeki oran');
    console.log('  Referans (hybrid %0): '
        + BUCKETS.map(b => b.label + ' ' + pct(baseline.leader.rates[b.id].rate)).join(' · '));
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  TAHMİN · İlk-1/2/3 vs Son-1/2/3 ayrı başarı testi               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);
    if (cli.kayitId) console.log('Kayıt: #' + cli.kayitId);
    console.log('');

    loadEngines();
    const db = openDb(cli.dbPath);

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        const entries = flatEntries.filter(e => host.bitisValueForSort(e) != null);
        const raceGroups = buildRaceGroups(entries);

        console.log('Flat satır     : ' + flatEntries.length);
        console.log('BİTİŞ bilgili  : ' + entries.length);
        console.log('Koşu sayısı    : ' + raceGroups.length);

        if (raceGroups.length < 1) {
            console.log('\n⚠ Yeterli BİTİŞ yok.');
            return;
        }

        console.log('\n⏳ Hibrit TAHMİN kalibre ediliyor…');
        await HybridTahminScoringEngine.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort
        );

        const dimBlend = DimensionTahminBoostEngine.calibrateBlendFromFlatEntries?.(
            flatEntries, host.bitisValueForSort
        );
        if (dimBlend?.dimPct != null) {
            console.log('Boyut kalibrasyon: %' + dimBlend.dimPct + ' boyut · %' + dimBlend.hybridPct
                + ' hybrid · n=' + (dimBlend.raceCount ?? '?')
                + (dimBlend.lowSample ? ' · ⚠ az koşu' : ''));
            attachTahminWithDimWeight(raceGroups, dimBlend.dimPct);
        } else {
            attachTahminWithDimWeight(raceGroups, 0);
        }

        const leaderCal = evaluatePositionBuckets(raceGroups, host, { who: 'leader' });
        const tailCal = evaluatePositionBuckets(raceGroups, host, { who: 'tail' });

        console.log('\n══ KALİBRE BLEND İLE (TAHMİN rank #1 lider) ══');
        console.log('  Koşu: ' + leaderCal.racesUsed + ' · beraberlik atlanan: ' + leaderCal.ties);
        printBucketTable(leaderCal.rates, 'Lider — ilk/son kova isabeti');

        console.log('\n══ TAHMİN SON SIRADAKİ AT (rank #son) ══');
        console.log('  Koşu: ' + tailCal.racesUsed + ' · beraberlik: ' + tailCal.ties);
        printBucketTable(tailCal.rates, 'Son sıra — son kovada mı? (son-1/2/3 beklenir)');

        console.log('\n── ÖZET (lider) ──');
        console.log('  İlk-1 (★)     : ' + pct(leaderCal.rates.ilk1.rate)
            + ' (' + leaderCal.rates.ilk1.hit + '/' + leaderCal.rates.ilk1.total + ')');
        console.log('  İlk-2         : ' + pct(leaderCal.rates.ilk2.rate)
            + ' (' + leaderCal.rates.ilk2.hit + '/' + leaderCal.rates.ilk2.total + ')');
        console.log('  İlk-3         : ' + pct(leaderCal.rates.ilk3.rate)
            + ' (' + leaderCal.rates.ilk3.hit + '/' + leaderCal.rates.ilk3.total + ')');
        console.log('  Son-1 (son)   : ' + pct(leaderCal.rates.son1.rate)
            + ' (' + leaderCal.rates.son1.hit + '/' + leaderCal.rates.son1.total + ')');
        console.log('  Son-2         : ' + pct(leaderCal.rates.son2.rate)
            + ' (' + leaderCal.rates.son2.hit + '/' + leaderCal.rates.son2.total + ')');
        console.log('  Son-3         : ' + pct(leaderCal.rates.son3.rate)
            + ' (' + leaderCal.rates.son3.hit + '/' + leaderCal.rates.son3.total + ')');

        if (cli.sweep || raceGroups.length <= 15) {
            const steps = buildSweepSteps();
            const sweepResults = [];

            for (const dimPct of steps) {
                clearTahminState(entries);
                attachTahminWithDimWeight(raceGroups, dimPct);
                const leader = evaluatePositionBuckets(raceGroups, host, { who: 'leader' });
                const tail = evaluatePositionBuckets(raceGroups, host, { who: 'tail' });
                sweepResults.push({ dimPct, hybridPct: 100 - dimPct, leader, tail });
            }

            const baseline = sweepResults.find(r => r.dimPct === 0) || sweepResults[0];
            printSweepSection(sweepResults, baseline);

            console.log('\n── SON SIRA (#son) — blend taraması en iyiler ──');
            for (const b of BUCKETS.filter(x => x.kind === 'bottom')) {
                let best = sweepResults[0];
                for (const row of sweepResults) {
                    if (row.tail.rates[b.id].rate > best.tail.rates[b.id].rate) best = row;
                }
                console.log('  ' + pad(b.label, 8) + ' en iyi %' + best.dimPct + ' boyut → '
                    + pct(best.tail.rates[b.id].rate)
                    + ' (' + best.tail.rates[b.id].hit + '/' + best.tail.rates[b.id].total + ')');
            }
        }

        console.log('\nOK · ' + raceGroups.length + ' koşu · ' + entries.length + ' BİTİŞ');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
