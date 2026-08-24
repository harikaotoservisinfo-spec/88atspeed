/**
 * İstatistikler — ağırlıklı AĞ. ORT.3 bileşik tahmin skoru
 * Her metrik için etki % (0–100) doğrudan ayarlanır; +/− ile 1'er adım.
 */
const IstatistikTahminEngine = {
    INFLUENCE_STORAGE_KEY: '88atspeed-istat-metric-influence',
    LEGACY_WEIGHT_STORAGE_KEY: '88atspeed-istat-metric-weights',
    DEFAULT_INFLUENCE: 2,
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,

    CORE_ORT_KEYS: [
        { key: 'son8001OrtOzeti', label: 'SON800-1', weightId: 'son8001' },
        { key: 'son8002OrtOzeti', label: 'SON800-2', weightId: 'son8002' },
        { key: 'oran1OrtOzeti', label: '800-1 ORAN', weightId: 'oran1' },
        { key: 'oran2OrtOzeti', label: '800-2 ORAN', weightId: 'oran2' },
        { key: 'fark827OrtOzeti', label: '800Δ·7', weightId: 'fark827' },
        { key: 'ffOrtOzeti', label: 'FFΔ', weightId: 'ff' },
        { key: 'test8OrtOzeti', label: 'T8Δ', weightId: 't8' },
        { key: 'son800Dr1OrtOzeti', label: 'SON800·1DR', weightId: 'son800dr1' },
        { key: 'son800DrOrtOzeti', label: 'SON800·DR', weightId: 'son800dr' },
        { key: 'test1OrtOzeti', label: 'TEST1', weightId: 'test1' },
        { key: 'test2OrtOzeti', label: 'TEST2', weightId: 'test2' },
        { key: 'test3OrtOzeti', label: 'TEST3', weightId: 'test3' },
        { key: 'test123SiraliOrtOzeti', label: 'TEST·SIRA', weightId: 'testsira' },
        { key: 't1drOrtOzeti', label: 'T1×DR', weightId: 't1dr' }
    ],

    _influenceCache: null,

    _allWeightIds(extraSections) {
        const ids = this.CORE_ORT_KEYS.map(d => d.weightId);
        for (const sec of extraSections || []) {
            if (sec.id) ids.push(sec.id);
        }
        return ids;
    },

    _loadInfluences() {
        if (this._influenceCache) return this._influenceCache;
        try {
            const raw = localStorage.getItem(this.INFLUENCE_STORAGE_KEY);
            if (raw) {
                this._influenceCache = JSON.parse(raw);
                return this._influenceCache;
            }
        } catch (_) {}
        this._influenceCache = {};
        return this._influenceCache;
    },

    _saveInfluences() {
        try {
            localStorage.setItem(this.INFLUENCE_STORAGE_KEY, JSON.stringify(this._influenceCache || {}));
        } catch (_) {}
    },

    /** Eski çarpan (0–20) kayıtlarını temizle */
    _clearLegacyWeights() {
        try {
            localStorage.removeItem(this.LEGACY_WEIGHT_STORAGE_KEY);
        } catch (_) {}
    },

    getInfluences() {
        return { ...this._loadInfluences() };
    },

    /** Geriye uyumluluk */
    getWeights() {
        return this.getInfluences();
    },

    getInfluence(weightId) {
        const v = this._loadInfluences()[weightId];
        return v != null ? v : this.DEFAULT_INFLUENCE;
    },

    /** Geriye uyumluluk */
    getWeight(weightId) {
        return this.getInfluence(weightId);
    },

    setInfluence(weightId, value) {
        const v = Math.max(
            this.MIN_INFLUENCE,
            Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0))
        );
        this._loadInfluences();
        this._influenceCache[weightId] = v;
        this._saveInfluences();
        return v;
    },

    adjustInfluence(weightId, delta) {
        const step = delta > 0 ? this.INFLUENCE_STEP : -this.INFLUENCE_STEP;
        return this.setInfluence(weightId, this.getInfluence(weightId) + step);
    },

    /** Geriye uyumluluk */
    adjustWeight(weightId, delta) {
        return this.adjustInfluence(weightId, delta);
    },

    resetWeights() {
        this._influenceCache = {};
        this._saveInfluences();
        this._clearLegacyWeights();
    },

    /** Gösterim: doğrudan etki % */
    getInfluencePct(weightId) {
        return this.getInfluence(weightId);
    },

    _ortPct(oz) {
        if (!oz) return null;
        if (oz.ort3?.pct != null) return oz.ort3.pct;
        if (oz.agirlikli?.pct != null) return oz.agirlikli.pct;
        if (oz.ort2?.pct != null) return oz.ort2.pct;
        if (oz.ort1?.pct != null) return oz.ort1.pct;
        return null;
    },

    computeRowTahmin(row, extraSections, influences) {
        influences = influences || this.getInfluences();
        const terms = [];

        for (const def of this.CORE_ORT_KEYS) {
            const pct = this._ortPct(row[def.key]);
            const weight = influences[def.weightId] ?? this.DEFAULT_INFLUENCE;
            if (pct != null && weight > 0) {
                terms.push({
                    weightId: def.weightId,
                    label: def.label,
                    pct,
                    weight,
                    source: 'core'
                });
            }
        }
        for (const sec of extraSections || []) {
            const pct = this._ortPct(row[sec.ortKey]);
            const weight = influences[sec.id] ?? this.DEFAULT_INFLUENCE;
            if (pct != null && weight > 0) {
                terms.push({
                    weightId: sec.id,
                    label: sec.label,
                    pct,
                    weight,
                    source: 'extra'
                });
            }
        }

        if (!terms.length) {
            return { pct: null, rank: null, metricCount: 0, weightSum: 0, terms: [], topTerms: [] };
        }

        let weightedSum = 0;
        let weightSum = 0;
        for (const t of terms) {
            weightedSum += t.pct * t.weight;
            weightSum += t.weight;
        }
        const pct = Math.round(weightedSum / weightSum);
        const topTerms = [...terms].sort((a, b) => (b.pct * b.weight) - (a.pct * a.weight)).slice(0, 8);
        return { pct, metricCount: terms.length, weightSum, terms, topTerms };
    },

    attachRaceTahmin(pkg, influences) {
        const extraSections = pkg.extraSections || [];
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: this.computeRowTahmin(row, extraSections, influences)
        }));
        scored.sort((a, b) => {
            const pa = a.tahmin.pct ?? -1;
            const pb = b.tahmin.pct ?? -1;
            if (pb !== pa) return pb - pa;
            const wa = a.tahmin.weightSum;
            const wb = b.tahmin.weightSum;
            if (wb !== wa) return wb - wa;
            return (a.row.no || 0) - (b.row.no || 0);
        });
        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = i + 1;
            scored[i].row.tahmin = scored[i].tahmin;
        }
        pkg.tahminOzeti = {
            leader: scored[0]?.row?.name || null,
            leaderPct: scored[0]?.tahmin?.pct ?? null,
            horseCount: scored.length
        };
        return pkg;
    },

    analyzeCalibration(pkg, actualOrder) {
        if (!actualOrder?.length) return null;
        const byName = new Map();
        for (const e of actualOrder) {
            byName.set(String(e.name).toUpperCase().trim(), e.finish);
        }
        const extraSections = pkg.extraSections || [];
        const perMetric = [];
        for (const def of this.CORE_ORT_KEYS) {
            perMetric.push(this._metricRankReport(pkg.rows, def.label, r => this._ortPct(r[def.key]), byName));
        }
        for (const sec of extraSections) {
            perMetric.push(this._metricRankReport(pkg.rows, sec.label, r => this._ortPct(r[sec.ortKey]), byName));
        }
        const winner = actualOrder.find(e => e.finish === 1);
        const winnerRow = winner
            ? pkg.rows.find(r => String(r.name).toUpperCase().trim() === String(winner.name).toUpperCase().trim())
            : null;
        return {
            winner: winner?.name || null,
            compositeRank: winnerRow?.tahmin?.rank ?? null,
            compositePct: winnerRow?.tahmin?.pct ?? null,
            metricsWhereWinnerFirst: perMetric.filter(m => m.winnerRank === 1).map(m => m.label),
            perMetric: perMetric.sort((a, b) => (a.winnerRank || 99) - (b.winnerRank || 99))
        };
    },

    _metricRankReport(rows, label, getPct, finishByName) {
        const ranked = rows
            .map(r => ({ name: r.name, pct: getPct(r) }))
            .filter(e => e.pct != null)
            .sort((a, b) => b.pct - a.pct);
        const winnerEntry = [...finishByName.entries()].find(([, f]) => f === 1);
        const winnerName = winnerEntry ? winnerEntry[0] : null;
        let winnerRank = null;
        let winnerPct = null;
        if (winnerName) {
            const idx = ranked.findIndex(e => String(e.name).toUpperCase().trim() === winnerName);
            if (idx >= 0) {
                winnerRank = idx + 1;
                winnerPct = ranked[idx].pct;
            }
        }
        return { label, winnerRank, winnerPct, horseCount: ranked.length };
    }
};
