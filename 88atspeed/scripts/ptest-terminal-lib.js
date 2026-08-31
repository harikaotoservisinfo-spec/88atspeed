/**
 * PUANLAMA TEST terminal araçları — DB yükleme, host, ortak sabitler
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '..');

const CORE_METRIC_SWEEP_LIST = [
    { id: 'son8001', label: 'SON800-1' },
    { id: 'oran1', label: '800-1 ORAN' },
    { id: 'oran2', label: '800-2 ORAN' },
    { id: 'fark827', label: '800Δ·7' },
    { id: 'ff', label: 'FFΔ' },
    { id: 't8', label: 'T8Δ' },
    { id: 'test1', label: 'TEST1' },
    { id: 'test2', label: 'TEST2' },
    { id: 'test3', label: 'TEST3' },
    { id: 'testsira', label: 'TEST·SIRA' },
    { id: 't1dr', label: 'T1×DR' }
];

const EXTRA_METRIC_SWEEP_LIST = [
    { id: 'f802', label: '800Δ·2' },
    { id: 'f803', label: '800Δ·3' },
    { id: 't9', label: 'T9Δ' },
    { id: 'dr1dr', label: 'DR/1DR' },
    { id: 'drsl', label: 'DR/SL' },
    { id: 'dr1sl', label: '1DR/SL' },
    { id: 't12y', label: 'T12Δ' },
    { id: 'kirmizi', label: 'T123K' },
    { id: 'yesil', label: 'T46Δ' },
    { id: 'mavif', label: 'T23M' },
    { id: 'kmavi', label: 'KMΔ' },
    { id: 't4', label: 'TEST4' },
    { id: 't5', label: 'TEST5' },
    { id: 't6', label: 'TEST6' },
    { id: 't7', label: 'TEST7' },
    { id: 't2m3', label: 'T2−T3' },
    { id: 't1dr3', label: 'T1DR3' },
    { id: 'fark', label: 'FARK' },
    { id: 'ilkf', label: 'İLK-F' },
    { id: 'sonf', label: 'SON-F' },
    { id: 'sl801', label: '8001/SL' },
    { id: 'sl802', label: '8002/SL' },
    { id: 'f8021', label: '8002−1' },
    { id: 'sehirSon', label: 'ŞEH-SON' },
    { id: 'smGec', label: 'Ş+M-GEÇ' },
    { id: 'sm12', label: 'Ş+M-12' },
    { id: 't9v', label: 'T9V' }
];

const ALL_METRIC_SWEEP_LIST = CORE_METRIC_SWEEP_LIST.concat(EXTRA_METRIC_SWEEP_LIST);

function parseCliArgs(argv) {
    const args = argv || process.argv.slice(2);
    function argVal(flag) {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : null;
    }
    const phasesRaw = argVal('--phase') || argVal('--phases') || 'all';
    return {
        dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
        filterKayit: argVal('--kayit') ? Number(argVal('--kayit')) : null,
        filterRace: argVal('--race') ? Number(argVal('--race')) : null,
        fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
        minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 5,
        top: argVal('--top') ? Number(argVal('--top')) : 12,
        quick: args.includes('--quick'),
        verbose: args.includes('--verbose') || args.includes('-v'),
        phases: phasesRaw === 'all'
            ? ['baseline', 'shares', 'colors', 'rules', 'metrics', 't9v', 'adaptive']
            : phasesRaw.split(',').map(s => s.trim()).filter(Boolean)
    };
}

function loadGostergeEngines() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    eval(fs.readFileSync(path.join(ROOT, 'public/js/formula-engine.js'), 'utf8') + '\n; global.GosterimEngine = GosterimEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-grids-extra.js'), 'utf8'));
    eval(fs.readFileSync(path.join(ROOT, 'public/js/ptest-gosterge-engine.js'), 'utf8') + '\n; global.PtestGostergeEngine = PtestGostergeEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/ptest-gosterge-depth-engine.js'), 'utf8') + '\n; global.PtestGostergeDepthEngine = PtestGostergeDepthEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/gosterge-scoring-engine.js'), 'utf8') + '\n; global.GostergeScoringEngine = GostergeScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/ptest-color-gosterge-export.js'), 'utf8') + '\n; global.PtestColorGostergeExport = PtestColorGostergeExport;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/ptest-field-factor-engine.js'), 'utf8') + '\n; global.PtestFieldFactorEngine = PtestFieldFactorEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/ptest-field-adaptive-engine.js'), 'utf8') + '\n; global.PtestFieldAdaptiveEngine = PtestFieldAdaptiveEngine;');
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function parsePuanlamaStore(raw) {
    if (!raw || typeof raw !== 'object') return { bitis: {}, cikan: {} };
    const isLegacy = !raw.bitis && !raw.cikan && Object.values(raw).some(v => typeof v === 'number');
    if (isLegacy) return { bitis: raw, cikan: {} };
    return { bitis: raw.bitis || {}, cikan: raw.cikan || {} };
}

function rowKeyParts(kayitId, raceNo, horseNo) {
    return String(kayitId) + '|' + raceNo + '|' + String(horseNo ?? '');
}

function buildBitisStatsFromEntries(entries, bitisValueForSort) {
    let withBitis = 0;
    let b1 = 0, b12 = 0, b123 = 0;
    for (const entry of entries || []) {
        const b = bitisValueForSort(entry);
        if (b == null || b < 1) continue;
        withBitis++;
        if (b === 1) b1++;
        if (b <= 2) b12++;
        if (b <= 3) b123++;
    }
    return { matchedRows: (entries || []).length, withBitis, b1, b12, b123 };
}

async function buildFlatEntriesFromDb(db, filters) {
    filters = filters || {};
    const IE = global.IstatistikEngine;
    let bitisMap = {};
    try {
        const bitisRow = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (bitisRow?.veri) {
            bitisMap = parsePuanlamaStore(JSON.parse(bitisRow.veri)).bitis;
        }
    } catch (_) {
        /* tablo yok */
    }

    let kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
    if (filters.filterKayit) {
        kayitlar = kayitlar.filter(k => Number(k.id) === filters.filterKayit);
    }

    const flat = [];
    for (const kayit of kayitlar) {
        let races;
        try {
            races = JSON.parse(kayit.veri);
        } catch (_) {
            continue;
        }
        if (!Array.isArray(races)) continue;

        const raceEntries = races.map((race, i) => {
            const raceNo = race.raceNo || (i + 1);
            const pkg = IE.buildRaceIstatistikPackage(race, kayit.hipodrom, kayit.tarih);
            return { race, raceNo, pkg };
        });
        if (raceEntries.length) IE.applyProgramGlobalPctScales(raceEntries.map(e => e.pkg));

        for (const { raceNo, pkg } of raceEntries) {
            if (filters.filterRace && Number(raceNo) !== filters.filterRace) continue;
            for (const row of pkg.rows) {
                const key = rowKeyParts(kayit.id, raceNo, row.no);
                const bitisRaw = bitisMap[key];
                const fromName = global.AtSpeedUtils.extractBitisFromHorseName(row.name);
                const bitisPos = bitisRaw != null && bitisRaw >= 1 ? bitisRaw : fromName;
                flat.push({
                    row,
                    tarih: kayit.tarih,
                    raceNo,
                    hipodrom: kayit.hipodrom,
                    kayitId: kayit.id,
                    _bitisPos: bitisPos != null && bitisPos >= 1 ? bitisPos : null,
                    _pkg: pkg
                });
            }
        }
    }
    return { flatEntries: flat, bitisMap };
}

