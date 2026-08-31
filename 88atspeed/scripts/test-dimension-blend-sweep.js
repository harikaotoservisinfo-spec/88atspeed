#!/usr/bin/env node
/**
 * Hybrid × boyut blend oranı taraması — TAHMİN koşu lideri BİTİŞ başarısı
 *
 * Kullanım:
 *   npm run test:dimension-blend
 *   node scripts/test-dimension-blend-sweep.js --db atlar.db
 *   node scripts/test-dimension-blend-sweep.js --kayit 148 --step 5
 *   node scripts/test-dimension-blend-sweep.js --dim-min 0 --dim-max 60 --step 2
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
    openDb,
    dbAll
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    dimMin: argVal('--dim-min') != null ? Number(argVal('--dim-min')) : 0,
    dimMax: argVal('--dim-max') != null ? Number(argVal('--dim-max')) : 100,
    step: argVal('--step') != null ? Number(argVal('--step')) : 5
};

const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

function loadEngines() {
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
    eval(fs.readFileSync(path.join(ROOT, 'public/js/dimension-tahmin-boost-engine.js'), 'utf8')
        + '\n; global.DimensionTahminBoostEngine = DimensionTahminBoostEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8')
        + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function blendedFromCounts(leaderTotal, b1, b12, b123) {
    if (!leaderTotal) return 0;
    return SUCCESS_BLEND.b1 * (b1 / leaderTotal)
        + SUCCESS_BLEND.b12 * (b12 / leaderTotal)
        + SUCCESS_BLEND.b123 * (b123 / leaderTotal);
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

function evaluateLeaderSuccess(raceGroups, host) {
    let leaderTotal = 0, b1 = 0, b12 = 0, b123 = 0;
    for (const entries of raceGroups) {
        const scored = entries.map(e => ({
            entry: e,
            score: e.row?.tahmin?.score ?? null
        })).filter(s => s.score != null);
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
        leaderTotal,
        b1, b12, b123,
        leaderBlended: blendedFromCounts(leaderTotal, b1, b12, b123),
        exactRate: leaderTotal ? b1 / leaderTotal : 0,
        top3Rate: leaderTotal ? b123 / leaderTotal : 0
    };
}

function clearTahminState(entries) {
    for (const e of entries) {
        if (e.row) delete e.row.tahmin;
    }
}

function attachTahminWithDimWeight(raceGroups, dimPct) {
    const dimW = dimPct / 100;
    const hybridW = 1 - dimW;
    DimensionTahminBoostEngine.setBlendWeights(hybridW, dimW);
    DimensionTahminBoostEngine.setEnabled(dimW > 0);

    for (const entries of raceGroups) {
        for (const e of entries) {
            if (e.row?.tahmin) delete e.row.tahmin;
            delete e.row?._dim;
        }
        const rows = entries.map(e => e.row);
        const pkg = {
            rows,
            forceDimensionBoost: dimW > 0,
            skipDimensionBoost: true,
            depthCoverage: entries[0]?._pkg?.depthCoverage || null,
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null
        };
        HybridTahminScoringEngine.attachRaceTahmin(pkg);
        if (dimW > 0) {
            pkg.skipDimensionBoost = false;
            DimensionTahminBoostEngine.applyBoostToPkg(pkg);
        }
    }
}

function buildSweepSteps() {
    const steps = [];
    const step = Math.max(1, cli.step);
    for (let d = cli.dimMin; d <= cli.dimMax; d += step) {
        steps.push(Math.min(d, cli.dimMax));
    }
    if (steps[steps.length - 1] !== cli.dimMax) steps.push(cli.dimMax);
    return [...new Set(steps)].sort((a, b) => a - b);
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  TAHMİN blend taraması — hybrid % vs boyut % · BİTİŞ başarısı    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);
    if (cli.kayitId) console.log('Kayıt: #' + cli.kayitId);
    console.log('Boyut payı: %' + cli.dimMin + ' → %' + cli.dimMax + ' · adım %' + cli.step + '\n');

    loadEngines();
    const db = openDb(cli.dbPath);

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        let entries = flatEntries.filter(e => host.bitisValueForSort(e) != null);
        const raceGroups = buildRaceGroups(entries);

        console.log('Flat satır     : ' + flatEntries.length);
        console.log('BİTİŞ bilgili  : ' + entries.length);
        console.log('Koşu sayısı    : ' + raceGroups.length);

        if (entries.length < 5) {
            console.log('\n⚠ Yeterli BİTİŞ yok. PUANLAMA TEST bitiş sütunlarını doldurun.');
            return;
        }

        console.log('\n⏳ Hibrit TAHMİN kalibre ediliyor…');
        await HybridTahminScoringEngine.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort
        );

        const sweepSteps = buildSweepSteps();
        const results = [];

        for (const dimPct of sweepSteps) {
            clearTahminState(entries);
            attachTahminWithDimWeight(raceGroups, dimPct);
            const stats = evaluateLeaderSuccess(raceGroups, host);
            results.push({
                dimPct,
                hybridPct: 100 - dimPct,
                ...stats
            });
        }

        const baseline = results.find(r => r.dimPct === 0) || results[0];
        results.sort((a, b) => b.leaderBlended - a.leaderBlended || b.exactRate - a.exactRate);

        console.log('\n══ SONUÇ TABLOSU (koşu lideri · karışık 80/12/8) ══');
        console.log('  ' + pad('Boyut%', 7) + pad('Hybrid%', 8)
            + pad('Karışık', 9) + pad('★ 1.', 8) + pad('1-3', 8) + 'n');
        console.log('  ' + '-'.repeat(44));

        const sorted = [...results].sort((a, b) => a.dimPct - b.dimPct);
        for (const r of sorted) {
            const vs = r.leaderBlended - baseline.leaderBlended;
            const mark = r.dimPct === results[0].dimPct ? ' ◀ en iyi' : '';
            console.log('  ' + pad('%' + r.dimPct, 7) + pad('%' + r.hybridPct, 8)
                + pad(pct(r.leaderBlended), 9) + pad(pct(r.exactRate), 8)
                + pad(pct(r.top3Rate), 8) + pad(String(r.leaderTotal), 4)
                + (vs >= 0 ? ' +' + pct(vs) : ' ' + pct(vs)) + mark);
        }

        const best = results[0];
        console.log('\n══ ÖZET ══');
        console.log('  Baseline (saf hybrid, boyut %0): karışık ' + pct(baseline.leaderBlended)
            + ' · ★ ' + pct(baseline.exactRate) + ' · n=' + baseline.leaderTotal);
        console.log('  En iyi blend                  : boyut %' + best.dimPct
            + ' / hybrid %' + best.hybridPct);
        console.log('    → karışık ' + pct(best.leaderBlended)
            + ' · ★ ' + pct(best.exactRate)
            + ' · 1-3 ' + pct(best.top3Rate)
            + ' · n=' + best.leaderTotal);
        const delta = best.leaderBlended - baseline.leaderBlended;
        console.log('    → vs baseline: ' + (delta >= 0 ? '+' : '') + pct(delta));

        const current = sorted.find(r => r.dimPct === 42) || sorted.find(r => r.dimPct === 40);
        if (current && current.dimPct !== best.dimPct) {
            console.log('  Mevcut prod (%42 boyut)         : karışık ' + pct(current.leaderBlended)
                + ' (+' + pct(current.leaderBlended - baseline.leaderBlended) + ' vs baseline)');
        }

        console.log('\nOK · ' + sweepSteps.length + ' oran denendi · '
            + raceGroups.length + ' koşu · ' + entries.length + ' BİTİŞ');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
