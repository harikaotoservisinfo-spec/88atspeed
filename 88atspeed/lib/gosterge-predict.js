/**
 * TEK / S2 / S1 / YUV — ilk-4 tahmin skoru (gosterge-column-eval ile uyumlu)
 */
const {
    horseRowKey,
    COLUMN_DEFS,
    pct
} = require('./gosterge-column-eval');

const COL_KEYS = ['TEK', 'S2', 'S1', 'YUV'];

/** Geçmiş kayıtlardan kalibre edilen sütun işaret→ilk4 oranları */
const DEFAULT_MARKER_RATES = {
    TEK: 0.408,
    S2: 0.408,
    S1: 0.444,
    YUV: 0.433
};

function markerGlyph(y) {
    if (y.s8) return '8';
    if (y.tei) return 'T';
    if (y.t1y || y.t1ym || y.t1yk) return '●1';
    if (y.t2y || y.t2ym || y.t2yk) return '●2';
    if (y.t3y || y.t3ym || y.t3yk) return '●3';
    if (y.t4) return '4';
    if (y.tkl) return 'P';
    if (y.t12) return '2';
    return '★';
}

function getHorseMarkers(horses) {
    const byHorse = new Map();
    for (const col of COLUMN_DEFS) {
        const map = col.getMarkers(horses);
        for (const [key, list] of map) {
            if (!byHorse.has(key)) byHorse.set(key, { TEK: [], S2: [], S1: [], YUV: [] });
            byHorse.get(key)[col.key] = list;
        }
    }
    return byHorse;
}

function colProb(colKey, markerCount, rates) {
    if (!markerCount) return 0;
    const p = rates[colKey] ?? DEFAULT_MARKER_RATES[colKey] ?? 0.4;
    return 1 - Math.pow(1 - p, markerCount);
}

function combineColProbs(colCounts, rates) {
    let miss = 1;
    for (const key of COL_KEYS) {
        const n = colCounts[key] || 0;
        if (n > 0) miss *= (1 - colProb(key, n, rates));
    }
    return 1 - miss;
}

function summarizeMarkers(colCounts, colLists) {
    const parts = [];
    for (const key of COL_KEYS) {
        const n = colCounts[key] || 0;
        if (!n) continue;
        const glyphs = (colLists[key] || []).map(markerGlyph).join('');
        parts.push({ col: key, count: n, glyphs });
    }
    return parts;
}

/**
 * Tek koşu için at bazlı ilk-4 skorları
 * @returns {{ picks: Array, allHorses: Array, markedCount: number }}
 */
function analyzeRacePredictions(horses, rates = DEFAULT_MARKER_RATES, pickCount = 4) {
    const markerMap = getHorseMarkers(horses);
    const allHorses = [];

    for (const h of horses || []) {
        const key = horseRowKey(h);
        const cols = markerMap.get(key) || { TEK: [], S2: [], S1: [], YUV: [] };
        const colCounts = {
            TEK: cols.TEK.length,
            S2: cols.S2.length,
            S1: cols.S1.length,
            YUV: cols.YUV.length
        };
        const totalMarkers = COL_KEYS.reduce((s, k) => s + colCounts[k], 0);
        const top4Prob = totalMarkers > 0 ? combineColProbs(colCounts, rates) : 0;
        const colProbs = {};
        for (const k of COL_KEYS) {
            colProbs[k] = colCounts[k] > 0
                ? Math.round(colProb(k, colCounts[k], rates) * 1000) / 10
                : null;
        }

        allHorses.push({
            no: String(h.no),
            name: h.name || '',
            colCounts,
            colProbs,
            markers: summarizeMarkers(colCounts, cols),
            totalMarkers,
            top4Prob: Math.round(top4Prob * 1000) / 10
        });
    }

    const withMarkers = allHorses
        .filter((h) => h.totalMarkers > 0)
        .sort((a, b) => b.top4Prob - a.top4Prob || b.totalMarkers - a.totalMarkers || Number(a.no) - Number(b.no));

    const sumProb = withMarkers.reduce((s, h) => s + h.top4Prob, 0);
    const picks = withMarkers.slice(0, pickCount).map((h, i) => Object.assign({}, h, {
        rank: i + 1,
        raceSharePct: sumProb > 0 ? Math.round((h.top4Prob / sumProb) * 1000) / 10 : 0
    }));

    return {
        picks,
        allHorses,
        markedCount: withMarkers.length,
        horseCount: (horses || []).length
    };
}

function normalizeRates(calibration) {
    const rates = { ...DEFAULT_MARKER_RATES };
    if (!calibration?.columns) return rates;
    for (const key of COL_KEYS) {
        const col = calibration.columns[key];
        if (col?.top4?.markerHitPct != null) {
            rates[key] = col.top4.markerHitPct / 100;
        }
    }
    return rates;
}

/** Tahmin havuzunun gerçek sonuçla karşılaştırması */
function evaluateRaceResult(picks, actualTop4Nos) {
    const actual = new Set((actualTop4Nos || []).map(String));
    const evaluated = (picks || []).map((p) => {
        const hit = actual.has(String(p.no));
        const sira = hit ? actualTop4Nos.indexOf(String(p.no)) + 1 : null;
        return Object.assign({}, p, { hit, finishPos: sira > 0 ? sira : null });
    });
    const hitCount = evaluated.filter((p) => p.hit).length;
    const pickCount = evaluated.length;
    return {
        picks: evaluated,
        hitCount,
        pickCount,
        poolHit: hitCount > 0,
        fullHit: pickCount > 0 && hitCount === Math.min(pickCount, 4),
        hitPct: pickCount ? Math.round((hitCount / Math.min(pickCount, 4)) * 1000) / 10 : 0
    };
}

function getActualTop4(resultRace) {
    return (resultRace?.horses || [])
        .filter((h) => !h.kosmaz && h.sira != null && Number(h.sira) > 0)
        .sort((a, b) => Number(a.sira) - Number(b.sira))
        .slice(0, 4)
        .map((h) => String(h.no));
}

module.exports = {
    COL_KEYS,
    DEFAULT_MARKER_RATES,
    analyzeRacePredictions,
    normalizeRates,
    evaluateRaceResult,
    getActualTop4,
    pct
};
