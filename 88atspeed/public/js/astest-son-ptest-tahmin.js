/**
 * SON TEST — PUANLAMA TEST motorlarından ek TAHMİN sütunları
 */
const AtestSonPtestTahmin = (function () {
    const T9V_SHARE = 0.40;
    const METRIC_SWEEP = { id: 'son8001', pct: 10 };

    let calPromise = null;
    let adaptiveProfiles = null;

    const COLUMNS = [
        { id: 'mtr', label: 'MTR', title: 'Metrik Tarama · SON800-1 %10 · T9V %40' },
        { id: 't9v', label: 'T9V', title: 'T9V Tarama · T9V pay %40' },
        { id: 'asf', label: 'ASF', title: 'At sayısı · Faktör · adaptive profil' },
        { id: 'g1side', label: 'G1↕', title: 'Gösterge 1 · tek metrik alt/üst (SON800-1 · SON·Δ)' },
        { id: 'g1pair', label: 'G1⇄', title: 'Gösterge 1 · çift yön (SON800-1 × 800-1 ORAN)' },
        { id: 'go', label: 'GÖ', title: 'Gösterge · tam puanlama motoru' },
        { id: 'hyb', label: 'HYB', title: 'Hibrit TAHMİN · başarı % + gösterge (at sayısına göre)' }
    ];

    function buildBitisStatsFromEntries(entries) {
        let withBitis = 0;
        let b1 = 0;
        let b12 = 0;
        let b123 = 0;
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
        }
        return { matchedRows: (entries || []).length, withBitis, b1, b12, b123 };
    }

    function enrichRace(race, resolveKosular) {
        const horses = (race.horses || []).map(function(h) {
            return Object.assign({}, h, { kosular: resolveKosular ? resolveKosular(h) : (h.kosular || []) });
        });
        return Object.assign({}, race, { horses: horses });
    }

    function buildPkg(race, meta, resolveKosular) {
        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        return IstatistikEngine.buildRaceIstatistikPackage(
            enrichRace(race, resolveKosular), hedefSehir, programTarih);
    }

    function horseKey(h) {
        if (h?.atId != null && h.atId !== '') return String(h.atId);
        if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
        if (h?.name) return 'name:' + String(h.name);
        return null;
    }

    function mapPkgRows(pkg, source, label) {
        const out = new Map();
        if (!pkg?.rows) return out;
        for (const row of pkg.rows) {
            const key = horseKey(row);
            if (key && row.tahmin) {
                out.set(key, Object.assign({}, row.tahmin, {
                    source: source,
                    scenarioLabel: label
                }));
            }
        }
        return out;
    }

    function snapshotGostergeState() {
        return {
            t9v: GostergeScoringEngine.getT9vScoreShare?.(),
            focus: GostergeScoringEngine.getMetricSweepFocus?.()
        };
    }

    function restoreGostergeState(saved) {
        if (!saved) return;
        GostergeScoringEngine.clearMetricSweepFocus?.();
        if (saved.t9v != null) GostergeScoringEngine.setT9vScoreShare?.(saved.t9v);
        if (saved.focus?.metricId) {
            GostergeScoringEngine.setMetricSweepFocus?.(
                saved.focus.metricId, saved.focus.shareWithinOther || 0);
        }
    }

    function lookupProfile(fieldSize) {
        if (!adaptiveProfiles?.bySize) return null;
        return GostergeScoringEngine.lookupFieldProfileBySize?.(adaptiveProfiles.bySize, fieldSize) || null;
    }

    async function ensureCalibration() {
        if (typeof GostergeScoringEngine === 'undefined'
            || typeof IstatistikEngine === 'undefined') {
            return false;
        }
        if (GostergeScoringEngine.isCalibrated?.()
            && typeof HybridTahminScoringEngine !== 'undefined'
            && HybridTahminScoringEngine.isCalibrated?.()
            && AtestSonGosterge1Tahmin?.isCalibrated?.()) {
            return true;
        }
        if (calPromise) return calPromise;
        calPromise = (async function() {
            try {
                if (typeof AtestSonRenkTahmin !== 'undefined') {
                    await AtestSonRenkTahmin.ensureCalibration();
                }
                const built = await GostergeScoringEngine.buildFlatEntriesFromApi({ IE: IstatistikEngine });
                const flatEntries = built.flatEntries || [];
                const bitisMap = built.bitisMap || {};
                const host = GostergeScoringEngine.makeBitisHost(
                    flatEntries, bitisMap, buildBitisStatsFromEntries);

                if (typeof HybridTahminScoringEngine !== 'undefined') {
                    await HybridTahminScoringEngine.calibrateFromFlatEntries(
                        flatEntries, host.bitisValueForSort, { host: host });
                    adaptiveProfiles = HybridTahminScoringEngine.getGostergeProfiles?.() || null;
                } else {
                    await GostergeScoringEngine.calibrate(flatEntries, host);
                    if (typeof PtestFieldFactorEngine !== 'undefined'
                        && typeof PtestFieldAdaptiveEngine !== 'undefined') {
                        GostergeScoringEngine.applyToFlatEntries(flatEntries);
                        const factorResults = PtestFieldFactorEngine.analyzeFieldFactors(flatEntries, host);
                        adaptiveProfiles = PtestFieldAdaptiveEngine.buildProfiles(factorResults, {
                            colorLadder: GostergeScoringEngine.getCalibration?.()?.colorLadder || []
                        });
                        GostergeScoringEngine.setFieldAdaptiveProfiles?.(adaptiveProfiles);
                    }
                }

                if (typeof AtestSonGosterge1Tahmin !== 'undefined') {
                    AtestSonGosterge1Tahmin.calibrateFromFlatEntries(
                        flatEntries, host.bitisValueForSort);
                }
                return !!GostergeScoringEngine.isCalibrated?.();
            } catch (err) {
                console.warn('AtestSonPtestTahmin: kalibrasyon başarısız', err);
                calPromise = null;
                return false;
            }
        })();
        return calPromise;
    }

    function scoreRaceAll(race, meta, resolveKosular) {
        const out = {};
        for (const col of COLUMNS) out[col.id] = new Map();
        if (!GostergeScoringEngine?.isCalibrated?.()) return out;

        const saved = snapshotGostergeState();
        const fieldSize = (race.horses || []).length;
        const profile = lookupProfile(fieldSize);

        try {
            // MTR
            GostergeScoringEngine.clearMetricSweepFocus?.();
            GostergeScoringEngine.setT9vScoreShare?.(T9V_SHARE);
            GostergeScoringEngine.setMetricSweepFocus?.(METRIC_SWEEP.id, METRIC_SWEEP.pct / 100);
            let pkg = buildPkg(race, meta, resolveKosular);
            GostergeScoringEngine.attachRaceTahminWithOptions(pkg, Object.assign(
                {}, GostergeScoringEngine.getDefaultColorScoringOptions(), { fieldProfile: profile }));
            out.mtr = mapPkgRows(pkg, 'metric-sweep', COLUMNS[0].title);

            // T9V
            GostergeScoringEngine.clearMetricSweepFocus?.();
            GostergeScoringEngine.setT9vScoreShare?.(T9V_SHARE);
            pkg = buildPkg(race, meta, resolveKosular);
            GostergeScoringEngine.attachRaceTahminWithOptions(pkg, Object.assign(
                {}, GostergeScoringEngine.getDefaultColorScoringOptions(), { fieldProfile: profile }));
            out.t9v = mapPkgRows(pkg, 't9v-sweep', COLUMNS[1].title);

            // ASF
            GostergeScoringEngine.clearMetricSweepFocus?.();
            GostergeScoringEngine.setT9vScoreShare?.(T9V_SHARE);
            pkg = buildPkg(race, meta, resolveKosular);
            GostergeScoringEngine.attachRaceTahmin?.(pkg, adaptiveProfiles?.bySize || null);
            out.asf = mapPkgRows(pkg, 'field-factor', COLUMNS[2].title);

            // G1
            if (typeof AtestSonGosterge1Tahmin !== 'undefined') {
                pkg = buildPkg(race, meta, resolveKosular);
                out.g1side = AtestSonGosterge1Tahmin.scoreSide(pkg);
                pkg = buildPkg(race, meta, resolveKosular);
                out.g1pair = AtestSonGosterge1Tahmin.scorePair(pkg);
            }

            // GÖ
            GostergeScoringEngine.clearMetricSweepFocus?.();
            GostergeScoringEngine.setT9vScoreShare?.(T9V_SHARE);
            pkg = buildPkg(race, meta, resolveKosular);
            GostergeScoringEngine.attachRaceTahmin?.(pkg, adaptiveProfiles?.bySize || null);
            out.go = mapPkgRows(pkg, 'gosterge', COLUMNS[5].title);

            // HYB
            if (typeof HybridTahminScoringEngine !== 'undefined'
                && HybridTahminScoringEngine.isCalibrated?.()) {
                pkg = buildPkg(race, meta, resolveKosular);
                HybridTahminScoringEngine.attachRaceTahmin(pkg);
                out.hyb = mapPkgRows(pkg, 'hybrid', COLUMNS[6].title);
            }
        } finally {
            restoreGostergeState(saved);
        }
        return out;
    }

    function getColumns() {
        return COLUMNS.slice();
    }

    function isCalibrated() {
        return !!GostergeScoringEngine?.isCalibrated?.();
    }

    return {
        COLUMNS,
        ensureCalibration,
        scoreRaceAll,
        getColumns,
        isCalibrated
    };
})();
