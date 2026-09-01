#!/usr/bin/env node
/**
 * Gösterge PUANLAMA — terminal tarama (at sayısına göre tam analiz)
 *
 * Renk göstergeleri, metrik merdivenleri, T9V/metrik payları ve faktör gruplarını
 * koşudaki at sayısına göre değerlendirir (PUANLAMA TEST ile aynı başarı formülü).
 *
 * Kullanım:
 *   npm run test:gosterge
 *   node scripts/test-gosterge-exhaustive.js --field-size 10
 *   node scripts/test-gosterge-exhaustive.js --phase baseline,colors,shares --quick
 *   node scripts/test-gosterge-exhaustive.js --db /var/www/88atspeed/atlar.db --top 20
 */
const fs = require('fs');
const {
    ROOT,
    ALL_METRIC_SWEEP_LIST,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    buildEntriesByFieldSize,
    pct,
    pad,
    openDb
} = require('./ptest-terminal-lib');

const cli = parseCliArgs();

function logProgress(msg) {
    if (cli.verbose) process.stderr.write(msg + '\n');
}

function blendedSuccess(stats, blend) {
    return global.PtestGostergeEngine.blendedGostergeSuccess(stats, blend);
}

function evalMatchOnSubset(matchFn, subset, host, minSample) {
    if (typeof matchFn !== 'function') return null;
    const matched = [];
    for (const e of subset) {
        if (matchFn(e)) matched.push(e);
    }
    const stats = host.buildBitisStatsFromEntries(matched);
    if ((stats.withBitis || 0) < minSample) return null;
    const blend = global.GostergeScoringEngine.SUCCESS_BLEND();
    return {
        stats,
        matched: matched.length,
        successRate: blendedSuccess(stats, blend),
        b1Rate: stats.b1 / stats.withBitis,
        b12Rate: stats.b12 / stats.withBitis,
        b123Rate: stats.b123 / stats.withBitis
    };
}

function pickColorCandidates(allColorRows, minSample, quick) {
    let pool = (allColorRows || []).filter(r => (r.stats?.withBitis || 0) >= minSample);
    if (quick) {
        pool = pool.slice(0, 4000);
    }
    return pool;
}

function rankColorRowsForSubset(colorRows, subset, host, minSample) {
    const out = [];
    for (const row of colorRows) {
        const ev = evalMatchOnSubset(row.match, subset, host, minSample);
        if (!ev) continue;
        out.push({
            label: row.label,
            metricLabel: row.metricLabel,
            mode: row.mode,
            pairLabel: row.pairLabel || '',
            category: row.category || '',
            statKind: row.statKind || 'bitis',
            globalRate: row.successRate,
            ...ev
        });
    }
    out.sort((a, b) => {
        if (b.successRate !== a.successRate) return b.successRate - a.successRate;
        return b.stats.withBitis - a.stats.withBitis;
    });
    return out;
}

function rankRulesForSubset(rules, subset, host, minSample) {
    const out = [];
    for (const rule of rules || []) {
        const ev = evalMatchOnSubset(rule.match, subset, host, minSample);
        if (!ev) continue;
        out.push({
            id: rule.id,
            label: rule.label,
            kind: rule.kind,
            globalRate: rule.successRate,
            ...ev
        });
    }
    out.sort((a, b) => {
        if (b.successRate !== a.successRate) return b.successRate - a.successRate;
        return b.stats.withBitis - a.stats.withBitis;
    });
    return out;
}

function evaluateWithSettings(subset, host, applyFn) {
    const GSE = global.GostergeScoringEngine;
    const savedTahmin = subset.map(e => e.row.tahmin);
    const savedSplit = GSE.getScoreShareSplit();
    const savedT9v = GSE.getT9vScoreShare();
    const savedFocus = GSE.getMetricSweepFocus();
    applyFn(GSE);
    GSE.applyToFlatEntries(subset);
    const stats = GSE.evaluateTahminSuccess(subset, host.bitisValueForSort);
    subset.forEach((e, i) => { e.row.tahmin = savedTahmin[i]; });
    GSE.setScoreShareSplit(savedSplit.t9v, savedSplit.colors, savedSplit.metrics, savedSplit.rest);
    GSE.setT9vScoreShare(savedT9v);
    GSE.clearMetricSweepFocus();
    if (savedFocus.metricId) {
        GSE.setMetricSweepFocus(savedFocus.metricId, savedFocus.shareWithinOther);
    }
    return stats;
}

