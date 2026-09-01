/**
 * Test sekmesi BAŞ+ sinyalleri → TAHMİN skor karışımı.
 * ŞEHİR / AS / KC·TK·PS·HP·SK birleşik test skorları BİTİŞ verisiyle kalibre edilir.
 */
const DimensionTahminBoostEngine = (function () {
    const ROUTES_VERSION = 2;
    const CALIB_OBJECTIVE_VERSION = 1;
    const DEFAULT_DIM_WEIGHT = 0.12;
    const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };
    /** Tüm atlar — tam / ±1 / ±2 yakınlık (3↔4 gibi durumlar) */
    const PROXIMITY_BLEND = { exact: 0.55, pm1: 0.30, pm2: 0.15 };
    const CALIB_OBJECTIVE = { leader: 0.60, proximity: 0.40 };
    let hybridWeight = 1 - DEFAULT_DIM_WEIGHT;
    let dimWeight = DEFAULT_DIM_WEIGHT;
    let enabled = true;

    /** BAŞ+ rotaları — göreli ağırlık (kalibrasyon sonrası güncellenebilir) */
    let ROUTES = [
        { id: 'as-bas', label: 'AS BAŞ+', group: 'fieldSize', window: null, metrics: ['basSuccess.pct'], weight: 0.22 },
        { id: 'sh-bas', label: 'SH BAŞ+', group: 'sehir', window: null, metrics: ['basSuccess.pct'], weight: 0.20 },
        { id: 'sk-bas', label: 'SK BAŞ+', group: 'siklet', window: null, metrics: ['basSuccess.pct'], weight: 0.16 },
        { id: 'tk-bas', label: 'TK BAŞ+', group: 'taki', window: null, metrics: ['basSuccess.pct'], weight: 0.14 },
        { id: 'ps-bas', label: 'PS BAŞ+', group: 'pist', window: null, metrics: ['basSuccess.pct'], weight: 0.12 },
        { id: 'hp-bas', label: 'HP BAŞ+', group: 'hp', window: null, metrics: ['basSuccess.pct'], weight: 0.13 },
        { id: 'kc-bas', label: 'KC BAŞ+', group: 'kcins_kosu', window: null, metrics: ['basSuccess.pct'], weight: 0.06, minSpread: 2 }
    ];

    function getBlendWeights() {
        return { hybridWeight, dimWeight };
    }

    function setBlendWeights(hybridW, dimW) {
        const h = Number(hybridW);
        const d = Number(dimW);
        if (!Number.isFinite(h) || !Number.isFinite(d) || h < 0 || d < 0 || h + d <= 0) {
            return getBlendWeights();
        }
        const sum = h + d;
        hybridWeight = Math.round((h / sum) * 1000) / 1000;
        dimWeight = Math.round((d / sum) * 1000) / 1000;
        return getBlendWeights();
    }

    function setEnabled(v) {
        enabled = !!v;
    }

    function isEnabled() {
        return enabled;
    }

    function getRoutes() {
        return ROUTES.map(r => Object.assign({}, r));
    }

    function raceFromRow(row) {
        const rm = row?.raceMeta || {};
        return {
            pist: rm.pist,
            kcins_kosu: rm.kcins_kosu || rm.kcins,
            kategori: rm.kategori,
            mesafe: rm.mesafe
        };
    }

    function horseFromRow(row) {
        return {
            yas: row?.yas,
            taki: row?.taki,
            hp: row?.hp,
            siklet: row?.siklet,
            kosular: row?.kosular || []
        };
    }

    function resolveMetric(src, metricPath) {
        if (!src || !metricPath) return null;
        const parts = String(metricPath).split('.');
        let v = src;
        for (let i = 0; i < parts.length; i++) {
            v = v?.[parts[i]];
            if (v == null || v === '' || v === '—') return null;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function computeDimensionBundle(row, pkg) {
        if (row?._dim) return row._dim;
        const kosular = row?.kosular;
        if (!kosular?.length) return null;
        if (typeof FieldSizeStatsEngine === 'undefined'
            || typeof SehirStatsEngine === 'undefined'
            || typeof KosuDimensionStatsEngine === 'undefined') {
            return null;
        }
        const horse = horseFromRow(row);
        const race = raceFromRow(row);
        const hedefSehir = pkg?.hedefSehir || '';
        const programTarih = pkg?.programTarih || null;
        const hedefFieldSize = pkg?.hedefFieldSize ?? pkg?.rows?.length ?? null;
        const out = {
            fieldSize: FieldSizeStatsEngine.computeStats(kosular, programTarih, hedefFieldSize),
            sehir: SehirStatsEngine.computeStats(kosular, hedefSehir, programTarih)
        };
        for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
            const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
            out[key] = KosuDimensionStatsEngine.computeStats(
                kosular, key, dim.getTarget(horse, race), programTarih
            );
        }
        row._dim = out;
        return out;
    }

    function metricValue(bundle, group, metric, windowSize) {
        if (!bundle) return null;
        const g = bundle[group];
        if (!g) return null;
        const src = windowSize ? g.windows?.[windowSize] : g;
        if (!src) return null;
        return resolveMetric(src, metric);
    }

    function metricWithFallback(bundle, route) {
        let v = metricValue(bundle, route.group, route.metrics[0], route.window);
        if ((v == null || v === 0) && route.fallbackWindow !== undefined) {
            v = metricValue(bundle, route.group, route.metrics[0], route.fallbackWindow);
        }
        return v;
    }

    function rankNormMap(scored, getValue) {
        const items = scored.map(s => ({ s, v: getValue(s) }));
        const valid = items.filter(x => x.v != null && Number.isFinite(x.v));
        if (valid.length < 2) return { map: new Map(), spread: 0 };
        valid.sort((a, b) => b.v - a.v
            || (a.s.row?.no ?? 0) - (b.s.row?.no ?? 0));
        const map = new Map();
        const n = valid.length;
        const min = valid[valid.length - 1].v;
        const max = valid[0].v;
        valid.forEach((x, idx) => {
            map.set(x.s, n <= 1 ? 0.5 : 1 - idx / (n - 1));
        });
        return { map, spread: max - min };
    }

    function activeRoutesForRace(scored, bundles) {
        const active = [];
        for (const route of ROUTES) {
            const { map, spread } = rankNormMap(scored, s => {
                const bi = bundles.get(s);
                return bi ? metricWithFallback(bi, route) : null;
            });
            if (map.size < 2) continue;
            if (route.minSpread != null && spread < route.minSpread) continue;
            let hasSignal = false;
            for (const v of map.values()) {
                if (v > 0) { hasSignal = true; break; }
            }
            if (!hasSignal) continue;
            active.push(Object.assign({}, route, { norms: map }));
        }
        return active;
    }

    function finalizeScoredRace(scored) {
        if (!scored?.length) return scored;
        for (const s of scored) {
            if (s.row?.kosuHistory?.tahminEligible === false) {
                s.tahmin.ineligible = true;
                s.tahmin.score = 0;
                s.tahmin.pct = 0;
            }
        }
        const eligible = scored.filter(s => !s.tahmin?.ineligible);
        const pool = eligible.length ? eligible : scored;
        const maxScore = Math.max(...pool.map(s => s.tahmin?.score ?? 0), 1);
        for (const s of pool) {
            const sc = s.tahmin?.score ?? 0;
            s.tahmin.pct = sc > 0 ? Math.max(1, Math.round((sc / maxScore) * 100)) : 0;
        }
        for (const s of scored) {
            if (s.tahmin?.ineligible) s.tahmin.pct = 0;
        }
        scored.sort((a, b) => {
            if (a.tahmin?.ineligible !== b.tahmin?.ineligible) {
                return a.tahmin.ineligible ? 1 : -1;
            }
            if (typeof AtSpeedUtils !== 'undefined' && AtSpeedUtils.compareTahminRank) {
                return AtSpeedUtils.compareTahminRank(
                    a.row, b.row, a.tahmin?.score, b.tahmin?.score
                );
            }
            const sa = a.tahmin?.score ?? 0;
            const sb = b.tahmin?.score ?? 0;
            if (sb !== sa) return sb - sa;
            return (a.row?.no ?? 0) - (b.row?.no ?? 0);
        });
        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
            scored[i].row.tahmin = scored[i].tahmin;
        }
        return scored;
    }

    function basBundleFromBySource(basBySource) {
        if (!basBySource) return null;
        return {
            fieldSize: basBySource.fieldSize,
            sehir: basBySource.sehir,
            siklet: basBySource.siklet,
            taki: basBySource.taki,
            pist: basBySource.pist,
            hp: basBySource.hp,
            kcins_kosu: basBySource.kcins_kosu
        };
    }

    /** SON TEST — 7 BAŞ+ sütunundan boyut-only TAHMİN (hibrit taban yok) */
    function computeDimensionOnlyFromBasBySource(horseRows) {
        if (!horseRows?.length) return horseRows;
        const scored = horseRows.map(function(row) {
            return {
                row: row.h,
                horseRow: row,
                basBySource: row.basBySource,
                tahmin: { score: 0, pct: 0, topTerms: [], source: 'son-test-bas' }
            };
        });

        const bundles = new Map();
        for (const s of scored) {
            const b = basBundleFromBySource(s.basBySource);
            if (b) bundles.set(s, b);
        }
        if (!bundles.size) return horseRows;

        const routes = activeRoutesForRace(scored, bundles);
        if (!routes.length) return horseRows;

        const weightSum = routes.reduce(function(a, r) { return a + r.weight; }, 0);
        if (!weightSum) return horseRows;

        for (const s of scored) {
            let boostSum = 0;
            const dimTerms = [];
            for (const route of routes) {
                const norm = route.norms.get(s) ?? 0;
                boostSum += norm * route.weight;
                if (norm >= 0.45) {
                    dimTerms.push({
                        label: route.label,
                        points: Math.round(norm * route.weight * 100),
                        source: 'dimension',
                        norm: norm
                    });
                }
            }
            const combined = boostSum / weightSum;
            const dimScore = Math.max(1, Math.round(combined * 100));
            s.tahmin.score = dimScore;
            s.tahmin.dimensionNorm = combined;
            s.tahmin.activeDimensionRoutes = routes.map(function(r) { return r.id; });
            dimTerms.sort(function(a, b) { return (b.points || 0) - (a.points || 0); });
            s.tahmin.topTerms = dimTerms.slice(0, 8);
        }

        finalizeScoredRace(scored);
        for (const s of scored) {
            if (s.horseRow) s.horseRow.tahmin = s.tahmin;
        }
        return horseRows;
    }

    function applyRaceBoost(scored, pkg) {
        if (!enabled || pkg?.skipDimensionBoost || !scored?.length) return scored;
        if (!pkg?.forceDimensionBoost
            && scored.some(s => s.tahmin?.dimensionBoostApplied)) return scored;

        const bundles = new Map();
        for (const s of scored) {
            const b = computeDimensionBundle(s.row, pkg);
            if (b) bundles.set(s, b);
        }
        if (!bundles.size) return scored;

        const routes = activeRoutesForRace(scored, bundles);
        if (!routes.length) return scored;

        const weightSum = routes.reduce((a, r) => a + r.weight, 0);
        if (!weightSum) return scored;

        let applied = false;
        for (const s of scored) {
            if (s.tahmin?.ineligible) continue;
            const baseScore = s.tahmin?.score ?? 0;
            if (!baseScore) continue;

            let boostSum = 0;
            const dimTerms = [];
            for (const route of routes) {
                const norm = route.norms.get(s) ?? 0;
                boostSum += norm * route.weight;
                if (norm >= 0.45) {
                    dimTerms.push({
                        label: route.label,
                        points: Math.round(norm * route.weight * 100),
                        source: 'dimension',
                        norm
                    });
                }
            }

            const combined = boostSum / weightSum;
            const dimScore = combined * 100;
            const newScore = Math.max(1, Math.round(
                baseScore * hybridWeight + dimScore * dimWeight
            ));

            s.tahmin.hybridBaseScore = baseScore;
            s.tahmin.dimensionNorm = combined;
            s.tahmin.dimensionBoost = (newScore - baseScore) / Math.max(baseScore, 1);
            s.tahmin.activeDimensionRoutes = routes.map(r => r.id);
            s.tahmin.dimensionBoostApplied = true;
            s.tahmin.score = newScore;
            s.tahmin.pct = newScore;
            applied = true;

            if (dimTerms.length) {
                const terms = [...(s.tahmin.topTerms || []), ...dimTerms];
                terms.sort((a, b) => (b.points || 0) - (a.points || 0));
                s.tahmin.topTerms = terms.slice(0, 8);
                s.tahmin.terms = s.tahmin.topTerms;
            }
        }
        return applied ? scored : scored;
    }

    function resetBoostState(rows) {
        for (const row of rows || []) {
            delete row._dim;
            if (row.tahmin) delete row.tahmin.dimensionBoostApplied;
        }
    }

    function countBoostCoverage(rows) {
        let withKosular = 0;
        let boosted = 0;
        for (const row of rows || []) {
            if (row.kosular?.length) withKosular++;
            if (row.tahmin?.dimensionBoostApplied) boosted++;
        }
        return { withKosular, boosted, total: (rows || []).length };
    }

    function syncTahminOzeti(pkg) {
        if (!pkg?.rows?.length) return pkg;
        const leader = pkg.rows.find(r => r.tahmin?.rank === 1)
            || pkg.rows.slice().sort((a, b) => (a.tahmin?.rank ?? 99) - (b.tahmin?.rank ?? 99))[0];
        const cov = countBoostCoverage(pkg.rows);
        const blend = getBlendWeights();
        const prev = pkg.tahminOzeti || {};
        pkg.tahminOzeti = Object.assign({}, prev, {
            leader: leader?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: pkg.rows.length,
            dimensionBlend: blend,
            dimensionApplied: cov.boosted > 0,
            dimensionCoverage: cov,
            dimensionRoutes: leader?.tahmin?.activeDimensionRoutes || [],
            dimensionRoutesVersion: ROUTES_VERSION
        });
        return pkg;
    }

    function applyBoostToPkg(pkg) {
        if (!pkg?.rows?.length) return pkg;
        if (!pkg.hedefSehir && pkg.rows[0]?.sehir?.hedef) {
            pkg.hedefSehir = pkg.rows[0].sehir.hedef;
        }
        if (pkg.hedefFieldSize == null) {
            pkg.hedefFieldSize = pkg.rows.length;
        }
        if (pkg.forceDimensionBoost) {
            resetBoostState(pkg.rows);
        }
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: row.tahmin || { score: 0, pct: 0, topTerms: [] }
        }));
        applyRaceBoost(scored, pkg);
        if (scored.some(s => s.tahmin?.dimensionBoostApplied)) {
            finalizeScoredRace(scored);
        }
        syncTahminOzeti(pkg);
        return pkg;
    }

    function pickScoredLeader(scored) {
        if (!scored || scored.length < 2) return null;
        scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
        if (scored[0].score === scored[1].score) return null;
        return scored[0];
    }

    function evaluateProximitySuccess(raceGroups, bitisValueForSort) {
        let total = 0, exact = 0, pm1 = 0, pm2 = 0;
        for (const entries of raceGroups) {
            for (const e of entries) {
                const bitis = bitisValueForSort(e);
                const pred = e.row?.tahmin?.rank;
                if (bitis == null || bitis < 1 || pred == null) continue;
                total++;
                const ad = Math.abs(bitis - pred);
                if (ad === 0) exact++;
                else if (ad === 1) pm1++;
                else if (ad === 2) pm2++;
            }
        }
        const proximityBlended = total
            ? PROXIMITY_BLEND.exact * (exact / total)
                + PROXIMITY_BLEND.pm1 * (pm1 / total)
                + PROXIMITY_BLEND.pm2 * (pm2 / total)
            : 0;
        return {
            total, exact, pm1, pm2,
            proximityBlended,
            nearRate: total ? (exact + pm1) / total : 0,
            exactRate: total ? exact / total : 0
        };
    }

    function blendCalibrationObjective(leaderStats, proximityStats) {
        return CALIB_OBJECTIVE.leader * (leaderStats?.leaderBlended ?? 0)
            + CALIB_OBJECTIVE.proximity * (proximityStats?.proximityBlended ?? 0);
    }

    function evaluateLeaderSuccess(raceGroups, bitisValueForSort) {
        let leaderTotal = 0, b1 = 0, b12 = 0, b123 = 0;
        for (const entries of raceGroups) {
            const scored = entries.map(e => ({
                entry: e,
                score: e.row?.tahmin?.score ?? null
            })).filter(s => s.score != null);
            const leader = pickScoredLeader(scored);
            if (!leader) continue;
            const bitis = bitisValueForSort(leader.entry);
            if (bitis == null || bitis < 1) continue;
            leaderTotal++;
            if (bitis === 1) b1++;
            if (bitis <= 2) b12++;
            if (bitis <= 3) b123++;
        }
        const leaderBlended = leaderTotal
            ? SUCCESS_BLEND.b1 * (b1 / leaderTotal)
                + SUCCESS_BLEND.b12 * (b12 / leaderTotal)
                + SUCCESS_BLEND.b123 * (b123 / leaderTotal)
            : 0;
        return {
            leaderTotal, b1, b12, b123,
            leaderBlended,
            exactRate: leaderTotal ? b1 / leaderTotal : 0,
            top3Rate: leaderTotal ? b123 / leaderTotal : 0
        };
    }

    function buildSweepSteps(raceCount) {
        const steps = new Set();
        for (let d = 0; d <= 50; d++) steps.add(d);
        for (let d = 55; d <= 100; d += 5) steps.add(d);
        return [...steps].sort((a, b) => a - b);
    }

    function clearRaceTahminState(raceGroups) {
        for (const entries of raceGroups) {
            for (const e of entries) {
                delete e.row?.tahmin;
                delete e.row?._dim;
            }
        }
    }

    function buildPkgFromRaceEntries(entries) {
        const rows = entries.map(e => e.row);
        const first = entries[0] || {};
        return {
            rows,
            skipDimensionBoost: true,
            hedefSehir: first.hipodrom || first._pkg?.hedefSehir || null,
            programTarih: first.tarih || first._pkg?.programTarih || null,
            hedefFieldSize: rows.length,
            depthCoverage: first._pkg?.depthCoverage || null,
            kosuHistorySummary: first._pkg?.kosuHistorySummary || null
        };
    }

    function attachTahminForDimPct(raceGroups, dimPct) {
        const dimW = dimPct / 100;
        setBlendWeights(1 - dimW, dimW);
        setEnabled(dimW > 0);
        if (typeof HybridTahminScoringEngine === 'undefined') return;
        for (const entries of raceGroups) {
            const pkg = buildPkgFromRaceEntries(entries);
            for (const e of entries) e._pkg = pkg;
            HybridTahminScoringEngine.attachRaceTahmin(pkg);
            if (dimW > 0) {
                pkg.forceDimensionBoost = true;
                applyBoostToPkg(pkg);
            }
        }
    }

    function calibrateBlendFromFlatEntries(flatEntries, bitisValueForSort) {
        if (!flatEntries?.length || !bitisValueForSort) return null;
        if (typeof HybridTahminScoringEngine === 'undefined'
            || !HybridTahminScoringEngine.isCalibrated?.()) {
            return null;
        }

        const withBitis = flatEntries.filter(e => {
            const b = bitisValueForSort(e);
            return b != null && b >= 1;
        });
        const raceMap = new Map();
        for (const e of withBitis) {
            const rk = String(e.kayitId) + '|' + e.raceNo;
            if (!raceMap.has(rk)) raceMap.set(rk, []);
            raceMap.get(rk).push(e);
        }
        const raceGroups = [...raceMap.values()];
        if (raceGroups.length < 3) {
            setBlendWeights(1 - DEFAULT_DIM_WEIGHT, DEFAULT_DIM_WEIGHT);
            return {
                hybridWeight: 1 - DEFAULT_DIM_WEIGHT,
                dimWeight: DEFAULT_DIM_WEIGHT,
                dimPct: Math.round(DEFAULT_DIM_WEIGHT * 100),
                hybridPct: Math.round((1 - DEFAULT_DIM_WEIGHT) * 100),
                routesVersion: ROUTES_VERSION,
                source: 'default-min-races',
                raceCount: raceGroups.length
            };
        }

        const steps = buildSweepSteps(raceGroups.length);
        let best = null;
        let baseline = null;

        for (const dimPct of steps) {
            clearRaceTahminState(raceGroups);
            attachTahminForDimPct(raceGroups, dimPct);
            const stats = evaluateLeaderSuccess(raceGroups, bitisValueForSort);
            const prox = evaluateProximitySuccess(raceGroups, bitisValueForSort);
            const objectiveBlended = blendCalibrationObjective(stats, prox);
            const row = Object.assign({
                dimPct,
                hybridPct: 100 - dimPct,
                objectiveBlended,
                proximityBlended: prox.proximityBlended,
                nearRate: prox.nearRate,
                proximityExact: prox.exact,
                proximityPm1: prox.pm1,
                proximityTotal: prox.total
            }, stats);
            if (dimPct === 0) baseline = row;
            if (!best
                || row.objectiveBlended > best.objectiveBlended
                || (row.objectiveBlended === best.objectiveBlended && row.leaderBlended > best.leaderBlended)
                || (row.objectiveBlended === best.objectiveBlended
                    && row.leaderBlended === best.leaderBlended && row.nearRate > best.nearRate)) {
                best = row;
            }
        }

        const dimW = best.dimPct / 100;
        setBlendWeights(1 - dimW, dimW);
        setEnabled(dimW > 0);

        return {
            hybridWeight: 1 - dimW,
            dimWeight: dimW,
            dimPct: best.dimPct,
            hybridPct: best.hybridPct,
            leaderBlended: best.leaderBlended,
            exactRate: best.exactRate,
            top3Rate: best.top3Rate,
            leaderTotal: best.leaderTotal,
            objectiveBlended: best.objectiveBlended,
            proximityBlended: best.proximityBlended,
            nearRate: best.nearRate,
            proximityTotal: best.proximityTotal,
            baselineBlended: baseline?.leaderBlended ?? null,
            baselineObjective: baseline?.objectiveBlended ?? null,
            gainVsBaseline: baseline ? best.objectiveBlended - baseline.objectiveBlended : null,
            raceCount: raceGroups.length,
            bitisRows: withBitis.length,
            lowSample: raceGroups.length < 15,
            routesVersion: ROUTES_VERSION,
            objectiveVersion: CALIB_OBJECTIVE_VERSION,
            routeIds: ROUTES.map(r => r.id),
            source: 'calibrated-sweep-bas-prox'
        };
    }

    return {
        ROUTES_VERSION,
        CALIB_OBJECTIVE_VERSION,
        get ROUTES() { return getRoutes(); },
        DEFAULT_DIM_WEIGHT,
        get HYBRID_WEIGHT() { return hybridWeight; },
        get DIM_WEIGHT() { return dimWeight; },
        getBlendWeights,
        setBlendWeights,
        setEnabled,
        isEnabled,
        getRoutes,
        computeDimensionBundle,
        metricValue,
        applyRaceBoost,
        finalizeScoredRace,
        applyBoostToPkg,
        syncTahminOzeti,
        countBoostCoverage,
        resetBoostState,
        calibrateBlendFromFlatEntries,
        attachTahminForDimPct,
        evaluateLeaderSuccess,
        evaluateProximitySuccess,
        blendCalibrationObjective,
        basBundleFromBySource,
        computeDimensionOnlyFromBasBySource
    };
})();

if (typeof module !== 'undefined') module.exports = DimensionTahminBoostEngine;
