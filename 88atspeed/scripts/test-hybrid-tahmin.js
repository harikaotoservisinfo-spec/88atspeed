#!/usr/bin/env node
/**
 * Hibrit TAHMİN — terminal benchmark (başarı % · gösterge · hibrit)
 *
 * Kullanım:
 *   npm run test:hybrid-tahmin
 *   node scripts/test-hybrid-tahmin.js --holdout 0.3
 *   node scripts/test-hybrid-tahmin.js --db /var/www/88atspeed/atlar.db --field-size 10
 */
const {
    ROOT,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    buildEntriesByFieldSize,
    pct,
    pad,
    openDb
} = require('./ptest-terminal-lib');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    holdout: argVal('--holdout') != null ? Number(argVal('--holdout')) : null,
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null
};

function loadHybridEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8')
        + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8')
        + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function splitHoldout(flatEntries, holdoutRatio) {
    const kayitIds = [...new Set(flatEntries.map(e => e.kayitId))].sort((a, b) => a - b);
    if (kayitIds.length < 2) {
        return { train: flatEntries, test: [], trainKayitCount: kayitIds.length, testKayitCount: 0 };
    }
    const ratio = Math.max(0.1, Math.min(0.5, holdoutRatio || 0.3));
    const splitIdx = Math.max(1, Math.floor(kayitIds.length * (1 - ratio)));
    const trainSet = new Set(kayitIds.slice(0, splitIdx));
    const testSet = new Set(kayitIds.slice(splitIdx));
    return {
        train: flatEntries.filter(e => trainSet.has(e.kayitId)),
        test: flatEntries.filter(e => testSet.has(e.kayitId)),
        trainKayitCount: trainSet.size,
        testKayitCount: testSet.size
    };
}

function countRaces(flatEntries) {
    return new Set(flatEntries.map(e => e.kayitId + '|' + e.raceNo)).size;
}

function printEngineStats(label, stats) {
    console.log('  ' + pad(label, 14) + ' · karışık ' + pad(pct(stats.leaderBlended), 7)
        + ' · tam ' + pad(pct(stats.exactRate), 7)
        + ' · lider ' + (stats.leaderTotal || 0) + ' koşu');
}

function printByFieldSize(flatEntries, host, fieldSizeFilter) {
    const { entriesByField, fieldSizes } = buildEntriesByFieldSize(flatEntries);
    const sizes = fieldSizeFilter
        ? fieldSizes.filter(fs => fs === fieldSizeFilter)
        : fieldSizes;

    console.log('\n── At sayısına göre (test kümesi) ──');
    for (const fs of sizes) {
        const subset = entriesByField[fs] || [];
        if (!subset.length) continue;
        const rc = countRaces(subset);
        const basari = HybridTahminScoringEngine.evaluateEngineOnFlat(subset, host.bitisValueForSort, 'basari');
        const gosterge = HybridTahminScoringEngine.evaluateEngineOnFlat(subset, host.bitisValueForSort, 'gosterge');
        const hybrid = HybridTahminScoringEngine.evaluateEngineOnFlat(subset, host.bitisValueForSort, 'hybrid');
        const cal = HybridTahminScoringEngine.getCalibration();
        const blend = cal?.blendBySize?.[fs] ?? cal?.globalBasariWeight ?? 0.5;
        console.log('  ' + fs + ' at · ' + rc + ' koşu · mod '
            + (cal?.modeBySize?.[fs] || cal?.globalMode || 'blend'));
        console.log('    başarı %  → karışık ' + pct(basari.leaderBlended)
            + ' · tam ' + pct(basari.exactRate));
        console.log('    gösterge  → karışık ' + pct(gosterge.leaderBlended)
            + ' · tam ' + pct(gosterge.exactRate));
        console.log('    HİBRİT    → karışık ' + pct(hybrid.leaderBlended)
            + ' · tam ' + pct(hybrid.exactRate)
            + (hybrid.leaderBlended > Math.max(basari.leaderBlended, gosterge.leaderBlended) ? ' ★' : ''));
    }
}