function bestMetricFocusForSubset(subset, host, metricList, pctSamples) {
    const results = [];
    for (const spec of metricList) {
        let best = null;
        for (const p of pctSamples) {
            const stats = evaluateWithSettings(subset, host, (GSE) => {
                GSE.setT9vScoreShare(0.40);
                GSE.setMetricSweepFocus(spec.id, p / 100);
            });
            if (!best || stats.leaderBlended > best.leaderBlended) {
                best = { pct: p, ...stats };
            }
        }
        if (best && best.leaderTotal > 0) {
            results.push({
                id: spec.id,
                label: spec.label,
                bestPct: best.pct,
                leaderBlended: best.leaderBlended,
                exactRate: best.exactRate,
                leaderTotal: best.leaderTotal
            });
        }
    }
    results.sort((a, b) => b.leaderBlended - a.leaderBlended);
    return results;
}

function bestT9vForSubset(subset, host, t9vSamples) {
    const results = [];
    for (const p of t9vSamples) {
        const stats = evaluateWithSettings(subset, host, (GSE) => {
            GSE.clearMetricSweepFocus();
            GSE.setT9vScoreShare(p / 100);
        });
        results.push({ pct: p, ...stats });
    }
    results.sort((a, b) => b.leaderBlended - a.leaderBlended);
    return results;
}

async function runShareSplitForSubset(subset, host, opts) {
    const GSE = global.GostergeScoringEngine;
    const configs = GSE.generateShareSplitSweepConfigs(opts);
    const results = [];
    for (let i = 0; i < configs.length; i++) {
        const row = GSE.evaluateShareSplit(subset, host, configs[i]);
        if (row) results.push({ config: configs[i], ...row });
        if (i % 12 === 11) await new Promise(r => setTimeout(r, 0));
    }
    results.sort((a, b) => {
        if (b.leaderBlended !== a.leaderBlended) return b.leaderBlended - a.leaderBlended;
        return b.exactRate - a.exactRate;
    });
    return results;
}

function printFieldHeader(fs, subset, raceCount) {
    console.log('\n╔══ ' + fs + ' at · ' + raceCount + ' koşu · '
        + subset.length + ' satır ══');
}

function printBaselineRow(r) {
    const s = r.success || {};
    const abs = r.avgBucketShare || {};
    console.log('  ' + pad(r.fieldSize + ' at', 6) + ' · ' + pad(r.raceCount + ' koşu', 8)
        + ' · karışık ' + pad(pct(s.leaderBlended), 7)
        + ' · 1. ' + pct(s.leaderB1Rate)
        + ' · tam ' + (s.exact || 0) + '/' + (s.exactTotal || 0)
        + ' · T9V ' + pct(abs.t9v) + ' · Renk ' + pct(abs.colors)
        + ' · Metrik ' + pct(abs.metrics)
        + ' · belirleyici: ' + (r.topDominantLabel || '—'));
}

function printColorTop(rows, top) {
    if (!rows.length) {
        console.log('  (yeterli örnek yok)');
        return;
    }
    for (let i = 0; i < Math.min(top, rows.length); i++) {
        const r = rows[i];
        const mode = r.mode === 'depthPair' ? 'Derinlik' : 'SON·Δ';
        const n = r.stats.withBitis;
        console.log('  ' + pad(String(i + 1) + '.', 4) + pad(pct(r.successRate), 7)
            + ' n=' + pad(n, 4) + ' · ' + pad(mode, 8) + ' · '
            + pad(r.metricLabel || '—', 12) + ' · ' + (r.label || '—'));
    }
}

function printRuleTop(rows, metricLabel, top) {
    if (!rows.length) return;
    console.log('  [' + metricLabel + ']');
    for (let i = 0; i < Math.min(top, rows.length); i++) {
        const r = rows[i];
        console.log('    ' + pad(String(i + 1) + '.', 4) + pad(pct(r.successRate), 7)
            + ' n=' + r.stats.withBitis + ' · ' + (r.label || r.id));
    }
}

function printShareTop(rows, top, baseline) {
    if (!rows.length) {
        console.log('  (sonuç yok)');
        return;
    }
    for (let i = 0; i < Math.min(top, rows.length); i++) {
        const r = rows[i];
        const cfg = r.config || {};
        const delta = baseline != null ? r.leaderBlended - baseline : 0;
        const deltaStr = baseline != null
            ? (delta >= 0 ? '+' : '') + (Math.round(delta * 1000) / 10).toFixed(1) + 'pp'
            : '';
        console.log('  ' + pad(String(i + 1) + '.', 4) + pad(pct(r.leaderBlended), 7)
            + ' · T9V %' + cfg.t9v + ' · Renk %' + cfg.colors
            + ' · Met %' + cfg.metrics + ' · rest %' + cfg.rest
            + (deltaStr ? ' · Δ ' + deltaStr : ''));
    }
}

function printMetricTop(rows, top) {
    if (!rows.length) {
        console.log('  (sonuç yok)');
        return;
    }
    for (let i = 0; i < Math.min(top, rows.length); i++) {
        const r = rows[i];
        console.log('  ' + pad(String(i + 1) + '.', 4) + pad(r.label, 14)
            + ' · %' + pad(r.bestPct, 3) + ' odak → karışık '
            + pct(r.leaderBlended) + ' · tam ' + pct(r.exactRate));
    }
}

