/**
 * SON TEST — Renk Puanlama Test (tek sütun: R2 · Top-50 · En iyi tek)
 */
const AtestSonRenkTahmin = (function () {
    /** Benchmark tablosu #2 — SON TEST'te gösterilen sütun */
    const SON_TEST_COLUMN_INDEX = 2;
    const SON_TEST_COLUMN_LABEL = 'R2';

    const DEFAULT_SCENARIO = {
        id: 'legacy',
        label: 'Mevcut · 7 sabit renk kuralı',
        legacy: true
    };

    let calPromise = null;
    let allColorRowsCache = null;
    /** @type {{ index: number, cfg: object, scoringOpts: object }[]|null} */
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

    function findScenarioItem(scenarioOrIndex) {
        const cache = scenarioCache?.length ? scenarioCache : rebuildScenarioCache();
        if (!cache.length) return null;
        if (scenarioOrIndex == null) {
            return cache.find(function(s) { return s.index === SON_TEST_COLUMN_INDEX; }) || cache[1] || cache[0];
        }
        if (typeof scenarioOrIndex === 'number') {
            return cache.find(function(s) { return s.index === scenarioOrIndex; }) || null;
        }
        const id = scenarioOrIndex.id;
        if (id) return cache.find(function(s) { return s.cfg.id === id; }) || null;
        return cache.find(function(s) { return s.index === SON_TEST_COLUMN_INDEX; }) || cache[0];
    }

    function getDisplayScenario() {
        const item = findScenarioItem(SON_TEST_COLUMN_INDEX);
        if (!item) return Object.assign({ index: SON_TEST_COLUMN_INDEX }, DEFAULT_SCENARIO);
        return Object.assign({ index: item.index }, item.cfg);
    }

    function getScenarioColumns() {
        const cfg = getDisplayScenario();
        return [{
            index: cfg.index,
            id: cfg.id,
            shortLabel: SON_TEST_COLUMN_LABEL,
            title: '#' + cfg.index + ' · ' + (cfg.label || cfg.id)
        }];
    }

    async function ensureCalibration() {
        if (typeof GostergeScoringEngine === 'undefined' || typeof IstatistikEngine === 'undefined') {
            return false;
        }
        if (GostergeScoringEngine.isCalibrated?.() && scenarioCache?.length) return true;
        if (calPromise) return calPromise;
        calPromise = (async function () {
            try {
                if (typeof GostergeScoringEngine.loadSharedCalibrationBundle === 'function') {
                    const ok = await GostergeScoringEngine.loadSharedCalibrationBundle();
                    if (ok && GostergeScoringEngine.isCalibrated?.()) {
                        onBundleLoaded();
                        return true;
                    }
                }
                const built = await GostergeScoringEngine.buildFlatEntriesFromApi({ IE: IstatistikEngine });
                const flatEntries = built.flatEntries || [];
                const bitisMap = built.bitisMap || {};
                const host = GostergeScoringEngine.makeBitisHost(
                    flatEntries, bitisMap, buildBitisStatsFromEntries);
                await GostergeScoringEngine.calibrate(flatEntries, host);
                if (GostergeScoringEngine.isCalibrated?.()) {
                    try {
                        allColorRowsCache = GostergeScoringEngine.getCachedAllColorRows?.()
                            || GostergeScoringEngine.collectAllColorGostergeRows(
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

    /** Tek koşu — R2 senaryosu; at anahtarı → tahmin */
    function scoreRace(race, meta, resolveKosular, scenario) {
        const out = new Map();
        if (!GostergeScoringEngine?.isCalibrated?.()) return out;
        const item = findScenarioItem(scenario);
        if (!item) return out;

        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        const enriched = enrichRaceForIstat(race, resolveKosular);
        const pkg = IstatistikEngine.buildRaceIstatistikPackage(enriched, hedefSehir, programTarih);
        if (!pkg?.rows?.length) return out;

        GostergeScoringEngine.attachRaceTahminWithOptions(pkg, item.scoringOpts);
        const cfg = Object.assign({ index: item.index }, item.cfg);
        for (const row of pkg.rows) {
            const key = horseKey(row);
            if (key && row.tahmin) {
                out.set(key, cloneTahmin(row.tahmin, cfg));
            }
        }
        return out;
    }

    function onBundleLoaded() {
        if (!GostergeScoringEngine?.isCalibrated?.()) {
            scenarioCache = null;
            return;
        }
        try {
            allColorRowsCache = GostergeScoringEngine.getCachedAllColorRows?.() || [];
        } catch (_) {
            allColorRowsCache = [];
        }
        rebuildScenarioCache();
    }

    function getDefaultScenario() {
        return getDisplayScenario();
    }

    return {
        SON_TEST_COLUMN_INDEX,
        SON_TEST_COLUMN_LABEL,
        DEFAULT_SCENARIO,
        ensureCalibration,
        onBundleLoaded,
        scoreRace,
        getDefaultScenario,
        getDisplayScenario,
        getScenarioColumns,
        scoringOptionsFromScenario
    };
})();
