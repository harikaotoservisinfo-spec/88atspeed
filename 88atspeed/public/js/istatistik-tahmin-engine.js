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
    DEFAULT_PERFECT100_INFLUENCE: 0,
    PERFECT100_AUTO_MULTIPLIER: 2,
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,
    PERFECT100_SUFFIX: ':p100',

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
        { id: 'test1', depthsKey: 'test1Depths', ortKey: 'test1OrtOzeti', label: 'TEST1', defaultInfluence: 20 },
        { id: 'test2', depthsKey: 'test2Depths', ortKey: 'test2OrtOzeti', label: 'TEST2' },
        { id: 'test3', depthsKey: 'test3Depths', ortKey: 'test3OrtOzeti', label: 'TEST3', defaultInfluence: 5 },
        { id: 'testsira', depthsKey: 'test123SiraliDepths', ortKey: 'test123SiraliOrtOzeti', label: 'TEST·SIRA' },
        { id: 't1dr', depthsKey: 't1drDepths', ortKey: 't1drOrtOzeti', label: 'T1×DR' }
    ],

    /** Şehir, dönem ve ilk-oran sütunları (derinlik grid değil) */
    SIMPLE_COLUMN_GROUPS: [
        {
            id: 'sehir', grpClass: 'istat-grp-sehir', label: 'ŞEHİR DENEY.',
            columns: [{ slot: 'c0', short: 'ŞEHİR', getPct: row => row.sehir?.pct ?? null }]
        },
        {
            id: 'donem', grpClass: 'istat-grp-donem', label: 'DÖNEM',
            columns: [
                { slot: 'ay3', short: 'SON 3 AY', getPct: row => row.ay3?.pct ?? null },
                { slot: 'ay1', short: 'SON 1 AY', getPct: row => row.ay1?.pct ?? null },
                { slot: 'gun15', short: 'SON 15 GÜN', getPct: row => row.gun15?.pct ?? null }
            ]
        },
        {
            id: 'genelIlk3', grpClass: 'istat-grp-ilk3', label: 'GENEL İLK3',
            columns: [
                { slot: 'ay3', short: '3 AY İLK3', getPct: row => row.genelIlk3?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1 AY İLK3', getPct: row => row.genelIlk3?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G İLK3', getPct: row => row.genelIlk3?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'genelIlk2', grpClass: 'istat-grp-ilk2', label: 'GENEL İLK2',
            columns: [
                { slot: 'ay3', short: '3 AY İLK2', getPct: row => row.genelIlk2?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1 AY İLK2', getPct: row => row.genelIlk2?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G İLK2', getPct: row => row.genelIlk2?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'genelIlk1', grpClass: 'istat-grp-ilk1', label: 'GENEL İLK1',
            columns: [
                { slot: 'ay3', short: '3 AY İLK1', getPct: row => row.genelIlk1?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1 AY İLK1', getPct: row => row.genelIlk1?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G İLK1', getPct: row => row.genelIlk1?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'smIlk3', grpClass: 'istat-grp-sm3', label: 'Ş/M İLK3',
            columns: [
                { slot: 'ay3', short: '3AY Ş/MİLK3', getPct: row => row.smIlk3?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY Ş/MİLK3', getPct: row => row.smIlk3?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G Ş/MİLK3', getPct: row => row.smIlk3?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'smIlk2', grpClass: 'istat-grp-sm2', label: 'Ş/M İLK2',
            columns: [
                { slot: 'ay3', short: '3AY Ş/MİLK2', getPct: row => row.smIlk2?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY Ş/MİLK2', getPct: row => row.smIlk2?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G Ş/MİLK2', getPct: row => row.smIlk2?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'smIlk1', grpClass: 'istat-grp-sm1', label: 'Ş/M İLK1',
            columns: [
                { slot: 'ay3', short: '3AY Ş/MİLK1', getPct: row => row.smIlk1?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY Ş/MİLK1', getPct: row => row.smIlk1?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G Ş/MİLK1', getPct: row => row.smIlk1?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'mesafeIlk3', grpClass: 'istat-grp-mf3', label: 'MES İLK3',
            columns: [
                { slot: 'ay3', short: '3AY MESİLK3', getPct: row => row.mesafeIlk3?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY MESİLK3', getPct: row => row.mesafeIlk3?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G MESİLK3', getPct: row => row.mesafeIlk3?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'mesafeIlk2', grpClass: 'istat-grp-mf2', label: 'MES İLK2',
            columns: [
                { slot: 'ay3', short: '3AY MESİLK2', getPct: row => row.mesafeIlk2?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY MESİLK2', getPct: row => row.mesafeIlk2?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G MESİLK2', getPct: row => row.mesafeIlk2?.gun15?.pct ?? null }
            ]
        },
        {
            id: 'mesafeIlk1', grpClass: 'istat-grp-mf1', label: 'MES İLK1',
            columns: [
                { slot: 'ay3', short: '3AY MESİLK1', getPct: row => row.mesafeIlk1?.ay3?.pct ?? null },
                { slot: 'ay1', short: '1AY MESİLK1', getPct: row => row.mesafeIlk1?.ay1?.pct ?? null },
                { slot: 'gun15', short: '15G MESİLK1', getPct: row => row.mesafeIlk1?.gun15?.pct ?? null }
            ]
        }
    ],

    /** GÖSTERİM renklendirme bayrakları — derinlik hücresinde aktifse TAHMİN'e %100 terim ekler */
    GOSTERIM_FLAGS: [
        { id: 'maviKenar', short: 'Mavi kenar', label: 'GÖSTERİM · Mavi kenar', defaultInfluence: 5 },
        { id: 'maviKenarSira', short: 'Mavi·SIRA', label: 'GÖSTERİM · Mavi kenar (TEST·SIRA)', defaultInfluence: 3 },
        { id: 'maviKenarSon800', short: 'Mavi·S800', label: 'GÖSTERİM · Mavi kenar (SON800-1)', defaultInfluence: 3 },
        { id: 'kirmiziKenar', short: 'Kırmızı kenar', label: 'GÖSTERİM · Kırmızı kenar', defaultInfluence: 5 },
        { id: 'yesilSatir', short: 'Yeşil satır', label: 'GÖSTERİM · Yeşil satır', defaultInfluence: 3 },
        { id: 'gucluUyari', short: 'Güçlü uyarı', label: 'GÖSTERİM · Güçlü uyarı', defaultInfluence: 5 },
        { id: 'maviFosfor', short: 'Fosfor mavi', label: 'GÖSTERİM · Fosfor mavi', defaultInfluence: 3 },
        { id: 'pembeSatir', short: 'Pembe satır', label: 'GÖSTERİM · Pembe satır', defaultInfluence: 1 },
        { id: 'kirmiziTest', short: 'Kırmızı TEST', label: 'GÖSTERİM · Kırmızı TEST', defaultInfluence: 2 },
        { id: 'sariTest12', short: 'Sarı TEST1≈2', label: 'GÖSTERİM · Sarı TEST1≈TEST2', defaultInfluence: 2 },
        { id: 'test1EnIyi', short: 'TEST1 en iyi', label: 'GÖSTERİM · TEST1 en iyi', defaultInfluence: 1 },
        { id: 'test2EnIyi', short: 'TEST2 en iyi', label: 'GÖSTERİM · TEST2 en iyi', defaultInfluence: 1 },
        { id: 'test3EnIyi', short: 'TEST3 en iyi', label: 'GÖSTERİM · TEST3 en iyi', defaultInfluence: 1 },
        { id: 'sehirEslesme', short: 'Şehir eşleşme', label: 'GÖSTERİM · Şehir eşleşme', defaultInfluence: 1 },
        { id: 'mesafeEslesme', short: 'Mesafe eşleşme', label: 'GÖSTERİM · Mesafe eşleşme', defaultInfluence: 1 },
        { id: 'test23Yanip', short: 'TEST23 yanıp', label: 'GÖSTERİM · TEST23 yanıp sönen', defaultInfluence: 2 },
        { id: 't1drKirmizi', short: 'T1×DR kırmızı', label: 'GÖSTERİM · T1×DR kırmızı', defaultInfluence: 2 },
        { id: 't1drEnIyi2', short: 'T1×DR top2', label: 'GÖSTERİM · T1×DR en iyi 2', defaultInfluence: 2 }
    ],

    GOSTERIM_GROUP_ID: 'gosterim',

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

    perfect100SlotId(baseSlotId) {
        return baseSlotId + this.PERFECT100_SUFFIX;
    },

    isPerfect100SlotId(weightId) {
        return String(weightId).endsWith(this.PERFECT100_SUFFIX);
    },

    baseSlotIdFromPerfect100(weightId) {
        if (!this.isPerfect100SlotId(weightId)) return weightId;
        return String(weightId).slice(0, -this.PERFECT100_SUFFIX.length);
    },

    _groupIdFromBaseSlot(baseSlotId) {
        const idx = String(baseSlotId).indexOf(':');
        return idx >= 0 ? baseSlotId.slice(0, idx) : baseSlotId;
    },

    _defaultInfluenceForGroup(groupId) {
        if (groupId === this.GOSTERIM_GROUP_ID) return this.DEFAULT_INFLUENCE;
        const gos = this.GOSTERIM_FLAGS.find(f => f.id === groupId);
        if (gos?.defaultInfluence != null) return gos.defaultInfluence;
        const core = this.CORE_GROUPS.find(g => g.id === groupId);
        if (core?.defaultInfluence != null) return core.defaultInfluence;
        const simple = this.SIMPLE_COLUMN_GROUPS.find(g => g.id === groupId);
        if (simple?.defaultInfluence != null) return simple.defaultInfluence;
        return this.DEFAULT_INFLUENCE;
    },

    _defaultInfluenceForBaseSlot(baseSlotId) {
        const idx = String(baseSlotId).indexOf(':');
        if (idx < 0) return this.DEFAULT_INFLUENCE;
        const groupId = baseSlotId.slice(0, idx);
        const slot = baseSlotId.slice(idx + 1);
        if (groupId === this.GOSTERIM_GROUP_ID) {
            const gos = this.GOSTERIM_FLAGS.find(f => f.id === slot);
            if (gos?.defaultInfluence != null) return gos.defaultInfluence;
        }
        return this._defaultInfluenceForGroup(groupId);
    },

    gosterimSlotId(flagId) {
        return this.slotId(this.GOSTERIM_GROUP_ID, flagId);
    },

    _resolveBaseInfluence(influences, weightId) {
        if (influences && influences[weightId] != null) return influences[weightId];
        return this._defaultInfluenceForBaseSlot(weightId);
    },

    _resolvePerfect100Influence(influences, baseSlotId) {
        const key = this.perfect100SlotId(baseSlotId);
        if (influences && influences[key] != null) return influences[key];
        return this.DEFAULT_PERFECT100_INFLUENCE;
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
        if (this.isPerfect100SlotId(weightId)) {
            return this.getPerfect100Influence(this.baseSlotIdFromPerfect100(weightId));
        }
        const v = this._loadInfluences()[weightId];
        return v != null ? v : this._defaultInfluenceForBaseSlot(weightId);
    },

    getPerfect100Influence(baseSlotId) {
        const v = this._loadInfluences()[this.perfect100SlotId(baseSlotId)];
        return v != null ? v : this.DEFAULT_PERFECT100_INFLUENCE;
    },

    getWeight(weightId) {
        return this.getInfluence(weightId);
    },

    getInfluencePct(weightId) {
        return this.getInfluence(weightId);
    },

    setInfluence(weightId, value) {
        if (this.isPerfect100SlotId(weightId)) {
            return this.setPerfect100Influence(this.baseSlotIdFromPerfect100(weightId), value);
        }
        const v = Math.max(
            this.MIN_INFLUENCE,
            Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0))
        );
        this._loadInfluences();
        this._influenceCache[weightId] = v;
        this._saveInfluences();
        return v;
    },

    setPerfect100Influence(baseSlotId, value) {
        const v = Math.max(
            this.MIN_INFLUENCE,
            Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0))
        );
        this._loadInfluences();
        this._influenceCache[this.perfect100SlotId(baseSlotId)] = v;
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
        const baseWeight = this._resolveBaseInfluence(influences, weightId);
        const p100Boost = pct === 100
            ? this._resolvePerfect100Influence(influences, weightId)
            : 0;
        const effectiveBase = pct === 100
            ? baseWeight * this.PERFECT100_AUTO_MULTIPLIER
            : baseWeight;
        const weight = effectiveBase + p100Boost;
        if (weight <= 0) return;
        terms.push({ weightId, label, pct, weight, baseWeight, effectiveBase, p100Boost });
    },

    _collectGosterimFlagTerms(cell, groupLabel, depthLabel, influences, terms) {
        if (!cell?.gosterim) return;
        for (const f of this.GOSTERIM_FLAGS) {
            if (!cell.gosterim[f.id]) continue;
            this._pushTerm(
                terms, influences,
                this.gosterimSlotId(f.id),
                groupLabel + ' · ' + depthLabel + ' · ' + f.short,
                100
            );
        }
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
                this._collectGosterimFlagTerms(cell, label, dl, influences, terms);
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

    _collectSimpleColumnTerms(row, influences, terms) {
        for (const g of this.SIMPLE_COLUMN_GROUPS) {
            for (const col of g.columns) {
                this._pushTerm(
                    terms, influences,
                    this.slotId(g.id, col.slot),
                    g.label + ' · ' + col.short,
                    col.getPct(row)
                );
            }
        }
    },

    computeRowTahmin(row, extraSections, influences) {
        this._initCompat();
        influences = influences || this.getInfluences();
        const terms = [];

        this._collectSimpleColumnTerms(row, influences, terms);
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
