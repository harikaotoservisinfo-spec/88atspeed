#!/usr/bin/env node
/**
 * Tek koşu TAHMİN teşhisi — hybrid / boyut / badge uyumu
 *
 *   node scripts/test-tahmin-race-diagnose.js --race 5
 *   node scripts/test-tahmin-race-diagnose.js --kayit 114 --race 5
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
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
    raceNo: argVal('--race') ? Number(argVal('--race')) : null
};

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

function attachLikeUi(entries) {
    const rows = entries.map(e => e.row);
    const pkg = {
        rows,
        skipDimensionBoost: true,
        depthCoverage: entries[0]?._pkg?.depthCoverage || null,
        hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null
    };
    HybridTahminScoringEngine.attachRaceTahmin(pkg);
    pkg.skipDimensionBoost = false;
    pkg.forceDimensionBoost = true;
    DimensionTahminBoostEngine.applyBoostToPkg(pkg);
    return pkg;
}

async function main() {
    if (!cli.raceNo) {
        console.error('Kullanım: node scripts/test-tahmin-race-diagnose.js --race N [--kayit ID]');
        process.exit(1);
    }

    loadEngines();
    const db = openDb(cli.dbPath);
    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId,
            filterRace: cli.raceNo
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        const entries = flatEntries.filter(e =>
            Number(e.raceNo) === cli.raceNo
            && (!cli.kayitId || Number(e.kayitId) === cli.kayitId)
        );
        if (!entries.length) {
            console.log('Koşu bulunamadı.');
            return;
        }

        await HybridTahminScoringEngine.calibrateFromFlatEntries(flatEntries, host.bitisValueForSort);

        const pkgBase = {
            rows: entries.map(e => ({ ...e.row, tahmin: undefined, _dim: undefined })),
            skipDimensionBoost: true,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom
        };
        for (const row of pkgBase.rows) delete row.tahmin;
        HybridTahminScoringEngine.attachRaceTahmin({
            rows: pkgBase.rows,
            skipDimensionBoost: true,
            hedefSehir: pkgBase.hedefSehir,
            depthCoverage: entries[0]?._pkg?.depthCoverage
        });

        const pkgFinal = attachLikeUi(entries);

        console.log('══ KOŞU ' + cli.raceNo + ' TEŞHİS ══');
        console.log('Kayıt: #' + entries[0].kayitId + ' · ' + entries[0].hipodrom + ' · ' + entries.length + ' at');
        console.log('Hybrid kalibre: ' + (HybridTahminScoringEngine.isCalibrated?.() ? 'evet' : 'hayır'));
        const blend = DimensionTahminBoostEngine.getBlendWeights();
        console.log('Blend: hybrid %' + Math.round(blend.hybridWeight * 100)
            + ' · boyut %' + Math.round(blend.dimWeight * 100));
        const cov = pkgFinal.tahminOzeti?.dimensionCoverage || {};
        console.log('Kosular: ' + cov.withKosular + '/' + cov.total
            + ' · boyut uygulanan: ' + cov.boosted + '/' + cov.total);
        console.log('Badge lider: ' + (pkgFinal.tahminOzeti?.leader || '—')
            + ' %' + (pkgFinal.tahminOzeti?.leaderPct ?? '?'));
        const rank1 = pkgFinal.rows.find(r => r.tahmin?.rank === 1);
        console.log('Tablo #1    : ' + (rank1?.name || '—')
            + ' %' + (rank1?.tahmin?.pct ?? '?'));
        console.log('Badge=Tablo : ' + (pkgFinal.tahminOzeti?.leader === rank1?.name ? '✓' : '✗ UYUMSUZ'));
        console.log('');

        console.log(pad('#', 3) + pad('At', 28) + pad('BİTİŞ', 6)
            + pad('Hyb', 5) + pad('DimN', 6) + pad('Skor', 5)
            + pad('TAH', 5) + pad('%', 5) + 'Boost');
        for (const row of pkgFinal.rows.sort((a, b) => (a.tahmin?.rank ?? 99) - (b.tahmin?.rank ?? 99))) {
            const bitis = host.bitisValueForSort(entries.find(e => e.row === row));
            const base = entries.find(e => e.row.no === row.no);
            const hybRow = pkgBase.rows.find(r => r.no === row.no);
            console.log(pad(String(row.no), 3)
                + pad((row.name || '').slice(0, 26), 28)
                + pad(bitis != null ? String(bitis) : '—', 6)
                + pad(hybRow?.tahmin?.score ?? '—', 5)
                + pad(row.tahmin?.dimensionNorm != null
                    ? (Math.round(row.tahmin.dimensionNorm * 100) + '') : '—', 6)
                + pad(row.tahmin?.score ?? '—', 5)
                + pad(row.tahmin?.rank ?? '—', 5)
                + pad(row.tahmin?.pct ?? '—', 5)
                + (row.tahmin?.dimensionBoostApplied ? '✓' : '—'));
        }
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
