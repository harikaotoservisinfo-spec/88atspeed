/**
 * SON TEST — Gösterge 1 alt/üst ve çift yön eşleşmesi TAHMİN
 */
const AtestSonGosterge1Tahmin = (function () {
    const OVERVIEW_STRIPS = [
        { id: 'delta', kind: 'SON·Δ', mode: 'gap' },
        { id: 'son', kind: 'SON', mode: 'field', field: 'pct', skipT1dr: true }
    ];
    const DEFAULT_STRIP_ID = 'delta';
    const DEFAULT_METRIC_ID = 'son8001';
    const DEFAULT_PAIR = ['son8001', 'oran1'];
    const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    let sideRates = null;
    let pairRates = null;

    function metrics() {
        return (typeof PtestGostergeEngine !== 'undefined' && PtestGostergeEngine.METRICS) || [];
    }

    function metricById(id) {
        return metrics().find(function(m) { return m.id === id; }) || null;
    }

    function stripById(id) {
        return OVERVIEW_STRIPS.find(function(s) { return s.id === id; }) || OVERVIEW_STRIPS[0];
    }

    function depthSon(cell, field) {
        const c = cell || {};
        return c[field] != null ? c[field] : null;
    }

    function stripCellNumericValue(row, m, strip) {
        const cell = row[m.primaryKey]?.[0] || null;
        if (strip.mode === 'gap') {
            if (!cell || cell.gapPct == null) return null;
            return cell.gapPct;
        }
        if (strip.skipT1dr && m.id === 't1dr') return null;
        return depthSon(cell, strip.field);
    }

    function raceStripAvgs(rows, strip) {
        const avgs = new Map();
        for (const m of metrics()) {
            let sum = 0;
            let count = 0;
            for (const row of rows) {
                const v = stripCellNumericValue(row, m, strip);
                if (v == null) continue;
                sum += v;
                count++;
            }
            if (count > 0) avgs.set(m.id, Math.round(sum / count));
        }
        return avgs;
    }

    function entrySide(row, strip, m, raceAvgs) {
        const val = stripCellNumericValue(row, m, strip);
        const avg = raceAvgs.get(m.id);
        if (val == null || avg == null) return null;
        if (val < avg) return 'down';
        if (val > avg) return 'up';
        return 'eq';
    }

    function blendedLeader(stats) {
        const t = stats.withBitis || 0;
        if (!t) return 0;
        return SUCCESS_BLEND.b1 * (stats.b1 / t)
            + SUCCESS_BLEND.b12 * (stats.b12 / t)
            + SUCCESS_BLEND.b123 * (stats.b123 / t);
    }

    function bitisStatsFromRows(rows, bitisForRow) {
        let withBitis = 0;
        let b1 = 0;
        let b12 = 0;
        let b123 = 0;
        for (const row of rows) {
            const b = bitisForRow(row);
            if (b == null || b < 1) continue;
            withBitis++;
            if (b === 1) b1++;
            if (b <= 2) b12++;
            if (b <= 3) b123++;
        }
        return { withBitis, b1, b12, b123 };
    }

    function calibrateFromFlatEntries(flatEntries, bitisValueForSort) {
        sideRates = { up: 0, down: 0, eq: 0 };
        pairRates = { same: 0, diff: 0 };
        if (!flatEntries?.length || !bitisValueForSort) return false;

        const strip = stripById(DEFAULT_STRIP_ID);
        const metric = metricById(DEFAULT_METRIC_ID);
        const mA = metricById(DEFAULT_PAIR[0]);
        const mB = metricById(DEFAULT_PAIR[1]);
        if (!metric || !mA || !mB) return false;

        const raceBuckets = new Map();
        for (const entry of flatEntries) {
            const rk = String(entry.kayitId) + '|' + entry.raceNo;
            if (!raceBuckets.has(rk)) raceBuckets.set(rk, []);
            raceBuckets.get(rk).push(entry.row);
        }

        const sideGroups = { up: [], down: [], eq: [] };
        const pairGroups = { same: [], diff: [] };

        const raceAvgsCache = new Map();
        for (const [rk, rows] of raceBuckets) {
            raceAvgsCache.set(rk, raceStripAvgs(rows, strip));
        }

        for (const entry of flatEntries) {
            const rk = String(entry.kayitId) + '|' + entry.raceNo;
            const raceAvgs = raceAvgsCache.get(rk) || raceStripAvgs([entry.row], strip);
            const side = entrySide(entry.row, strip, metric, raceAvgs);
            if (side && sideGroups[side]) sideGroups[side].push(entry.row);

            const sideA = entrySide(entry.row, strip, mA, raceAvgs);
            const sideB = entrySide(entry.row, strip, mB, raceAvgs);
            if (sideA == null || sideB == null) continue;
            if (sideA === sideB) pairGroups.same.push(entry.row);
            else pairGroups.diff.push(entry.row);
        }

        function bitisForRow(row) {
            return bitisValueForSort({ row: row });
        }

        for (const key of Object.keys(sideGroups)) {
            sideRates[key] = blendedLeader(bitisStatsFromRows(sideGroups[key], bitisForRow));
        }
        for (const key of Object.keys(pairGroups)) {
            pairRates[key] = blendedLeader(bitisStatsFromRows(pairGroups[key], bitisForRow));
        }
        return true;
    }

    function finalizeRace(rows, scored) {
        const maxScore = Math.max.apply(null, scored.map(function(s) { return s.tahmin.score; }).concat([1]));
        for (const s of scored) {
            s.tahmin.pct = s.tahmin.score > 0
                ? Math.max(1, Math.round((s.tahmin.score / maxScore) * 100))
                : 0;
        }
        scored.sort(function(a, b) {
            if (b.tahmin.score !== a.tahmin.score) return b.tahmin.score - a.tahmin.score;
            return (a.row.no ?? 0) - (b.row.no ?? 0);
        });
        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
            scored[i].row.tahmin = scored[i].tahmin;
        }
        return scored;
    }

    function scoreSide(pkg) {
        const out = new Map();
        if (!sideRates || !pkg?.rows?.length) return out;
        const strip = stripById(DEFAULT_STRIP_ID);
        const metric = metricById(DEFAULT_METRIC_ID);
        if (!metric) return out;
        const raceAvgs = raceStripAvgs(pkg.rows, strip);
        const scored = pkg.rows.map(function(row) {
            const side = entrySide(row, strip, metric, raceAvgs) || 'eq';
            const base = sideRates[side] ?? sideRates.up ?? 0;
            const score = Math.max(1, Math.round(base * 100));
            return {
                row: row,
                tahmin: {
                    score: score,
                    pct: null,
                    rank: null,
                    source: 'gosterge1-side',
                    scenarioLabel: 'G1 alt/üst · ' + metric.label + ' · ' + side
                }
            };
        });
        finalizeRace(pkg.rows, scored);
        for (const row of pkg.rows) {
            const key = row.atId != null ? String(row.atId) : ('no:' + String(row.no ?? ''));
            if (row.tahmin) out.set(key, row.tahmin);
        }
        return out;
    }

    function scorePair(pkg) {
        const out = new Map();
        if (!pairRates || !pkg?.rows?.length) return out;
        const strip = stripById(DEFAULT_STRIP_ID);
        const mA = metricById(DEFAULT_PAIR[0]);
        const mB = metricById(DEFAULT_PAIR[1]);
        if (!mA || !mB) return out;
        const raceAvgs = raceStripAvgs(pkg.rows, strip);
        const scored = pkg.rows.map(function(row) {
            const sideA = entrySide(row, strip, mA, raceAvgs);
            const sideB = entrySide(row, strip, mB, raceAvgs);
            let match = 'diff';
            if (sideA != null && sideB != null && sideA === sideB) match = 'same';
            const base = pairRates[match] ?? 0;
            const score = Math.max(1, Math.round(base * 100));
            return {
                row: row,
                tahmin: {
                    score: score,
                    pct: null,
                    rank: null,
                    source: 'gosterge1-pair',
                    scenarioLabel: 'G1 çift · ' + mA.label + '×' + mB.label + ' · ' + match
                }
            };
        });
        finalizeRace(pkg.rows, scored);
        for (const row of pkg.rows) {
            const key = row.atId != null ? String(row.atId) : ('no:' + String(row.no ?? ''));
            if (row.tahmin) out.set(key, row.tahmin);
        }
        return out;
    }

    return {
        calibrateFromFlatEntries,
        scoreSide,
        scorePair,
        isCalibrated: function() { return !!(sideRates && pairRates); }
    };
})();
