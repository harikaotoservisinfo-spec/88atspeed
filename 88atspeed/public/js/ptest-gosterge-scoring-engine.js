/**
 * PUANLAMA TEST — gösterge bitiş başarısına göre TAHMİN puanlama.
 * Her metrik grubu için göstergeler bitiş verisinden sıralanır; atlar eşleşen en iyi göstergeye göre puanlanır.
 */
const PtestGostergeScoringEngine = (function () {
    const MIN_RULE_SAMPLE = 5;
    const SUCCESS_BLEND = { b1: 0.55, b12: 0.30, b123: 0.15 };

    let calibration = null;

    function collectMetrics(flatEntries) {
        const core = PtestGostergeEngine.METRICS.map(m => ({ id: m.id, label: m.label, spec: m }));
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
                    }
                });
            }
        }
        return core.concat(extras);
    }

    function blendedSuccess(stats) {
        if (!stats.withBitis) return 0;
        const t = stats.withBitis;
        return SUCCESS_BLEND.b1 * (stats.b1 / t)
            + SUCCESS_BLEND.b12 * (stats.b12 / t)
            + SUCCESS_BLEND.b123 * (stats.b123 / t);
    }

    function buildRuleCatalog(ctx) {
        const rules = [];
        const colors = [
            { id: 'yesilHucre', label: '🟢 Yeşil hücre', match: e => ctx.primaryMatchesRule(e, 'yesilHucre') },
            { id: 'turuncuHucre', label: '🟠 Turuncu hücre', match: e => ctx.primaryMatchesRule(e, 'turuncuHucre') },
            { id: 'turuncuCevre', label: '🟠 Turuncu çevre', match: e => ctx.primaryMatchesRule(e, 'turuncuCevre') },
            { id: 'sariYazi', label: '🟡 Sarı yazı', match: e => ctx.primaryVisualFlags(e).sariYazi },
            { id: 'kirmiziIc', label: '🔴 Kırmızı iç', match: e => ctx.primaryVisualFlags(e).kirmiziIc },
            { id: 'acikYesilIc', label: '🟢 Açık yeşil iç', match: e => ctx.primaryVisualFlags(e).acikYesilIc },
            { id: 'koyuYesilIc', label: '🟩 Koyu yeşil iç', match: e => ctx.primaryVisualFlags(e).koyuYesilIc }
        ];
        rules.push(...colors);

        const deltaBuckets = PtestGostergeEngine._YESIL_DELTA_SORT_BUCKETS || [];
        for (const b of deltaBuckets) {
            rules.push({
                id: 'delta_' + b.id,
                label: b.label,
                match: e => ctx.primaryMatchesRule(e, b.id)
            });
        }

        for (let pct = 1; pct <= 25; pct++) {
            const p = pct;
            rules.push({
                id: 't1sari_' + p,
                label: 'T1×DR sarı %' + p,
                match: e => ctx.t1SariMatchesPct(e, p)
            });
        }

        return rules;
    }

    function calibrateMetric(spec, flatEntries, host) {
        const ctx = PtestGostergeEngine.createContext(spec, host);
        const rules = buildRuleCatalog(ctx);
        const ranked = [];

        for (const rule of rules) {
            const matched = [];
            for (const entry of flatEntries) {
                if (rule.match(entry)) matched.push(entry);
            }
            const stats = host.buildBitisStatsFromEntries(matched);
            if (stats.withBitis < MIN_RULE_SAMPLE) continue;
            ranked.push({
                id: rule.id,
                label: rule.label,
                match: rule.match,
                stats,
                successRate: blendedSuccess(stats),
                b1Rate: stats.b1 / stats.withBitis,
                b12Rate: stats.b12 / stats.withBitis
            });
        }

        ranked.sort((a, b) => {
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            if (b.stats.withBitis !== a.stats.withBitis) return b.stats.withBitis - a.stats.withBitis;
            return b.b1Rate - a.b1Rate;
        });

        const n = ranked.length;
        for (let i = 0; i < n; i++) {
            const item = ranked[i];
            item.rank = i + 1;
            const tier = n - i;
            item.points = Math.max(1, Math.round(tier * 80 + item.successRate * 500));
        }

        return ranked;
    }

    function calibrate(flatEntries, host) {
        if (!flatEntries?.length || !host?.buildBitisStatsFromEntries) {
            calibration = null;
            return null;
        }

        const metrics = collectMetrics(flatEntries);
        const ladders = {};
        let bitisRows = 0;

        for (const entry of flatEntries) {
            if (host.bitisValueForSort?.(entry) != null) bitisRows++;
        }

        for (const m of metrics) {
            ladders[m.id] = calibrateMetric(m.spec, flatEntries, host);
        }

        calibration = {
            ladders,
            metrics,
            bitisRows,
            totalRows: flatEntries.length,
            calibratedAt: Date.now()
        };
        return calibration;
    }

    function metricWeight(metricId) {
        if (typeof IstatistikTahminEngine !== 'undefined' && IstatistikTahminEngine.getMetricGroupWeight) {
            return IstatistikTahminEngine.getMetricGroupWeight(metricId);
        }
        return 1000;
    }

    function scoreEntry(entry, spec, ladder) {
        if (!ladder?.length) return { score: 0, bestRule: null, hits: [] };

        const ctx = PtestGostergeEngine.createContext(spec, {
            flatEntries: [entry],
            buildBitisStatsFromEntries: () => ({ matchedRows: 0, withBitis: 0, b1: 0, b12: 0, b123: 0, b4: 0, bOut: 0 }),
            countUniqueRaces: () => 1,
            raceKey: () => ''
        });

        let best = null;
        const hits = [];
        for (const rule of ladder) {
            if (!rule.match(entry)) continue;
            hits.push(rule);
            if (!best || rule.points > best.points) best = rule;
        }

        let score = best ? best.points : 0;
        if (hits.length > 1) score += Math.round(hits.length * 8);

        return { score, bestRule: best, hits };
    }

    function computeRowTahmin(entry) {
        if (!calibration) {
            return { score: 0, pct: null, rank: null, terms: [], topTerms: [], source: 'none' };
        }

        const terms = [];
        let totalScore = 0;

        for (const m of calibration.metrics) {
            const ladder = calibration.ladders[m.id];
            if (!ladder?.length) continue;
            const { score, bestRule, hits } = scoreEntry(entry, m.spec, ladder);
            if (!bestRule) continue;
            const w = metricWeight(m.id);
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
                points: weighted
            });
        }

        terms.sort((a, b) => b.points - a.points);
        return {
            score: totalScore,
            pct: null,
            rank: null,
            terms,
            topTerms: terms.slice(0, 8),
            source: 'gosterge'
        };
    }

    function rankRaceEntries(entries) {
        const scored = entries.map(entry => {
            const tahmin = computeRowTahmin(entry);
            entry.row.tahmin = tahmin;
            return { entry, tahmin };
        });

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
            return (a.entry.row.no || 0) - (b.entry.row.no || 0);
        });

        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
        }
        return scored;
    }

    function attachRaceTahmin(pkg) {
        if (!calibration || !pkg?.rows) return pkg;

        const scored = pkg.rows.map(row => {
            const entry = { row };
            const tahmin = computeRowTahmin(entry);
            row.tahmin = tahmin;
            return { row, tahmin };
        });

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
            return (a.row.no || 0) - (b.row.no || 0);
        });

        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
        }

        pkg.tahminOzeti = {
            leader: scored[0]?.row?.name || null,
            leaderPct: scored[0]?.tahmin?.pct ?? null,
            leaderScore: scored[0]?.tahmin?.score ?? 0,
            horseCount: scored.length,
            source: 'gosterge'
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

    function renderCalibrationHtml() {
        if (!calibration) {
            return '<p class="ptest-scoring-empty">Bitiş verisi girildikten sonra gösterge puanlama merdiveni oluşur.</p>';
        }

        let h = '<div class="ptest-scoring-meta">📊 Gösterge puanlama · '
            + calibration.bitisRows + ' bitişli satır / ' + calibration.totalRows
            + ' toplam · her metrik grubu kendi en başarılı göstergelerine göre</div>';

        for (const m of calibration.metrics) {
            const ladder = calibration.ladders[m.id] || [];
            if (!ladder.length) continue;
            h += '<details class="ptest-scoring-metric-block" open>';
            h += '<summary class="ptest-scoring-metric-summary">' + AtSpeedUtils.escapeHtml(m.label)
                + ' · ' + ladder.length + ' gösterge</summary>';
            h += '<table class="ptest-scoring-table"><thead><tr>'
                + '<th>#</th><th>Gösterge</th><th>Başarı</th><th>1.</th><th>1–2</th><th>n</th><th>Puan</th>'
                + '</tr></thead><tbody>';
            for (const rule of ladder.slice(0, 20)) {
                const succ = (rule.successRate * 100).toFixed(1);
                const b1 = (rule.b1Rate * 100).toFixed(1);
                const b12 = (rule.b12Rate * 100).toFixed(1);
                h += '<tr><td>' + rule.rank + '</td><td>' + AtSpeedUtils.escapeHtml(rule.label) + '</td>'
                    + '<td>' + succ + '%</td><td>' + b1 + '%</td><td>' + b12 + '%</td>'
                    + '<td>' + rule.stats.withBitis + '</td><td>' + rule.points + '</td></tr>';
            }
            if (ladder.length > 20) {
                h += '<tr><td colspan="7">… +' + (ladder.length - 20) + ' gösterge daha</td></tr>';
            }
            h += '</tbody></table></details>';
        }
        return h || '<p>Yeterli bitiş örneği yok (gösterge başına min ' + MIN_RULE_SAMPLE + ').</p>';
    }

    function getCalibration() {
        return calibration;
    }

    return {
        calibrate,
        attachRaceTahmin,
        applyToFlatEntries,
        computeRowTahmin,
        renderCalibrationHtml,
        getCalibration,
        MIN_RULE_SAMPLE
    };
})();

if (typeof module !== 'undefined') module.exports = PtestGostergeScoringEngine;
