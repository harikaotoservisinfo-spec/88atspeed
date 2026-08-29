/**
 * Gösterge bitiş başarısına göre TAHMİN puanlama (PUANLAMA TEST + İSTATİSTİKLER).
 * SON·Δ göstergeleri + derinlik çifti (SON↔1ÖNCE…) göstergeleri · metrik grubu bazlı.
 */
const GostergeScoringEngine = (function () {
    const MIN_RULE_SAMPLE = 5;
    const DEPTH_PAIR_WEIGHT_FACTOR = 0.65;
    let T9V_SCORE_SHARE = 0.40;
    let OTHER_SCORE_SHARE = 0.60;
    /** %60 diliminde kova oranları — sweep en iyi: Renkler 40 · Metrikler 15 · rest 5 */
    let COLOR_OTHER_SHARE = 40 / 60;
    let METRIC_OTHER_SHARE = 15 / 60;
    let REST_OTHER_SHARE = 5 / 60;
    const DEFAULT_SCORE_SHARE_SPLIT = { t9v: 40, colors: 40, metrics: 15, rest: 5 };
    const COLOR_RULE_IDS = new Set([
        'yesilHucre', 'turuncuHucre', 'turuncuCevre', 'sariYazi',
        'kirmiziIc', 'acikYesilIc', 'koyuYesilIc'
    ]);
    /** Kalıcı renk puanlama — export gösterge Top-N (benchmark #1) */
    const COLOR_GOSTERGE_CONFIG = {
        topN: 80,
        matchMode: 'sum',
        includeDepth: true,
        includeRaceRank: false
    };
    let METRIC_SWEEP_FOCUS_ID = null;
    let METRIC_SWEEP_FOCUS_SHARE = 0;
    /** OTHER dilimi payları (ham puanlar; normalize → toplam 1.0) */
    const OTHER_METRIC_SHARE_PCT = {
        son8001: 3,
        oran1: 6,
        oran2: 14,
        fark827: 1,
        ff: 3,
        t8: 4,
        test1: 18,
        test2: 3,
        test3: 3,
        testsira: 3,
        t1dr: 7,
        f802: 3,
        f803: 3,
        t9: 7,
        dr1dr: 7,
        drsl: 5,
        dr1sl: 4,
        t12y: 12,
        kirmizi: 4,
        yesil: 6,
        mavif: 3,
        kmavi: 45,
        t4: 5,
        t5: 3,
        t6: 3,
        t7: 5,
        t2m3: 3,
        t1dr3: 4,
        fark: 6,
        ilkf: 5,
        sonf: 3,
        sl801: 3,
        sl802: 6,
        f8021: 3,
        sehirSon: 2,
        smGec: 2,
        sm12: 1
    };

    const OTHER_METRIC_SHARE_LABELS = {
        son8001: 'SON800-1',
        oran1: '800-1 ORAN',
        oran2: '800-2 ORAN',
        fark827: '800Δ·7',
        ff: 'FFΔ',
        t8: 'T8Δ',
        test1: 'TEST1',
        test2: 'TEST2',
        test3: 'TEST3',
        testsira: 'TEST·SIRA',
        t1dr: 'T1×DR',
        f802: '800Δ·2',
        f803: '800Δ·3',
        t9: 'T9Δ',
        dr1dr: 'DR/1DR',
        drsl: 'DR/SL',
        dr1sl: '1DR/SL',
        t12y: 'T12Δ',
        kirmizi: 'T123K',
        yesil: 'T46Δ',
        mavif: 'T23M',
        kmavi: 'KMΔ',
        t4: 'TEST4',
        t5: 'TEST5',
        t6: 'TEST6',
        t7: 'TEST7',
        t2m3: 'T2−T3',
        t1dr3: 'T1DR3',
        fark: 'FARK',
        ilkf: 'İLK-F',
        sonf: 'SON-F',
        sl801: '8001/SL',
        sl802: '8002/SL',
        f8021: '8002−1',
        sehirSon: 'ŞEH-SON',
        smGec: 'Ş+M-GEÇ',
        sm12: 'Ş+M-12'
    };

    function buildOtherMetricShares() {
        let total = 0;
        for (const pct of Object.values(OTHER_METRIC_SHARE_PCT)) total += pct;
        const out = {};
        for (const [id, pct] of Object.entries(OTHER_METRIC_SHARE_PCT)) {
            out[id] = pct / total;
        }
        return out;
    }

    const OTHER_METRIC_SHARES = buildOtherMetricShares();
    let SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    let calibration = null;

    function setT9vScoreShare(share) {
        const s = Math.max(0, Math.min(1, Number(share) || 0));
        T9V_SCORE_SHARE = s;
        OTHER_SCORE_SHARE = 1 - s;
    }

    function getT9vScoreShare() {
        return T9V_SCORE_SHARE;
    }

    function getScoreShareSplit() {
        const colorsTotal = OTHER_SCORE_SHARE * COLOR_OTHER_SHARE;
        const metricsTotal = OTHER_SCORE_SHARE * METRIC_OTHER_SHARE;
        const restTotal = OTHER_SCORE_SHARE * REST_OTHER_SHARE;
        return {
            t9v: Math.round(T9V_SCORE_SHARE * 1000) / 10,
            colors: Math.round(colorsTotal * 1000) / 10,
            metrics: Math.round(metricsTotal * 1000) / 10,
            rest: Math.round(restTotal * 1000) / 10
        };
    }

    function setScoreShareSplit(t9vPct, colorsPct, metricsPct, restPct) {
        let t = Math.max(0, Number(t9vPct) || 0);
        let c = Math.max(0, Number(colorsPct) || 0);
        let m = Math.max(0, Number(metricsPct) || 0);
        let r = Math.max(0, Number(restPct) || 0);
        const sum = t + c + m + r;
        if (sum <= 0) return getScoreShareSplit();
        t /= sum;
        c /= sum;
        m /= sum;
        r /= sum;
        T9V_SCORE_SHARE = t;
        OTHER_SCORE_SHARE = 1 - t;
        const otherTotal = c + m + r;
        if (otherTotal <= 0) {
            COLOR_OTHER_SHARE = 0;
            METRIC_OTHER_SHARE = 0;
            REST_OTHER_SHARE = 0;
        } else {
            COLOR_OTHER_SHARE = c / otherTotal;
            METRIC_OTHER_SHARE = m / otherTotal;
            REST_OTHER_SHARE = r / otherTotal;
        }
        return getScoreShareSplit();
    }

    function resetScoreShareSplit() {
        const d = DEFAULT_SCORE_SHARE_SPLIT;
        return setScoreShareSplit(d.t9v, d.colors, d.metrics, d.rest);
    }

    function evaluateShareSplit(flatEntries, host, split) {
        if (!calibration || !flatEntries?.length) return null;
        const savedSplit = getScoreShareSplit();
        const savedTahmin = flatEntries.map(e => e.row.tahmin);
        const normalized = setScoreShareSplit(split.t9v, split.colors, split.metrics, split.rest);
        applyToFlatEntries(flatEntries);
        const stats = evaluateTahminSuccess(flatEntries, host.bitisValueForSort, SUCCESS_BLEND);
        flatEntries.forEach((e, i) => { e.row.tahmin = savedTahmin[i]; });
        setScoreShareSplit(savedSplit.t9v, savedSplit.colors, savedSplit.metrics, savedSplit.rest);
        return { split: { ...split }, normalized, ...stats };
    }

    function compareShareSplit(flatEntries, host, split) {
        if (!calibration || !flatEntries?.length) return null;
        const current = getScoreShareSplit();
        const baseline = evaluateShareSplit(flatEntries, host, current);
        const tested = evaluateShareSplit(flatEntries, host, split);
        if (!baseline || !tested) return null;
        const delta = tested.leaderBlended - baseline.leaderBlended;
        return { current, baseline, tested, delta };
    }

    function generateShareSplitSweepConfigs(opts) {
        opts = opts || {};
        const step = opts.step != null ? opts.step : 5;
        const full = opts.full !== false;
        const configs = [];
        const t9vMin = opts.t9vMin != null ? opts.t9vMin : (full ? 15 : 25);
        const t9vMax = opts.t9vMax != null ? opts.t9vMax : (full ? 55 : 45);
        const colorMin = opts.colorMin != null ? opts.colorMin : (full ? 25 : 35);
        const colorMax = opts.colorMax != null ? opts.colorMax : (full ? 65 : 55);
        const metricMin = opts.metricMin != null ? opts.metricMin : (full ? 5 : 10);
        const metricMax = opts.metricMax != null ? opts.metricMax : (full ? 40 : 25);
        const restMax = opts.restMax != null ? opts.restMax : 40;

        for (let t9v = t9vMin; t9v <= t9vMax; t9v += step) {
            for (let colors = colorMin; colors <= colorMax; colors += step) {
                for (let metrics = metricMin; metrics <= metricMax; metrics += step) {
                    const rest = 100 - t9v - colors - metrics;
                    if (rest < 0 || rest > restMax) continue;
                    configs.push({
                        id: 't' + t9v + '_c' + colors + '_m' + metrics + '_r' + rest,
                        label: 'T9V %' + t9v + ' · Renkler %' + colors + ' · Metrikler %' + metrics + ' · rest %' + rest,
                        t9v, colors, metrics, rest
                    });
                }
            }
        }
        return configs;
    }

    async function runShareSplitSweep(flatEntries, host, onProgress, opts) {
        if (!calibration) return { results: [], configCount: 0 };
        const configs = generateShareSplitSweepConfigs(opts);
        const results = [];
        for (let i = 0; i < configs.length; i++) {
            const cfg = configs[i];
            onProgress?.({
                phase: 'run',
                index: i + 1,
                total: configs.length,
                label: cfg.label,
                pct: Math.round(((i + 1) / configs.length) * 100)
            });
            const row = evaluateShareSplit(flatEntries, host, cfg);
            if (row) results.push({ config: cfg, ...row });
            if (i % 8 === 7) await yieldToMain();
        }
        results.sort((a, b) => {
            if (b.leaderBlended !== a.leaderBlended) return b.leaderBlended - a.leaderBlended;
            if (b.exactRate !== a.exactRate) return b.exactRate - a.exactRate;
            return b.leaderB1Rate - a.leaderB1Rate;
        });
        return { results, configCount: configs.length, best: results[0] || null };
    }

    function setMetricSweepFocus(metricId, shareWithinOther) {
        METRIC_SWEEP_FOCUS_ID = metricId || null;
        const s = Math.max(0, Math.min(1, Number(shareWithinOther) || 0));
        METRIC_SWEEP_FOCUS_SHARE = METRIC_SWEEP_FOCUS_ID ? s : 0;
    }

    function clearMetricSweepFocus() {
        METRIC_SWEEP_FOCUS_ID = null;
        METRIC_SWEEP_FOCUS_SHARE = 0;
    }

    function getMetricSweepFocus() {
        return {
            metricId: METRIC_SWEEP_FOCUS_ID,
            shareWithinOther: METRIC_SWEEP_FOCUS_SHARE
        };
    }

    function isFocusScoreMetric(metricEntry) {
        if (!METRIC_SWEEP_FOCUS_ID) return false;
        return metricBaseId(metricEntry) === METRIC_SWEEP_FOCUS_ID;
    }

    function isColorRule(ruleId) {
        return COLOR_RULE_IDS.has(ruleId);
    }

    function otherMetricShare(baseId) {
        const s = OTHER_METRIC_SHARES[baseId];
        return s != null ? s : 0;
    }

    function otherMetricShareTotal() {
        let t = 0;
        for (const s of Object.values(OTHER_METRIC_SHARES)) t += s;
        return t;
    }

    function restOtherMetricShare() {
        return Math.max(0, 1 - otherMetricShareTotal());
    }

    function getOtherMetricShares() {
        const pctTotal = Object.values(OTHER_METRIC_SHARE_PCT).reduce((a, b) => a + b, 0);
        const out = {
            _colors: {
                frac: COLOR_OTHER_SHARE,
                pctWithin65: Math.round(COLOR_OTHER_SHARE * 1000) / 10,
                pctOfTotal: Math.round(COLOR_OTHER_SHARE * OTHER_SCORE_SHARE * 1000) / 10,
                label: 'Renkler (Top-' + COLOR_GOSTERGE_CONFIG.topN + ' export · Toplam)'
            },
            _metricSlice: {
                pctWithin65: Math.round(METRIC_OTHER_SHARE * 1000) / 10,
                pctOfTotal: Math.round(METRIC_OTHER_SHARE * OTHER_SCORE_SHARE * 1000) / 10
            }
        };
        for (const [id, frac] of Object.entries(OTHER_METRIC_SHARES)) {
            out[id] = {
                frac,
                pctWithin65: OTHER_METRIC_SHARE_PCT[id],
                pctWithinMetricSlice: Math.round(OTHER_METRIC_SHARE_PCT[id] * METRIC_OTHER_SHARE * 10) / 10,
                pctOfTotal: Math.round(frac * METRIC_OTHER_SHARE * OTHER_SCORE_SHARE * 1000) / 10,
                label: OTHER_METRIC_SHARE_LABELS[id] || id
            };
        }
        out._rest = {
            frac: REST_OTHER_SHARE,
            pctOfTotal: Math.round(REST_OTHER_SHARE * OTHER_SCORE_SHARE * 1000) / 10,
            pctWithin65: Math.round(REST_OTHER_SHARE * 1000) / 10,
            label: 'rest (SON800-2, SON800·DR…)'
        };
        return out;
    }

    /** @deprecated use getOtherMetricShares */
    function getCoreOtherMetricShares() {
        return getOtherMetricShares();
    }

    function setSuccessBlend(blend) {
        if (blend && typeof blend.b1 === 'number') {
            SUCCESS_BLEND = { ...SUCCESS_BLEND, ...blend };
        }
    }

    function blendedSuccess(stats) {
        if (!stats.withBitis) return 0;
        const t = stats.withBitis;
        return SUCCESS_BLEND.b1 * (stats.b1 / t)
            + SUCCESS_BLEND.b12 * (stats.b12 / t)
            + SUCCESS_BLEND.b123 * (stats.b123 / t);
    }

    function rankRules(rawRules, host) {
        const ranked = [];
        for (const rule of rawRules) {
            const matched = [];
            for (const entry of rule._entries || []) {
                if (rule.match(entry)) matched.push(entry);
            }
            const stats = host.buildBitisStatsFromEntries(matched);
            if (stats.withBitis < MIN_RULE_SAMPLE) continue;
            ranked.push({
                id: rule.id,
                label: rule.label,
                kind: rule.kind,
                stats,
                successRate: blendedSuccess(stats),
                b1Rate: stats.b1 / stats.withBitis,
                b12Rate: stats.b12 / stats.withBitis,
                match: rule.match
            });
        }
        ranked.sort((a, b) => {
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            if (b.stats.withBitis !== a.stats.withBitis) return b.stats.withBitis - a.stats.withBitis;
            return b.b1Rate - a.b1Rate;
        });
        const n = ranked.length;
        for (let i = 0; i < n; i++) {
            ranked[i].rank = i + 1;
            ranked[i].points = Math.max(1, Math.round((n - i) * 80 + ranked[i].successRate * 500));
        }
        return ranked;
    }

    function buildRuleCatalog(ctx, labelPrefix) {
        const pfx = labelPrefix || '';
        const rules = [];
        const colors = [
            { id: 'yesilHucre', label: pfx + '🟢 Yeşil hücre', match: e => ctx.primaryMatchesRule(e, 'yesilHucre') },
            { id: 'turuncuHucre', label: pfx + '🟠 Turuncu hücre', match: e => ctx.primaryMatchesRule(e, 'turuncuHucre') },
            { id: 'turuncuCevre', label: pfx + '🟠 Turuncu çevre', match: e => ctx.primaryMatchesRule(e, 'turuncuCevre') },
            { id: 'sariYazi', label: pfx + '🟡 Sarı yazı', match: e => ctx.primaryVisualFlags(e).sariYazi },
            { id: 'kirmiziIc', label: pfx + '🔴 Kırmızı iç', match: e => ctx.primaryVisualFlags(e).kirmiziIc },
            { id: 'acikYesilIc', label: pfx + '🟢 Açık yeşil iç', match: e => ctx.primaryVisualFlags(e).acikYesilIc },
            { id: 'koyuYesilIc', label: pfx + '🟩 Koyu yeşil iç', match: e => ctx.primaryVisualFlags(e).koyuYesilIc }
        ];
        rules.push(...colors);

        const deltaBuckets = PtestGostergeEngine._YESIL_DELTA_SORT_BUCKETS || [];
        for (const b of deltaBuckets) {
            rules.push({
                id: 'delta_' + b.id,
                label: pfx + b.label,
                match: e => ctx.primaryMatchesRule(e, b.id)
            });
        }

        for (let pct = 1; pct <= 25; pct++) {
            const pv = pct;
            rules.push({
                id: 't1sari_' + pv,
                label: pfx + 'T1×DR sarı %' + pv,
                match: e => ctx.t1SariMatchesPct(e, pv)
            });
        }
        return rules;
    }

    function collectSonDeltaMetrics(flatEntries) {
        const core = PtestGostergeEngine.METRICS.map(m => ({
            id: m.id,
            label: m.label,
            spec: m,
            mode: 'sonDelta'
        }));
        const seen = new Set(core.map(m => m.id));
        const extras = [];
        for (const entry of flatEntries) {
            for (const sec of entry.row._extraSectionMeta || []) {
                if (!sec?.id || seen.has(sec.id)) continue;
                seen.add(sec.id);
                extras.push({
                    id: sec.id,
                    label: sec.label || sec.id,
                    spec: {
                        id: sec.id,
                        label: sec.label || sec.id,
                        primaryKey: sec.depthsKey,
                        crossKey: 't1drDepths',
                        t1SariKey: 't1drDepths'
                    },
                    mode: 'sonDelta'
                });
            }
        }
        return core.concat(extras);
    }

    function collectAllScoreMetrics(flatEntries) {
        const metrics = [...collectSonDeltaMetrics(flatEntries)];
        if (typeof PtestGostergeDepthEngine === 'undefined') return metrics;

        const depthBase = PtestGostergeDepthEngine.allMetrics(flatEntries);
        for (const dm of depthBase) {
            for (const pair of PtestGostergeDepthEngine.DEPTH_PAIRS) {
                metrics.push({
                    id: dm.id + '__dp' + pair.index,
                    label: dm.label + ' · ' + pair.label,
                    spec: {
                        id: dm.id,
                        label: dm.label,
                        primaryKey: dm.primaryKey,
                        crossKey: dm.crossKey
                    },
                    mode: 'depthPair',
                    pairIndex: pair.index,
                    pairLabel: pair.label
                });
            }
        }
        return metrics;
    }

    function createSonCtx(spec, host) {
        return PtestGostergeEngine.createContext(spec, host);
    }

    function createDepthCtx(spec, pairIndex, host, depthScales) {
        const scales = depthScales[spec.id] || depthScales;
        return PtestGostergeDepthEngine.createPairContext(spec, pairIndex, host, scales);
    }

    function calibrateMetricEntry(m, flatEntries, host, depthScales) {
        let ctx;
        let prefix = '';
        if (m.mode === 'depthPair') {
            ctx = createDepthCtx(m.spec, m.pairIndex, host, depthScales);
            prefix = '[' + m.pairLabel + '] ';
        } else {
            ctx = createSonCtx(m.spec, host);
        }
        const catalog = buildRuleCatalog(ctx, prefix);
        for (const r of catalog) r._entries = flatEntries;
        return rankRules(catalog, host);
    }

    function buildDepthScales(flatEntries) {
        const out = {};
        if (typeof PtestGostergeDepthEngine === 'undefined') return out;
        for (const dm of PtestGostergeDepthEngine.allMetrics(flatEntries)) {
            out[dm.id] = {
                primary: PtestGostergeDepthEngine.buildGlobalPairScales(
                    flatEntries, dm.primaryKey, PtestGostergeDepthEngine.DEPTH_PAIRS.length),
                cross: PtestGostergeDepthEngine.buildGlobalPairScales(
                    flatEntries, dm.crossKey, PtestGostergeDepthEngine.DEPTH_PAIRS.length)
            };
        }
        return out;
    }

    function yieldToMain() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    function buildLiveMatchersFromLadders(metrics, ladders) {
        const out = {};
        for (const m of metrics || []) {
            const map = new Map();
            for (const rule of ladders[m.id] || []) {
                if (rule?.id && typeof rule.match === 'function') {
                    map.set(rule.id, rule.match);
                }
            }
            if (map.size) out[m.id] = map;
        }
        return out;
    }

    function mergeLiveMatchers(primary, fallback) {
        const out = { ...primary };
        for (const m of Object.keys(fallback || {})) {
            if (!out[m]?.size && fallback[m]?.size) out[m] = fallback[m];
        }
        return out;
    }

    function buildLiveMatchers(metrics, host, depthScales) {
        const liveHost = {
            flatEntries: host.flatEntries,
            buildBitisStatsFromEntries: host.buildBitisStatsFromEntries,
            bitisValueForSort: host.bitisValueForSort
        };
        const out = {};
        for (const m of metrics) {
            let ctx;
            let prefix = '';
            if (m.mode === 'depthPair') {
                ctx = createDepthCtx(m.spec, m.pairIndex, liveHost, depthScales);
                prefix = '[' + m.pairLabel + '] ';
            } else {
                ctx = createSonCtx(m.spec, liveHost);
            }
            const catalog = buildRuleCatalog(ctx, prefix);
            out[m.id] = new Map(catalog.map(r => [r.id, r.match]));
        }
        return out;
    }

    async function calibrate(flatEntries, host) {
        if (!flatEntries?.length) {
            calibration = null;
            return null;
        }
        if (typeof host?.buildBitisStatsFromEntries !== 'function') {
            console.warn('calibrate: host.buildBitisStatsFromEntries eksik');
            calibration = null;
            return null;
        }

        let bitisRows = 0;
        for (const entry of flatEntries) {
            const b = host.bitisValueForSort?.(entry);
            if (b != null && b >= 1) bitisRows++;
        }

        let metrics = [];
        let depthScales = {};
        const ladders = {};
        try {
            metrics = collectAllScoreMetrics(flatEntries);
            depthScales = buildDepthScales(flatEntries);
        } catch (err) {
            console.error('calibrate: metric setup failed', err);
            calibration = {
                ladders: {},
                metrics: [],
                depthScales: {},
                liveMatchers: {},
                colorLadder: [],
                colorGostergeConfig: { ...COLOR_GOSTERGE_CONFIG },
                allColorRowsCount: 0,
                bitisRows,
                totalRows: flatEntries.length,
                successBlend: { ...SUCCESS_BLEND },
                calibratedAt: Date.now()
            };
            return calibration;
        }

        calibration = {
            ladders: {},
            metrics,
            depthScales,
            liveMatchers: {},
            colorLadder: [],
            colorGostergeConfig: { ...COLOR_GOSTERGE_CONFIG },
            allColorRowsCount: 0,
            bitisRows,
            totalRows: flatEntries.length,
            successBlend: { ...SUCCESS_BLEND },
            calibratedAt: Date.now()
        };

        try {
            for (let i = 0; i < metrics.length; i++) {
                const m = metrics[i];
                try {
                    ladders[m.id] = calibrateMetricEntry(m, flatEntries, host, depthScales);
                } catch (err) {
                    console.warn('calibrate metric failed', m.id, err);
                    ladders[m.id] = [];
                }
                if (i > 0 && i % 4 === 0) await yieldToMain();
            }

            let liveMatchers = {};
            try {
                liveMatchers = buildLiveMatchers(metrics, host, depthScales);
            } catch (err) {
                console.warn('buildLiveMatchers failed', err);
            }
            liveMatchers = mergeLiveMatchers(liveMatchers, buildLiveMatchersFromLadders(metrics, ladders));

            let allColorRows = [];
            let colorLadder = [];
            try {
                allColorRows = collectAllColorGostergeRows(flatEntries, host);
                colorLadder = buildColorGostergeLadder(allColorRows, COLOR_GOSTERGE_CONFIG);
            } catch (err) {
                console.warn('color ladder build failed', err);
            }

            calibration = {
                ladders,
                metrics,
                depthScales,
                liveMatchers,
                colorLadder,
                colorGostergeConfig: { ...COLOR_GOSTERGE_CONFIG },
                allColorRowsCount: allColorRows.length,
                bitisRows,
                totalRows: flatEntries.length,
                successBlend: { ...SUCCESS_BLEND },
                calibratedAt: Date.now()
            };
        } catch (err) {
            console.error('calibrate failed', err);
            calibration = {
                ...calibration,
                ladders,
                metrics,
                depthScales,
                bitisRows,
                totalRows: flatEntries.length,
                calibratedAt: Date.now()
            };
        }
        return calibration;
    }

    function getDefaultColorScoringOptions() {
        if (calibration?.colorLadder?.length) {
            return {
                colorMode: 'gosterge',
                colorLadder: calibration.colorLadder,
                colorMatchMode: calibration.colorGostergeConfig?.matchMode || COLOR_GOSTERGE_CONFIG.matchMode
            };
        }
        return { colorMode: 'legacy' };
    }

    function metricBaseId(metricEntry) {
        return metricEntry.spec?.id || metricEntry.id.replace(/__dp\d+$/, '');
    }

    function isT9vScoreMetric(metricEntry) {
        return metricBaseId(metricEntry) === 't9v';
    }

    function metricWeight(metricEntry) {
        const baseId = metricBaseId(metricEntry);
        let w = 1000;
        if (typeof IstatistikTahminEngine !== 'undefined' && IstatistikTahminEngine.getMetricGroupWeight) {
            w = IstatistikTahminEngine.getMetricGroupWeight(baseId);
        }
        if (baseId === 't9v') {
            w = 1000;
        }
        if (metricEntry.mode === 'depthPair') {
            w = Math.round(w * DEPTH_PAIR_WEIGHT_FACTOR);
        }
        return w;
    }

    function blendScoreBuckets(buckets) {
        const active = (buckets || []).filter(b => b.weighted > 0 && b.share > 0);
        if (!active.length) return 0;
        if (active.length === 1) return Math.round(active[0].weighted / active[0].share);
        return Math.round(Math.min(...active.map(b => b.weighted / b.share)));
    }

    function buildBlendBuckets(bucketWeighted) {
        const buckets = [{ id: 't9v', weighted: bucketWeighted.t9v || 0, share: T9V_SCORE_SHARE }];
        buckets.push({
            id: 'colors',
            weighted: bucketWeighted.colors || 0,
            share: OTHER_SCORE_SHARE * COLOR_OTHER_SHARE
        });
        for (const [id, frac] of Object.entries(OTHER_METRIC_SHARES)) {
            buckets.push({
                id,
                weighted: bucketWeighted[id] || 0,
                share: OTHER_SCORE_SHARE * METRIC_OTHER_SHARE * frac
            });
        }
        if (REST_OTHER_SHARE > 0) {
            buckets.push({
                id: 'rest',
                weighted: bucketWeighted.rest || 0,
                share: OTHER_SCORE_SHARE * REST_OTHER_SHARE
            });
        }
        return buckets;
    }

    /** Belirleyici faktör: metrikleri tek kovada topla (tek tek düşük paylı metrikler renkleri gölgelemesin) */
    function buildBindingBlendBuckets(bucketWeighted) {
        let metricsWeighted = 0;
        for (const id of Object.keys(OTHER_METRIC_SHARES)) {
            metricsWeighted += bucketWeighted[id] || 0;
        }
        const buckets = [
            { id: 't9v', weighted: bucketWeighted.t9v || 0, share: T9V_SCORE_SHARE },
            {
                id: 'colors',
                weighted: bucketWeighted.colors || 0,
                share: OTHER_SCORE_SHARE * COLOR_OTHER_SHARE
            },
            {
                id: 'metrics',
                weighted: metricsWeighted,
                share: OTHER_SCORE_SHARE * METRIC_OTHER_SHARE
            }
        ];
        if (REST_OTHER_SHARE > 0) {
            buckets.push({
                id: 'rest',
                weighted: bucketWeighted.rest || 0,
                share: OTHER_SCORE_SHARE * REST_OTHER_SHARE
            });
        }
        return buckets;
    }

    function blendBucketGroup(id) {
        if (id === 't9v') return 't9v';
        if (id === 'colors') return 'colors';
        if (id === 'metrics') return 'metrics';
        if (id === 'rest') return 'rest';
        if (OTHER_METRIC_SHARES[id]) return 'metrics';
        return 'rest';
    }

    /** Min-blend: hangi kova nihai skoru sınırlıyor (TAHMİN puanlaması · 4 kova) */
    function computeScoreBinding(bucketWeighted, opts) {
        opts = opts || {};
        const blendBuckets = buildBindingBlendBuckets(bucketWeighted);
        const active = blendBuckets.filter(b => b.weighted > 0 && b.share > 0);
        if (!active.length) {
            return {
                group: null,
                binderId: null,
                finalTotal: 0,
                attributed: { t9v: 0, colors: 0, metrics: 0, rest: 0 },
                colorLimitsOther: false,
                colorDecisive: false
            };
        }
        const tiePriority = { colors: 0, t9v: 1, metrics: 2, rest: 3 };
        let minRatio = Infinity;
        let binder = active[0];
        for (const b of active) {
            const ratio = b.weighted / b.share;
            const group = blendBucketGroup(b.id);
            const pri = tiePriority[group] ?? 9;
            const binderGroup = blendBucketGroup(binder.id);
            const binderPri = tiePriority[binderGroup] ?? 9;
            const nearTie = minRatio < Infinity && Math.abs(ratio - minRatio) <= Math.max(1, minRatio * 0.01);
            const colorPrefer = (opts.colorHitCount || 0) > 0 && group === 'colors'
                && (nearTie || ratio <= minRatio + 1e-9);
            if (ratio < minRatio - 1e-9 || (nearTie && (colorPrefer || pri < binderPri))) {
                minRatio = ratio;
                binder = b;
            }
        }
        const finalTotal = Math.round(minRatio);
        const group = blendBucketGroup(binder.id);
        const attributed = { t9v: 0, colors: 0, metrics: 0, rest: 0 };
        if (group) attributed[group] = finalTotal;

        const others = blendBuckets.filter(b => b.id !== 't9v');
        const activeOthers = others.filter(b => b.weighted > 0 && b.share > 0);
        let colorLimitsOther = false;
        let otherMinRatio = Infinity;
        if (activeOthers.length) {
            otherMinRatio = Math.min(...activeOthers.map(b => b.weighted / b.share));
            let otherBinder = activeOthers[0];
            for (const b of activeOthers) {
                const r = b.weighted / b.share;
                const near = Math.abs(r - otherMinRatio) <= Math.max(1, otherMinRatio * 0.01);
                const pri = tiePriority[blendBucketGroup(b.id)] ?? 9;
                const obPri = tiePriority[blendBucketGroup(otherBinder.id)] ?? 9;
                if (r < otherMinRatio - 1e-9 || (near && pri < obPri)) otherBinder = b;
            }
            colorLimitsOther = otherBinder.id === 'colors';
        }
        const t9vB = blendBuckets.find(b => b.id === 't9v');
        const t9vRatio = t9vB && t9vB.weighted > 0 && t9vB.share > 0
            ? t9vB.weighted / t9vB.share
            : Infinity;
        const colorDecisive = !!(opts.colorHitCount > 0 && colorLimitsOther
            && otherMinRatio <= t9vRatio + Math.max(1, t9vRatio * 0.01));

        return {
            group,
            binderId: binder.id,
            finalTotal,
            attributed,
            colorLimitsOther,
            colorDecisive
        };
    }

    function scaledBucketTotals(bucketWeighted, finalTotal) {
        const agg = aggregateBucketTotals(bucketWeighted);
        const rawTotal = agg.t9v + agg.colors + agg.metrics + agg.rest;
        if (rawTotal <= 0 || finalTotal <= 0) return agg;
        return {
            t9v: Math.round(finalTotal * (agg.t9v / rawTotal)),
            colors: Math.round(finalTotal * (agg.colors / rawTotal)),
            metrics: Math.round(finalTotal * (agg.metrics / rawTotal)),
            rest: Math.round(finalTotal * (agg.rest / rawTotal))
        };
    }

    function blendGostergeScoreTotals(bucketWeighted) {
        if (METRIC_SWEEP_FOCUS_ID && METRIC_SWEEP_FOCUS_SHARE > 0) {
            const focusShare = OTHER_SCORE_SHARE * METRIC_SWEEP_FOCUS_SHARE;
            const restShare = OTHER_SCORE_SHARE * (1 - METRIC_SWEEP_FOCUS_SHARE);
            return blendScoreBuckets([
                { weighted: bucketWeighted.t9v || 0, share: T9V_SCORE_SHARE },
                { weighted: bucketWeighted.focus || 0, share: focusShare },
                { weighted: bucketWeighted.rest || 0, share: restShare }
            ]);
        }
        return blendScoreBuckets(buildBlendBuckets(bucketWeighted).map(b => ({
            weighted: b.weighted,
            share: b.share
        })));
    }

    function aggregateBucketTotals(bucketWeighted) {
        let metrics = 0;
        for (const id of Object.keys(OTHER_METRIC_SHARES)) {
            metrics += bucketWeighted[id] || 0;
        }
        return {
            t9v: bucketWeighted.t9v || 0,
            colors: bucketWeighted.colors || 0,
            metrics,
            rest: bucketWeighted.rest || 0
        };
    }

    function termBucketId(term) {
        const base = String(term.metricId || '').replace(/__dp\d+$/, '');
        if (base === 't9v') return 't9v';
        if (base === '_colorGosterge') return 'colors';
        if (OTHER_METRIC_SHARES[base]) return 'metrics';
        return 'rest';
    }

    function distributeBucketPoints(group, target) {
        if (!group?.length || target <= 0) {
            if (group) group.forEach(t => { t.points = 0; });
            return;
        }
        const raw = group.reduce((s, t) => s + (t.points || 0), 0);
        if (raw <= 0) {
            group[0].points = Math.round(target);
            for (let i = 1; i < group.length; i++) group[i].points = 0;
            return;
        }
        let assigned = 0;
        for (let i = 0; i < group.length; i++) {
            if (i === group.length - 1) {
                group[i].points = Math.max(0, Math.round(target - assigned));
            } else {
                const p = Math.round((group[i].points / raw) * target);
                group[i].points = p;
                assigned += p;
            }
        }
    }

    function scaleTermPoints(terms, bucketWeighted, finalTotal) {
        const agg = aggregateBucketTotals(bucketWeighted);
        const rawTotal = agg.t9v + agg.colors + agg.metrics + agg.rest;
        const scaled = scaledBucketTotals(bucketWeighted, finalTotal);
        if (rawTotal <= 0) return scaled;
        if (!terms.length) return scaled;
        if (finalTotal === rawTotal) return scaled;

        const targets = {
            t9v: scaled.t9v,
            colors: scaled.colors,
            metrics: scaled.metrics,
            rest: scaled.rest
        };
        const groups = { t9v: [], colors: [], metrics: [], rest: [] };
        for (const term of terms) {
            groups[termBucketId(term)].push(term);
        }
        for (const key of Object.keys(groups)) {
            distributeBucketPoints(groups[key], targets[key]);
        }
        terms.sort((a, b) => b.points - a.points);
        return scaled;
    }

    function scoreEntryForMetric(entry, m, ladder) {
        if (!ladder?.length) return { score: 0, bestRule: null, hits: [] };

        const matchById = calibration?.liveMatchers?.[m.id];
        let best = null;
        const hits = [];
        for (const rule of ladder) {
            let matched = false;
            if (matchById?.has(rule.id)) {
                const fn = matchById.get(rule.id);
                matched = !!(fn && fn(entry));
            } else if (typeof rule.match === 'function') {
                matched = !!rule.match(entry);
            }
            if (!matched) continue;
            hits.push(rule);
            if (!best || rule.points > best.points) best = rule;
        }

        let score = best ? best.points : 0;
        if (hits.length > 1) score += Math.round(hits.length * 8);
        return { score, bestRule: best, hits };
    }

    /** Renk gösterge — hit başına ortalama puan (metrik ölçeğiyle uyumlu) */
    function colorScoreForBucket(rawColorScore, hitCount) {
        const hits = Math.max(0, hitCount || 0);
        if (!hits) return 0;
        const perHit = Math.round((rawColorScore || 0) / hits);
        return Math.max(1, perHit);
    }

    function scoreColorGostergeHits(entry, ladder, matchMode) {
        if (!ladder?.length) return { score: 0, hits: [] };
        const hits = [];
        for (const rule of ladder) {
            if (rule.match && rule.match(entry)) hits.push(rule);
        }
        if (!hits.length) return { score: 0, hits: [] };
        let score = 0;
        if (matchMode === 'sum') {
            for (const h of hits) score += h.points || 0;
        } else {
            score = Math.max(...hits.map(h => h.points || 0));
        }
        return { score, hits };
    }

    function computeRowTahminWithOptions(entry, scoringOptions) {
        if (!calibration) {
            return { score: 0, pct: null, rank: null, terms: [], topTerms: [], source: 'none', metricCount: 0 };
        }

        const opts = scoringOptions || {};
        const colorMode = opts.colorMode || 'legacy';
        const colorLadder = opts.colorLadder || null;
        const colorMatchMode = opts.colorMatchMode || 'best';

        const terms = [];
        const bucketWeighted = { t9v: 0, colors: 0, focus: 0, rest: 0 };
        for (const id of Object.keys(OTHER_METRIC_SHARES)) bucketWeighted[id] = 0;

        for (const m of calibration.metrics) {
            const ladder = calibration.ladders[m.id];
            if (!ladder?.length) continue;
            const { score, bestRule, hits } = scoreEntryForMetric(entry, m, ladder);
            if (!bestRule) continue;
            const w = metricWeight(m);
            const weighted = Math.round((score * w) / 1000);
            const baseId = metricBaseId(m);
            if (isT9vScoreMetric(m)) bucketWeighted.t9v += weighted;
            else if (isFocusScoreMetric(m)) bucketWeighted.focus += weighted;
            else if (colorMode === 'legacy' && !METRIC_SWEEP_FOCUS_ID && isColorRule(bestRule.id)) {
                bucketWeighted.colors += weighted;
            } else if (!METRIC_SWEEP_FOCUS_ID && otherMetricShare(baseId) > 0) {
                bucketWeighted[baseId] += weighted;
            } else bucketWeighted.rest += weighted;
            terms.push({
                metricId: m.id,
                metricLabel: m.label,
                ruleId: bestRule.id,
                ruleLabel: bestRule.label,
                ruleRank: bestRule.rank,
                ruleSuccess: bestRule.successRate,
                hitCount: hits.length,
                points: weighted,
                label: m.label + ' · ' + bestRule.label
            });
        }

        let colorHitCount = 0;
        if (colorMode === 'gosterge' && colorLadder?.length) {
            const { score: colorScore, hits: colorHits } = scoreColorGostergeHits(entry, colorLadder, colorMatchMode);
            colorHitCount = colorHits.length;
            const colorWeighted = colorScoreForBucket(colorScore, colorHitCount);
            if (colorWeighted > 0) {
                bucketWeighted.colors += colorWeighted;
                const top = colorHits.reduce((a, b) => (b.points > (a?.points || 0) ? b : a), colorHits[0]);
                terms.push({
                    metricId: '_colorGosterge',
                    metricLabel: 'Renk gösterge',
                    ruleId: top?.id || 'color',
                    ruleLabel: top?.label || 'Renk gösterge',
                    ruleRank: top?.rank || 0,
                    ruleSuccess: top?.successRate || 0,
                    hitCount: colorHits.length,
                    points: colorWeighted,
                    label: colorHits.length > 1
                        ? 'Renk · ' + colorHits.length + ' eşleşme (toplam)'
                        : 'Renk · ' + (top?.label || 'gösterge')
                });
            }
        }

        terms.sort((a, b) => b.points - a.points);
        for (const term of terms) term.rawPoints = term.points;
        const totalScore = blendGostergeScoreTotals(bucketWeighted);
        const binding = computeScoreBinding(bucketWeighted, { colorHitCount });
        const buckets = scaleTermPoints(terms, bucketWeighted, totalScore);
        const rawBuckets = aggregateBucketTotals(bucketWeighted);

        return {
            score: totalScore,
            pct: null,
            rank: null,
            terms,
            topTerms: terms.slice(0, 8),
            metricCount: terms.length,
            source: 'gosterge',
            buckets,
            rawBuckets,
            attributedBuckets: binding.attributed,
            bindingBucket: binding.group,
            bindingId: binding.binderId,
            colorHitCount,
            colorLimitsOther: binding.colorLimitsOther,
            colorDecisive: binding.colorDecisive
        };
    }

    function computeRowTahmin(entry) {
        return computeRowTahminWithOptions(entry, getDefaultColorScoringOptions());
    }

    function rankRaceEntriesWithOptions(entries, scoringOptions) {
        const scored = entries.map(entry => {
            const tahmin = computeRowTahminWithOptions(entry, scoringOptions);
            entry.row.tahmin = tahmin;
            return { entry, tahmin, row: entry.row };
        });
        return finalizeRaceScores(scored);
    }

    function applyScoringOptionsToFlatEntries(flatEntries, scoringOptions) {
        if (!calibration || !flatEntries?.length) return;
        const byRace = new Map();
        for (const entry of flatEntries) {
            const rk = String(entry.kayitId) + '|' + entry.raceNo;
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(entry);
        }
        for (const group of byRace.values()) {
            rankRaceEntriesWithOptions(group, scoringOptions);
        }
    }

    function assignColorLadderPoints(rows) {
        const n = rows.length;
        for (let i = 0; i < n; i++) {
            rows[i].rank = i + 1;
            rows[i].points = Math.max(1, Math.round((n - i) * 80 + (rows[i].successRate || 0) * 500));
        }
        return rows;
    }

    function buildColorGostergeLadder(allRows, opts) {
        opts = opts || {};
        const topN = opts.topN || 50;
        const minSample = opts.minSample != null ? opts.minSample : MIN_RULE_SAMPLE;
        let rows = (allRows || []).filter(r =>
            r.match && (r.stats?.withBitis || 0) >= minSample
        );
        if (!opts.includeRaceRank) rows = rows.filter(r => r.statKind !== 'raceRank');
        if (!opts.includeDepth) rows = rows.filter(r => r.mode !== 'depthPair');
        rows = PtestGostergeEngine.sortColorGostergeRows(rows).slice(0, topN);
        return assignColorLadderPoints(rows);
    }

    function collectAllColorGostergeRows(flatEntries, host) {
        if (typeof PtestColorGostergeExport !== 'undefined' && PtestColorGostergeExport.collectAllColorRows) {
            return PtestColorGostergeExport.collectAllColorRows(flatEntries, host, {
                successBlend: SUCCESS_BLEND
            });
        }
        return [];
    }

    function evaluateTahminSuccess(flatEntries, bitisValueForSort, successBlend) {
        const blend = successBlend || SUCCESS_BLEND;
        const byRace = new Map();
        for (const entry of flatEntries) {
            const rk = String(entry.kayitId) + '|' + entry.raceNo;
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(entry);
        }

        let leaderB1 = 0;
        let leaderB12 = 0;
        let leaderB123 = 0;
        let leaderTotal = 0;
        let exact = 0;
        let exactTotal = 0;

        for (const group of byRace.values()) {
            group.sort((a, b) => {
                const sa = a.row?.tahmin?.score ?? 0;
                const sb = b.row?.tahmin?.score ?? 0;
                if (sb !== sa) return sb - sa;
                return (a.row?.no ?? 0) - (b.row?.no ?? 0);
            });
            const leader = group[0];
            const lb = bitisValueForSort?.(leader);
            if (lb != null && lb >= 1) {
                leaderTotal++;
                if (lb === 1) leaderB1++;
                if (lb <= 2) leaderB12++;
                if (lb <= 3) leaderB123++;
            }
        }

        for (const entry of flatEntries) {
            const b = bitisValueForSort?.(entry);
            if (b == null || b < 1) continue;
            exactTotal++;
            const rank = entry.row?.tahmin?.rank;
            if (rank != null && Number(rank) === Number(b)) exact++;
        }

        const leaderBlended = leaderTotal
            ? blend.b1 * (leaderB1 / leaderTotal)
                + blend.b12 * (leaderB12 / leaderTotal)
                + blend.b123 * (leaderB123 / leaderTotal)
            : 0;

        return {
            leaderTotal,
            leaderB1,
            leaderB12,
            leaderB123,
            leaderB1Rate: leaderTotal ? leaderB1 / leaderTotal : 0,
            leaderB12Rate: leaderTotal ? leaderB12 / leaderTotal : 0,
            leaderB123Rate: leaderTotal ? leaderB123 / leaderTotal : 0,
            leaderBlended,
            exact,
            exactTotal,
            exactRate: exactTotal ? exact / exactTotal : 0
        };
    }

    function evaluateColorScoringConfig(flatEntries, host, config, allColorRows) {
        if (!calibration) return null;
        const saved = flatEntries.map(e => e.row.tahmin);
        let scoringOptions;
        if (config?.legacy) {
            scoringOptions = { colorMode: 'legacy' };
        } else {
            const ladder = buildColorGostergeLadder(allColorRows, config);
            scoringOptions = {
                colorMode: 'gosterge',
                colorLadder: ladder,
                colorMatchMode: config.matchMode || 'best'
            };
        }
        applyScoringOptionsToFlatEntries(flatEntries, scoringOptions);
        const stats = evaluateTahminSuccess(flatEntries, host.bitisValueForSort, SUCCESS_BLEND);
        flatEntries.forEach((e, i) => { e.row.tahmin = saved[i]; });
        return {
            config,
            ladderCount: config?.legacy ? 7 : (scoringOptions.colorLadder?.length || 0),
            ...stats
        };
    }

    async function runColorScoringBenchmark(flatEntries, host, configs, onProgress) {
        if (!calibration) return [];
        onProgress?.('Renk gösterge listesi toplanıyor…');
        await yieldToMain();
        const allColorRows = collectAllColorGostergeRows(flatEntries, host);
        const results = [];
        for (let i = 0; i < configs.length; i++) {
            onProgress?.('Test ' + (i + 1) + '/' + configs.length + ': ' + (configs[i].label || configs[i].id));
            results.push(evaluateColorScoringConfig(flatEntries, host, configs[i], allColorRows));
            if (i % 3 === 2) await yieldToMain();
        }
        results.sort((a, b) => {
            if (b.leaderBlended !== a.leaderBlended) return b.leaderBlended - a.leaderBlended;
            return b.exactRate - a.exactRate;
        });
        return { results, allColorRowsCount: allColorRows.length };
    }

    function generateColorBenchmarkConfigs() {
        const configs = [{
            id: 'legacy',
            label: 'Mevcut · 7 sabit renk kuralı',
            legacy: true
        }];
        const topNs = [50, 80, 100];
        const matchModes = [
            { id: 'best', label: 'En iyi tek' },
            { id: 'sum', label: 'Toplam' }
        ];
        for (const topN of topNs) {
            for (const mm of matchModes) {
                for (const includeDepth of [false, true]) {
                    for (const includeRaceRank of [false, true]) {
                        configs.push({
                            id: 'n' + topN + '_' + mm.id + (includeDepth ? '_d' : '_nd') + (includeRaceRank ? '_r' : '_nr'),
                            label: 'Top-' + topN + ' · ' + mm.label
                                + (includeDepth ? ' · derinlik' : '')
                                + (includeRaceRank ? ' · raceRank' : ''),
                            topN,
                            matchMode: mm.id,
                            includeDepth,
                            includeRaceRank,
                            legacy: false
                        });
                    }
                }
            }
        }
        return configs;
    }

    function finalizeRaceScores(scored) {
        const maxScore = Math.max(...scored.map(s => s.tahmin.score), 1);
        for (const s of scored) {
            s.tahmin.pct = s.tahmin.score > 0
                ? Math.round((s.tahmin.score / maxScore) * 100)
                : null;
        }
        scored.sort((a, b) => {
            const sa = a.tahmin.score;
            const sb = b.tahmin.score;
            if (sb !== sa) return sb - sa;
            const na = a.row?.no ?? a.entry?.row?.no ?? 0;
            const nb = b.row?.no ?? b.entry?.row?.no ?? 0;
            return na - nb;
        });
        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
        }
        return scored;
    }

    function rankRaceEntries(entries) {
        const scored = entries.map(entry => {
            const tahmin = computeRowTahmin(entry);
            entry.row.tahmin = tahmin;
            return { entry, tahmin, row: entry.row };
        });
        return finalizeRaceScores(scored);
    }

    function attachRaceTahmin(pkg) {
        if (!calibration || !pkg?.rows) return pkg;

        const scored = pkg.rows.map(row => {
            const tahmin = computeRowTahmin({ row });
            row.tahmin = tahmin;
            return { row, tahmin };
        });
        finalizeRaceScores(scored);

        pkg.tahminOzeti = {
            leader: scored[0]?.row?.name || null,
            leaderPct: scored[0]?.tahmin?.pct ?? null,
            leaderScore: scored[0]?.tahmin?.score ?? 0,
            horseCount: scored.length,
            source: 'gosterge',
            metricCount: scored[0]?.tahmin?.metricCount ?? 0
        };
        return pkg;
    }

    function applyToFlatEntries(flatEntries) {
        if (!calibration || !flatEntries?.length) return;
        const byRace = new Map();
        for (const entry of flatEntries) {
            const rk = String(entry.kayitId) + '|' + entry.raceNo;
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(entry);
        }
        for (const group of byRace.values()) {
            rankRaceEntries(group);
        }
    }

    function rowKeyParts(kayitId, raceNo, horseNo) {
        return String(kayitId) + '|' + raceNo + '|' + String(horseNo ?? '');
    }

    /** PUANLAMA TEST bitiş + hesaplama kayıtlarından kalibrasyon verisi oluştur */
    async function buildFlatEntriesFromApi(options) {
        const IE = options.IE || IstatistikEngine;
        const bitisRes = await fetch('/api/puanlama-bitis-sonuclari');
        const bitisJson = await bitisRes.json();
        const store = bitisJson.sonuclar || {};
        const bitisMap = store.bitis || store;

        const listRes = await fetch('/api/hesaplama-kayitlar');
        const listJson = await listRes.json();
        if (!listJson.success) throw new Error(listJson.error || 'Kayıt listesi alınamadı');
        const kayitlar = listJson.kayitlar || [];

        const flat = [];
        for (let ki = 0; ki < kayitlar.length; ki++) {
            const meta = kayitlar[ki];
            const res = await fetch('/api/hesaplama-kayit/' + meta.id);
            const json = await res.json();
            if (!json.success || !json.kayit?.veri) continue;
            const kayit = json.kayit;
            const races = kayit.veri || [];
            const raceEntries = races.map((race, i) => {
                const raceNo = race.raceNo || (i + 1);
                const pkg = IE.buildRaceIstatistikPackage(race, kayit.hipodrom, kayit.tarih);
                return { race, raceNo, pkg };
            });
            if (raceEntries.length) IE.applyProgramGlobalPctScales(raceEntries.map(e => e.pkg));
            for (const { raceNo, pkg } of raceEntries) {
                for (const row of pkg.rows) {
                    row._extraSectionMeta = (pkg.extraSections || []).map(sec => ({
                        id: sec.id,
                        label: sec.label,
                        depthsKey: sec.depthsKey
                    }));
                    const key = rowKeyParts(kayit.id, raceNo, row.no);
                    const bitisRaw = bitisMap[key];
                    const fromName = AtSpeedUtils.extractBitisFromHorseName(row.name);
                    const bitisPos = bitisRaw != null && bitisRaw >= 1 ? bitisRaw : fromName;
                    flat.push({
                        row,
                        tarih: kayit.tarih,
                        raceNo,
                        hipodrom: kayit.hipodrom,
                        kayitId: kayit.id,
                        _bitisPos: bitisPos != null && bitisPos >= 1 ? bitisPos : null
                    });
                }
            }
            if (ki > 0 && ki % 3 === 0) await yieldToMain();
        }
        return { flatEntries: flat, bitisMap };
    }

    function makeBitisHost(flatEntries, bitisMap, buildBitisStatsFromEntries) {
        return {
            flatEntries,
            buildBitisStatsFromEntries,
            bitisValueForSort(entry) {
                const key = rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no);
                const v = bitisMap[key];
                if (v != null && v >= 1) return v;
                if (entry._bitisPos != null && entry._bitisPos >= 1) return entry._bitisPos;
                return AtSpeedUtils.extractBitisFromHorseName(entry.row?.name);
            },
            countUniqueRaces: () => new Set(flatEntries.map(e => e.kayitId + '|' + e.raceNo)).size,
            raceKey: (kayitId, raceNo) => String(kayitId) + '|' + raceNo
        };
    }

    async function loadAndCalibrateFromApi(buildBitisStatsFromEntries) {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromApi({ IE: IstatistikEngine });
        const host = makeBitisHost(flatEntries, bitisMap, buildBitisStatsFromEntries);
        return await calibrate(flatEntries, host);
    }

    function renderCalibrationHtml() {
        if (!calibration) {
            return '<p class="ptest-scoring-empty">Bitiş verisi girildikten sonra gösterge puanlama merdiveni oluşur.</p>';
        }

        const blend = calibration.successBlend || SUCCESS_BLEND;
        const shareSplit = getScoreShareSplit();
        let shareParts = [
            'T9V %' + shareSplit.t9v,
            'Renkler %' + shareSplit.colors,
            'Metrikler %' + shareSplit.metrics,
            'rest %' + shareSplit.rest
        ];
        const shareInfo = getOtherMetricShares();
        const sortedIds = Object.keys(OTHER_METRIC_SHARE_PCT).sort((a, b) =>
            OTHER_METRIC_SHARE_PCT[b] - OTHER_METRIC_SHARE_PCT[a]);
        for (const id of sortedIds.slice(0, 4)) {
            const info = shareInfo[id];
            if (info) shareParts.push(info.label + ' %' + info.pctOfTotal);
        }
        if (sortedIds.length > 4) shareParts.push('+' + (sortedIds.length - 4) + ' metrik');
        const colorCfg = calibration.colorGostergeConfig;
        if (calibration.colorLadder?.length && colorCfg) {
            shareParts[1] += ' · Top-' + colorCfg.topN + ' Toplam'
                + (colorCfg.includeDepth ? '+derinlik' : '');
        }
        let h = '<div class="ptest-scoring-meta">📊 Gösterge puanlama · '
            + calibration.bitisRows + ' bitişli / ' + calibration.totalRows + ' satır · '
            + 'başarı: %' + Math.round(blend.b1 * 100) + ' 1. · %' + Math.round(blend.b12 * 100) + ' 1–2 · %'
            + Math.round(blend.b123 * 100) + ' 1–3 · ' + shareParts.join(' · ') + '</div>';
        h += '<details class="ptest-scoring-share-table"><summary>Pay dağılımı · T9V %' + shareSplit.t9v
            + ' · Renkler %' + shareSplit.colors + ' · Metrikler %' + shareSplit.metrics
            + ' · rest %' + shareSplit.rest + '</summary>';
        h += '<table class="ptest-scoring-table"><thead><tr>'
            + '<th>Kova</th><th>%' + Math.round(OTHER_SCORE_SHARE * 100) + ' içi</th><th>Toplam ~%</th></tr></thead><tbody>';
        h += '<tr><td><strong>T9V</strong></td><td>—</td><td>' + shareSplit.t9v + '</td></tr>';
        h += '<tr><td><strong>Renkler</strong> (Top-' + (colorCfg?.topN || '?') + ' export · Toplam'
            + (colorCfg?.includeDepth ? ' · derinlik' : '') + ')</td><td>'
            + shareInfo._colors.pctWithin65 + '</td><td>' + shareInfo._colors.pctOfTotal + '</td></tr>';
        h += '<tr><td colspan="3"><em>Metrik dilimi (%' + Math.round(OTHER_SCORE_SHARE * 100)
            + ' × ' + shareSplit.metrics + '/' + Math.round(OTHER_SCORE_SHARE * 100)
            + ' ≈ ' + shareInfo._metricSlice.pctOfTotal + ' toplam)</em></td></tr>';
        for (const id of Object.keys(OTHER_METRIC_SHARE_PCT)) {
            const info = shareInfo[id];
            h += '<tr><td>' + AtSpeedUtils.escapeHtml(info.label) + '</td><td>'
                + info.pctWithinMetricSlice + '</td><td>' + info.pctOfTotal + '</td></tr>';
        }
        if (shareInfo._rest?.frac > 0) {
            h += '<tr><td>' + AtSpeedUtils.escapeHtml(shareInfo._rest.label || 'rest') + '</td><td>'
                + shareInfo._rest.pctWithin65 + '</td><td>' + shareInfo._rest.pctOfTotal + '</td></tr>';
        }
        h += '</tbody></table></details>';

        if (calibration.colorLadder?.length) {
            h += renderMetricLadderBlock(
                'Renk gösterge · Top-' + (colorCfg?.topN || calibration.colorLadder.length)
                    + ' · Toplam · %' + shareSplit.colors + ' kova',
                calibration.colorLadder,
                true
            );
        }

        const shown = new Set();
        for (const m of calibration.metrics) {
            if (m.mode === 'depthPair') continue;
            const ladder = calibration.ladders[m.id] || [];
            if (!ladder.length || shown.has(m.id)) continue;
            shown.add(m.id);
            h += renderMetricLadderBlock(m.label, ladder);

            for (const dm of calibration.metrics.filter(x => x.mode === 'depthPair' && x.spec.id === m.spec.id)) {
                const dl = calibration.ladders[dm.id] || [];
                if (dl.length) h += renderMetricLadderBlock(dm.label, dl, false);
            }
        }
        return h || '<p>Yeterli bitiş örneği yok (gösterge başına min ' + MIN_RULE_SAMPLE + ').</p>';
    }

    function renderMetricLadderBlock(title, ladder, open) {
        if (open == null) open = true;
        let h = '<details class="ptest-scoring-metric-block"' + (open ? ' open' : '') + '>';
        h += '<summary class="ptest-scoring-metric-summary">' + AtSpeedUtils.escapeHtml(title)
            + ' · ' + ladder.length + ' gösterge</summary>';
        h += '<table class="ptest-scoring-table"><thead><tr>'
            + '<th>#</th><th>Gösterge</th><th>Başarı</th><th>1.</th><th>1–2</th><th>n</th><th>Puan</th>'
            + '</tr></thead><tbody>';
        for (const rule of ladder.slice(0, 15)) {
            h += '<tr><td>' + rule.rank + '</td><td>' + AtSpeedUtils.escapeHtml(rule.label) + '</td>'
                + '<td>' + (rule.successRate * 100).toFixed(1) + '%</td>'
                + '<td>' + (rule.b1Rate * 100).toFixed(1) + '%</td>'
                + '<td>' + (rule.b12Rate * 100).toFixed(1) + '%</td>'
                + '<td>' + rule.stats.withBitis + '</td><td>' + rule.points + '</td></tr>';
        }
        if (ladder.length > 15) {
            h += '<tr><td colspan="7">… +' + (ladder.length - 15) + ' gösterge</td></tr>';
        }
        h += '</tbody></table></details>';
        return h;
    }

    function getCalibration() {
        return calibration;
    }

    function isCalibrated() {
        return !!(calibration && calibration.bitisRows >= MIN_RULE_SAMPLE);
    }

    function isScoringReady(flatEntries, bitisValueForSort) {
        if (isCalibrated()) return true;
        if (!calibration?.metrics?.length || !flatEntries?.length) return false;
        let bitis = 0;
        let scored = 0;
        for (const entry of flatEntries) {
            if (bitisValueForSort?.(entry) != null) bitis++;
            const t = entry.row?.tahmin;
            if (t?.source === 'gosterge' && ((t.terms?.length || 0) > 0 || (t.score || 0) > 0)) scored++;
        }
        return bitis >= MIN_RULE_SAMPLE && scored >= MIN_RULE_SAMPLE;
    }

    function diagnoseColorScoring(flatEntries) {
        if (!calibration || !flatEntries?.length) return null;
        const opts = getDefaultColorScoringOptions();
        const ladder = opts.colorLadder || [];
        let withHits = 0;
        let withWeight = 0;
        let totalHits = 0;
        let bucketSum = 0;
        let usedTahmin = 0;
        let colorBinding = 0;
        let colorBindingStrict = 0;
        let colorLimitsOther = 0;
        for (const entry of flatEntries) {
            const t = entry.row?.tahmin;
            if (t?.bindingBucket === 'colors') colorBindingStrict++;
            if (t?.colorLimitsOther) colorLimitsOther++;
            if (t?.bindingBucket === 'colors') colorBinding++;
            else if (!t?.bindingBucket && t?.buckets) {
                let best = null;
                let bestVal = -1;
                for (const id of ['t9v', 'colors', 'metrics', 'rest']) {
                    const v = t.buckets[id] || 0;
                    if (v > bestVal) { bestVal = v; best = id; }
                }
                if (best === 'colors') colorBinding++;
            }
            if (t?.buckets || t?.colorHitCount != null) {
                usedTahmin++;
                const hits = t.colorHitCount || 0;
                const w = (t.attributedBuckets?.colors || t.buckets?.colors || 0);
                if (hits > 0) {
                    withHits++;
                    totalHits += hits;
                }
                if (w > 0) {
                    withWeight++;
                    bucketSum += w;
                }
                continue;
            }
            const { score, hits } = scoreColorGostergeHits(entry, ladder, opts.colorMatchMode || 'sum');
            const w = colorScoreForBucket(score, hits.length);
            if (hits.length) {
                withHits++;
                totalHits += hits.length;
            }
            if (w > 0) {
                withWeight++;
                bucketSum += w;
            }
        }
        const n = flatEntries.length;
        return {
            colorMode: opts.colorMode,
            matchMode: opts.colorMatchMode || COLOR_GOSTERGE_CONFIG.matchMode,
            ladderSize: ladder.length,
            allColorRowsCount: calibration.allColorRowsCount || 0,
            horses: n,
            withColorHits: withHits,
            withColorWeight: withWeight,
            hitRate: n ? withHits / n : 0,
            weightRate: n ? withWeight / n : 0,
            avgHitsWhenMatched: withHits ? totalHits / withHits : 0,
            avgColorBucketWeight: withWeight ? bucketSum / withWeight : 0,
            colorBinding,
            colorBindingRate: n ? colorBinding / n : 0,
            colorBindingStrict,
            colorBindingStrictRate: n ? colorBindingStrict / n : 0,
            colorLimitsOther,
            colorLimitsOtherRate: n ? colorLimitsOther / n : 0,
            fromTahminCache: usedTahmin
        };
    }

    return {
        calibrate,
        attachRaceTahmin,
        applyToFlatEntries,
        computeRowTahmin,
        computeRowTahminWithOptions,
        applyScoringOptionsToFlatEntries,
        buildColorGostergeLadder,
        collectAllColorGostergeRows,
        evaluateTahminSuccess,
        evaluateColorScoringConfig,
        runColorScoringBenchmark,
        generateColorBenchmarkConfigs,
        getDefaultColorScoringOptions,
        COLOR_GOSTERGE_CONFIG,
        renderCalibrationHtml,
        diagnoseColorScoring,
        isScoringReady,
        aggregateBucketTotals,
        loadAndCalibrateFromApi,
        buildFlatEntriesFromApi,
        makeBitisHost,
        setSuccessBlend,
        setT9vScoreShare,
        getT9vScoreShare,
        setScoreShareSplit,
        getScoreShareSplit,
        resetScoreShareSplit,
        evaluateShareSplit,
        compareShareSplit,
        runShareSplitSweep,
        generateShareSplitSweepConfigs,
        DEFAULT_SCORE_SHARE_SPLIT,
        setMetricSweepFocus,
        clearMetricSweepFocus,
        getMetricSweepFocus,
        getOtherMetricShares,
        getCoreOtherMetricShares,
        OTHER_METRIC_SHARE_PCT,
        OTHER_METRIC_SHARES,
        get COLOR_OTHER_SHARE() { return COLOR_OTHER_SHARE; },
        get METRIC_OTHER_SHARE() { return METRIC_OTHER_SHARE; },
        get REST_OTHER_SHARE() { return REST_OTHER_SHARE; },
        COLOR_RULE_IDS,
        isColorRule,
        collectSonDeltaMetrics,
        MIN_RULE_SAMPLE,
        SUCCESS_BLEND: () => ({ ...SUCCESS_BLEND }),
        get T9V_SCORE_SHARE() { return T9V_SCORE_SHARE; },
        get OTHER_SCORE_SHARE() { return OTHER_SCORE_SHARE; }
    };
})();

const PtestGostergeScoringEngine = GostergeScoringEngine;

if (typeof module !== 'undefined') module.exports = GostergeScoringEngine;
