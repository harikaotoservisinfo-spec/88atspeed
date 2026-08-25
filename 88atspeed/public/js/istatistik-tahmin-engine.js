/**
 * İstatistikler — metrik grubu bazlı GÖSTERİM görsel profil + trend TAHMİN.
 * Etki ID: {metricId}:visual:{profileId}  örn. son8001:visual:maviKenar
 */
const IstatistikTahminEngine = {
    INFLUENCE_STORAGE_KEY: '88atspeed-istat-visual-influence-v2',
    LEGACY_KEYS: [
        '88atspeed-istat-visual-influence-v1',
        '88atspeed-istat-metric-influence-v2',
        '88atspeed-istat-metric-influence',
        '88atspeed-istat-metric-weights'
    ],
    DEFAULT_INFLUENCE: 10,
    DEFAULT_SELECTED_METRIC: 'son8001',
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,

    VISUAL_GROUP: 'visual',
    TREND_GROUP: 'trend',
    ORT_GROUP: 'ort',

    VISUAL_PROFILES: [
        { id: 'maviKenar', short: 'Mavi kenar', label: 'Mavi kenar', defaultInfluence: 15 },
        { id: 'kirmiziKenar', short: 'Kırmızı kenar', label: 'Kırmızı kenar', defaultInfluence: 12 },
        { id: 'sari', short: 'Sarı', label: 'Sarı hücre (çizgisiz)', defaultInfluence: 10 },
        { id: 'sariMavi', short: 'Sarı+mavi', label: 'Sarı + mavi kenar', defaultInfluence: 18 },
        { id: 'sariKirmizi', short: 'Sarı+kırmızı', label: 'Sarı + kırmızı kenar', defaultInfluence: 16 },
        { id: 'yesil', short: 'Yeşil', label: 'Yeşil hücre (çizgisiz)', defaultInfluence: 10 },
        { id: 'yesilMavi', short: 'Yeşil+mavi', label: 'Yeşil + mavi kenar', defaultInfluence: 20 },
        { id: 'yesilKirmizi', short: 'Yeşil+kırmızı', label: 'Yeşil + kırmızı kenar', defaultInfluence: 18 },
        { id: 'yesilAcik', short: 'Açık yeşil', label: 'Açık yeşil satır', defaultInfluence: 8 },
        { id: 'gucluUyari', short: 'Güçlü uyarı', label: 'Güçlü uyarı satırı', defaultInfluence: 14 },
        { id: 'maviFosfor', short: 'Fosfor mavi', label: 'Fosfor mavi satır', defaultInfluence: 10 }
    ],

    TREND_PROFILES: [
        { id: 'trendUp3', short: 'Son 3 ↑', label: 'Son 3 derinlik yükseliş', defaultInfluence: 12 },
        { id: 'trendDown3', short: 'Son 3 ↓', label: 'Son 3 derinlik düşüş', defaultInfluence: 4 },
        { id: 'trendUpSon', short: 'SON ↑', label: 'SON > 1 ÖNCE', defaultInfluence: 6 },
        { id: 'trendDownSon', short: 'SON ↓', label: 'SON < 1 ÖNCE', defaultInfluence: 3 }
    ],

    /** T9V — KMΔ + |TEST9| 0'a yakın: gerçek sinyal seçicileri */
    T9V_SIGNAL_PROFILES: [
        { id: 'hucreVar', short: 'Hücre var', label: 'KM uyumlu + T9 verisi (hücre dolu)', defaultInfluence: 5 },
        { id: 'kmUymuyor', short: 'KM uyumsuz', label: 'KMΔ qualifies=false → hücre yok', defaultInfluence: 0 },
        { id: 't9VeriYok', short: 'T9 eksik', label: 'KM uyumlu ama T9 verisi yok', defaultInfluence: 0 },
        { id: 'pct100', short: '%100', label: '|TEST9| en düşük (isBest)', defaultInfluence: 20 },
        { id: 'pct90', short: '%90-99', label: 'T9V %90–99', defaultInfluence: 16 },
        { id: 'pct75', short: '%75-89', label: 'T9V %75–89', defaultInfluence: 12 },
        { id: 'pct50', short: '%50-74', label: 'T9V %50–74', defaultInfluence: 8 },
        { id: 'pct25', short: '%25-49', label: 'T9V %25–49', defaultInfluence: 4 },
        { id: 'pctLow', short: '%1-24', label: 'T9V %1–24', defaultInfluence: 2 },
        { id: 'kmEnIyi', short: 'KM en iyi', label: 'KMΔ isBest aynı derinlikte', defaultInfluence: 14 },
        { id: 'kmPct100', short: 'KM %100', label: 'KMΔ pct=100', defaultInfluence: 10 },
        { id: 't9EnIyi', short: 'T9 en iyi', label: 'T9Δ isBest (tüm atlar)', defaultInfluence: 12 },
        { id: 't9Pct100', short: 'T9 %100', label: 'T9Δ pct=100', defaultInfluence: 10 }
    ],

    T9V_ORT_PROFILES: [
        { id: 'ortAg100', short: 'AĞ.ORT %100', label: 'Ağırlıklı ort. %100', defaultInfluence: 18 },
        { id: 'ortAg75', short: 'AĞ.ORT %75+', label: 'Ağırlıklı ort. ≥%75', defaultInfluence: 12 },
        { id: 'ortAg50', short: 'AĞ.ORT %50+', label: 'Ağırlıklı ort. %50–74', defaultInfluence: 6 },
        { id: 'ortAgLow', short: 'AĞ.ORT düşük', label: 'Ağırlıklı ort. %1–49', defaultInfluence: 2 },
        { id: 'ort3High', short: 'AĞ.ORT.3 yüksek', label: 'AĞ. ORT.3 ≥%75', defaultInfluence: 10 },
        { id: 'ort3Mid', short: 'AĞ.ORT.3 orta', label: 'AĞ. ORT.3 %50–74', defaultInfluence: 5 }
    ],

    /** Metrik → seçici kataloğu (UI + varsayılan etkiler) */
    METRIC_SELECTOR_CATALOGS: {
        default: {
            title: 'Görsel profiller',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: null },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: null }
            ]
        },
        t9v: {
            title: 'T9V sinyalleri',
            sections: [
                { kind: 'visual', title: 'T9V — KMΔ + |TEST9|', profiles: 'T9V_SIGNAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' },
                { kind: 'ort', title: 'AĞ. ORT.', profiles: 'T9V_ORT_PROFILES' }
            ]
        }
    },

    CORE_GROUPS: [
        { id: 'son8001', depthsKey: 'son8001Depths', label: 'SON800-1' },
        { id: 'son8002', depthsKey: 'son8002Depths', label: 'SON800-2' },
        { id: 'oran1', depthsKey: 'oran1Depths', label: '800-1 ORAN' },
        { id: 'oran2', depthsKey: 'oran2Depths', label: '800-2 ORAN' },
        { id: 'fark827', depthsKey: 'fark827Depths', label: '800Δ·7' },
        { id: 'ff', depthsKey: 'ffDepths', label: 'FFΔ' },
        { id: 't8', depthsKey: 'test8Depths', label: 'T8Δ' },
        { id: 'son800dr1', depthsKey: 'son800Dr1Depths', label: 'SON800·1DR' },
        { id: 'son800dr', depthsKey: 'son800DrDepths', label: 'SON800·DR' },
        { id: 'test1', depthsKey: 'test1Depths', label: 'TEST1' },
        { id: 'test2', depthsKey: 'test2Depths', label: 'TEST2' },
        { id: 'test3', depthsKey: 'test3Depths', label: 'TEST3' },
        { id: 'testsira', depthsKey: 'test123SiraliDepths', label: 'TEST·SIRA' },
        { id: 't1dr', depthsKey: 't1drDepths', label: 'T1×DR' }
    ],

    SIMPLE_COLUMN_GROUPS: [
        { grpClass: 'istat-grp-sehir', columns: [{ short: 'ŞEHİR' }] },
        { grpClass: 'istat-grp-donem', columns: [{ short: 'SON 3 AY' }, { short: 'SON 1 AY' }, { short: 'SON 15 GÜN' }] },
        { grpClass: 'istat-grp-ilk3', columns: [{ short: '3 AY İLK3' }, { short: '1 AY İLK3' }, { short: '15G İLK3' }] },
        { grpClass: 'istat-grp-ilk2', columns: [{ short: '3 AY İLK2' }, { short: '1 AY İLK2' }, { short: '15G İLK2' }] },
        { grpClass: 'istat-grp-ilk1', columns: [{ short: '3 AY İLK1' }, { short: '1 AY İLK1' }, { short: '15G İLK1' }] },
        { grpClass: 'istat-grp-sm3', columns: [{ short: '3AY Ş/MİLK3' }, { short: '1AY Ş/MİLK3' }, { short: '15G Ş/MİLK3' }] },
        { grpClass: 'istat-grp-sm2', columns: [{ short: '3AY Ş/MİLK2' }, { short: '1AY Ş/MİLK2' }, { short: '15G Ş/MİLK2' }] },
        { grpClass: 'istat-grp-sm1', columns: [{ short: '3AY Ş/MİLK1' }, { short: '1AY Ş/MİLK1' }, { short: '15G Ş/MİLK1' }] },
        { grpClass: 'istat-grp-mf3', columns: [{ short: '3AY MESİLK3' }, { short: '1AY MESİLK3' }, { short: '15G MESİLK3' }] },
        { grpClass: 'istat-grp-mf2', columns: [{ short: '3AY MESİLK2' }, { short: '1AY MESİLK2' }, { short: '15G MESİLK2' }] },
        { grpClass: 'istat-grp-mf1', columns: [{ short: '3AY MESİLK1' }, { short: '1AY MESİLK1' }, { short: '15G MESİLK1' }] }
    ],

    _storeCache: null,
    _draftByMetric: null,

    CALC_MODE_SOLO: 'solo',
    CALC_MODE_ALL: 'all',

    _profileKey(kind, profileId) {
        return kind + ':' + profileId;
    },

    metricWeightId(metricId, kind, profileId) {
        return metricId + ':' + kind + ':' + profileId;
    },

    visualSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.VISUAL_GROUP, profileId);
    },

    trendSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.TREND_GROUP, profileId);
    },

    ortSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.ORT_GROUP, profileId);
    },

    getMetricSelectorCatalog(metricId) {
        return this.METRIC_SELECTOR_CATALOGS[metricId]
            || this.METRIC_SELECTOR_CATALOGS.default;
    },

    _resolveProfileList(refName) {
        if (!refName) return this.VISUAL_PROFILES;
        if (refName === 'TREND_PROFILES') return this.TREND_PROFILES;
        if (this[refName]) return this[refName];
        return this.VISUAL_PROFILES;
    },

    getMetricProfileSections(metricId) {
        const cat = this.getMetricSelectorCatalog(metricId);
        return cat.sections.map(sec => ({
            kind: sec.kind,
            title: sec.title,
            profiles: this._resolveProfileList(sec.profiles)
        }));
    },

    getProfileDef(metricId, kind, profileId) {
        for (const sec of this.getMetricProfileSections(metricId)) {
            if (sec.kind !== kind) continue;
            const p = sec.profiles.find(x => x.id === profileId);
            if (p) return p;
        }
        return null;
    },

    /** Geriye uyumluluk — tek argümanlı eski çağrılar */
    gosterimSlotId(metricIdOrProfile, profileId) {
        if (profileId == null) return this._profileKey(this.VISUAL_GROUP, metricIdOrProfile);
        return this.visualSlotId(metricIdOrProfile, profileId);
    },

    get GOSTERIM_FLAGS() {
        return this.VISUAL_PROFILES;
    },

    _parseWeightId(weightId) {
        const parts = String(weightId).split(':');
        if (parts.length >= 3) {
            return {
                metricId: parts[0],
                kind: parts[1],
                profileId: parts.slice(2).join(':')
            };
        }
        if (parts.length === 2) {
            return { metricId: null, kind: parts[0], profileId: parts[1] };
        }
        return null;
    },

    _defaultForProfile(kind, profileId, metricId) {
        if (metricId) {
            const p = this.getProfileDef(metricId, kind, profileId);
            if (p) return p.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        if (kind === this.VISUAL_GROUP) {
            const p = this.VISUAL_PROFILES.find(x => x.id === profileId);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        if (kind === this.TREND_GROUP) {
            const p = this.TREND_PROFILES.find(x => x.id === profileId);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        if (kind === this.ORT_GROUP) {
            const p = this.T9V_ORT_PROFILES.find(x => x.id === profileId);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        return this.DEFAULT_INFLUENCE;
    },

    _emptyStore() {
        return {
            selectedMetric: this.DEFAULT_SELECTED_METRIC,
            calcMode: this.CALC_MODE_SOLO,
            savedMetrics: [],
            byMetric: {}
        };
    },

    _savedMetricIds(store) {
        store = store || this._loadStore();
        const explicit = store.savedMetrics || [];
        const fromSaved = Object.keys(store.byMetric || {}).filter(
            id => Object.keys(store.byMetric[id] || {}).length > 0
        );
        return [...new Set([...explicit, ...fromSaved])];
    },

    _migrateStore(store) {
        if (!store.calcMode) store.calcMode = this.CALC_MODE_SOLO;
        if (!store.savedMetrics) {
            store.savedMetrics = Object.keys(store.byMetric || {}).filter(
                id => Object.keys(store.byMetric[id] || {}).length > 0
            );
        }
        return store;
    },

    _loadStore() {
        if (this._storeCache) return this._storeCache;
        try {
            const raw = localStorage.getItem(this.INFLUENCE_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.byMetric) {
                    this._storeCache = this._migrateStore({
                        selectedMetric: parsed.selectedMetric || this.DEFAULT_SELECTED_METRIC,
                        calcMode: parsed.calcMode,
                        savedMetrics: parsed.savedMetrics,
                        byMetric: parsed.byMetric || {}
                    });
                    return this._storeCache;
                }
            }
        } catch (_) {}
        this._storeCache = this._emptyStore();
        return this._storeCache;
    },

    _saveStore() {
        try {
            localStorage.setItem(this.INFLUENCE_STORAGE_KEY, JSON.stringify(this._storeCache || this._emptyStore()));
        } catch (_) {}
    },

    _clearLegacy() {
        for (const k of this.LEGACY_KEYS) {
            try { localStorage.removeItem(k); } catch (_) {}
        }
    },

    getMetricCatalog(extraSections) {
        const core = this.CORE_GROUPS.map(g => ({ id: g.id, label: g.label }));
        const extra = (extraSections || []).map(s => ({ id: s.id, label: s.label }));
        const seen = new Set();
        const out = [];
        for (const item of [...core, ...extra]) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            out.push(item);
        }
        return out;
    },

    getSelectedMetric() {
        return this._loadStore().selectedMetric || this.DEFAULT_SELECTED_METRIC;
    },

    getCalcMode() {
        return this._loadStore().calcMode || this.CALC_MODE_SOLO;
    },

    setCalcMode(mode) {
        const store = this._loadStore();
        store.calcMode = mode === this.CALC_MODE_ALL ? this.CALC_MODE_ALL : this.CALC_MODE_SOLO;
        this._saveStore();
        return store.calcMode;
    },

    isMetricSaved(metricId) {
        return this._savedMetricIds().includes(metricId);
    },

    _ensureDraftMap() {
        if (!this._draftByMetric) this._draftByMetric = {};
    },

    _buildDefaultDraft(metricId) {
        const draft = {};
        for (const sec of this.getMetricProfileSections(metricId)) {
            for (const p of sec.profiles) {
                draft[this._profileKey(sec.kind, p.id)] = p.defaultInfluence ?? this.DEFAULT_INFLUENCE;
            }
        }
        return draft;
    },

    ensureDraft(metricId) {
        this._ensureDraftMap();
        if (this._draftByMetric[metricId]) return this._draftByMetric[metricId];
        const saved = this._loadStore().byMetric?.[metricId];
        if (saved && Object.keys(saved).length) {
            this._draftByMetric[metricId] = { ...saved };
        } else {
            this._draftByMetric[metricId] = this._buildDefaultDraft(metricId);
        }
        return this._draftByMetric[metricId];
    },

    clearDraft(metricId) {
        this._ensureDraftMap();
        if (metricId) delete this._draftByMetric[metricId];
        else this._draftByMetric = {};
    },

    hasUnsavedDraft(metricId) {
        const draft = this._draftByMetric?.[metricId];
        if (!draft) return false;
        const saved = this._loadStore().byMetric?.[metricId] || {};
        return JSON.stringify(draft) !== JSON.stringify(saved);
    },

    getDraftInfluence(metricId, kind, profileId) {
        this.ensureDraft(metricId);
        const key = this._profileKey(kind, profileId);
        const v = this._draftByMetric[metricId][key];
        return v != null ? v : this._defaultForProfile(kind, profileId, metricId);
    },

    setDraftInfluence(metricId, kind, profileId, value) {
        this.ensureDraft(metricId);
        const v = Math.max(
            this.MIN_INFLUENCE,
            Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0))
        );
        this._draftByMetric[metricId][this._profileKey(kind, profileId)] = v;
        return v;
    },

    saveDraftMetric(metricId) {
        metricId = metricId || this.getSelectedMetric();
        this.ensureDraft(metricId);
        const store = this._loadStore();
        store.byMetric[metricId] = { ...this._draftByMetric[metricId] };
        if (!store.savedMetrics) store.savedMetrics = [];
        if (!store.savedMetrics.includes(metricId)) store.savedMetrics.push(metricId);
        this._saveStore();
        return metricId;
    },

    _effectiveInfluenceMap(metricId) {
        if (this._draftByMetric?.[metricId]) {
            return { ...this._draftByMetric[metricId] };
        }
        const saved = this._loadStore().byMetric?.[metricId];
        return saved ? { ...saved } : {};
    },

    getActiveMetricIds(extraSections) {
        const store = this._loadStore();
        const mode = store.calcMode || this.CALC_MODE_SOLO;
        const selected = store.selectedMetric || this.DEFAULT_SELECTED_METRIC;
        const saved = this._savedMetricIds(store);
        if (mode === this.CALC_MODE_ALL) {
            return saved;
        }
        return [selected];
    },

    getCalculationWeights(extraSections) {
        const flat = {};
        for (const metricId of this.getActiveMetricIds(extraSections)) {
            const map = this._effectiveInfluenceMap(metricId);
            for (const [key, val] of Object.entries(map)) {
                flat[metricId + ':' + key] = val;
            }
        }
        return flat;
    },

    setSelectedMetric(metricId) {
        const store = this._loadStore();
        store.selectedMetric = metricId;
        this.ensureDraft(metricId);
        this._saveStore();
        return metricId;
    },

    getMetricInfluence(metricId, kind, profileId) {
        const key = this._profileKey(kind, profileId);
        const store = this._loadStore();
        const v = store.byMetric?.[metricId]?.[key];
        return v != null ? v : this._defaultForProfile(kind, profileId, metricId);
    },

    setMetricInfluence(metricId, kind, profileId, value) {
        const v = Math.max(
            this.MIN_INFLUENCE,
            Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0))
        );
        const store = this._loadStore();
        if (!store.byMetric[metricId]) store.byMetric[metricId] = {};
        store.byMetric[metricId][this._profileKey(kind, profileId)] = v;
        this._saveStore();
        return v;
    },

    getMetricInfluences(metricId) {
        const store = this._loadStore();
        return { ...(store.byMetric?.[metricId] || {}) };
    },

    hasCustomMetricInfluences(metricId) {
        return this.isMetricSaved(metricId);
    },

    resetMetricInfluences(metricId) {
        const store = this._loadStore();
        if (metricId) {
            delete store.byMetric[metricId];
            if (store.savedMetrics) {
                store.savedMetrics = store.savedMetrics.filter(id => id !== metricId);
            }
            this.clearDraft(metricId);
        } else {
            store.byMetric = {};
            store.savedMetrics = [];
            this.clearDraft();
        }
        this._saveStore();
    },

    getInfluences() {
        const store = this._loadStore();
        const flat = {};
        for (const [metricId, map] of Object.entries(store.byMetric || {})) {
            for (const [key, val] of Object.entries(map)) {
                flat[metricId + ':' + key] = val;
            }
        }
        return flat;
    },

    getWeights() {
        return this.getInfluences();
    },

    getWeights(extraSections) {
        return this.getCalculationWeights(extraSections);
    },

    getInfluence(weightId) {
        const parsed = this._parseWeightId(weightId);
        if (!parsed) return this.DEFAULT_INFLUENCE;
        if (parsed.metricId) {
            return this.getDraftInfluence(parsed.metricId, parsed.kind, parsed.profileId);
        }
        return this._defaultForProfile(parsed.kind, parsed.profileId, null);
    },

    getWeight(weightId) {
        return this.getInfluence(weightId);
    },

    getInfluencePct(weightId) {
        return this.getInfluence(weightId);
    },

    setInfluence(weightId, value) {
        const parsed = this._parseWeightId(weightId);
        if (!parsed?.metricId) {
            return Math.max(this.MIN_INFLUENCE, Math.min(this.MAX_INFLUENCE, Math.round(Number(value) || 0)));
        }
        return this.setDraftInfluence(parsed.metricId, parsed.kind, parsed.profileId, value);
    },

    adjustInfluence(weightId, delta) {
        const step = delta > 0 ? this.INFLUENCE_STEP : -this.INFLUENCE_STEP;
        return this.setInfluence(weightId, this.getInfluence(weightId) + step);
    },

    adjustWeight(weightId, delta) {
        return this.adjustInfluence(weightId, delta);
    },

    resetWeights(metricId) {
        this.resetMetricInfluences(metricId);
        if (!metricId) {
            const store = this._loadStore();
            store.selectedMetric = this.DEFAULT_SELECTED_METRIC;
            store.calcMode = this.CALC_MODE_SOLO;
            this._saveStore();
        }
        this._clearLegacy();
    },

    _resolveInfluence(influences, weightId, metricId, kind, profileId) {
        if (influences != null) {
            return influences[weightId] != null ? influences[weightId] : 0;
        }
        return this.getMetricInfluence(metricId, kind, profileId);
    },

    _pushSignalTerm(terms, influences, metricId, profileId, label) {
        const weightId = this.visualSlotId(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, this.VISUAL_GROUP, profileId
        );
        if (weight <= 0) return;
        terms.push({ weightId, metricId, label, weight, points: weight });
    },

    _pushVisualTerm(terms, influences, metricId, profileId, label) {
        this._pushSignalTerm(terms, influences, metricId, profileId, label);
    },

    _pushTrendTerm(terms, influences, metricId, profileId, label) {
        const weightId = this.trendSlotId(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, this.TREND_GROUP, profileId
        );
        if (weight <= 0) return;
        terms.push({ weightId, metricId, label, weight, points: weight });
    },

    _pushOrtTerm(terms, influences, metricId, profileId, label) {
        const weightId = this.ortSlotId(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, this.ORT_GROUP, profileId
        );
        if (weight <= 0) return;
        terms.push({ weightId, metricId, label, weight, points: weight });
    },

    _t9vPctTier(pct) {
        if (pct == null || pct <= 0) return null;
        if (pct === 100) return 'pct100';
        if (pct >= 90) return 'pct90';
        if (pct >= 75) return 'pct75';
        if (pct >= 50) return 'pct50';
        if (pct >= 25) return 'pct25';
        return 'pctLow';
    },

    _t9vOrtTier(pct) {
        if (pct == null || pct <= 0) return null;
        if (pct === 100) return 'ortAg100';
        if (pct >= 75) return 'ortAg75';
        if (pct >= 50) return 'ortAg50';
        return 'ortAgLow';
    },

    /**
     * T9V derinlik sinyalleri — KMΔ uyumu + |TEST9| yüzde kademesi + KM/T9 bileşenleri.
     */
    classifyT9vDepthSignals(cell, kmCell, t9Cell) {
        const out = [];
        if (cell?.pct != null) {
            out.push('hucreVar');
            const tier = this._t9vPctTier(cell.pct);
            if (tier) out.push(tier);
            if (cell.kmIsBest || kmCell?.isBest) out.push('kmEnIyi');
            if ((cell.kmPct ?? kmCell?.pct) === 100) out.push('kmPct100');
            if (cell.t9IsBest || t9Cell?.isBest) out.push('t9EnIyi');
            if ((cell.t9Pct ?? t9Cell?.pct) === 100) out.push('t9Pct100');
            return out;
        }
        if (kmCell?.qualifies && !t9Cell) out.push('t9VeriYok');
        else out.push('kmUymuyor');
        return out;
    },

    classifyT9vOrtSignals(ortOzeti) {
        const out = [];
        const ag = ortOzeti?.agirlikli?.pct;
        const tier = this._t9vOrtTier(ag);
        if (tier) out.push(tier);
        const ort3 = ortOzeti?.ort3?.pct;
        if (ort3 != null && ort3 >= 75) out.push('ort3High');
        else if (ort3 != null && ort3 >= 50) out.push('ort3Mid');
        return out;
    },

    _collectT9vTerms(depths, kmDepths, t9Depths, ortOzeti, metricId, groupLabel, influences, terms) {
        const maxN = depths?.length || 0;
        for (let d = 0; d < maxN; d++) {
            const cell = depths[d];
            const kmCell = kmDepths?.[d];
            const t9Cell = t9Depths?.[d];
            const signals = this.classifyT9vDepthSignals(cell, kmCell, t9Cell);
            const dl = d === 0 ? 'SON' : d + ' ÖNCE';
            for (const sid of signals) {
                const def = this.getProfileDef(metricId, this.VISUAL_GROUP, sid);
                this._pushSignalTerm(
                    terms, influences, metricId, sid,
                    groupLabel + ' · ' + dl + ' · ' + (def?.short || sid)
                );
            }
        }
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        if (IE?.computeDepthTrend) {
            const trends = IE.computeDepthTrend(depths, 3);
            for (const tid of trends) {
                const def = this.getProfileDef(metricId, this.TREND_GROUP, tid)
                    || this.TREND_PROFILES.find(p => p.id === tid);
                this._pushTrendTerm(
                    terms, influences, metricId, tid,
                    groupLabel + ' · ' + (def?.short || tid)
                );
            }
        }
        for (const oid of this.classifyT9vOrtSignals(ortOzeti)) {
            const def = this.getProfileDef(metricId, this.ORT_GROUP, oid);
            this._pushOrtTerm(
                terms, influences, metricId, oid,
                groupLabel + ' · ' + (def?.short || oid)
            );
        }
    },

    _collectDepthVisualTerms(depths, metricId, groupLabel, influences, terms) {
        if (!depths?.length) return;
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        for (let d = 0; d < depths.length; d++) {
            const cell = depths[d];
            if (!cell) continue;
            const profile = cell.visualProfile
                || (IE && IE.classifyCellVisual ? IE.classifyCellVisual(cell) : null);
            if (!profile) continue;
            const dl = d === 0 ? 'SON' : d + ' ÖNCE';
            const def = this.getProfileDef(metricId, this.VISUAL_GROUP, profile)
                || this.VISUAL_PROFILES.find(p => p.id === profile);
            this._pushVisualTerm(
                terms, influences, metricId, profile,
                groupLabel + ' · ' + dl + ' · ' + (def?.short || profile)
            );
        }
        if (IE?.computeDepthTrend) {
            const trends = IE.computeDepthTrend(depths, 3);
            for (const tid of trends) {
                const def = this.getProfileDef(metricId, this.TREND_GROUP, tid)
                    || this.TREND_PROFILES.find(p => p.id === tid);
                this._pushTrendTerm(
                    terms, influences, metricId, tid,
                    groupLabel + ' · ' + (def?.short || tid)
                );
            }
        }
    },

    _collectMetricTerms(row, g, influences, terms) {
        if (g.id === 't9v') {
            this._collectT9vTerms(
                g.depths,
                row.kmaviDepths,
                row.t9Depths,
                row.t9vOrtOzeti,
                g.id,
                g.label,
                influences,
                terms
            );
            return;
        }
        this._collectDepthVisualTerms(g.depths, g.id, g.label, influences, terms);
    },

    _allDepthGroups(row, extraSections) {
        const groups = this.CORE_GROUPS.map(g => ({
            id: g.id,
            label: g.label,
            depths: row[g.depthsKey]
        }));
        for (const sec of extraSections || []) {
            groups.push({ id: sec.id, label: sec.label, depths: row[sec.depthsKey] });
        }
        return groups;
    },

    computeRowTahmin(row, extraSections, influences) {
        influences = influences || null;
        const terms = [];

        for (const g of this._allDepthGroups(row, extraSections)) {
            this._collectMetricTerms(row, g, influences, terms);
        }

        if (!terms.length) {
            return { pct: null, score: 0, rank: null, metricCount: 0, weightSum: 0, terms: [], topTerms: [] };
        }

        const score = terms.reduce((s, t) => s + t.points, 0);
        const topTerms = [...terms].sort((a, b) => b.points - a.points).slice(0, 10);
        return {
            pct: null,
            score,
            metricCount: terms.length,
            weightSum: score,
            terms,
            topTerms
        };
    },

    attachRaceTahmin(pkg, influences) {
        const extraSections = pkg.extraSections || [];
        if (influences == null) influences = this.getCalculationWeights(extraSections);
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: this.computeRowTahmin(row, extraSections, influences)
        }));

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
            scored[i].row.tahmin = scored[i].tahmin;
        }

        pkg.tahminOzeti = {
            leader: scored[0]?.row?.name || null,
            leaderPct: scored[0]?.tahmin?.pct ?? null,
            leaderScore: scored[0]?.tahmin?.score ?? 0,
            horseCount: scored.length
        };
        return pkg;
    },

    analyzeCalibration(pkg, actualOrder) {
        if (!actualOrder?.length) return null;
        const winner = actualOrder.find(e => e.finish === 1);
        const winnerRow = winner
            ? pkg.rows.find(r => String(r.name).toUpperCase().trim() === String(winner.name).toUpperCase().trim())
            : null;
        return {
            winner: winner?.name || null,
            compositeRank: winnerRow?.tahmin?.rank ?? null,
            compositePct: winnerRow?.tahmin?.pct ?? null,
            compositeScore: winnerRow?.tahmin?.score ?? null
        };
    }
};
