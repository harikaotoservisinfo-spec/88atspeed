/**
 * TEK / S2 / S1 / YUV sütun mantığı — public-home.js ile uyumlu
 */

function horseRowKey(h) {
    if (h?.atId != null && h.atId !== '') return String(h.atId);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    return 'name:' + String(h.name || '');
}

function gostergeMarkerSignature(y) {
    const sutun = String(y?.t || '').split(' · ')[1] || '';
    if (y.s8) return 's8:' + (y.s8r || 0);
    if (y.tei) return 'tei:' + (y.teik ? 'k' : y.teiy ? 'y' : y.teis ? 's' : 'm');
    if (y.shs) return 'shs:' + (y.shk ? 'k' : 'm');
    if (y.t46) return 't46';
    if (y.t12) return 't12:' + (y.t12k ? 'k' : 'o');
    if (y.t9m) return 't9m';
    if (y.t5k) return 't5k';
    if (y.f8g) return 'f8g';
    if (y.tkl) return 'tkl';
    if (y.t4) return 't4';
    if (y.t1yk) return 't1yk';
    if (y.t1ym) return 't1ym';
    if (y.t1y) return 't1y';
    if (y.t2yk) return 't2yk';
    if (y.t2ym) return 't2ym';
    if (y.t2y) return 't2y';
    if (y.t3yk) return 't3yk';
    if (y.t3ym) return 't3ym';
    if (y.t3y) return 't3y';
    if (y.tkr) return 'tkr';
    if (y.tmk) return 'tmk';
    if (y.ttsk) return 'ttsk';
    if (y.ttsm) return 'ttsm';
    if (y.tts) return 'tts';
    if (y.ttyk) return 'ttyk';
    if (y.ttym) return 'ttym';
    if (y.tty) return 'tty';
    return (y.ad || 'star') + '|' + sutun;
}

function isSon2GostergeMarker(y) {
    const k = parseInt(y?.k, 10);
    return !isNaN(k) && k >= 1 && k <= 2;
}

function isSon1GostergeMarker(y) {
    const k = parseInt(y?.k, 10);
    return k === 1;
}

function isYuvarlakGostergeMarker(y) {
    return !!(y.t1y || y.t1ym || y.t1yk || y.t2y || y.t2ym || y.t2yk || y.t3y || y.t3ym || y.t3yk);
}

function buildRaceUniqueGostergeMap(horses, markerFilter) {
    const rows = (horses || []).map((h) => {
        const raw = Array.isArray(h.yildizlar) ? h.yildizlar : [];
        const list = markerFilter ? raw.filter(markerFilter) : raw;
        const sigs = new Set(list.map(gostergeMarkerSignature));
        return { key: horseRowKey(h), list, sigs };
    });
    const horseCountBySig = new Map();
    rows.forEach(({ sigs }) => {
        sigs.forEach((sig) => horseCountBySig.set(sig, (horseCountBySig.get(sig) || 0) + 1));
    });
    const uniqueMap = new Map();
    rows.forEach(({ key, list }) => {
        const seen = new Set();
        const unique = [];
        for (const y of list) {
            const sig = gostergeMarkerSignature(y);
            if (horseCountBySig.get(sig) !== 1 || seen.has(sig)) continue;
            seen.add(sig);
            unique.push(y);
        }
        uniqueMap.set(key, unique);
    });
    return uniqueMap;
}

function collectYuvarlakGostergeMarkers(h) {
    return (Array.isArray(h.yildizlar) ? h.yildizlar : []).filter(isYuvarlakGostergeMarker);
}

const COLUMN_DEFS = [
    {
        key: 'TEK',
        label: 'TEK',
        getMarkers(horses) {
            const map = buildRaceUniqueGostergeMap(horses);
            return map;
        }
    },
    {
        key: 'S2',
        label: 'S2',
        getMarkers(horses) {
            return buildRaceUniqueGostergeMap(horses, isSon2GostergeMarker);
        }
    },
    {
        key: 'S1',
        label: 'S1',
        getMarkers(horses) {
            return buildRaceUniqueGostergeMap(horses, isSon1GostergeMarker);
        }
    },
    {
        key: 'YUV',
        label: 'YUV',
        getMarkers(horses) {
            const map = new Map();
            for (const h of horses || []) {
                map.set(horseRowKey(h), collectYuvarlakGostergeMarkers(h));
            }
            return map;
        }
    }
];

/**
 * Tek koşu için sütun istatistikleri
 * @param {Map|Set|string} hitKeys — isabet sayılan atlar (Set veya tek anahtar)
 * @returns {{ totalMarkers, hitMarkers, raceHasHit, raceHasMarkers }}
 */
function evalRaceColumns(horses, hitKeys) {
    const hitSet = hitKeys instanceof Set ? hitKeys
        : (hitKeys instanceof Map ? new Set(hitKeys.keys()) : new Set([hitKeys]));
    const result = {};
    for (const col of COLUMN_DEFS) {
        const markerMap = col.getMarkers(horses);
        let totalMarkers = 0;
        let hitMarkers = 0;
        let raceHasMarkers = false;
        for (const [key, list] of markerMap) {
            const n = list.length;
            if (n > 0) raceHasMarkers = true;
            totalMarkers += n;
            if (hitSet.has(key)) hitMarkers += n;
        }
        result[col.key] = {
            totalMarkers,
            hitMarkers,
            raceHasHit: hitMarkers > 0,
            raceHasMarkers
        };
    }
    return result;
}

/** bitisSira 1..maxSira arası atların anahtar kümesi */
function topFinishKeys(horses, maxSira = 4) {
    const keys = new Set();
    for (const h of horses || []) {
        const sira = h.bitisSira != null ? Number(h.bitisSira) : null;
        if (sira != null && !isNaN(sira) && sira >= 1 && sira <= maxSira) {
            keys.add(horseRowKey(h));
        }
    }
    return keys;
}

function pct(n, d) {
    if (!d) return null;
    return Math.round((n / d) * 1000) / 10;
}

function aggregateColumnStats(raceResults, columnsField = 'columns') {
    const agg = {};
    for (const col of COLUMN_DEFS) {
        agg[col.key] = {
            label: col.label,
            races: 0,
            racesWithMarkers: 0,
            racesWithHit: 0,
            totalMarkers: 0,
            hitMarkers: 0
        };
    }
    for (const r of raceResults) {
        for (const col of COLUMN_DEFS) {
            const s = r[columnsField][col.key];
            const a = agg[col.key];
            a.races++;
            if (s.raceHasMarkers) a.racesWithMarkers++;
            if (s.raceHasHit) a.racesWithHit++;
            a.totalMarkers += s.totalMarkers;
            a.hitMarkers += s.hitMarkers;
        }
    }
    for (const key of Object.keys(agg)) {
        const a = agg[key];
        a.markerHitPct = pct(a.hitMarkers, a.totalMarkers);
        a.raceHitPct = pct(a.racesWithHit, a.races);
        a.raceHitAmongMarkedPct = pct(a.racesWithHit, a.racesWithMarkers);
    }
    return agg;
}

module.exports = {
    horseRowKey,
    gostergeMarkerSignature,
    isSon2GostergeMarker,
    isSon1GostergeMarker,
    isYuvarlakGostergeMarker,
    buildRaceUniqueGostergeMap,
    collectYuvarlakGostergeMarkers,
    COLUMN_DEFS,
    evalRaceColumns,
    topFinishKeys,
    aggregateColumnStats,
    pct
};