function printBlendTable(cal) {
    if (!cal?.blendList?.length) return;
    console.log('\n── Hibrit karışım ağırlıkları (kalibrasyon) ──');
    for (const row of cal.blendList.sort((a, b) => a.fieldSize - b.fieldSize)) {
        let line = '  ' + pad(row.fieldSize + ' at', 6) + ' · ' + pad(row.raceCount + ' koşu', 8)
            + ' · ' + pad(row.engineMode || 'blend', 8);
        if (row.engineMode === 'blend') {
            line += ' · B%' + pad(String(Math.round((row.basariWeight || 0) * 100)), 3)
                + ' G%' + pad(String(Math.round((row.gostergeWeight || 0) * 100)), 3);
        }
        if (row.basariBlended != null) {
            line += ' · ölçüm B:' + pct(row.basariBlended) + ' G:' + pct(row.gostergeBlended);
        }
        if (row.fieldSize === 10) line += ' · 10-at terminal profili';
        if (row.source === 'global-min-races') line += ' · global (&lt;' + (global.HybridTahminScoringEngine?.MIN_RACES_FOR_MODE || 10) + ' koşu)';
        console.log(line);
    }
}

async function calibrateOnTrain(trainEntries, host) {
    return HybridTahminScoringEngine.calibrateFromFlatEntries(trainEntries, host.bitisValueForSort, { host });
}

async function main() {
    loadHybridEngines();
    const db = openDb(cli.dbPath);
    console.log('══ Hibrit TAHMİN benchmark ══');
    console.log('DB: ' + cli.dbPath);

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.filterKayit,
            filterRace: cli.filterRace
        });
        if (!flatEntries.length) {
            console.log('Veri yok.');
            process.exit(0);
        }

        const host = makeGostergeHost(flatEntries, bitisMap);
        const raceCount = countRaces(flatEntries);
        const withBitis = flatEntries.filter(e => host.bitisValueForSort(e) >= 1).length;
        console.log('Satır: ' + flatEntries.length + ' · bitişli: ' + withBitis + ' · koşu: ' + raceCount);

        let trainEntries = flatEntries;
        let testEntries = flatEntries;
        let mode = 'full';

        if (cli.holdout != null && cli.holdout > 0) {
            const split = splitHoldout(flatEntries, cli.holdout);
            trainEntries = split.train;
            testEntries = split.test;
            mode = 'holdout';
            console.log('\n── Holdout ──');
            console.log('  Eğitim: ' + split.trainKayitCount + ' kayıt · '
                + countRaces(trainEntries) + ' koşu · ' + trainEntries.length + ' satır');
            console.log('  Test:   ' + split.testKayitCount + ' kayıt · '
                + countRaces(testEntries) + ' koşu · ' + testEntries.length + ' satır');
        }

        console.log('\n⏳ Kalibrasyon (' + (mode === 'holdout' ? 'yalnızca eğitim kümesi' : 'tüm veri') + ')…');
        const cal = await calibrateOnTrain(trainEntries, host);
        if (!cal) {
            console.error('Kalibrasyon başarısız.');
            process.exit(1);
        }

        printBlendTable(cal);

        const evalSet = mode === 'holdout' ? testEntries : flatEntries;
        const evalLabel = mode === 'holdout' ? 'Test kümesi (out-of-sample)' : 'Tüm veri';

        console.log('\n── ' + evalLabel + ' ──');
        const basariStats = HybridTahminScoringEngine.evaluateEngineOnFlat(
            evalSet, host.bitisValueForSort, 'basari'
        );
        const gostergeStats = HybridTahminScoringEngine.evaluateEngineOnFlat(
            evalSet, host.bitisValueForSort, 'gosterge'
        );
        const hybridStats = HybridTahminScoringEngine.evaluateEngineOnFlat(
            evalSet, host.bitisValueForSort, 'hybrid'
        );

        printEngineStats('Başarı %', basariStats);
        printEngineStats('Gösterge', gostergeStats);
        printEngineStats('HİBRİT', hybridStats);

        const best = Math.max(basariStats.leaderBlended, gostergeStats.leaderBlended, hybridStats.leaderBlended);
        if (hybridStats.leaderBlended >= best - 0.0001) {
            console.log('  → Hibrit en iyi veya eşit ★');
        }

        printByFieldSize(evalSet, host, cli.fieldSize);

        if (mode === 'full') {
            console.log('\n── Holdout önerisi ──');
            console.log('  node scripts/test-hybrid-tahmin.js --holdout 0.3');
        }

        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