function printT9vTop(rows, top) {
    if (!rows.length) return;
    for (let i = 0; i < Math.min(top, rows.length); i++) {
        const r = rows[i];
        console.log('  ' + pad(String(i + 1) + '.', 4) + 'T9V %' + pad(r.pct, 3)
            + ' → karışık ' + pct(r.leaderBlended)
            + ' · 1. ' + pct(r.leaderB1Rate)
            + ' · tam ' + pct(r.exactRate));
    }
}

async function main() {
    if (!fs.existsSync(cli.dbPath)) {
        console.error('Veritabanı bulunamadı: ' + cli.dbPath);
        process.exit(1);
    }

    loadGostergeEngines();
    const db = openDb(cli.dbPath);
    const GSE = global.GostergeScoringEngine;
    const PFFE = global.PtestFieldFactorEngine;
    const blend = GSE.SUCCESS_BLEND();

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.filterKayit,
            filterRace: cli.filterRace
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        host.flatEntries = flatEntries;

        const raceCount = new Set(flatEntries.map(e => e.kayitId + '|' + e.raceNo)).size;
        const bitisCount = flatEntries.filter(e => host.bitisValueForSort(e) != null).length;

        console.log('=== Gösterge PUANLAMA · Terminal Tarama ===');
        console.log('DB: ' + cli.dbPath);
        console.log('Satır: ' + flatEntries.length + ' · Bitişli: ' + bitisCount + ' · Koşu: ' + raceCount);
        console.log('Başarı formülü: %' + Math.round(blend.b1 * 100) + ' 1. · %'
            + Math.round(blend.b12 * 100) + ' 1–2 · %' + Math.round(blend.b123 * 100) + ' 1–3');
        console.log('Min örnek: ' + cli.minSample + ' · Top: ' + cli.top
            + (cli.quick ? ' · HIZLI mod' : ''));

        if (!flatEntries.length) {
            console.log('Veri yok.');
            process.exit(0);
        }

        logProgress('Kalibrasyon…');
        await GSE.calibrate(flatEntries, host);
        if (!GSE.isCalibrated()) {
            console.error('Kalibrasyon başarısız — bitiş verisi veya gösterge motoru eksik.');
            process.exit(1);
        }
        GSE.applyToFlatEntries(flatEntries);

        const cal = GSE.getCalibration();
        const metricCount = (cal.metrics || []).length;
        const ladderRuleCount = Object.values(cal.ladders || {})
            .reduce((a, arr) => a + (arr?.length || 0), 0);

        console.log('\n── Kalibrasyon ──');
        console.log('Metrik: ' + metricCount + ' · Merdiven kuralı: ' + ladderRuleCount
            + ' · Renk gösterge havuzu: ' + (cal.allColorRowsCount || '—'));

        let allColorRows = null;
        let colorCandidates = null;
        if (cli.phases.includes('colors')) {
            logProgress('Renk göstergeleri toplanıyor…');
            allColorRows = global.PtestColorGostergeExport.collectAllColorRows(flatEntries, host, {
                successBlend: blend,
                onProgress: msg => logProgress(msg)
            });
            colorCandidates = pickColorCandidates(allColorRows, cli.minSample, cli.quick);
            console.log('Renk gösterge: ' + allColorRows.length + ' · aday havuzu: '
                + colorCandidates.length + ' (global n≥' + cli.minSample + ')');
        }

        const factorAnalysis = PFFE.analyzeFieldFactors(flatEntries, host);
        let { entriesByField, fieldSizes } = buildEntriesByFieldSize(flatEntries);
        if (cli.fieldSize) {
            fieldSizes = fieldSizes.filter(fs => fs === cli.fieldSize);
        }

        const factorByFs = {};
        for (const r of factorAnalysis.results || []) {
            factorByFs[r.fieldSize] = r;
        }

        if (cli.phases.includes('baseline')) {
            console.log('\n── At sayısı özeti (mevcut pay: T9V %'
                + GSE.getScoreShareSplit().t9v + ' · Renk %'
                + GSE.getScoreShareSplit().colors + ') ──');
            for (const fs of fieldSizes) {
                const r = factorByFs[fs];
                if (r) printBaselineRow(r);
            }
        }

        const shareOpts = cli.quick
            ? { full: false, step: 10, t9vMin: 25, t9vMax: 50, colorMin: 30, colorMax: 60, metricMin: 10, metricMax: 30 }
            : { full: false, step: 5, t9vMin: 20, t9vMax: 55, colorMin: 25, colorMax: 65, metricMin: 5, metricMax: 35 };

        const metricPctSamples = cli.quick
            ? [5, 10, 15, 20, 25, 30, 40, 50]
            : [1, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50];

        const t9vSamples = cli.quick
            ? [25, 30, 35, 40, 45, 50]
            : [20, 25, 30, 35, 40, 45, 50, 55];

        const metricsForSweep = cli.quick
            ? ALL_METRIC_SWEEP_LIST.filter(m => ['test1', 't1dr', 't12y', 'kmavi', 't9v', 'son8001', 'test3'].includes(m.id))
            : ALL_METRIC_SWEEP_LIST;

        for (const fs of fieldSizes) {
            const subset = entriesByField[fs] || [];
            const r = factorByFs[fs];
            const rc = r?.raceCount || new Set(subset.map(e => e.kayitId + '|' + e.raceNo)).size;
            const baselineBlended = r?.success?.leaderBlended;

            if (cli.phases.includes('shares')) {
                printFieldHeader(fs, subset, rc);
                console.log('── En iyi pay dağılımı (T9V · Renk · Metrik · rest) ──');
                logProgress(fs + ' at pay taraması…');
                const shareRows = await runShareSplitForSubset(subset, host, shareOpts);
                printShareTop(shareRows, cli.top, baselineBlended);
            }

            if (cli.phases.includes('colors') && colorCandidates) {
                if (!cli.phases.includes('shares')) printFieldHeader(fs, subset, rc);
                console.log('── En başarılı renk göstergeleri ──');
                logProgress(fs + ' at renk değerlendirmesi…');
                const colorRanked = rankColorRowsForSubset(
                    colorCandidates, subset, host, cli.minSample
                );
                printColorTop(colorRanked, cli.top);
            }

            if (cli.phases.includes('rules')) {
                if (!cli.phases.includes('shares') && !cli.phases.includes('colors')) {
                    printFieldHeader(fs, subset, rc);
                }
                console.log('── Kalibrasyon merdiveni (metrik başına en iyi kurallar) ──');
                const ladders = cal.ladders || {};
                const metrics = cal.metrics || [];
                const showMetrics = cli.quick ? metrics.slice(0, 8) : metrics;
                for (const m of showMetrics) {
                    const rules = ladders[m.id] || [];
                    const ranked = rankRulesForSubset(rules, subset, host, cli.minSample);
                    if (ranked.length) {
                        printRuleTop(ranked, m.label || m.id, Math.min(5, cli.top));
                    }
                }
            }

            if (cli.phases.includes('metrics')) {
                if (!cli.phases.includes('shares') && !cli.phases.includes('colors') && !cli.phases.includes('rules')) {
                    printFieldHeader(fs, subset, rc);
                }
                console.log('── Metrik odak taraması (T9V %40 sabit, %65 diliminde tek metrik) ──');
                logProgress(fs + ' at metrik taraması…');
                const metricRows = bestMetricFocusForSubset(subset, host, metricsForSweep, metricPctSamples);
                printMetricTop(metricRows, cli.top);
            }

            if (cli.phases.includes('t9v')) {
                console.log('── T9V pay taraması ──');
                const t9vRows = bestT9vForSubset(subset, host, t9vSamples);
                printT9vTop(t9vRows, cli.top);
            }

            if (cli.phases.includes('adaptive')) {
                console.log('── Uyarlamalı profil önerisi ──');
                const row = factorByFs[fs];
                if (row && global.PtestFieldAdaptiveEngine?.buildProfiles) {
                    const profiles = global.PtestFieldAdaptiveEngine.buildProfiles(factorAnalysis);
                    const p = profiles?.bySize?.[fs];
                    if (p) {
                        console.log('  Baskın faktör: ' + (p.bestFactorLabel || p.bestFactor || '—'));
                        if (p.shareSplit) {
                            console.log('  Önerilen pay: T9V %' + p.shareSplit.t9v
                                + ' · Renk %' + p.shareSplit.colors
                                + ' · Met %' + p.shareSplit.metrics
                                + ' · rest %' + p.shareSplit.rest);
                        }
                        if (p.priorityMetricIds?.length) {
                            console.log('  Öncelik metrikleri: ' + p.priorityMetricIds.join(', '));
                        }
                        if (p.topTermsWinners?.length) {
                            console.log('  Kazanan atlarda: ' + p.topTermsWinners.slice(0, 5)
                                .map(t => t.label).join(' · '));
                        }
                    } else {
                        console.log('  Profil üretilemedi');
                    }
                }
            }
        }

        console.log('\n── Kullanım ──');
        console.log('Tek at sayısı: node scripts/test-gosterge-exhaustive.js --field-size 10');
        console.log('Hızlı:       node scripts/test-gosterge-exhaustive.js --quick');
        console.log('Aşamalar:    --phase baseline,colors,shares,rules,metrics,t9v,adaptive');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
