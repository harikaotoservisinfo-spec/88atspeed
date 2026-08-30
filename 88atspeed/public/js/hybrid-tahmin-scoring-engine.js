/**
 * Hibrit TAHMİN — başarı % + gösterge profili (at sayısı + veri doluluk).
 * Terminal kalibrasyonu: her at sayısında hangi motorun daha iyi çalıştığı ölçülür.
 */
const HybridTahminScoringEngine = (function () {
    const STORAGE_KEY = 'hybridTahminCalibration';
    const PROFILE_VERSION = 2;
    const MIN_RACES_FOR_MODE = 10;
    const MIN_RACES_FOR_CURATED_ONLY = 15;
    const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };
    const BLEND_CLAMP = { min: 0.15, max: 0.85 };
    const MODE_MARGIN = 0.03;

    /** Terminal kanıtı — az koşuda (<15) doğrudan uygulanır */
    const CURATED_GOSTERGE_PROFILES = {
        10: {
            fieldSize: 10,
            bestFactor: 'colors',
            bestFactorLabel: 'Renkler',
            shareSplit: { t9v: 18, colors: 62, metrics: 15, rest: 5 },
            bucketBoost: 1.45,
            colorScoreMult: 1.5,
            priorityMetricIds: ['son8001', 'test1', 't1dr', 'ff', 't8'],
            priorityPreview: ['SON800-1', 'TEST1', 'T1×DR', 'FFΔ'],
            metricFocusId: 'son8001',
            metricFocusShare: 0.10,
            profileSource: 'curated-terminal'
        }
    };

    let calibration = null;
    let gostergeProfiles = null;

    function pct(rate) {
        if (rate == null || !Number.isFinite(rate)) return '—';
        return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
    }

    function raceKey(entry) {
        return String(entry.kayitId) + '|' + entry.raceNo;
    }

    function groupByRace(flatEntries) {
        const byRace = new Map();
        for (const entry of flatEntries || []) {
            const rk = raceKey(entry);
            if (!byRace.has(rk)) byRace.set(rk, []);
            byRace.get(rk).push(entry);
        }
        return byRace;
    }

    function groupByFieldSize(flatEntries) {
        const byRace = groupByRace(flatEntries);
        const out = {};
        for (const entries of byRace.values()) {
            const fs = entries.length;
            if (!out[fs]) out[fs] = [];
            out[fs].push(entries);
        }
        return out;
    }

    function blendShareSplit(a, b, curatedWeight) {
        if (!a) return b ? { ...b } : null;
        if (!b) return { ...a };
        const w = Math.max(0, Math.min(1, curatedWeight || 0));
        const keys = ['t9v', 'colors', 'metrics', 'rest'];
        const out = {};
        let sum = 0;
        for (const k of keys) {
            out[k] = Math.round(((a[k] || 0) * (1 - w) + (b[k] || 0) * w) * 10) / 10;
            sum += out[k];
        }
        const fix = Math.round((100 - sum) * 10) / 10;
        if (fix) out.t9v = Math.round((out.t9v + fix) * 10) / 10;
        return out;
    }

    function mergeGostergeProfiles(adaptiveProfiles, raceCountBySize) {
        const bySize = { ...(adaptiveProfiles?.bySize || {}) };
        for (const [fsStr, curated] of Object.entries(CURATED_GOSTERGE_PROFILES)) {
            const fs = Number(fsStr);
            const raceCount = raceCountBySize[fs] || 0;
            const adaptive = bySize[fs] || bySize[String(fs)];
            if (!adaptive || raceCount < MIN_RACES_FOR_CURATED_ONLY) {
                bySize[fs] = { ...curated, raceCount, profileSource: 'curated-terminal' };
            } else {
                bySize[fs] = {
                    ...adaptive,
                    shareSplit: blendShareSplit(adaptive.shareSplit, curated.shareSplit, 0.35),
                    priorityMetricIds: [...new Set([
                        ...(curated.priorityMetricIds || []),
                        ...(adaptive.priorityMetricIds || [])
                    ])].slice(0, 10),
                    metricFocusId: curated.metricFocusId || adaptive.metricFocusId,
                    metricFocusShare: curated.metricFocusShare ?? adaptive.metricFocusShare,
                    colorScoreMult: Math.max(adaptive.colorScoreMult || 1, curated.colorScoreMult || 1),
                    bucketBoost: Math.max(adaptive.bucketBoost || 1, curated.bucketBoost || 1),
                    profileSource: 'hybrid-curated'
                };
            }
        }
        const list = Object.values(bySize).sort((a, b) => (a.fieldSize || 0) - (b.fieldSize || 0));
        return { bySize, list, builtAt: Date.now() };
    }

    function lookupGostergeProfile(fieldSize) {
        if (!gostergeProfiles?.bySize) return null;
        if (GostergeScoringEngine.lookupFieldProfileBySize) {
            return GostergeScoringEngine.lookupFieldProfileBySize(gostergeProfiles.bySize, fieldSize);
        }
        return gostergeProfiles.bySize[fieldSize] || gostergeProfiles.bySize[String(fieldSize)] || null;
    }

    function lookupBasariWeight(fieldSize) {
        if (!calibration?.blendBySize) return calibration?.globalBasariWeight ?? 0.5;
        const direct = calibration.blendBySize[fieldSize] ?? calibration.blendBySize[String(fieldSize)];
        if (direct != null) return direct;
        return calibration.globalBasariWeight ?? 0.5;
    }

    function computeRowBasariCoverage(row, weights) {
        const w = BasariPctScoringEngine.mergeProfileWeights(weights);
        const keys = Object.keys(w);
        if (!keys.length) return 0;
        let hit = 0;
        for (const key of keys) {
            if (BasariPctScoringEngine.resolveBasariPct(row, key) != null) hit++;
        }
        return hit / keys.length;
    }

    function computeRaceBasariCoverage(rows, weights) {
        if (!rows?.length) return 0;
        let sum = 0;
        for (const row of rows) sum += computeRowBasariCoverage(row, weights);
        return sum / rows.length;
    }

    function applyTahminEligibility(scored) {
        for (const s of scored) {
            const hist = s.row?.kosuHistory;
            if (!hist || hist.tahminEligible !== false) continue;
            s.tahmin.ineligible = true;
            s.tahmin.ineligibleReason = hist.noHistory ? 'kosu_yok'
                : hist.debut ? 'debut' : 'veri_yetersiz';
            s.tahmin.score = 0;
            s.tahmin.pct = 0;
        }
    }

    function finishRaceScoring(scored, pkg) {
        if (pkg?.skipDimensionBoost) {
            return finalizeRaceScores(scored);
        }
        return finishWithDimensionBoost(scored, pkg);
    }

    function finishWithDimensionBoost(scored, pkg) {
        if (typeof DimensionTahminBoostEngine !== 'undefined'
            && DimensionTahminBoostEngine.applyRaceBoost) {
            DimensionTahminBoostEngine.applyRaceBoost(scored, pkg);
        }
        return finalizeRaceScores(scored);
    }

    function finalizeRaceScores(scored) {
        applyTahminEligibility(scored);
        const eligible = scored.filter(s => !s.tahmin.ineligible);
        const pool = eligible.length ? eligible : scored;
        const maxScore = Math.max(...pool.map(s => s.tahmin.score), 1);
        for (const s of pool) {
            s.tahmin.pct = s.tahmin.score > 0
                ? Math.max(1, Math.round((s.tahmin.score / maxScore) * 100))
                : 0;
        }
        for (const s of scored) {
            if (s.tahmin.ineligible) s.tahmin.pct = 0;
        }
        scored.sort((a, b) => {
            if (a.tahmin.ineligible !== b.tahmin.ineligible) {
                return a.tahmin.ineligible ? 1 : -1;
            }
            if (typeof AtSpeedUtils !== 'undefined' && AtSpeedUtils.compareTahminRank) {
                return AtSpeedUtils.compareTahminRank(a.row, b.row, a.tahmin.score, b.tahmin.score);
            }
            const sa = a.tahmin.score;
            const sb = b.tahmin.score;
            if (sb !== sa) return sb - sa;
            return (a.row?.no ?? 0) - (b.row?.no ?? 0);
        });
        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
            scored[i].row.tahmin = scored[i].tahmin;
        }
        return scored;
    }

    function statLabel(key) {
        const cat = BasariPctScoringEngine.STAT_CATALOG || [];
        return cat.find(s => s.key === key)?.label || key;
    }

    function normalizeRacePct(scored) {
        const maxScore = Math.max(...scored.map(s => s.tahmin.score), 1);
        for (const s of scored) {
            s.tahmin.pct = s.tahmin.score > 0
                ? Math.max(1, Math.round((s.tahmin.score / maxScore) * 100))
                : 0;
        }
        return scored;
    }

    function scoreGostergeRows(rows, profile) {
        const GSE = GostergeScoringEngine;
        const savedSplit = GSE.getScoreShareSplit();
        const savedFocus = GSE.getMetricSweepFocus();
        if (profile?.shareSplit) {
            GSE.setScoreShareSplit(
                profile.shareSplit.t9v,
                profile.shareSplit.colors,
                profile.shareSplit.metrics,
                profile.shareSplit.rest
            );
        }
        if (profile?.metricFocusId && profile.metricFocusShare > 0) {
            GSE.setMetricSweepFocus(profile.metricFocusId, profile.metricFocusShare);
        } else {
            GSE.clearMetricSweepFocus();
        }
        const scoringOpts = {
            ...GSE.getDefaultColorScoringOptions(),
            fieldProfile: profile
        };
        const scored = rows.map(row => ({
            row,
            tahmin: GSE.computeRowTahminWithOptions({ row }, scoringOpts)
        }));
        if (profile?.shareSplit) {
            GSE.setScoreShareSplit(savedSplit.t9v, savedSplit.colors, savedSplit.metrics, savedSplit.rest);
        }
        if (savedFocus.metricId) {
            GSE.setMetricSweepFocus(savedFocus.metricId, savedFocus.shareWithinOther);
        } else {
            GSE.clearMetricSweepFocus();
        }
        return scored;
    }

    function blendRaceScores(basariScored, gostergeScored, basariWeight) {
        const bw = Math.max(BLEND_CLAMP.min, Math.min(BLEND_CLAMP.max, basariWeight));
        const gw = 1 - bw;
        normalizeRacePct(basariScored);
        normalizeRacePct(gostergeScored);
        const gMap = new Map(gostergeScored.map(s => [s.row, s.tahmin]));

        const blended = basariScored.map(bs => {
            const gs = gMap.get(bs.row);
            const bPct = bs.tahmin.pct || 0;
            const gPct = gs?.pct || 0;
            const score = Math.round(bPct * bw + gPct * gw);
            const terms = [];
            if (bs.tahmin.topTerms?.length) {
                for (const t of bs.tahmin.topTerms.slice(0, 4)) {
                    terms.push({ ...t, label: 'Başarı: ' + (t.label || t.ruleLabel), source: 'basari' });
                }
            }
            if (gs?.topTerms?.length) {
                for (const t of gs.topTerms.slice(0, 4)) {
                    terms.push({ ...t, label: 'Gösterge: ' + (t.label || t.ruleLabel), source: 'gosterge' });
                }
            }
            terms.sort((a, b) => (b.points || 0) - (a.points || 0));
            return {
                row: bs.row,
                tahmin: {
                    score,
                    pct: score,
                    rank: null,
                    terms,
                    topTerms: terms.slice(0, 6),
                    metricCount: (bs.tahmin.metricCount || 0) + (gs?.metricCount || 0),
                    source: 'hybrid',
                    basariWeight: bw,
                    gostergeWeight: gw,
                    basariPct: bPct,
                    gostergePct: gPct,
                    basariScore: bs.tahmin.score,
                    gostergeScore: gs?.score || 0
                }
            };
        });

        applyTahminEligibility(blended);
        blended.sort((a, b) => {
            if (a.tahmin.ineligible !== b.tahmin.ineligible) {
                return a.tahmin.ineligible ? 1 : -1;
            }
            if (typeof AtSpeedUtils !== 'undefined' && AtSpeedUtils.compareTahminRank) {
                return AtSpeedUtils.compareTahminRank(a.row, b.row, a.tahmin.score, b.tahmin.score);
            }
            if (b.tahmin.score !== a.tahmin.score) return b.tahmin.score - a.tahmin.score;
            return (a.row?.no ?? 0) - (b.row?.no ?? 0);
        });
        for (let i = 0; i < blended.length; i++) {
            blended[i].tahmin.rank = i + 1;
            blended[i].row.tahmin = blended[i].tahmin;
        }
        return blended;
    }

    function resolveBasariWeight(fieldSize, raceCoverage, depthCoverage) {
        let bw = lookupBasariWeight(fieldSize);
        if (raceCoverage >= 0.65) bw = Math.min(BLEND_CLAMP.max, bw + 0.12);
        else if (raceCoverage <= 0.35) bw = Math.max(BLEND_CLAMP.min, bw - 0.12);

        const coreMiss = depthCoverage?.coreMissingRate ?? 0;
        if (coreMiss >= 0.5) bw = Math.min(BLEND_CLAMP.max, bw + 0.22);
        else if (coreMiss >= 0.25) bw = Math.min(BLEND_CLAMP.max, bw + 0.12);
        else if (coreMiss >= 0.1) bw = Math.min(BLEND_CLAMP.max, bw + 0.06);

        const sonOk = (depthCoverage?.son8001 ?? 1) >= 0.75;
        const testOk = (depthCoverage?.test1 ?? 1) >= 0.75;
        if (sonOk && testOk && coreMiss < 0.05) {
            bw = Math.max(BLEND_CLAMP.min, bw - 0.05);
        }
        return bw;
    }

    function lookupEngineMode(fieldSize) {
        const row = calibration?.modeBySize?.[fieldSize]
            ?? calibration?.modeBySize?.[String(fieldSize)];
        if (row) return row;
        return calibration?.globalMode || 'blend';
    }

    function attachBasariOnly(pkg, fieldSize, basariWeights) {
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: BasariPctScoringEngine.computeRowScore(row, basariWeights)
        }));
        finishRaceScoring(scored, pkg);
        const leader = pkg.rows.find(r => r.tahmin?.rank === 1);
        pkg.tahminOzeti = {
            leader: leader?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: fieldSize,
            source: 'hybrid',
            engineMode: 'basari',
            metricCount: leader?.tahmin?.metricCount ?? 0,
            fieldProfile: { fieldSize, bestFactorLabel: 'Başarı %', engineMode: 'basari' }
        };
        return pkg;
    }

    function attachGostergeOnly(pkg, profile) {
        const scored = scoreGostergeRows(pkg.rows, profile);
        finishRaceScoring(scored, pkg);
        const leader = pkg.rows.find(r => r.tahmin?.rank === 1);
        pkg.tahminOzeti = {
            leader: leader?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: pkg.rows.length,
            source: 'hybrid',
            engineMode: 'gosterge',
            metricCount: leader?.tahmin?.metricCount ?? 0,
            fieldProfile: profile ? {
                fieldSize: pkg.rows.length,
                bestFactor: profile.bestFactor,
                bestFactorLabel: profile.bestFactorLabel,
                priorityPreview: profile.priorityPreview || [],
                profileSource: profile.profileSource,
                engineMode: 'gosterge'
            } : null
        };
        return pkg;
    }

    function attachRaceTahmin(pkg) {
        if (!pkg?.rows?.length) return pkg;
        const fieldSize = pkg.rows.length;
        const basariWeights = BasariPctScoringEngine.lookupWeights(fieldSize);
        const profile = lookupGostergeProfile(fieldSize);
        const engineMode = lookupEngineMode(fieldSize);

        if (engineMode === 'basari') {
            return attachBasariOnly(pkg, fieldSize, basariWeights);
        }
        if (engineMode === 'gosterge' && GostergeScoringEngine.isCalibrated?.()) {
            return attachGostergeOnly(pkg, profile);
        }

        const raceCoverage = computeRaceBasariCoverage(pkg.rows, basariWeights);
        const depthCoverage = pkg.depthCoverage || null;
        const basariWeight = resolveBasariWeight(fieldSize, raceCoverage, depthCoverage);

        const basariScored = pkg.rows.map(row => ({
            row,
            tahmin: BasariPctScoringEngine.computeRowScore(row, basariWeights)
        }));

        let blended;
        if (GostergeScoringEngine.isCalibrated?.()) {
            const gostergeScored = scoreGostergeRows(pkg.rows, profile);
            blended = blendRaceScores(basariScored, gostergeScored, basariWeight);
            finishRaceScoring(blended, pkg);
        } else {
            finishRaceScoring(basariScored, pkg);
            blended = basariScored;
        }

        const leader = pkg.rows.find(r => r.tahmin?.rank === 1)
            || pkg.rows.slice().sort((a, b) => (a.tahmin?.rank ?? 99) - (b.tahmin?.rank ?? 99))[0];

        pkg.tahminOzeti = {
            leader: leader?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: fieldSize,
            source: 'hybrid',
            engineMode: engineMode === 'blend' ? 'blend' : engineMode,
            metricCount: leader?.tahmin?.metricCount ?? 0,
            basariWeight: leader?.tahmin?.basariWeight ?? basariWeight,
            gostergeWeight: leader?.tahmin?.gostergeWeight ?? (1 - basariWeight),
            raceCoverage,
            depthCoverage,
            kosuHistorySummary: pkg.kosuHistorySummary || null,
            fieldProfile: profile ? {
                fieldSize,
                bestFactor: profile.bestFactor,
                bestFactorLabel: profile.bestFactorLabel,
                priorityPreview: profile.priorityPreview || profile.priorityMetricIds || [],
                profileSource: profile.profileSource,
                engineMode: 'blend'
            } : {
                fieldSize,
                bestFactorLabel: 'Başarı %',
                engineMode: 'blend',
                priorityPreview: Object.entries(basariWeights)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k]) => statLabel(k))
            }
        };
        return pkg;
    }

    function evaluateEngineOnFlat(flatEntries, bitisValueForSort, engine) {
        const byRace = groupByRace(flatEntries);
        let leaderTotal = 0;
        let leaderB1 = 0, leaderB12 = 0, leaderB123 = 0;
        let exact = 0, exactTotal = 0;

        for (const entries of byRace.values()) {
            const pkg = { rows: entries.map(e => e.row) };
            if (engine === 'basari') BasariPctScoringEngine.attachRaceTahmin(pkg);
            else if (engine === 'gosterge') GostergeScoringEngine.attachRaceTahmin(pkg);
            else attachRaceTahmin(pkg);

            const leader = entries.find(e => e.row.tahmin?.rank === 1);
            if (leader) {
                const bitis = bitisValueForSort?.(leader);
                if (bitis != null && bitis >= 1) {
                    leaderTotal++;
                    if (bitis === 1) leaderB1++;
                    if (bitis <= 2) leaderB12++;
                    if (bitis <= 3) leaderB123++;
                }
            }
        }

        for (const entry of flatEntries) {
            const b = bitisValueForSort?.(entry);
            if (b == null || b < 1) continue;
            exactTotal++;
            const rank = entry.row?.tahmin?.rank;
            if (rank != null && Number(rank) === Number(b)) exact++;
        }

        const blend = SUCCESS_BLEND;
        const leaderBlended = leaderTotal
            ? blend.b1 * (leaderB1 / leaderTotal)
                + blend.b12 * (leaderB12 / leaderTotal)
                + blend.b123 * (leaderB123 / leaderTotal)
            : 0;

        return {
            leaderTotal,
            leaderBlended,
            exact,
            exactTotal,
            exactRate: exactTotal ? exact / exactTotal : 0,
            leaderB1Rate: leaderTotal ? leaderB1 / leaderTotal : 0,
            leaderB12Rate: leaderTotal ? leaderB12 / leaderTotal : 0,
            leaderB123Rate: leaderTotal ? leaderB123 / leaderTotal : 0
        };
    }

    function evaluateGostergeWithProfile(flatEntries, bitisValueForSort, profile) {
        const byRace = groupByRace(flatEntries);
        let leaderTotal = 0, leaderB1 = 0, leaderB12 = 0, leaderB123 = 0;
        let exact = 0, exactTotal = 0;

        for (const entries of byRace.values()) {
            const pkg = { rows: entries.map(e => e.row) };
            attachGostergeOnly(pkg, profile);
            const leader = entries.find(e => e.row.tahmin?.rank === 1);
            if (leader) {
                const bitis = bitisValueForSort?.(leader);
                if (bitis != null && bitis >= 1) {
                    leaderTotal++;
                    if (bitis === 1) leaderB1++;
                    if (bitis <= 2) leaderB12++;
                    if (bitis <= 3) leaderB123++;
                }
            }
        }
        for (const entry of flatEntries) {
            const b = bitisValueForSort?.(entry);
            if (b == null || b < 1) continue;
            exactTotal++;
            const rank = entry.row?.tahmin?.rank;
            if (rank != null && Number(rank) === Number(b)) exact++;
        }
        const blend = SUCCESS_BLEND;
        const leaderBlended = leaderTotal
            ? blend.b1 * (leaderB1 / leaderTotal)
                + blend.b12 * (leaderB12 / leaderTotal)
                + blend.b123 * (leaderB123 / leaderTotal)
            : 0;
        return { leaderTotal, leaderBlended, exact, exactTotal, exactRate: exactTotal ? exact / exactTotal : 0 };
    }

    function pickEngineMode(basariStats, gostergeStats, globalMode) {
        const b = basariStats.leaderBlended;
        const g = gostergeStats.leaderBlended;
        if (b > g + MODE_MARGIN) return 'basari';
        if (g > b + MODE_MARGIN) return 'gosterge';
        return 'blend';
    }

    function calibrateBlendWeights(flatEntries, bitisValueForSort) {
        const byFieldSize = groupByFieldSize(flatEntries);
        const raceCountBySize = {};
        for (const [fsStr, groups] of Object.entries(byFieldSize)) {
            raceCountBySize[Number(fsStr)] = groups.length;
        }

        GostergeScoringEngine.setFieldAdaptiveProfiles(gostergeProfiles);
        GostergeScoringEngine.setFieldAdaptiveScoringEnabled(true);

        const globalBasari = evaluateEngineOnFlat(flatEntries, bitisValueForSort, 'basari');
        const globalGosterge = evaluateEngineOnFlat(flatEntries, bitisValueForSort, 'gosterge');
        const globalMode = pickEngineMode(globalBasari, globalGosterge, 'blend');
        const globalBasariWeight = globalMode === 'basari' ? 0.85
            : globalMode === 'gosterge' ? 0.15 : 0.5;

        const blendBySize = {};
        const modeBySize = {};
        const blendList = [];

        for (const [fsStr, raceGroups] of Object.entries(byFieldSize)) {
            const fs = Number(fsStr);
            const subset = raceGroups.flat();
            const raceCount = raceGroups.length;

            if (raceCount < MIN_RACES_FOR_MODE) {
                blendBySize[fs] = globalBasariWeight;
                modeBySize[fs] = globalMode;
                blendList.push({
                    fieldSize: fs,
                    raceCount,
                    engineMode: globalMode,
                    basariWeight: globalBasariWeight,
                    gostergeWeight: 1 - globalBasariWeight,
                    basariBlended: null,
                    gostergeBlended: null,
                    source: 'global-min-races'
                });
                continue;
            }

            const basariStats = evaluateEngineOnFlat(subset, bitisValueForSort, 'basari');
            let gostergeStats = evaluateEngineOnFlat(subset, bitisValueForSort, 'gosterge');
            let mode = pickEngineMode(basariStats, gostergeStats, globalMode);

            if (fs === 10 && CURATED_GOSTERGE_PROFILES[10]) {
                const curatedStats = evaluateGostergeWithProfile(
                    subset, bitisValueForSort, CURATED_GOSTERGE_PROFILES[10]
                );
                if (curatedStats.leaderBlended > gostergeStats.leaderBlended) {
                    gostergeStats = curatedStats;
                    gostergeProfiles.bySize[10] = {
                        ...CURATED_GOSTERGE_PROFILES[10],
                        raceCount: raceGroups.length,
                        profileSource: 'curated-terminal'
                    };
                }
                mode = pickEngineMode(basariStats, gostergeStats, globalMode);
            }

            modeBySize[fs] = mode;
            let bw = mode === 'basari' ? 0.85 : mode === 'gosterge' ? 0.15 : 0.5;
            if (mode === 'blend') {
                const total = basariStats.leaderBlended + gostergeStats.leaderBlended;
                bw = total > 0 ? basariStats.leaderBlended / total : 0.5;
                bw = Math.max(BLEND_CLAMP.min, Math.min(BLEND_CLAMP.max, bw));
            }
            blendBySize[fs] = bw;
            blendList.push({
                fieldSize: fs,
                raceCount: raceGroups.length,
                engineMode: mode,
                basariWeight: bw,
                gostergeWeight: 1 - bw,
                basariBlended: basariStats.leaderBlended,
                gostergeBlended: gostergeStats.leaderBlended,
                source: 'calibrated'
            });
        }

        return {
            blendBySize,
            modeBySize,
            blendList,
            globalBasariWeight,
            globalMode,
            globalBasariBlended: globalBasari.leaderBlended,
            globalGostergeBlended: globalGosterge.leaderBlended,
            raceCountBySize
        };
    }

    async function calibrateFromFlatEntries(flatEntries, bitisValueForSort, opts) {
        opts = opts || {};
        if (!flatEntries?.length || !bitisValueForSort) return null;
        if (typeof BasariPctScoringEngine === 'undefined'
            || typeof GostergeScoringEngine === 'undefined') {
            return null;
        }

        BasariPctScoringEngine.calibrateFromFlatEntries(flatEntries, bitisValueForSort);

        const host = opts.host || {
            bitisValueForSort,
            buildBitisStatsFromEntries(entries) {
                let withBitis = 0, b1 = 0, b12 = 0, b123 = 0;
                for (const entry of entries || []) {
                    const b = bitisValueForSort(entry);
                    if (b == null || b < 1) continue;
                    withBitis++;
                    if (b === 1) b1++;
                    if (b <= 2) b12++;
                    if (b <= 3) b123++;
                }
                return { matchedRows: (entries || []).length, withBitis, b1, b12, b123 };
            }
        };

        await GostergeScoringEngine.calibrate(flatEntries, host);

        let adaptive = null;
        if (typeof PtestFieldFactorEngine !== 'undefined'
            && typeof PtestFieldAdaptiveEngine !== 'undefined') {
            GostergeScoringEngine.applyToFlatEntries(flatEntries);
            const factorResults = PtestFieldFactorEngine.analyzeFieldFactors(flatEntries, host);
            adaptive = PtestFieldAdaptiveEngine.buildProfiles(factorResults, opts.adaptiveOpts || {});
        }
        const byFieldSize = groupByFieldSize(flatEntries);
        const raceCountBySize = {};
        for (const [fs, groups] of Object.entries(byFieldSize)) {
            raceCountBySize[Number(fs)] = groups.length;
        }
        gostergeProfiles = mergeGostergeProfiles(adaptive, raceCountBySize);
        GostergeScoringEngine.setFieldAdaptiveProfiles(gostergeProfiles);

        const blend = calibrateBlendWeights(flatEntries, bitisValueForSort);
        const hybridStats = evaluateEngineOnFlat(flatEntries, bitisValueForSort, 'hybrid');

        let dimensionBlend = null;
        if (typeof DimensionTahminBoostEngine !== 'undefined'
            && DimensionTahminBoostEngine.calibrateBlendFromFlatEntries) {
            dimensionBlend = DimensionTahminBoostEngine.calibrateBlendFromFlatEntries(
                flatEntries, bitisValueForSort
            );
        }

        calibration = {
            version: PROFILE_VERSION,
            builtAt: Date.now(),
            gostergeProfiles,
            ...blend,
            hybridBlended: hybridStats.leaderBlended,
            hybridExactRate: hybridStats.exactRate,
            hybridLeaderTotal: hybridStats.leaderTotal,
            dimensionBlend,
            basariSummary: BasariPctScoringEngine.getCalibrationSummary?.()
        };
        saveCalibration();
        return calibration;
    }

    async function loadAndCalibrateFromApi(buildBitisStatsFromEntries) {
        if (!GostergeScoringEngine?.buildFlatEntriesFromApi) return null;
        const { flatEntries, bitisMap } = await GostergeScoringEngine.buildFlatEntriesFromApi({
            IE: IstatistikEngine
        });
        const host = GostergeScoringEngine.makeBitisHost(
            flatEntries, bitisMap, buildBitisStatsFromEntries
        );
        return calibrateFromFlatEntries(flatEntries, host.bitisValueForSort);
    }

    function saveCalibration() {
        if (!calibration) return false;
        try {
            if (typeof localStorage === 'undefined') return true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                version: PROFILE_VERSION,
                blendBySize: calibration.blendBySize,
                modeBySize: calibration.modeBySize,
                blendList: calibration.blendList,
                globalBasariWeight: calibration.globalBasariWeight,
                globalMode: calibration.globalMode,
                gostergeProfiles: calibration.gostergeProfiles,
                hybridBlended: calibration.hybridBlended,
                dimensionBlend: calibration.dimensionBlend,
                builtAt: calibration.builtAt
            }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function loadCalibration() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed.version !== PROFILE_VERSION) return null;
            calibration = parsed;
            gostergeProfiles = parsed.gostergeProfiles || null;
            if (gostergeProfiles) GostergeScoringEngine.setFieldAdaptiveProfiles?.(gostergeProfiles);
            if (parsed.dimensionBlend?.dimWeight != null
                && typeof DimensionTahminBoostEngine !== 'undefined') {
                DimensionTahminBoostEngine.setBlendWeights(
                    parsed.dimensionBlend.hybridWeight ?? (1 - parsed.dimensionBlend.dimWeight),
                    parsed.dimensionBlend.dimWeight
                );
            }
            return calibration;
        } catch (_) {
            return null;
        }
    }

    function isCalibrated() {
        return !!(calibration?.blendBySize && BasariPctScoringEngine.isCalibrated?.()
            && GostergeScoringEngine.isCalibrated?.());
    }

    function getCalibration() {
        return calibration;
    }

    function getGostergeProfiles() {
        return gostergeProfiles;
    }

    function renderStatusHtml() {
        if (!isCalibrated()) {
            return '<span style="color:#e65100">Hibrit profil henüz yok — bitiş verisi yüklenince kalibre edilir</span>';
        }
        const parts = (calibration.blendList || [])
            .sort((a, b) => (a.fieldSize || 0) - (b.fieldSize || 0))
            .map(p => {
                const mode = p.engineMode || 'blend';
                let s = p.fieldSize + ' at → ' + mode;
                if (mode === 'blend') {
                    s += ' (B%' + Math.round((p.basariWeight || 0) * 100)
                        + '·G%' + Math.round((p.gostergeWeight || 0) * 100) + ')';
                }
                if (p.fieldSize === 10) s += ' · terminal profili';
                return s;
            });
        let dimLine = '';
        const db = calibration.dimensionBlend;
        if (db?.dimPct != null) {
            dimLine = '<br><span style="color:#2e7d32;font-size:11px">Boyut blend: %'
                + db.dimPct + ' boyut · %' + (db.hybridPct ?? (100 - db.dimPct)) + ' hybrid';
            if (db.leaderBlended != null) {
                dimLine += ' · karışık ' + pct(db.leaderBlended);
                if (db.gainVsBaseline != null && db.gainVsBaseline > 0) {
                    dimLine += ' (+' + pct(db.gainVsBaseline) + ' vs saf hybrid)';
                }
            }
            if (db.lowSample) dimLine += ' · ⚠ az koşu (n=' + (db.raceCount ?? '?') + ')';
            dimLine += '</span>';
        }
        return '<strong>Hibrit TAHMİN aktif</strong> · Karışık ' + pct(calibration.hybridBlended)
            + dimLine
            + '<br>' + parts.join(' · ')
            + '<br><span style="color:#789;font-size:10px">Mod seçimi: koşu &lt; '
            + MIN_RACES_FOR_MODE + ' → global · boyut payı BİTİŞ verisinden kalibre · 10-at profili</span>';
    }

    if (typeof localStorage !== 'undefined') loadCalibration();

    return {
        attachRaceTahmin,
        calibrateFromFlatEntries,
        loadAndCalibrateFromApi,
        evaluateEngineOnFlat,
        evaluateTahminSuccess(flatEntries, bitisValueForSort) {
            return evaluateEngineOnFlat(flatEntries, bitisValueForSort, 'hybrid');
        },
        mergeGostergeProfiles,
        getCalibration,
        getGostergeProfiles,
        isCalibrated,
        renderStatusHtml,
        loadCalibration,
        saveCalibration,
        CURATED_GOSTERGE_PROFILES,
        SUCCESS_BLEND,
        PROFILE_VERSION,
        MIN_RACES_FOR_MODE,
        STORAGE_KEY
    };
})();

if (typeof module !== 'undefined') module.exports = HybridTahminScoringEngine;
