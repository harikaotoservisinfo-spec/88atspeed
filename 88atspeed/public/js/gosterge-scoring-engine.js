/**
 * Gösterge bitiş başarısına göre TAHMİN puanlama (PUANLAMA TEST + İSTATİSTİKLER).
 * SON·Δ göstergeleri + derinlik çifti (SON↔1ÖNCE…) göstergeleri · metrik grubu bazlı.
 */
const GostergeScoringEngine = (function () {
    const MIN_RULE_SAMPLE = 5;
    const DEPTH_PAIR_WEIGHT_FACTOR = 0.65;
    let SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    let calibration = null;

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
        if (!flatEntries?.length || !host?.buildBitisStatsFromEntries) {
            calibration = null;
            return null;
        }

        const metrics = collectAllScoreMetrics(flatEntries);
        const depthScales = buildDepthScales(flatEntries);
        const ladders = {};
        let bitisRows = 0;

        for (const entry of flatEntries) {
            if (host.bitisValueForSort?.(entry) != null) bitisRows++;
        }

        for (let i = 0; i < metrics.length; i++) {
            const m = metrics[i];
            ladders[m.id] = calibrateMetricEntry(m, flatEntries, host, depthScales);
            if (i > 0 && i % 4 === 0) await yieldToMain();
        }

        const liveMatchers = buildLiveMatchers(metrics, host, depthScales);

        calibration = {
            ladders,
            metrics,
            depthScales,
            liveMatchers,
            bitisRows,
            totalRows: flatEntries.length,
            successBlend: { ...SUCCESS_BLEND },
            calibratedAt: Date.now()
        };
        return calibration;
    }

    function metricWeight(metricEntry) {
        const baseId = metricEntry.spec?.id || metricEntry.id.replace(/__dp\d+$/, '');
        let w = 1000;
        if (typeof IstatistikTahminEngine !== 'undefined' && IstatistikTahminEngine.getMetricGroupWeight) {
            w = IstatistikTahminEngine.getMetricGroupWeight(baseId);
        }
        if (metricEntry.mode === 'depthPair') {
            w = Math.round(w * DEPTH_PAIR_WEIGHT_FACTOR);
        }
        return w;
    }

    function scoreEntryForMetric(entry, m, ladder) {
        if (!ladder?.length) return { score: 0, bestRule: null, hits: [] };

        const matchById = calibration?.liveMatchers?.[m.id];
        if (!matchById) return { score: 0, bestRule: null, hits: [] };

        let best = null;
        const hits = [];
        for (const rule of ladder) {
            const matchFn = matchById.get(rule.id);
            if (!matchFn || !matchFn(entry)) continue;
            hits.push(rule);
            if (!best || rule.points > best.points) best = rule;
        }

        let score = best ? best.points : 0;
        if (hits.length > 1) score += Math.round(hits.length * 8);
        return { score, bestRule: best, hits };
    }

    function computeRowTahmin(entry) {
        if (!calibration) {
            return { score: 0, pct: null, rank: null, terms: [], topTerms: [], source: 'none', metricCount: 0 };
        }

        const terms = [];
        let totalScore = 0;

        for (const m of calibration.metrics) {
            const ladder = calibration.ladders[m.id];
            if (!ladder?.length) continue;
            const { score, bestRule, hits } = scoreEntryForMetric(entry, m, ladder);
            if (!bestRule) continue;
            const w = metricWeight(m);
            const weighted = Math.round((score * w) / 1000);
            totalScore += weighted;
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

        terms.sort((a, b) => b.points - a.points);
        return {
            score: totalScore,
            pct: null,
            rank: null,
            terms,
            topTerms: terms.slice(0, 8),
            metricCount: terms.length,
            source: 'gosterge'
        };
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
        let h = '<div class="ptest-scoring-meta">📊 Gösterge puanlama · '
            + calibration.bitisRows + ' bitişli / ' + calibration.totalRows + ' satır · '
            + 'başarı: %' + Math.round(blend.b1 * 100) + ' 1. · %' + Math.round(blend.b12 * 100) + ' 1–2 · %'
            + Math.round(blend.b123 * 100) + ' 1–3 · SON·Δ + derinlik çiftleri</div>';

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

    return {
        calibrate,
        attachRaceTahmin,
        applyToFlatEntries,
        computeRowTahmin,
        renderCalibrationHtml,
        getCalibration,
        isCalibrated,
        loadAndCalibrateFromApi,
        buildFlatEntriesFromApi,
        makeBitisHost,
        setSuccessBlend,
        MIN_RULE_SAMPLE,
        SUCCESS_BLEND: () => ({ ...SUCCESS_BLEND })
    };
})();

const PtestGostergeScoringEngine = GostergeScoringEngine;

if (typeof module !== 'undefined') module.exports = GostergeScoringEngine;
