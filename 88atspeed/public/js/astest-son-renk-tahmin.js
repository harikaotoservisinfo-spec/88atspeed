/**
 * SON TEST — Renk Puanlama Test motoru (PUANLAMA TEST kalibrasyonu + koşu TAHMİN)
 * Varsayılan: senaryo #1 · Mevcut · 7 sabit renk kuralı (legacy)
 */
const AtestSonRenkTahmin = (function () {
    /** Renk Puanlama benchmark #1 — en iyi lider 1. */
    const DEFAULT_SCENARIO = {
        id: 'legacy',
        label: 'Mevcut · 7 sabit renk kuralı',
        legacy: true
    };

    let calPromise = null;
    let allColorRowsCache = null;

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

    async function ensureCalibration() {
        if (typeof GostergeScoringEngine === 'undefined' || typeof IstatistikEngine === 'undefined') {
            return false;
        }
        if (GostergeScoringEngine.isCalibrated?.()) return true;
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

    /** Tek koşu — Renk Puanlama TAHMİN; at anahtarı → tahmin objesi */
    function scoreRace(race, meta, resolveKosular, scenario) {
        const out = new Map();
        if (!GostergeScoringEngine?.isCalibrated?.()) return out;
        const cfg = scenario || DEFAULT_SCENARIO;
        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        const enriched = enrichRaceForIstat(race, resolveKosular);
        const pkg = IstatistikEngine.buildRaceIstatistikPackage(enriched, hedefSehir, programTarih);
        if (!pkg?.rows?.length) return out;

        let allColorRows = allColorRowsCache;
        if (!cfg.legacy && !allColorRows?.length && GostergeScoringEngine.buildFlatEntriesFromApi) {
            return out;
        }
        const scoringOpts = scoringOptionsFromScenario(cfg, allColorRows);
        GostergeScoringEngine.attachRaceTahminWithOptions(pkg, scoringOpts);

        for (const row of pkg.rows) {
            const key = horseKey(row);
            if (key && row.tahmin) {
                row.tahmin.source = 'renk-puanlama';
                row.tahmin.scenarioId = cfg.id;
                row.tahmin.scenarioLabel = cfg.label;
                out.set(key, row.tahmin);
            }
        }
        return out;
    }

    function getDefaultScenario() {
        return Object.assign({}, DEFAULT_SCENARIO);
    }

    return {
        DEFAULT_SCENARIO,
        ensureCalibration,
        scoreRace,
        getDefaultScenario,
        scoringOptionsFromScenario
    };
})();