function makeGostergeHost(flatEntries, bitisMap) {
    const host = {
        flatEntries,
        buildBitisStatsFromEntries(entries) {
            return buildBitisStatsFromEntries(entries, host.bitisValueForSort);
        },
        bitisValueForSort(entry) {
            if (entry._bitisPos != null) return entry._bitisPos;
            const key = rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no);
            const raw = bitisMap[key];
            if (raw != null && raw >= 1) return raw;
            const fromName = global.AtSpeedUtils.extractBitisFromHorseName(entry.row?.name);
            return fromName != null && fromName >= 1 ? fromName : null;
        },
        buildRaceEntryGroups() {
            const map = new Map();
            for (const entry of flatEntries) {
                const rk = host.raceKey(entry.kayitId, entry.raceNo);
                if (!map.has(rk)) map.set(rk, []);
                map.get(rk).push(entry);
            }
            return map;
        },
        computeMetricRankInRace(entry, raceEntries, getMetric) {
            const val = getMetric(entry);
            if (val == null) return { rank: null, field: 0 };
            let rank = 1;
            let field = 0;
            for (const other of raceEntries) {
                const ov = getMetric(other);
                if (ov == null) continue;
                field++;
                if (ov > val) rank++;
            }
            if (!field) return { rank: null, field: 0 };
            return { rank, field };
        },
        buildRaceRankStatsFromItems(rankItems) {
            let withRank = 0;
            let r1 = 0, r12 = 0, r123 = 0, r4 = 0, rOut = 0;
            for (const item of rankItems) {
                const rank = item.rank;
                if (rank == null) continue;
                withRank++;
                if (rank === 1) r1++;
                if (rank <= 2) r12++;
                if (rank <= 3) r123++;
                if (rank === 4) r4++;
                if (rank >= 5) rOut++;
            }
            return {
                matchedRows: rankItems.length,
                withBitis: withRank,
                b1: r1,
                b12: r12,
                b123: r123,
                b4: r4,
                bOut: rOut
            };
        },
        countUniqueRaces() {
            return new Set(flatEntries.map(e => e.kayitId + '|' + e.raceNo)).size;
        },
        raceKey(kayitId, raceNo) {
            return String(kayitId) + '|' + raceNo;
        }
    };
    return host;
}

function buildEntriesByFieldSize(flatEntries) {
    const fieldByRace = new Map();
    const groups = new Map();
    for (const entry of flatEntries) {
        const rk = String(entry.kayitId) + '|' + entry.raceNo;
        if (!groups.has(rk)) groups.set(rk, []);
        groups.get(rk).push(entry);
    }
    for (const [rk, horses] of groups) {
        fieldByRace.set(rk, horses.length);
    }
    const entriesByField = {};
    for (const entry of flatEntries) {
        const rk = String(entry.kayitId) + '|' + entry.raceNo;
        const fs = fieldByRace.get(rk) || 0;
        if (!fs) continue;
        if (!entriesByField[fs]) entriesByField[fs] = [];
        entriesByField[fs].push(entry);
    }
    const fieldSizes = Object.keys(entriesByField).map(Number).sort((a, b) => a - b);
    return { entriesByField, fieldSizes, fieldByRace };
}

function pct(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return (Math.round(n * 1000) / 10).toFixed(1) + '%';
}

function pad(s, n) {
    s = String(s ?? '');
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function openDb(dbPath) {
    return new sqlite3.Database(dbPath);
}

module.exports = {
    ROOT,
    CORE_METRIC_SWEEP_LIST,
    EXTRA_METRIC_SWEEP_LIST,
    ALL_METRIC_SWEEP_LIST,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    buildEntriesByFieldSize,
    buildBitisStatsFromEntries,
    dbGet,
    dbAll,
    parsePuanlamaStore,
    rowKeyParts,
    pct,
    pad,
    openDb
};
