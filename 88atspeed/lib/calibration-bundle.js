/**
 * Sunucu tarafı PUANLAMA TEST kalibrasyon paketi — tarayıcıya 500MB flat yerine ~0.5MB bundle.
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    openDb
} = require('../scripts/ptest-terminal-lib');

const DB_PATH = path.join(__dirname, '..', 'atlar.db');
const BUNDLE_VERSION = 1;
const CACHE_MS = 120000;

let bundleCache = null;
let bundleCacheAt = 0;
let bundlePromise = null;

function stripFunctions(value) {
    return JSON.parse(JSON.stringify(value, function(key, val) {
        return typeof val === 'function' ? undefined : val;
    }));
}

function loadHybridEngines() {
    const files = [
        ['basari-pct-scoring-engine.js', 'BasariPctScoringEngine'],
        ['hybrid-tahmin-scoring-engine.js', 'HybridTahminScoringEngine'],
        ['astest-son-gosterge1-tahmin.js', 'AtestSonGosterge1Tahmin']
    ];
    for (const [file, globalName] of files) {
        if (global[globalName]) continue;
        eval(fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8')
            + '\n; global.' + globalName + ' = ' + globalName + ';');
    }
}

function readG1Rates() {
    const mod = global.AtestSonGosterge1Tahmin;
    if (!mod) return null;
    return {
        sideRates: mod.getSideRates?.() || null,
        pairRates: mod.getPairRates?.() || null
    };
}

async function buildCalibrationBundle(dbPath) {
    const now = Date.now();
    if (bundleCache && (now - bundleCacheAt) < CACHE_MS) {
        return bundleCache;
    }
    if (bundlePromise) return bundlePromise;

    bundlePromise = (async function() {
        const t0 = Date.now();
        loadGostergeEngines();
        loadHybridEngines();

        const db = openDb(dbPath || DB_PATH);
        try {
            const built = await buildFlatEntriesFromDb(db, {});
            const host = makeGostergeHost(built.flatEntries, built.bitisMap);

            await global.HybridTahminScoringEngine.calibrateFromFlatEntries(
                built.flatEntries, host.bitisValueForSort, { host: host });
            global.AtestSonGosterge1Tahmin.calibrateFromFlatEntries(
                built.flatEntries, host.bitisValueForSort);

            const g1 = readG1Rates();
            const bundle = {
                version: BUNDLE_VERSION,
                builtAt: Date.now(),
                flatCount: built.flatEntries.length,
                gosterge: stripFunctions(global.GostergeScoringEngine.getCalibration()),
                hybrid: stripFunctions(global.HybridTahminScoringEngine.getCalibration()),
                basari: {
                    weightsBySize: global.BasariPctScoringEngine.getWeightsBySize(),
                    summary: global.BasariPctScoringEngine.getCalibrationSummary()
                },
                g1: g1
            };

            bundleCache = {
                bundle: bundle,
                buildMs: Date.now() - t0,
                flatCount: built.flatEntries.length
            };
            bundleCacheAt = Date.now();
            return bundleCache;
        } finally {
            db.close();
            bundlePromise = null;
        }
    })();

    return bundlePromise;
}

function clearCalibrationBundleCache() {
    bundleCache = null;
    bundleCacheAt = 0;
    bundlePromise = null;
}

module.exports = {
    buildCalibrationBundle,
    clearCalibrationBundleCache,
    BUNDLE_VERSION
};
