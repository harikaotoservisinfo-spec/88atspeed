/**
 * Sunucu tarafı PUANLAMA TEST kalibrasyon paketi — tarayıcıya 500MB flat yerine ~0.5MB bundle.
 * Disk önbelleği: ilk build sonrası anında servis (curl/panel takılmasın).
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
const BUNDLE_FILE = path.join(__dirname, '..', 'data', 'calibration-bundle.v1.json');
const BUNDLE_VERSION = 1;
const CACHE_MS = 120000;
const DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let bundleCache = null;
let bundleCacheAt = 0;
let bundlePromise = null;
let backgroundRebuildScheduled = false;

function stripFunctions(value) {
    return JSON.parse(JSON.stringify(value, function strip(key, val) {
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

function isValidBundlePayload(payload) {
    return !!(payload?.bundle?.gosterge?.metrics?.length
        && payload.bundle.gosterge.bitisRows >= 5);
}

function loadBundleFromDisk() {
    try {
        if (!fs.existsSync(BUNDLE_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(BUNDLE_FILE, 'utf8'));
        if (!isValidBundlePayload(raw)) return null;
        return {
            bundle: raw.bundle,
            flatCount: raw.flatCount || 0,
            buildMs: raw.buildMs || 0,
            builtAt: raw.builtAt || fs.statSync(BUNDLE_FILE).mtimeMs,
            source: 'disk'
        };
    } catch (err) {
        console.warn('calibration-bundle disk okunamadı:', err.message);
        return null;
    }
}

function saveBundleToDisk(payload) {
    try {
        fs.mkdirSync(path.dirname(BUNDLE_FILE), { recursive: true });
        const out = {
            version: BUNDLE_VERSION,
            builtAt: Date.now(),
            flatCount: payload.flatCount,
            buildMs: payload.buildMs,
            bundle: payload.bundle
        };
        fs.writeFileSync(BUNDLE_FILE, JSON.stringify(out));
        console.log('💾 Kalibrasyon bundle diske yazıldı · ' + payload.flatCount + ' flat · ' + payload.buildMs + 'ms');
    } catch (err) {
        console.warn('calibration-bundle disk yazılamadı:', err.message);
    }
}

function getBundleStatus() {
    const mem = bundleCache && isValidBundlePayload(bundleCache)
        ? { ready: true, source: 'memory', flatCount: bundleCache.flatCount, buildMs: bundleCache.buildMs }
        : { ready: false, source: 'memory' };
    if (mem.ready) return Object.assign(mem, { building: !!bundlePromise });
    const disk = loadBundleFromDisk();
    if (disk) {
        return {
            ready: true,
            source: 'disk',
            flatCount: disk.flatCount,
            buildMs: disk.buildMs,
            builtAt: disk.builtAt,
            building: !!bundlePromise,
            diskAgeMs: Date.now() - (disk.builtAt || 0)
        };
    }
    return { ready: false, source: 'none', building: !!bundlePromise };
}

function scheduleBackgroundRebuild(dbPath, force) {
    if (backgroundRebuildScheduled && !force) return;
    const disk = loadBundleFromDisk();
    if (!force && disk && (Date.now() - (disk.builtAt || 0)) < DISK_MAX_AGE_MS) return;
    if (bundlePromise) return;
    backgroundRebuildScheduled = true;
    setTimeout(function onRebuild() {
        buildCalibrationBundle(dbPath, { force: true, quiet: true })
            .then(function(b) {
                console.log('🔥 Kalibrasyon bundle arka plan yenileme: ' + b.flatCount + ' flat · ' + b.buildMs + 'ms');
            })
            .catch(function(err) {
                console.warn('Kalibrasyon bundle arka plan yenileme başarısız:', err.message);
            })
            .finally(function() {
                backgroundRebuildScheduled = false;
            });
    }, 1000);
}

async function buildCalibrationBundleFresh(dbPath, quiet) {
    const t0 = Date.now();
    if (!quiet) console.log('⏳ Kalibrasyon bundle build başlıyor…');
    loadGostergeEngines();
    loadHybridEngines();

    const db = openDb(dbPath || DB_PATH);
    try {
        const built = await buildFlatEntriesFromDb(db, {});
        if (!built.flatEntries.length) {
            throw new Error('Kalibrasyon için flat entry yok (hesaplama_kayitlari boş mu?)');
        }
        const host = makeGostergeHost(built.flatEntries, built.bitisMap);

        await global.HybridTahminScoringEngine.calibrateFromFlatEntries(
            built.flatEntries, host.bitisValueForSort, { host: host });
        global.AtestSonGosterge1Tahmin.calibrateFromFlatEntries(
            built.flatEntries, host.bitisValueForSort);

        const g1 = readG1Rates();
        const gostergeCal = global.GostergeScoringEngine.getCalibration();
        if (!gostergeCal?.metrics?.length || (gostergeCal.bitisRows || 0) < 5) {
            throw new Error('Gösterge kalibrasyonu yetersiz (bitisRows=' + (gostergeCal?.bitisRows || 0) + ')');
        }

        const bundle = {
            version: BUNDLE_VERSION,
            builtAt: Date.now(),
            flatCount: built.flatEntries.length,
            gosterge: stripFunctions(gostergeCal),
            hybrid: stripFunctions(global.HybridTahminScoringEngine.getCalibration()),
            basari: {
                weightsBySize: global.BasariPctScoringEngine.getWeightsBySize(),
                summary: global.BasariPctScoringEngine.getCalibrationSummary()
            },
            g1: g1
        };

        const payload = {
            bundle: bundle,
            buildMs: Date.now() - t0,
            flatCount: built.flatEntries.length,
            builtAt: Date.now(),
            source: 'fresh'
        };
        if (!quiet) {
            console.log('✅ Kalibrasyon bundle hazır · ' + payload.flatCount + ' flat · ' + payload.buildMs + 'ms');
        }
        return payload;
    } finally {
        db.close();
    }
}

async function buildCalibrationBundle(dbPath, opts) {
    opts = opts || {};
    const now = Date.now();

    if (!opts.force && bundleCache && isValidBundlePayload(bundleCache)
        && (now - bundleCacheAt) < CACHE_MS) {
        return bundleCache;
    }

    if (!opts.force) {
        const disk = loadBundleFromDisk();
        if (disk) {
            bundleCache = disk;
            bundleCacheAt = now;
            scheduleBackgroundRebuild(dbPath, false);
            return disk;
        }
    }

    if (bundlePromise) return bundlePromise;

    bundlePromise = (async function runBuild() {
        try {
            const payload = await buildCalibrationBundleFresh(dbPath, opts.quiet);
            bundleCache = payload;
            bundleCacheAt = Date.now();
            saveBundleToDisk(payload);
            return payload;
        } finally {
            bundlePromise = null;
        }
    })();

    return bundlePromise;
}

function clearCalibrationBundleCache() {
    bundleCache = null;
    bundleCacheAt = 0;
    bundlePromise = null;
    backgroundRebuildScheduled = false;
}

function primeBundleFromDisk() {
    const disk = loadBundleFromDisk();
    if (disk) {
        bundleCache = disk;
        bundleCacheAt = Date.now();
        console.log('📦 Kalibrasyon bundle diskten yüklendi · ' + disk.flatCount + ' flat');
        return true;
    }
    return false;
}

module.exports = {
    buildCalibrationBundle,
    buildCalibrationBundleFresh,
    clearCalibrationBundleCache,
    getBundleStatus,
    primeBundleFromDisk,
    scheduleBackgroundRebuild,
    BUNDLE_VERSION,
    BUNDLE_FILE
};
