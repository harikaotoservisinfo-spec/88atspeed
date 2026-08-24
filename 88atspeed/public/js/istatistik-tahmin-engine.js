/**
 * İstatistikler — sütun bazlı ağırlıklı TAHMİN (derinlik + AĞ. ORT.*)
 * Etki ID: {grupId}:d0..dN, {grupId}:ort0..ort3
 */
const IstatistikTahminEngine = {
    INFLUENCE_STORAGE_KEY: '88atspeed-istat-metric-influence-v2',
    LEGACY_KEYS: [
        '88atspeed-istat-metric-influence',
        '88atspeed-istat-metric-weights'
    ],
    DEFAULT_INFLUENCE: 1,
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,

    ORT_SLOTS: [
        { key: 'agirlikli', slot: 'ort0', short: 'AĞ.ORT' },
        { key: 'ort1', slot: 'ort1', short: 'AĞ.ORT.1' },
        { key: 'ort2', slot: 'ort2', short: 'AĞ.ORT.2' },
        { key: 'ort3', slot: 'ort3', short: 'AĞ.ORT.3' }
    ],

    CORE_GROUPS: [
        { id: 'son8001', depthsKey: 'son8001Depths', ortKey: 'son8001OrtOzeti', label: 'SON800-1' },
        { id: 'son8002', depthsKey: 'son8002Depths', ortKey: 'son8002OrtOzeti', label: 'SON800-2' },
        { id: 'oran1', depthsKey: 'oran1Depths', ortKey: 'oran1OrtOzeti', label: '800-1 ORAN' },
        { id: 'oran2', depthsKey: 'oran2Depths', ortKey: 'oran2OrtOzeti', label: '800-2 ORAN' },
        { id: 'fark827', depthsKey: 'fark827Depths', ortKey: 'fark827OrtOzeti', label: '800Δ·7' },
        { id: 'ff', depthsKey: 'ffDepths', ortKey: 'ffOrtOzeti', label: 'FFΔ' },
        { id: 't8', depthsKey: 'test8Depths', ortKey: 'test8OrtOzeti', label: 'T8Δ' },
        { id: 'son800dr1', depthsKey: 'son800Dr1Depths', ortKey: 'son800Dr1OrtOzeti', label: 'SON800·1DR' },
        { id: 'son800dr', depthsKey: 'son800DrDepths', ortKey: 'son800DrOrtOzeti', label: 'SON800·DR' },
        { id: 'test1', depthsKey: 'test1Depths', ortKey: 'test1OrtOzeti', label: 'TEST1' },
        { id: 'test2', depthsKey: 'test2Depths', ortKey: 'test2OrtOzeti', label: 'TEST2' },
        { id: 'test3', depthsKey: 'test3Depths', ortKey: 'test3OrtOzeti', label: 'TEST3' },
        { id: 'testsira', depthsKey: 'test123SiraliDepths', ortKey: 'test123SiraliOrtOzeti', label: 'TEST·SIRA' },
        { id: 't1dr', depthsKey: 't1drDepths', ortKey: 't1drOrtOzeti', label: 'T1×DR' }
    ],

    /** Geriye uyumluluk */
    CORE_ORT_KEYS: null,

    _influenceCache: null,

    _initCompat() {
        if (!this.CORE_ORT_KEYS) {
            this.CORE_ORT_KEYS = this.CORE_GROUPS.map(g => ({
                key: g.ortKey,
                label: g.label,
                weightId: g.id,
                depthsKey: g.depthsKey
            }));
        }
    },

    slotId(groupId, slot) {
        return groupId + ':' + slot;
    },

    depthSlotId(groupId, depth) {
        return this.slotId(groupId, 'd' + depth);
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

    _clearLegacy() {
        for (const k of this.LEGACY_KEYS) {
            try { localStorage.removeItem(k); } catch (_) {}
        }
    },

    getInfluences() {
        return { ...this._loadInfluences() };
    },

    getWeights() {
        return this.getInfluences();
    },

    getInfluence(weightId) {
        const v = this._loadInfluences()[weightId];
        return v != null ? v : this.DEFAULT_INFLUENCE;
    },

    getWeight(weightId) {
        return this.getInfluence(weightId);
    },

    getInfluencePct(weightId) {
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

    adjustWeight(weightId, delta) {
        return this.adjustInfluence(weightId, delta);
    },

    resetWeights() {
        this._influenceCache = {};
        this._saveInfluences();
        this._clearLegacy();
    },

    _pushTerm(terms, influences, weightId, label, pct) {
        if (pct == null) return;
        const weight = influences[weightId] ?? this.DEFAULT_INFLUENCE;
        if (weight <= 0) return;
        terms.push({ weightId, label, pct, weight });
    },

    _collectGroupTerms(groupId, label, depths, ortOzeti, influences, terms, depthLabels) {
        if (depths?.length) {
            for (let d = 0; d < depths.length; d++) {
                const cell = depths[d];
                const dl = depthLabels ? depthLabels(d) : (d === 0 ? 'SON' : d + ' ÖNCE');
                this._pushTerm(
                    terms, influences,
                    this.depthSlotId(groupId, d),
                    label + ' · ' + dl,
                    cell?.pct ?? null
                );
            }
        }
        if (ortOzeti) {
            for (const s of this.ORT_SLOTS) {
                this._pushTerm(
                    terms, influences,
                    this.slotId(groupId, s.slot),
                    label + ' · ' + s.short,
                    ortOzeti[s.key]?.pct ?? null
                );
            }
        }
    },

    computeRowTahmin(row, extraSections, influences) {
        this._initCompat();
        influences = influences || this.getInfluences();
        const terms = [];

        for (const g of this.CORE_GROUPS) {
            this._collectGroupTerms(
                g.id, g.label,
                row[g.depthsKey], row[g.ortKey],
                influences, terms
            );
        }
        for (const sec of extraSections || []) {
            this._collectGroupTerms(
                sec.id, sec.label,
                row[sec.depthsKey], row[sec.ortKey],
                influences, terms
            );
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
        const topTerms = [...terms].sort((a, b) => (b.pct * b.weight) - (a.pct * a.weight)).slice(0, 10);
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
        const winner = actualOrder.find(e => e.finish === 1);
        const winnerRow = winner
            ? pkg.rows.find(r => String(r.name).toUpperCase().trim() === String(winner.name).toUpperCase().trim())
            : null;
        return {
            winner: winner?.name || null,
            compositeRank: winnerRow?.tahmin?.rank ?? null,
            compositePct: winnerRow?.tahmin?.pct ?? null
        };
    }
};

IstatistikTahminEngine._initCompat();
