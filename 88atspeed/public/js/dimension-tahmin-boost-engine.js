/**
 * Boyut penceresi sinyalleri → TAHMİN skor çarpanı.
 * Terminal korelasyon (#148): TK·S3 cnt123, PS·S4 cnt123, AS·TÜM/S5 cnt123,
 * SH·TÜM cnt123, HP·S1 cnt123, KC·S1 cnt1 (düşük güven).
 */
const DimensionTahminBoostEngine = (function () {
    /** Eski çarpan — sıra değiştirmiyordu; blend ile değiştirildi */
    const MAX_TOTAL_BOOST = 0.18;
    /** Hybrid taban skor + boyut norm (0–100) karışımı — terminal TK·S3 ~%60 vs hybrid ~%28 */
    const HYBRID_WEIGHT = 0.58;
    const DIM_WEIGHT = 0.42;
    let enabled = true;

    /** Kanıt tabanlı rota — ağırlıklar göreli güven */
    const ROUTES = [
        {
            id: 'tk', label: 'TK S3·1-2-3', group: 'taki', window: 3,
            metrics: ['cnt123'], weight: 0.24
        },
        {
            id: 'ps', label: 'PS S4·1-2-3', group: 'pist', window: 4,
            metrics: ['cnt123'], weight: 0.22
        },
        {
            id: 'as', label: 'AS S5·1-2-3', group: 'fieldSize', window: 5,
            metrics: ['cnt123'], weight: 0.18, fallbackWindow: null
        },
        {
            id: 'sh', label: 'SH TÜM·1-2-3', group: 'sehir', window: null,
            metrics: ['cnt123'], weight: 0.14
        },
        {
            id: 'hp', label: 'HP S1·1-2-3', group: 'hp', window: 1,
            metrics: ['cnt123'], weight: 0.12
        },
        {
            id: 'kc', label: 'KC S1·1.', group: 'kcins_kosu', window: 1,
            metrics: ['cnt1'], weight: 0.06, minSpread: 0.01
        }
    ];

    function setEnabled(v) {
        enabled = !!v;
    }

    function isEnabled() {
        return enabled;
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
        const out = {
            fieldSize: FieldSizeStatsEngine.computeStats(kosular),
            sehir: SehirStatsEngine.computeStats(kosular, hedefSehir)
        };
        for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
            const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
            out[key] = KosuDimensionStatsEngine.computeStats(
                kosular, key, dim.getTarget(horse, race)
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
        const v = src[metric];
        if (v == null || v === '' || v === '—') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
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

    function applyRaceBoost(scored, pkg) {
        if (!enabled || pkg?.skipDimensionBoost || !scored?.length) return scored;
        if (scored.some(s => s.tahmin?.dimensionBoostApplied)) return scored;

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
                baseScore * HYBRID_WEIGHT + dimScore * DIM_WEIGHT
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

    function applyBoostToPkg(pkg) {
        if (!pkg?.rows?.length) return pkg;
        if (!pkg.hedefSehir && pkg.rows[0]?.sehir?.hedef) {
            pkg.hedefSehir = pkg.rows[0].sehir.hedef;
        }
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: row.tahmin || { score: 0, pct: 0, topTerms: [] }
        }));
        applyRaceBoost(scored, pkg);
        if (scored.some(s => s.tahmin?.dimensionBoostApplied)) {
            finalizeScoredRace(scored);
        }
        return pkg;
    }

    return {
        ROUTES,
        MAX_TOTAL_BOOST,
        HYBRID_WEIGHT,
        DIM_WEIGHT,
        setEnabled,
        isEnabled,
        computeDimensionBundle,
        metricValue,
        applyRaceBoost,
        finalizeScoredRace,
        applyBoostToPkg
    };
})();

if (typeof module !== 'undefined') module.exports = DimensionTahminBoostEngine;
