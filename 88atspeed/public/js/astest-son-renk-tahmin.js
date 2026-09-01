/**
 * SON TEST — Renk Puanlama Test motoru (25 benchmark senaryosu)
 */
const AtestSonRenkTahmin = (function () {
    const DEFAULT_SCENARIO = {
        id: 'legacy',
        label: 'Mevcut · 7 sabit renk kuralı',
        legacy: true
    };

    let calPromise = null;
    let allColorRowsCache = null;
    /** @type {{ cfg: object, scoringOpts: object }[]|null} */
    let scenarioCache = null;

    function buildBitisStatsFromEntries(entries) {
        let withBitis = 0;
        let b1 = 0;
        let b12 = 0;
        let b123 = 0;
        let b4 = 0;
        let bOut = 0;
        for (const entry of entries || []) {
            let b = entry._bitisPos;
            if (b == null || b < 1) {
                b = AtSpeedUtils.extractBitisFromHorseName(entry.row?.name);
            }
            if (b == null || b < 1) continue;
            withBitis++;
            if (b === 1) b1++;
            if (b <= 2) b12++;
            if (b <= 3) b123++;
            if (b === 4) b4++;
            if (b >= 5) bOut++;
        }
        return { matchedRows: (entries || []).length, withBitis, b1, b12, b123, b4, bOut };
    }

    function scoringOptionsFromScenario(config, allColorRows) {
        if (!config || config.legacy) {
            return { colorMode: 'legacy' };
        }
        const ladder = GostergeScoringEngine.buildColorGostergeLadder(allColorRows || [], {
            topN: config.topN,
            matchMode: config.matchMode || 'best',
            includeDepth: !!config.includeDepth,
            includeRaceRank: !!config.includeRaceRank
        });
        return {
            colorMode: 'gosterge',
            colorLadder: ladder,
            colorMatchMode: config.matchMode || 'best'
        };
    }

    function rebuildScenarioCache() {
        if (!GostergeScoringEngine?.isCalibrated?.()) {
            scenarioCache = null;
            return [];
        }
        const configs = GostergeScoringEngine.generateColorBenchmarkConfigs?.() || [DEFAULT_SCENARIO];
        scenarioCache = configs.map(function(cfg, idx) {
            return {
                index: idx + 1,
                cfg: cfg,
                scoringOpts: scoringOptionsFromScenario(cfg, allColorRowsCache)
            };
        });
        return scenarioCache;
    }

    function getAllScenarios() {
        if (scenarioCache?.length) {
            return scenarioCache.map(function(s) { return Object.assign({ index: s.index }, s.cfg); });
        }
        if (typeof GostergeScoringEngine !== 'undefined' && GostergeScoringEngine.generateColorBenchmarkConfigs) {
            return GostergeScoringEngine.generateColorBenchmarkConfigs().map(function(cfg, idx) {
                return Object.assign({ index: idx + 1 }, cfg);
            });
        }
        return [Object.assign({ index: 1 }, DEFAULT_SCENARIO)];
    }

    /** Sütun meta — RENK + R2…R25 */
    function getScenarioColumns() {
        const scenarios = getAllScenarios();
        return scenarios.map(function(cfg, idx) {
            const n = idx + 1;
            return {
                index: n,
                id: cfg.id,
                shortLabel: n === 1 ? 'RENK' : ('R' + n),
                title: '#' + n + ' · ' + (cfg.label || cfg.id)
            };
        });
    }

    async function ensureCalibration() {
        if (typeof GostergeScoringEngine === 'undefined' || typeof IstatistikEngine === 'undefined') {
            return false;
        }
        if (GostergeScoringEngine.isCalibrated?.() && scenarioCache?.length) return true;
        if (calPromise) return calPromise;
        calPromise = (async function () {
            try {
                const built = await GostergeScoringEngine.buildFlatEntriesFromApi({ IE: IstatistikEngine });
                const flatEntries = built.flatEntries || [];
                const bitisMap = built.bitisMap || {};
                const host = GostergeScoringEngine.makeBitisHost(
                    flatEntries, bitisMap, buildBitisStatsFromEntries);
                await GostergeScoringEngine.calibrate(flatEntries, host);
                if (GostergeScoringEngine.isCalibrated?.()) {
                    try {
                        allColorRowsCache = GostergeScoringEngine.collectAllColorGostergeRows(
                            flatEntries, host) || [];
                    } catch (_) {
                        allColorRowsCache = [];
                    }
                    rebuildScenarioCache();
                }
                return !!GostergeScoringEngine.isCalibrated?.();
            } catch (err) {
                console.warn('AtestSonRenkTahmin: kalibrasyon başarısız', err);
                calPromise = null;
                return false;
            }
        })();
        return calPromise;
    }

    function enrichRaceForIstat(race, resolveKosular) {
        const horses = (race.horses || []).map(function(h) {
            const kosular = resolveKosular ? resolveKosular(h) : (h.kosular || []);
            return Object.assign({}, h, { kosular: kosular });
        });
        return Object.assign({}, race, { horses: horses });
    }

    function horseKey(h) {
        if (h?.atId != null && h.atId !== '') return String(h.atId);
        if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
        if (h?.name) return 'name:' + String(h.name);
        return null;
    }

    function cloneTahmin(tahmin, cfg) {
        if (!tahmin) return null;
        return Object.assign({}, tahmin, {
            source: 'renk-puanlama',
            scenarioId: cfg.id,
            scenarioLabel: cfg.label,
            scenarioIndex: cfg.index
        });
    }

    /** Tek koşu — tek senaryo */
    function scoreRace(race, meta, resolveKosular, scenario) {
        const all = scoreRaceAllScenarios(race, meta, resolveKosular);
        const cfg = scenario || DEFAULT_SCENARIO;
        const sid = cfg.id || 'legacy';
        return all[sid] || new Map();
    }

    /** Tek koşu — 25 senaryo; scenarioId → Map(horseKey → tahmin) */
    function scoreRaceAllScenarios(race, meta, resolveKosular) {
        const out = {};
        if (!GostergeScoringEngine?.isCalibrated?.()) return out;
        const cache = scenarioCache?.length ? scenarioCache : rebuildScenarioCache();
        if (!cache.length) return out;

        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        const enriched = enrichRaceForIstat(race, resolveKosular);
        const pkg = IstatistikEngine.buildRaceIstatistikPackage(enriched, hedefSehir, programTarih);
        if (!pkg?.rows?.length) return out;

        for (let si = 0; si < cache.length; si++) {
            const item = cache[si];
            const cfg = item.cfg;
            GostergeScoringEngine.attachRaceTahminWithOptions(pkg, item.scoringOpts);
            const map = new Map();
            for (const row of pkg.rows) {
                const key = horseKey(row);
                if (key && row.tahmin) {
                    map.set(key, cloneTahmin(row.tahmin, Object.assign({ index: item.index }, cfg)));
                }
            }
            out[cfg.id] = map;
        }
        return out;
    }

    function getDefaultScenario() {
        return Object.assign({ index: 1 }, DEFAULT_SCENARIO);
    }

    return {
        DEFAULT_SCENARIO,
        ensureCalibration,
        scoreRace,
        scoreRaceAllScenarios,
        getDefaultScenario,
        getAllScenarios,
        getScenarioColumns,
        scoringOptionsFromScenario
    };
})();
