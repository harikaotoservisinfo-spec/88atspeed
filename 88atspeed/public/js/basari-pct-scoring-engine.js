/**
 * TAHMİN — yalnızca geçmiş başarı yüzdeleri (İLK1/2/3, Ş/M, mesafe, şehir).
 * Gösterge merdiveni, renk, T9V, metrik derinlikleri ve görsel profil etkisiz.
 * At sayısına göre PUANLAMA TEST bitiş verisinden hangi yüzdenin işe yaradığı öğrenilir.
 */
const BasariPctScoringEngine = (function () {
    const STORAGE_KEY = 'basariPctWeightsBySize';
    const PROFILE_VERSION = 3;
    const MIN_RACES = 5;
    /** Profil adayında en az bu oranda atda veri olmalı (Ş/M ~%14 elenir) */
    const MIN_STAT_COVERAGE = 0.25;
    const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    const PERIODS = ['gun15', 'ay1', 'ay3'];
    const ILK_BUNDLES = [
        { prefix: 'smIlk', label: 'Ş/M İLK' },
        { prefix: 'mesafeIlk', label: 'MES İLK' },
        { prefix: 'genelIlk', label: 'GEN İLK' }
    ];

    function buildStatCatalog() {
        const out = [];
        for (const b of ILK_BUNDLES) {
            for (let ilk = 1; ilk <= 3; ilk++) {
                for (const p of PERIODS) {
                    const key = b.prefix + ilk + '.' + p;
                    const pl = p === 'gun15' ? '15G' : (p === 'ay1' ? '1AY' : '3AY');
                    out.push({ key, label: pl + ' ' + b.label + ilk });
                }
            }
        }
        out.push({ key: 'sehir', label: 'Şehir deneyimi' });
        return out;
    }

    const STAT_CATALOG = buildStatCatalog();

    const DEFAULT_WEIGHTS = {
        'genelIlk1.gun15': 14,
        'genelIlk1.ay1': 12,
        'genelIlk1.ay3': 10,
        'genelIlk2.gun15': 8,
        'genelIlk2.ay1': 6,
        'genelIlk3.gun15': 5,
        'mesafeIlk1.gun15': 10,
        'mesafeIlk1.ay1': 8,
        'mesafeIlk1.ay3': 6,
        'mesafeIlk2.gun15': 5,
        'sehir': 8,
        'smIlk1.gun15': 6,
        'smIlk1.ay1': 5,
        'smIlk1.ay3': 4,
        'smIlk2.gun15': 4,
        'smIlk2.ay1': 3
    };

    let weightsBySize = null;
    let calibrationSummary = null;

    function statLabel(key) {
        return STAT_CATALOG.find(s => s.key === key)?.label || key;
    }

    function resolveBasariPct(row, key) {
        if (!row || !key) return null;
        if (key === 'sehir') {
            const p = row.sehir?.pct;
            return p != null && Number.isFinite(p) ? p : null;
        }
        const dot = key.indexOf('.');
        if (dot < 0) return null;
        const bundle = key.slice(0, dot);
        const period = key.slice(dot + 1);
        const b = row[bundle];
        const p = b?.[period]?.pct;
        return p != null && Number.isFinite(p) ? p : null;
    }

    function normalizeWeights(weights) {
        const out = {};
        let sum = 0;
        for (const [k, v] of Object.entries(weights || {})) {
            const n = Math.max(0, Number(v) || 0);
            if (n > 0) {
                out[k] = n;
                sum += n;
            }
        }
        if (!sum) return { ...DEFAULT_WEIGHTS };
        for (const k of Object.keys(out)) {
            out[k] = Math.round((out[k] / sum) * 1000) / 10;
        }
        return out;
    }

    function mergeProfileWeights(profileWeights) {
        const base = { ...DEFAULT_WEIGHTS };
        const prof = normalizeWeights(profileWeights);
        for (const [k, v] of Object.entries(prof)) {
            base[k] = (base[k] || 0) + v * 1.5;
        }
        return normalizeWeights(base);
    }

    function lookupWeights(fieldSize) {
        const fs = Number(fieldSize);
        if (!Number.isFinite(fs) || fs <= 0) return normalizeWeights(DEFAULT_WEIGHTS);
        const map = weightsBySize || {};
        const direct = map[fs] || map[String(fs)];
        if (direct) return mergeProfileWeights(direct);
        const sizes = Object.keys(map)
            .map(k => Number(k))
            .filter(n => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);
        if (!sizes.length) return normalizeWeights(DEFAULT_WEIGHTS);
        let nearest = sizes[0];
        let minDiff = Math.abs(fs - nearest);
        for (const n of sizes) {
            const diff = Math.abs(fs - n);
            if (diff < minDiff || (diff === minDiff && n > nearest)) {
                minDiff = diff;
                nearest = n;
            }
        }
        return mergeProfileWeights(map[nearest] || map[String(nearest)] || DEFAULT_WEIGHTS);
    }

    function computeRowScore(row, weights) {
        const w = mergeProfileWeights(weights);
        const terms = [];
        let weightedSum = 0;
        let totalWeight = 0;

        for (const [key, weight] of Object.entries(w)) {
            const pct = resolveBasariPct(row, key);
            if (pct == null) continue;
            totalWeight += weight;
            weightedSum += pct * weight;
            terms.push({
                label: statLabel(key),
                ruleLabel: statLabel(key) + ' %' + pct,
                points: Math.round((pct * weight) / 100),
                pct,
                metricId: key,
                weight
            });
        }

        if (!totalWeight) {
            for (const { key } of STAT_CATALOG) {
                const pct = resolveBasariPct(row, key);
                if (pct == null) continue;
                const weight = 10;
                totalWeight += weight;
                weightedSum += pct * weight;
                terms.push({
                    label: statLabel(key),
                    ruleLabel: statLabel(key) + ' %' + pct,
                    points: Math.round((pct * weight) / 100),
                    pct,
                    metricId: key,
                    weight
                });
            }
        }

        terms.sort((a, b) => b.points - a.points);
        const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

        return {
            score,
            pct: null,
            rank: null,
            terms,
            topTerms: terms.slice(0, 6),
            metricCount: terms.length,
            source: 'basari-pct',
            weightKeys: Object.keys(w),
            dataCoverage: terms.length
        };
    }

    function finalizeRaceScores(scored) {
        const maxScore = Math.max(...scored.map(s => s.tahmin.score), 1);
        for (const s of scored) {
            s.tahmin.pct = s.tahmin.score > 0
                ? Math.max(1, Math.round((s.tahmin.score / maxScore) * 100))
                : 0;
        }
        scored.sort((a, b) => {
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

    function attachRaceTahmin(pkg) {
        if (!pkg?.rows?.length) return pkg;
        const fieldSize = pkg.rows.length;
        const weights = lookupWeights(fieldSize);
        const topKeys = Object.entries(weights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([k]) => statLabel(k));

        const scored = pkg.rows.map(row => ({
            row,
            tahmin: computeRowScore(row, weights)
        }));
        finalizeRaceScores(scored);

        const leader = pkg.rows.find(r => r.tahmin?.rank === 1)
            || pkg.rows.slice().sort((a, b) => (a.tahmin?.rank ?? 99) - (b.tahmin?.rank ?? 99))[0];

        pkg.tahminOzeti = {
            leader: leader?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: fieldSize,
            source: 'basari-pct',
            metricCount: leader?.tahmin?.metricCount ?? 0,
            fieldProfile: {
                fieldSize,
                bestFactorLabel: 'Başarı %',
                priorityPreview: topKeys
            }
        };
        return pkg;
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

    function evaluateTahminSuccess(flatEntries, bitisValueForSort, successBlend) {
        successBlend = successBlend || SUCCESS_BLEND;
        const byRace = groupByRace(flatEntries);
        let leaderTotal = 0;
        let leaderB1 = 0;
        let leaderB12 = 0;
        let leaderB123 = 0;
        let exact = 0;
        let exactTotal = 0;
        let noScoreRaces = 0;

        for (const entries of byRace.values()) {
            const pkg = { rows: entries.map(e => e.row) };
            attachRaceTahmin(pkg);
            const leader = entries.find(e => e.row.tahmin?.rank === 1);
            if (!leader || !leader.row.tahmin?.metricCount) {
                noScoreRaces++;
                continue;
            }
            const bitis = bitisValueForSort?.(leader);
            if (bitis == null || bitis < 1) continue;
            leaderTotal++;
            if (bitis === 1) leaderB1++;
            if (bitis <= 2) leaderB12++;
            if (bitis <= 3) leaderB123++;
        }

        for (const entry of flatEntries) {
            const b = bitisValueForSort?.(entry);
            if (b == null || b < 1) continue;
            exactTotal++;
            const rank = entry.row?.tahmin?.rank;
            if (rank != null && Number(rank) === Number(b)) exact++;
        }

        const leaderBlended = leaderTotal
            ? successBlend.b1 * (leaderB1 / leaderTotal)
                + successBlend.b12 * (leaderB12 / leaderTotal)
                + successBlend.b123 * (leaderB123 / leaderTotal)
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
            exactRate: exactTotal ? exact / exactTotal : 0,
            noScoreRaces
        };
    }

    function statCoverageInFieldSize(raceGroups, statKey) {
        let total = 0;
        let hit = 0;
        for (const entries of raceGroups || []) {
            for (const entry of entries) {
                total++;
                if (resolveBasariPct(entry.row, statKey) != null) hit++;
            }
        }
        return total ? hit / total : 0;
    }

    function evaluateStatLeaderBlended(raceGroups, statKey, bitisValueForSort) {
        let leaderTotal = 0;
        let leaderB1 = 0;
        let leaderB12 = 0;
        let leaderB123 = 0;

        for (const entries of raceGroups) {
            if (!entries.length) continue;
            const scored = entries.map(entry => ({
                entry,
                score: resolveBasariPct(entry.row, statKey)
            }));
            const hasData = scored.some(s => s.score != null);
            if (!hasData) continue;

            scored.sort((a, b) => {
                const sa = a.score ?? -1;
                const sb = b.score ?? -1;
                if (sb !== sa) return sb - sa;
                return (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0);
            });

            const leaderEntry = scored[0]?.entry;
            const bitis = bitisValueForSort?.(leaderEntry);
            if (bitis == null || bitis < 1) continue;
            leaderTotal++;
            if (bitis === 1) leaderB1++;
            if (bitis <= 2) leaderB12++;
            if (bitis <= 3) leaderB123++;
        }

        const blend = SUCCESS_BLEND;
        const leaderBlended = leaderTotal
            ? blend.b1 * (leaderB1 / leaderTotal)
                + blend.b12 * (leaderB12 / leaderTotal)
                + blend.b123 * (leaderB123 / leaderTotal)
            : 0;

        return { leaderBlended, leaderTotal, statKey };
    }

    function evaluateCombinedLeaderBlended(raceGroups, weights, bitisValueForSort) {
        let leaderTotal = 0;
        let leaderB1 = 0;
        let leaderB12 = 0;
        let leaderB123 = 0;

        for (const entries of raceGroups) {
            if (!entries.length) continue;
            const scored = entries.map(entry => ({
                entry,
                tahmin: computeRowScore(entry.row, weights)
            }));
            if (!scored.some(s => s.tahmin.metricCount > 0)) continue;
            scored.sort((a, b) => {
                const sa = a.tahmin.score;
                const sb = b.tahmin.score;
                if (sb !== sa) return sb - sa;
                return (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0);
            });
            const leaderEntry = scored[0]?.entry;
            const bitis = bitisValueForSort?.(leaderEntry);
            if (bitis == null || bitis < 1) continue;
            leaderTotal++;
            if (bitis === 1) leaderB1++;
            if (bitis <= 2) leaderB12++;
            if (bitis <= 3) leaderB123++;
        }

        const blend = SUCCESS_BLEND;
        return leaderTotal
            ? blend.b1 * (leaderB1 / leaderTotal)
                + blend.b12 * (leaderB12 / leaderTotal)
                + blend.b123 * (leaderB123 / leaderTotal)
            : 0;
    }

    function calibrateFromFlatEntries(flatEntries, bitisValueForSort) {
        if (!flatEntries?.length || !bitisValueForSort) return null;

        const byRace = groupByRace(flatEntries);
        const byFieldSize = {};
        for (const entries of byRace.values()) {
            const fs = entries.length;
            if (!byFieldSize[fs]) byFieldSize[fs] = [];
            byFieldSize[fs].push(entries);
        }

        const out = {};
        const list = [];

        for (const fsStr of Object.keys(byFieldSize).sort((a, b) => Number(a) - Number(b))) {
            const fs = Number(fsStr);
            const raceGroups = byFieldSize[fs];
            if (raceGroups.length < MIN_RACES) continue;

            const statResults = [];
            for (const { key } of STAT_CATALOG) {
                const coverage = statCoverageInFieldSize(raceGroups, key);
                if (coverage < MIN_STAT_COVERAGE) continue;
                const r = evaluateStatLeaderBlended(raceGroups, key, bitisValueForSort);
                if (r.leaderTotal >= 3) {
                    r.coverage = coverage;
                    r.adjustedBlended = r.leaderBlended * (0.35 + 0.65 * coverage);
                    statResults.push(r);
                }
            }
            statResults.sort((a, b) => b.adjustedBlended - a.adjustedBlended);

            const top = statResults.slice(0, 8).filter(s => s.adjustedBlended > 0);
            if (!top.length) continue;

            const weights = {};
            let sum = 0;
            for (let i = 0; i < top.length; i++) {
                const w = Math.max(5, Math.round((top[i].adjustedBlended * 100) * (top.length - i)));
                weights[top[i].statKey] = w;
                sum += w;
            }
            for (const k of Object.keys(weights)) {
                weights[k] = Math.round((weights[k] / sum) * 1000) / 10;
            }

            const normalized = normalizeWeights(weights);
            const combinedBlended = evaluateCombinedLeaderBlended(raceGroups, normalized, bitisValueForSort);

            out[fs] = normalized;
            list.push({
                fieldSize: fs,
                raceCount: raceGroups.length,
                leaderBlended: combinedBlended || top[0].leaderBlended,
                topStat: statLabel(top[0].statKey),
                topCoverage: top[0].coverage,
                weights: out[fs],
                preview: top.slice(0, 3).map(t => statLabel(t.statKey)),
                previewCoverage: top.slice(0, 3).map(t => Math.round((t.coverage || 0) * 100) + '%')
            });
        }

        weightsBySize = out;
        calibrationSummary = {
            bySize: out,
            list,
            builtAt: Date.now(),
            version: PROFILE_VERSION
        };
        saveWeights();
        return calibrationSummary;
    }

    async function loadAndCalibrateFromApi(buildBitisStatsFromEntries) {
        if (typeof GostergeScoringEngine === 'undefined'
            || !GostergeScoringEngine.buildFlatEntriesFromApi) {
            return null;
        }
        const { flatEntries, bitisMap } = await GostergeScoringEngine.buildFlatEntriesFromApi({
            IE: IstatistikEngine
        });
        const host = GostergeScoringEngine.makeBitisHost(
            flatEntries, bitisMap, buildBitisStatsFromEntries
        );
        return calibrateFromFlatEntries(flatEntries, host.bitisValueForSort);
    }

    function setWeightsBySize(map) {
        weightsBySize = map || null;
        if (map) {
            calibrationSummary = {
                bySize: map,
                list: Object.keys(map).map(fs => ({
                    fieldSize: Number(fs),
                    weights: map[fs],
                    preview: Object.keys(map[fs] || {}).slice(0, 3).map(statLabel)
                })),
                builtAt: Date.now(),
                version: PROFILE_VERSION
            };
        }
    }

    function saveWeights() {
        if (!weightsBySize) return false;
        try {
            if (typeof localStorage === 'undefined') return true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                version: PROFILE_VERSION,
                bySize: weightsBySize,
                list: calibrationSummary?.list || [],
                builtAt: calibrationSummary?.builtAt || Date.now()
            }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function loadWeights() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed.version !== PROFILE_VERSION || !parsed.bySize) return null;
            weightsBySize = parsed.bySize;
            calibrationSummary = {
                bySize: parsed.bySize,
                list: parsed.list || [],
                builtAt: parsed.builtAt || 0,
                version: parsed.version
            };
            return calibrationSummary;
        } catch (_) {
            return null;
        }
    }

    function getCalibrationSummary() {
        return calibrationSummary;
    }

    function getWeightsBySize() {
        return weightsBySize;
    }

    function isCalibrated() {
        return !!(weightsBySize && Object.keys(weightsBySize).length);
    }

    function renderStatusHtml() {
        if (!isCalibrated()) {
            return '<span style="color:#e65100">Başarı yüzdesi profili henüz yok — bitiş verisi yüklenince kalibre edilir</span>';
        }
        const parts = (calibrationSummary?.list || [])
            .sort((a, b) => (a.fieldSize || 0) - (b.fieldSize || 0))
            .map(p => p.fieldSize + ' at → ' + (p.preview || []).join(' · '));
        return '<strong>Başarı % profili aktif</strong> · ' + parts.join(' · ')
            + '<br><span style="color:#789;font-size:10px">Gösterge / renk / T9V / metrik etkisiz · profil: min %'
            + Math.round(MIN_STAT_COVERAGE * 100) + ' doluluk · yedek: GEN/MES/şehir</span>';
    }

    if (typeof localStorage !== 'undefined') loadWeights();

    return {
        attachRaceTahmin,
        computeRowScore,
        resolveBasariPct,
        lookupWeights,
        mergeProfileWeights,
        calibrateFromFlatEntries,
        loadAndCalibrateFromApi,
        evaluateTahminSuccess,
        statCoverageInFieldSize,
        setWeightsBySize,
        loadWeights,
        saveWeights,
        getCalibrationSummary,
        getWeightsBySize,
        isCalibrated,
        renderStatusHtml,
        STAT_CATALOG,
        DEFAULT_WEIGHTS,
        STORAGE_KEY,
        PROFILE_VERSION,
        MIN_STAT_COVERAGE,
        SUCCESS_BLEND
    };
})();
