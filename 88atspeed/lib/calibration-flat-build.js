/**
 * Sunucu tarafı kalibrasyon flat-entry build — tarayıcıdaki N+1 HTTP + paket hesabını önler.
 */
const path = require('path');
const {
    openDb,
    loadGostergeEngines,
    buildFlatEntriesFromDb
} = require('../scripts/ptest-terminal-lib');

const DB_PATH = path.join(__dirname, '..', 'atlar.db');
const CACHE_MS = 120000;

let buildCache = null;
let buildCacheAt = 0;
let buildPromise = null;

function stripPkg(flatEntries) {
    for (const entry of flatEntries || []) {
        if (entry?._pkg) delete entry._pkg;
    }
}

async function buildCalibrationFlat(dbPath) {
    const now = Date.now();
    if (buildCache && (now - buildCacheAt) < CACHE_MS) {
        return buildCache;
    }
    if (buildPromise) return buildPromise;

    buildPromise = (async function () {
        const t0 = Date.now();
        loadGostergeEngines();
        const db = openDb(dbPath || DB_PATH);
        try {
            const built = await buildFlatEntriesFromDb(db, {});
            stripPkg(built.flatEntries);
            buildCache = {
                flatEntries: built.flatEntries,
                bitisMap: built.bitisMap,
                flatCount: built.flatEntries.length,
                buildMs: Date.now() - t0
            };
            buildCacheAt = Date.now();
            return buildCache;
        } finally {
            db.close();
            buildPromise = null;
        }
    })();
    return buildPromise;
}

function clearCalibrationFlatCache() {
    buildCache = null;
    buildCacheAt = 0;
}

module.exports = { buildCalibrationFlat, clearCalibrationFlatCache };
