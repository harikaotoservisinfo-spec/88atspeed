/**
 * TAHMİN — yalnızca geçmiş başarı yüzdeleri (İLK1/2/3, Ş/M, mesafe, şehir).
 * Gösterge merdiveni, renk, T9V, metrik derinlikleri ve görsel profil etkisiz.
 * At sayısına göre PUANLAMA TEST bitiş verisinden hangi yüzdenin işe yaradığı öğrenilir.
 */
const BasariPctScoringEngine = (function () {
    const STORAGE_KEY = 'basariPctWeightsBySize';
    const PROFILE_VERSION = 1;
    const MIN_RACES = 5;
    const SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    /** Tüm aday başarı yüzdesi alanları */
    const STAT_CATALOG = [
        { key: 'smIlk1.gun15', label: '15G Ş/M İLK1' },
        { key: 'smIlk1.ay1', label: '1AY Ş/M İLK1' },
        { key: 'smIlk1.ay3', label: '3AY Ş/M İLK1' },
        { key: 'smIlk2.gun15', label: '15G Ş/M İLK2' },
        { key: 'smIlk2.ay1', label: '1AY Ş/M İLK2' },
        { key: 'smIlk3.gun15', label: '15G Ş/M İLK3' },
        { key: 'mesafeIlk1.gun15', label: '15G MES İLK1' },
        { key: 'mesafeIlk1.ay1', label: '1AY MES İLK1' },
        { key: 'mesafeIlk1.ay3', label: '3AY MES İLK1' },
        { key: 'mesafeIlk2.gun15', label: '15G MES İLK2' },
        { key: 'genelIlk1.gun15', label: '15G GEN İLK1' },
        { key: 'genelIlk1.ay1', label: '1AY GEN İLK1' },
        { key: 'genelIlk1.ay3', label: '3AY GEN İLK1' },
        { key: 'genelIlk2.gun15', label: '15G GEN İLK2' },
        { key: 'genelIlk3.gun15', label: '15G GEN İLK3' },
        { key: 'sehir', label: 'Şehir deneyimi' }
    ];

    const DEFAULT_WEIGHTS = {
        'smIlk1.gun15': 28,
        'smIlk1.ay1': 22,
        'smIlk2.gun15': 14,
        'mesafeIlk1.gun15': 12,
        'genelIlk1.gun15': 10,
        'smIlk1.ay3': 8,
        'sehir': 6
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

    function lookupWeights(fieldSize) {
        const fs = Number(fieldSize);
        if (!Number.isFinite(fs) || fs <= 0) return normalizeWeights(DEFAULT_WEIGHTS);
        const map = weightsBySize || {};
        const direct = map[fs] || map[String(fs)];
        if (direct) return normalizeWeights(direct);
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
        return normalizeWeights(map[nearest] || map[String(nearest)] || DEFAULT_WEIGHTS);
    }

    function computeRowScore(row, weights) {
        const w = normalizeWeights(weights);
        const terms = [];
        let score = 0;
        for (const [key, weight] of Object.entries(w)) {
            const pct = resolveBasariPct(row, key);
            if (pct == null) continue;
            const points = Math.round((pct * weight) / 100);
            if (points <= 0) continue;
            score += points;
            terms.push({
                label: statLabel(key),
                ruleLabel: statLabel(key) + ' %' + pct,
                points,
                pct,
                metricId: key
            });
        }
        terms.sort((a, b) => b.points - a.points);
        return {
            score,
            pct: null,
            rank: null,
            terms,
            topTerms: terms.slice(0, 6),
            metricCount: terms.length,
            source: 'basari-pct',
            weightKeys: Object.keys(w)
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
                const r = evaluateStatLeaderBlended(raceGroups, key, bitisValueForSort);
                if (r.leaderTotal >= 3) statResults.push(r);
            }
            statResults.sort((a, b) => b.leaderBlended - a.leaderBlended);

            const top = statResults.slice(0, 6).filter(s => s.leaderBlended > 0);
            if (!top.length) continue;

            const weights = {};
            let sum = 0;
            for (let i = 0; i < top.length; i++) {
                const w = Math.max(5, Math.round((top[i].leaderBlended * 100) * (top.length - i)));
                weights[top[i].statKey] = w;
                sum += w;
            }
            for (const k of Object.keys(weights)) {
                weights[k] = Math.round((weights[k] / sum) * 1000) / 10;
            }

            out[fs] = normalizeWeights(weights);
            list.push({
                fieldSize: fs,
                raceCount: raceGroups.length,
                leaderBlended: top[0].leaderBlended,
                topStat: statLabel(top[0].statKey),
                weights: out[fs],
                preview: top.slice(0, 3).map(t => statLabel(t.statKey))
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

    function saveWeights() {
        if (!weightsBySize) return false;
        try {
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
            + '<br><span style="color:#789;font-size:10px">Gösterge / renk / T9V / metrik faktörleri TAHMİN\'e girmez</span>';
    }

    loadWeights();

    return {
        attachRaceTahmin,
        computeRowScore,
        resolveBasariPct,
        lookupWeights,
        calibrateFromFlatEntries,
        loadAndCalibrateFromApi,
        loadWeights,
        saveWeights,
        getCalibrationSummary,
        getWeightsBySize,
        isCalibrated,
        renderStatusHtml,
        STAT_CATALOG,
        DEFAULT_WEIGHTS,
        STORAGE_KEY,
        PROFILE_VERSION
    };
})();
