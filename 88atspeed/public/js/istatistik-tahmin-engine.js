/**
 * İstatistikler — metrik grubu bazlı GÖSTERİM görsel profil + trend TAHMİN.
 * Etki ID: {metricId}:visual:{profileId}  örn. son8001:visual:maviKenar
 */
const IstatistikTahminEngine = {
    INFLUENCE_STORAGE_KEY: '88atspeed-istat-visual-influence-v4',
    LEGACY_KEYS: [
        '88atspeed-istat-visual-influence-v3',
        '88atspeed-istat-visual-influence-v2',
        '88atspeed-istat-visual-influence-v1',
        '88atspeed-istat-metric-influence-v2',
        '88atspeed-istat-metric-influence',
        '88atspeed-istat-metric-weights'
    ],
    DEFAULT_INFLUENCE: 0,
    /** Sarı ton > yeşil ton önceliği — preset sürümü (localStorage migrasyonu) */
    TONE_KENAR_PRESET_VERSION: 9,

    /** Metrik bazlı varsayılan slider etkileri (0–100) — puan ölçekli metrikler hariç */
    METRIC_INFLUENCE_PRESETS: {},

    /** Puan ölçekli metriklerde görsel profil başlangıç slider değeri (+1) */
    POINT_SCALE_DEFAULT_VISUAL_INFLUENCE: 1,

    /** Bu metrikler eski 1:1 puan modelini kullanır (özel seçici katalogları) */
    POINT_SCALE_EXCLUDED_METRICS: ['t9v'],

    /** Görsel profil puan ölçeği — slider +1 başına hücre puanı (t9v hariç tüm metrikler) */
    SM_VISUAL_POINT_SCALE: {
        'visual:sariMavi': 100,
        'visual:sariKirmizi': 70,
        'visual:sari': 30,
        'visual:maviKenar': 12,
        'visual:kirmiziKenar': 8,
        'visual:yesilMavi': 16,
        'visual:yesilKirmizi': 13,
        'visual:yesil': 5,
        'visual:maviFosfor': 9,
        'visual:gucluUyari': 7,
        'visual:yesilAcik': 3
    },

    /** Trend Δ referans ölçeği ve çarpanı — puan ölçekli metriklerde */
    POINT_SCALE_TREND_REF: 30,
    POINT_SCALE_TREND_MULT: 1.2,

    /** Metrik grubu genel ağırlığı — 1000 üzerinden (puan × ağırlık / 1000) */
    METRIC_GROUP_WEIGHT_BASE: 1000,
    METRIC_GROUP_WEIGHT_DEFAULT: 1000,
    METRIC_GROUP_WEIGHTS: {
        son8001: 60,
        son8002: 40,
        oran1: 30,
        oran2: 30,
        fark827: 20,
        ff: 40,
        t8: 60,
        son800dr1: 60,
        son800dr: 50,
        test1: 250,
        test2: 50,
        test3: 50,
        testsira: 50,
        t1dr: 120,
        f802: 50,
        f803: 50,
        t9: 120,
        dr1dr: 100,
        drsl: 70,
        dr1sl: 60,
        t12y: 200,
        kirmizi: 100,
        yesil: 100,
        mavif: 70,
        kmavi: 70,
        t4: 80,
        t5: 100,
        t6: 45,
        t7: 70,
        t2m3: 40,
        t1dr3: 90,
        fark: 150,
        ilkf: 40,
        sonf: 80,
        sl801: 60,
        sl802: 110,
        f8021: 60,
        sehirSon: 70,
        smGec: 60,
        sm12: 50,
        t9v: 80
    },

    DEFAULT_SELECTED_METRIC: 'son8001',
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,

    VISUAL_GROUP: 'visual',
    COLOR_GROUP: 'color',
    GOS_GROUP: 'gos',
    TONE_GROUP: 'tone',
    TREND_GROUP: 'trend',
    ORT_GROUP: 'ort',
    PCT_GROUP: 'pct',

    /** Derinlik yüzde tabanı — normalize %100 → bu puan (grup ağırlığı öncesi) */
    PCT_BASE_REF: 100,
    /** SON hücresi %0 iken uygulanan ceza (grup ağırlığı öncesi) */
    SON_ZERO_PENALTY_REF: 8,
    /** Sürekli trend eğimi çarpanı (trend slider açıkken) */
    PCT_TREND_SLOPE_MULT: 0.12,

    /** pkg üzerindeki maxDepth alan adları — çekirdek + ek gruplar */
    MAX_DEPTH_PKG_KEYS: {
        son8001: 'maxDepth1',
        son8002: 'maxDepth2',
        oran1: 'oranMaxDepth1',
        oran2: 'oranMaxDepth2',
        fark827: 'maxDepthFark827',
        ff: 'maxDepthFf',
        t8: 'maxDepthT8',
        son800dr1: 'maxDepthDr1',
        son800dr: 'maxDepthDr',
        test1: 'maxDepthTest1',
        test2: 'maxDepthTest2',
        test3: 'maxDepthTest3',
        testsira: 'maxDepthTest123Sirali',
        t1dr: 'maxDepthT1dr',
        f802: 'maxDepthF802',
        f803: 'maxDepthF803',
        t9: 'maxDepthT9',
        dr1dr: 'maxDepthDr1dr',
        drsl: 'maxDepthDrsl',
        dr1sl: 'maxDepthDr1sl',
        t12y: 'maxDepthT12y',
        kirmizi: 'maxDepthKirmizi',
        yesil: 'maxDepthYesil',
        mavif: 'maxDepthMavif',
        kmavi: 'maxDepthKmavi',
        t4: 'maxDepthT4',
        t5: 'maxDepthT5',
        t6: 'maxDepthT6',
        t7: 'maxDepthT7',
        t2m3: 'maxDepthT2m3',
        t1dr3: 'maxDepthT1dr3',
        fark: 'maxDepthFark',
        ilkf: 'maxDepthIlkf',
        sonf: 'maxDepthSonf',
        sl801: 'maxDepthSl801',
        sl802: 'maxDepthSl802',
        f8021: 'maxDepthF8021',
        sehirSon: 'maxDepthSehirSon',
        smGec: 'maxDepthSmGec',
        sm12: 'maxDepthSm12',
        t9v: 'maxDepthT9v'
    },

    /** Yüzde tabanı uygulanmayan metrikler (özel TAHMİN mantığı veya ikili 0/100) */
    PCT_DEPTH_EXCLUDED: ['t9v', 'sehirSon', 'smGec', 'sm12', 'kmavi'],

    VISUAL_PROFILES: [
        { id: 'maviKenar', short: 'Mavi kenar', label: 'Mavi kenar' },
        { id: 'kirmiziKenar', short: 'Kırmızı kenar', label: 'Kırmızı kenar' },
        { id: 'sari', short: 'Sarı', label: 'Sarı hücre (çizgisiz)', defaultInfluence: 8 },
        { id: 'sariMavi', short: 'Sarı+mavi', label: 'Sarı + mavi kenar', defaultInfluence: 10 },
        { id: 'sariKirmizi', short: 'Sarı+kırmızı', label: 'Sarı + kırmızı kenar', defaultInfluence: 9 },
        { id: 'yesil', short: 'Yeşil', label: 'Yeşil hücre (çizgisiz)', defaultInfluence: 2 },
        { id: 'yesilMavi', short: 'Yeşil+mavi', label: 'Yeşil + mavi kenar', defaultInfluence: 4 },
        { id: 'yesilKirmizi', short: 'Yeşil+kırmızı', label: 'Yeşil + kırmızı kenar', defaultInfluence: 3 },
        { id: 'yesilAcik', short: 'Açık yeşil', label: 'Açık yeşil satır' },
        { id: 'gucluUyari', short: 'Güçlü uyarı', label: 'Güçlü uyarı satırı' },
        { id: 'maviFosfor', short: 'Fosfor mavi', label: 'Fosfor mavi satır' }
    ],

    TREND_PROFILES: [
        { id: 'trendUp3', short: 'Son 3 ↑', label: 'SON > 1 ÖNCE > 2 ÖNCE (sürekli yükseliş)' },
        { id: 'trendDown3', short: 'Son 3 ↓', label: 'SON < 1 ÖNCE < 2 ÖNCE (sürekli düşüş)' },
        { id: 'trendUpSon', short: 'SON ↑', label: 'SON > 1 ÖNCE (tek adım yükseliş)' },
        { id: 'trendDownSon', short: 'SON ↓', label: 'SON < 1 ÖNCE (tek adım düşüş, büyüklüğe göre puan)' }
    ],

    /** Trend puanı: etki × düşüş/yükseliş büyüklüğü (Δ%) — düz +1 değil */
    TREND_DELTA_DIVISOR: 25,

    /** T9V — KMΔ + |TEST9| 0'a yakın: gerçek sinyal seçicileri */
    T9V_SIGNAL_PROFILES: [
        { id: 'hucreVar', short: 'Hücre var', label: 'KM uyumlu + T9 verisi (hücre dolu)' },
        { id: 'kmUymuyor', short: 'KM uyumsuz', label: 'KMΔ qualifies=false → hücre yok' },
        { id: 't9VeriYok', short: 'T9 eksik', label: 'KM uyumlu ama T9 verisi yok' },
        { id: 'pct100', short: '%100', label: '|TEST9| en düşük (isBest)' },
        { id: 'pct90', short: '%90-99', label: 'T9V %90–99' },
        { id: 'pct75', short: '%75-89', label: 'T9V %75–89' },
        { id: 'pct50', short: '%50-74', label: 'T9V %50–74' },
        { id: 'pct25', short: '%25-49', label: 'T9V %25–49' },
        { id: 'pctLow', short: '%1-24', label: 'T9V %1–24' },
        { id: 'kmEnIyi', short: 'KM en iyi', label: 'KMΔ isBest aynı derinlikte' },
        { id: 'kmPct100', short: 'KM %100', label: 'KMΔ pct=100' },
        { id: 't9EnIyi', short: 'T9 en iyi', label: 'T9Δ isBest (tüm atlar)' },
        { id: 't9Pct100', short: 'T9 %100', label: 'T9Δ pct=100' }
    ],

    T9V_ORT_PROFILES: [
        { id: 'ortAg100', short: 'AĞ.ORT %100', label: 'Ağırlıklı ort. %100' },
        { id: 'ortAg75', short: 'AĞ.ORT %75+', label: 'Ağırlıklı ort. ≥%75' },
        { id: 'ortAg50', short: 'AĞ.ORT %50+', label: 'Ağırlıklı ort. %50–74' },
        { id: 'ortAgLow', short: 'AĞ.ORT düşük', label: 'Ağırlıklı ort. %1–49' },
        { id: 'ort3High', short: 'AĞ.ORT.3 yüksek', label: 'AĞ. ORT.3 ≥%75' },
        { id: 'ort3Mid', short: 'AĞ.ORT.3 orta', label: 'AĞ. ORT.3 %50–74' }
    ],

    /** T9V — ton (dolgu) × çerçeve (kenar) kombinasyonları; her biri ayrı anlam */
    T9V_TON_KENAR_PROFILES: (function () {
        const toneKenarDefaults = {
            tk_sari_yok: 8,
            tk_sari_kirmizi: 9,
            tk_sari_mavi: 10,
            tk_yesil_yok: 2,
            tk_yesil_mavi: 4,
            tk_yesil_kirmizi: 3
        };
        const tones = [
            { key: 'yok', label: 'Ton yok (düz/beyaz dolgu)' },
            { key: 'sari', label: 'Sarı ton' },
            { key: 'yesil', label: 'Yeşil ton' },
            { key: 'kirmizi', label: 'Kırmızı ton' }
        ];
        const borders = [
            { key: 'yok', label: 'çizgi yok' },
            { key: 'mavi', label: 'mavi çizgi' },
            { key: 'kirmizi', label: 'kırmızı çizgi' }
        ];
        const out = [
            { id: 'hucreYok', short: 'Hücre yok', label: '— veya pct yok' }
        ];
        for (const t of tones) {
            for (const b of borders) {
                const id = 'tk_' + t.key + '_' + b.key;
                out.push({
                    id,
                    short: t.label.split(' ')[0] + (t.key === 'yok' ? ' ton' : '') + ' · ' + b.label,
                    label: t.label + ', ' + b.label,
                    defaultInfluence: toneKenarDefaults[id] ?? 0
                });
            }
        }
        return out;
    })(),

    /** @deprecated T9V için T9V_TON_KENAR_PROFILES kullanın */
    T9V_COLOR_PROFILES: [],

    /** @deprecated */
    T9V_GOSTERIM_RAW: [],

    /** @deprecated */
    T9V_PCT_TONE: [],

    /** Metrik → seçici kataloğu (UI + varsayılan etkiler) */
    METRIC_SELECTOR_CATALOGS: {
        default: {
            title: 'Görsel profiller',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: 'VISUAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' }
            ]
        },
        sm12: {
            title: 'Ş+M-12 — Ş/M koşuda 1. veya 2.',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: 'VISUAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' }
            ]
        },
        smGec: {
            title: 'Ş+M-GEÇ — Şehir+mesafe geçmişi',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: 'VISUAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' }
            ]
        },
        sehirSon: {
            title: 'ŞEH-SON — Koşu program şehrinde',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: 'VISUAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' }
            ]
        },
        f8021: {
            title: '8002−1 — Tek koşu |8002-8001| 0\'a yakın',
            sections: [
                { kind: 'visual', title: 'Görsel profiller', profiles: 'VISUAL_PROFILES' },
                { kind: 'trend', title: 'Trend (son 3 derinlik)', profiles: 'TREND_PROFILES' }
            ]
        },
        t9v: {
            title: 'T9V sinyalleri',
            sections: [
                { kind: 'visual', title: 'T9V — KMΔ + |TEST9|', profiles: 'T9V_SIGNAL_PROFILES' },
                { kind: 'color', title: 'Ton + çerçeve (kombinasyon)', profiles: 'T9V_TON_KENAR_PROFILES' },
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

    colorSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.COLOR_GROUP, profileId);
    },

    gosSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.GOS_GROUP, profileId);
    },

    toneSlotId(metricId, profileId) {
        return this.metricWeightId(metricId, this.TONE_GROUP, profileId);
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
        if (refName === 'VISUAL_PROFILES') return this.VISUAL_PROFILES;
        if (refName === 'TREND_PROFILES') return this.TREND_PROFILES;
        if (!refName) return this.VISUAL_PROFILES;
        if (refName === 'T9V_TON_KENAR_PROFILES') return this.T9V_TON_KENAR_PROFILES;
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
            const key = this._profileKey(kind, profileId);
            const metricPreset = this.METRIC_INFLUENCE_PRESETS?.[metricId];
            if (metricPreset && metricPreset[key] != null) {
                return metricPreset[key];
            }
            // Puan ölçekli metrikler: görsel +1, trend 0
            if (this._isPointScaleMetric(metricId)) {
                if (kind === this.VISUAL_GROUP) {
                    return this.POINT_SCALE_DEFAULT_VISUAL_INFLUENCE;
                }
                return this.DEFAULT_INFLUENCE;
            }
            const p = this.getProfileDef(metricId, kind, profileId);
            if (p && p.defaultInfluence != null) return p.defaultInfluence;
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
        if (kind === this.COLOR_GROUP) {
            const p = this.T9V_TON_KENAR_PROFILES.find(x => x.id === profileId);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        if (kind === this.GOS_GROUP) {
            return this.DEFAULT_INFLUENCE;
        }
        if (kind === this.TONE_GROUP) {
            return this.DEFAULT_INFLUENCE;
        }
        return this.DEFAULT_INFLUENCE;
    },

    _toneKenarPresetKeys() {
        const out = {};
        for (const p of this.VISUAL_PROFILES) {
            if (p.defaultInfluence != null && p.defaultInfluence > 0) {
                out[this._profileKey(this.VISUAL_GROUP, p.id)] = p.defaultInfluence;
            }
        }
        for (const p of this.T9V_TON_KENAR_PROFILES) {
            if (p.defaultInfluence != null && p.defaultInfluence > 0) {
                out[this._profileKey(this.COLOR_GROUP, p.id)] = p.defaultInfluence;
            }
        }
        return out;
    },

    _applyToneKenarPreset(store) {
        const preset = this._toneKenarPresetKeys();
        for (const metricId of this._savedMetricIds(store)) {
            if (this.METRIC_INFLUENCE_PRESETS?.[metricId]) continue;
            if (this._isPointScaleMetric(metricId)) continue;
            if (!store.byMetric[metricId]) store.byMetric[metricId] = {};
            for (const [k, v] of Object.entries(preset)) {
                store.byMetric[metricId][k] = v;
            }
        }
        this._draftByMetric = null;
    },

    _applyMetricPresets(store) {
        for (const [metricId, preset] of Object.entries(this.METRIC_INFLUENCE_PRESETS || {})) {
            if (!store.byMetric[metricId]) store.byMetric[metricId] = {};
            for (const [k, v] of Object.entries(preset)) {
                store.byMetric[metricId][k] = v;
            }
            if (!store.savedMetrics) store.savedMetrics = [];
            if (!store.savedMetrics.includes(metricId)) store.savedMetrics.push(metricId);
        }
        this._draftByMetric = null;
    },

    _resetMetricInfluences(store, metricId) {
        if (!store.byMetric?.[metricId]) return;
        for (const key of Object.keys(store.byMetric[metricId])) {
            store.byMetric[metricId][key] = 0;
        }
        this._draftByMetric = null;
    },

    /** v4: sm12 slider değerleri eskiden puan ölçeğiyle karışmıştı — sıfırla */
    _migrateSm12PointScaleModel(store) {
        this._resetMetricInfluences(store, 'sm12');
    },

    /** v5: smGec aynı modele geçti — eski slider değerlerini sıfırla */
    _migrateSmGecPointScaleModel(store) {
        this._resetMetricInfluences(store, 'smGec');
    },

    /** v6: sehirSon (ŞEH-SON) aynı modele geçti */
    _migrateSehirSonPointScaleModel(store) {
        this._resetMetricInfluences(store, 'sehirSon');
    },

    /** v7: f8021 (8002−1) aynı modele geçti */
    _migrateF8021PointScaleModel(store) {
        this._resetMetricInfluences(store, 'f8021');
    },

    /** v8: tüm görsel profil metrikleri aynı ölçek tablosuna geçti (t9v hariç) */
    _migrateGlobalVisualPointScaleModel(store) {
        const skip = new Set(this.POINT_SCALE_EXCLUDED_METRICS || []);
        for (const metricId of Object.keys(store.byMetric || {})) {
            if (skip.has(metricId)) continue;
            this._resetMetricInfluences(store, metricId);
        }
    },

    _allPointScaleMetricIds() {
        const extras = [
            'f802', 'f803', 't9', 'dr1dr', 'drsl', 'dr1sl', 't12y', 'kirmizi', 'yesil', 'mavif',
            'kmavi', 't4', 't5', 't6', 't7', 't2m3', 't1dr3', 'fark', 'ilkf', 'sonf', 'sl801',
            'sl802', 'f8021', 'sehirSon', 'smGec', 'sm12'
        ];
        const core = this.CORE_GROUPS.map(g => g.id);
        return [...new Set([...core, ...extras])].filter(id => this._isPointScaleMetric(id));
    },

    _buildPointScaleStarterInfluences(metricId) {
        const out = {};
        for (const sec of this.getMetricProfileSections(metricId)) {
            for (const p of sec.profiles) {
                out[this._profileKey(sec.kind, p.id)] = this._defaultForProfile(
                    sec.kind, p.id, metricId
                );
            }
        }
        return out;
    },

    /** v9: kayıtlı olmayan puan ölçekli metrikler → görsel +1, trend 0, kaydet */
    _migrateUnsavedPointScaleStarters(store) {
        const saved = new Set(store.savedMetrics || []);
        for (const metricId of this._allPointScaleMetricIds()) {
            if (saved.has(metricId)) continue;
            if (!store.byMetric[metricId]) store.byMetric[metricId] = {};
            const starter = this._buildPointScaleStarterInfluences(metricId);
            for (const [k, v] of Object.entries(starter)) {
                store.byMetric[metricId][k] = v;
            }
            if (!store.savedMetrics) store.savedMetrics = [];
            if (!store.savedMetrics.includes(metricId)) store.savedMetrics.push(metricId);
        }
        this._draftByMetric = null;
    },

    _isPointScaleMetric(metricId) {
        if (!metricId) return false;
        return !(this.POINT_SCALE_EXCLUDED_METRICS || []).includes(metricId);
    },

    getVisualPointScale(metricId, kind, profileId) {
        if (!this._isPointScaleMetric(metricId) || kind !== this.VISUAL_GROUP) return 1;
        const key = this._profileKey(kind, profileId);
        const scale = this.SM_VISUAL_POINT_SCALE[key];
        return scale != null ? scale : 1;
    },

    getTrendRefPointScale(metricId) {
        return this._isPointScaleMetric(metricId) ? this.POINT_SCALE_TREND_REF : 1;
    },

    getTrendPointMultiplier(metricId) {
        return this._isPointScaleMetric(metricId) ? this.POINT_SCALE_TREND_MULT : 1;
    },

    getMetricGroupWeight(metricId) {
        const w = this.METRIC_GROUP_WEIGHTS?.[metricId];
        return w != null ? w : this.METRIC_GROUP_WEIGHT_DEFAULT;
    },

    applyMetricGroupWeight(metricId, points) {
        if (points == null || points === 0) return 0;
        const w = this.getMetricGroupWeight(metricId);
        if (w === this.METRIC_GROUP_WEIGHT_BASE) return points;
        return Math.round((points * w) / this.METRIC_GROUP_WEIGHT_BASE);
    },

    _emptyStore() {
        return {
            selectedMetric: this.DEFAULT_SELECTED_METRIC,
            calcMode: this.CALC_MODE_SOLO,
            savedMetrics: [],
            byMetric: {},
            presetVersion: this.TONE_KENAR_PRESET_VERSION
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
        const prevVersion = store.presetVersion || 0;
        if (prevVersion < this.TONE_KENAR_PRESET_VERSION) {
            if (prevVersion < 4) {
                this._migrateSm12PointScaleModel(store);
            }
            if (prevVersion < 5) {
                this._migrateSmGecPointScaleModel(store);
            }
            if (prevVersion < 6) {
                this._migrateSehirSonPointScaleModel(store);
            }
            if (prevVersion < 7) {
                this._migrateF8021PointScaleModel(store);
            }
            if (prevVersion < 8) {
                this._migrateGlobalVisualPointScaleModel(store);
            }
            if (prevVersion < 9) {
                this._migrateUnsavedPointScaleStarters(store);
            }
            if (prevVersion < 3) {
                this._applyToneKenarPreset(store);
            }
            this._applyMetricPresets(store);
            store.presetVersion = this.TONE_KENAR_PRESET_VERSION;
        }
        return store;
    },

    _loadStore() {
        if (this._storeCache) return this._storeCache;
        try {
            let raw = localStorage.getItem(this.INFLUENCE_STORAGE_KEY);
            if (!raw) {
                raw = localStorage.getItem('88atspeed-istat-visual-influence-v3');
            }
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.byMetric) {
                    this._storeCache = this._migrateStore({
                        selectedMetric: parsed.selectedMetric || this.DEFAULT_SELECTED_METRIC,
                        calcMode: parsed.calcMode,
                        savedMetrics: parsed.savedMetrics,
                        byMetric: parsed.byMetric || {},
                        presetVersion: parsed.presetVersion
                    });
                    this._saveStore();
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
                draft[this._profileKey(sec.kind, p.id)] = this._defaultForProfile(
                    sec.kind, p.id, metricId
                );
            }
        }
        return draft;
    },

    zeroDraftMetric(metricId) {
        metricId = metricId || this.getSelectedMetric();
        this._draftByMetric = this._draftByMetric || {};
        this._draftByMetric[metricId] = this._buildDefaultDraft(metricId);
        return this._draftByMetric[metricId];
    },

    zeroAllDrafts() {
        this._draftByMetric = {};
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
        if (this._draftByMetric?.[metricId]) {
            this._draftByMetric[metricId][this._profileKey(kind, profileId)] = v;
        }
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
            this.zeroDraftMetric(metricId);
        } else {
            store.byMetric = {};
            store.savedMetrics = [];
            this.zeroAllDrafts();
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
            this.zeroAllDrafts();
        }
        this._clearLegacy();
    },

    _resolveInfluence(influences, weightId, metricId, kind, profileId) {
        if (influences != null) {
            return influences[weightId] != null ? influences[weightId] : 0;
        }
        return this.getMetricInfluence(metricId, kind, profileId);
    },

    _depthWeightFactor(depth, maxDepth) {
        if (!maxDepth || maxDepth <= 0) return 1;
        const w = maxDepth - depth;
        return Math.max(0, w) / maxDepth;
    },

    _pushKindTerm(terms, influences, metricId, kind, profileId, label, depthFactor = 1) {
        const slotMap = {
            [this.VISUAL_GROUP]: (m, p) => this.visualSlotId(m, p),
            [this.COLOR_GROUP]: (m, p) => this.colorSlotId(m, p),
            [this.GOS_GROUP]: (m, p) => this.gosSlotId(m, p),
            [this.TONE_GROUP]: (m, p) => this.toneSlotId(m, p),
            [this.TREND_GROUP]: (m, p) => this.trendSlotId(m, p),
            [this.ORT_GROUP]: (m, p) => this.ortSlotId(m, p)
        };
        const slotFn = slotMap[kind] || slotMap[this.VISUAL_GROUP];
        const weightId = slotFn(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, kind, profileId
        );
        if (weight <= 0) return;
        const scale = this.getVisualPointScale(metricId, kind, profileId);
        const df = depthFactor != null && depthFactor > 0 ? depthFactor : 1;
        let points = Math.round(weight * scale * df);
        points = this.applyMetricGroupWeight(metricId, points);
        if (points <= 0) return;
        const metricWeight = this.getMetricGroupWeight(metricId);
        terms.push({ weightId, metricId, label, weight, scale, metricWeight, points });
    },

    _pushSignalTerm(terms, influences, metricId, profileId, label, depthFactor) {
        this._pushKindTerm(terms, influences, metricId, this.VISUAL_GROUP, profileId, label, depthFactor);
    },

    _pushVisualTerm(terms, influences, metricId, profileId, label, depthFactor) {
        this._pushKindTerm(terms, influences, metricId, this.VISUAL_GROUP, profileId, label, depthFactor);
    },

    _pushColorTerm(terms, influences, metricId, profileId, label, depthFactor) {
        this._pushKindTerm(terms, influences, metricId, this.COLOR_GROUP, profileId, label, depthFactor);
    },

    _pushGosTerm(terms, influences, metricId, profileId, label, depthFactor) {
        this._pushKindTerm(terms, influences, metricId, this.GOS_GROUP, profileId, label, depthFactor);
    },

    _pushToneTerm(terms, influences, metricId, profileId, label, depthFactor) {
        this._pushKindTerm(terms, influences, metricId, this.TONE_GROUP, profileId, label, depthFactor);
    },

    _pushTrendTerm(terms, influences, metricId, trendHit, label) {
        const profileId = typeof trendHit === 'string' ? trendHit : trendHit.id;
        const delta = typeof trendHit === 'object' ? (trendHit.delta || 0) : 0;
        const weightId = this.trendSlotId(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, this.TREND_GROUP, profileId
        );
        if (weight <= 0 || delta <= 0) return;
        const refScale = this.getTrendRefPointScale(metricId);
        const trendMult = this.getTrendPointMultiplier(metricId);
        let points = Math.round((weight * delta * refScale) / this.TREND_DELTA_DIVISOR);
        if (trendMult !== 1) {
            points = Math.round(points * trendMult);
            // +1 slider: trend ≈ refScale × %20 fazla; görsel +1 = refScale (sarı baz)
            const trendFloor = Math.round(weight * refScale * trendMult);
            if (points < trendFloor) points = trendFloor;
        }
        if (points <= 0) return;
        points = this.applyMetricGroupWeight(metricId, points);
        if (points <= 0) return;
        const detail = typeof trendHit === 'object' && trendHit.detail ? ' · ' + trendHit.detail : '';
        terms.push({
            weightId,
            metricId,
            label: label + detail,
            weight,
            delta,
            metricWeight: this.getMetricGroupWeight(metricId),
            points
        });
    },

    _collectDepthTrendTerms(depths, metricId, groupLabel, influences, terms) {
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        if (!IE?.computeDepthTrendHits) return;
        const hits = IE.computeDepthTrendHits(depths, 3);
        for (const hit of hits) {
            const def = this.getProfileDef(metricId, this.TREND_GROUP, hit.id)
                || this.TREND_PROFILES.find(p => p.id === hit.id);
            this._pushTrendTerm(
                terms, influences, metricId, hit,
                groupLabel + ' · ' + (def?.short || hit.id)
            );
        }
    },

    _pushOrtTerm(terms, influences, metricId, profileId, label) {
        const weightId = this.ortSlotId(metricId, profileId);
        const weight = this._resolveInfluence(
            influences, weightId, metricId, this.ORT_GROUP, profileId
        );
        if (weight <= 0) return;
        const scale = this.getVisualPointScale(metricId, this.ORT_GROUP, profileId);
        let points = Math.round(weight * scale);
        points = this.applyMetricGroupWeight(metricId, points);
        if (points <= 0) return;
        terms.push({
            weightId, metricId, label, weight, scale,
            metricWeight: this.getMetricGroupWeight(metricId),
            points
        });
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

    _visualProfileToTonKenar(profile) {
        const map = {
            yesilMavi: 'tk_yesil_mavi',
            yesilKirmizi: 'tk_yesil_kirmizi',
            yesil: 'tk_yesil_yok',
            sariMavi: 'tk_sari_mavi',
            sariKirmizi: 'tk_sari_kirmizi',
            sari: 'tk_sari_yok',
            maviKenar: 'tk_yok_mavi',
            kirmiziKenar: 'tk_yok_kirmizi',
            gucluUyari: 'tk_yesil_yok',
            maviFosfor: 'tk_yok_yok',
            yesilAcik: 'tk_sari_yok'
        };
        return map[profile] || null;
    },

    _t9vPctToTone(pct) {
        if (pct === 0) return 'kirmizi';
        if (pct <= 33) return 'sari';
        if (pct >= 34) return 'yesil';
        return 'yok';
    },

    /**
     * T9V hücre görünümü — dolgu tonu × kenar çizgisi tek kombinasyon anahtarı.
     * GÖSTERİM bayrakları varsa classifyCellVisual eşlemesi; yoksa pct dolgu kademesi.
     */
    classifyT9vTonKenar(cell) {
        if (!cell || cell.pct == null) return 'hucreYok';

        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        if (cell.gosterim) {
            const { tone, border } = IE?.classifyRenderedToneBorder
                ? IE.classifyRenderedToneBorder(cell)
                : { tone: this._t9vPctToTone(cell.pct), border: 'yok' };
            return 'tk_' + tone + '_' + border;
        }

        const tone = this._t9vPctToTone(cell.pct);
        return 'tk_' + tone + '_yok';
    },

    _collectT9vTonKenarTerms(depths, metricId, groupLabel, influences, terms, maxDepth) {
        const maxN = depths?.length || 0;
        const md = maxDepth || maxN || 1;
        for (let d = 0; d < maxN; d++) {
            const cell = depths[d];
            const dl = d === 0 ? 'SON' : d + ' ÖNCE';
            const comboId = this.classifyT9vTonKenar(cell);
            const def = this.getProfileDef(metricId, this.COLOR_GROUP, comboId);
            this._pushColorTerm(
                terms, influences, metricId, comboId,
                groupLabel + ' · ' + dl + ' · ' + (def?.short || comboId),
                this._depthWeightFactor(d, md)
            );
        }
    },

    _collectT9vTerms(depths, kmDepths, t9Depths, ortOzeti, metricId, groupLabel, influences, terms, maxDepth) {
        const maxN = depths?.length || 0;
        const md = maxDepth || maxN || 1;
        for (let d = 0; d < maxN; d++) {
            const cell = depths[d];
            const kmCell = kmDepths?.[d];
            const t9Cell = t9Depths?.[d];
            const signals = this.classifyT9vDepthSignals(cell, kmCell, t9Cell);
            const dl = d === 0 ? 'SON' : d + ' ÖNCE';
            const df = this._depthWeightFactor(d, md);
            for (const sid of signals) {
                const def = this.getProfileDef(metricId, this.VISUAL_GROUP, sid);
                this._pushSignalTerm(
                    terms, influences, metricId, sid,
                    groupLabel + ' · ' + dl + ' · ' + (def?.short || sid),
                    df
                );
            }
        }
        this._collectT9vTonKenarTerms(depths, metricId, groupLabel, influences, terms, md);
        this._collectDepthTrendTerms(depths, metricId, groupLabel, influences, terms, md);
        for (const oid of this.classifyT9vOrtSignals(ortOzeti)) {
            const def = this.getProfileDef(metricId, this.ORT_GROUP, oid);
            this._pushOrtTerm(
                terms, influences, metricId, oid,
                groupLabel + ' · ' + (def?.short || oid)
            );
        }
    },

    _collectDepthVisualTerms(depths, metricId, groupLabel, influences, terms, maxDepth) {
        if (!depths?.length) return;
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        const md = maxDepth || depths.length || 1;
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
                groupLabel + ' · ' + dl + ' · ' + (def?.short || profile),
                this._depthWeightFactor(d, md)
            );
        }
        this._collectDepthTrendTerms(depths, metricId, groupLabel, influences, terms, md);
    },

    _resolveMaxDepth(metricId, pkg, depths, groupMaxDepth) {
        if (groupMaxDepth != null && groupMaxDepth > 0) return groupMaxDepth;
        if (pkg) {
            const key = this.MAX_DEPTH_PKG_KEYS[metricId];
            if (key && pkg[key] != null) return pkg[key];
            const cap = metricId.charAt(0).toUpperCase() + metricId.slice(1);
            const alt = 'maxDepth' + cap;
            if (pkg[alt] != null) return pkg[alt];
        }
        if (depths?.length) return depths.length;
        return 0;
    },

    _hasActiveTrendInfluence(influences, metricId) {
        return this.TREND_PROFILES.some(p =>
            this._resolveInfluence(
                influences, this.trendSlotId(metricId, p.id), metricId, this.TREND_GROUP, p.id
            ) > 0
        );
    },

    _avgActiveTrendInfluence(influences, metricId) {
        let sum = 0;
        let n = 0;
        for (const p of this.TREND_PROFILES) {
            const w = this._resolveInfluence(
                influences, this.trendSlotId(metricId, p.id), metricId, this.TREND_GROUP, p.id
            );
            if (w > 0) {
                sum += w;
                n++;
            }
        }
        return n ? sum / n : 0;
    },

    _usesPctDepthBase(metricId) {
        return !this.PCT_DEPTH_EXCLUDED.includes(metricId);
    },

    _collectDepthPctBaseTerms(depths, maxDepth, metricId, groupLabel, influences, terms) {
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        if (!IE?.computeDepthPctTahminComponents) return;
        const comp = IE.computeDepthPctTahminComponents(depths, maxDepth, {
            sonZeroPenaltyRef: this.SON_ZERO_PENALTY_REF
        });
        if (!comp) return;

        const normPct = Math.round(comp.normalized);
        let basePoints = Math.round(comp.weightedSum * (this.PCT_BASE_REF / comp.maxDepth));
        basePoints = this.applyMetricGroupWeight(metricId, basePoints);
        if (basePoints > 0) {
            terms.push({
                weightId: metricId + ':pct:base',
                metricId,
                label: groupLabel + ' · yüzde tabanı %' + normPct,
                weight: this.PCT_BASE_REF,
                scale: comp.normalized / 100,
                metricWeight: this.getMetricGroupWeight(metricId),
                points: basePoints
            });
        }

        if (comp.sonZeroPenalty > 0) {
            const pen = this.applyMetricGroupWeight(metricId, comp.sonZeroPenalty);
            if (pen > 0) {
                terms.push({
                    weightId: metricId + ':pct:sonZero',
                    metricId,
                    label: groupLabel + ' · SON %0 ceza',
                    points: -pen
                });
            }
        }

        if (comp.trendSlope != null && comp.trendSlope !== 0 && this._hasActiveTrendInfluence(influences, metricId)) {
            const md = maxDepth || comp.maxDepth || 7;
            const w0 = md;
            const w1 = Math.max(1, md - 1);
            const slopeMult = (w0 + w1) / (2 * md);
            const avgTrend = this._avgActiveTrendInfluence(influences, metricId);
            const refScale = this.getTrendRefPointScale(metricId);
            let slopePts = Math.round(
                comp.trendSlope * this.PCT_TREND_SLOPE_MULT * avgTrend * slopeMult
                * refScale / this.POINT_SCALE_TREND_REF
            );
            slopePts = this.applyMetricGroupWeight(metricId, slopePts);
            if (slopePts !== 0) {
                const arrow = comp.trendSlope > 0 ? '↑' : '↓';
                terms.push({
                    weightId: metricId + ':pct:trendSlope',
                    metricId,
                    label: groupLabel + ' · eğim ' + arrow + ' (Δ' + Math.round(comp.trendSlope) + ')',
                    points: slopePts
                });
            }
        }
    },

    _collectMetricTerms(row, g, influences, terms, pkg) {
        const maxDepth = this._resolveMaxDepth(g.id, pkg, g.depths, g.maxDepth);
        if (g.id === 't9v') {
            this._collectT9vTerms(
                g.depths,
                row.kmaviDepths,
                row.t9Depths,
                row.t9vOrtOzeti,
                g.id,
                g.label,
                influences,
                terms,
                maxDepth
            );
            return;
        }
        if (this._usesPctDepthBase(g.id)) {
            this._collectDepthPctBaseTerms(g.depths, maxDepth, g.id, g.label, influences, terms);
        }
        this._collectDepthVisualTerms(g.depths, g.id, g.label, influences, terms, maxDepth);
    },

    _allDepthGroups(row, extraSections, pkg) {
        const groups = this.CORE_GROUPS.map(g => ({
            id: g.id,
            label: g.label,
            depths: row[g.depthsKey],
            maxDepth: this._resolveMaxDepth(g.id, pkg, row[g.depthsKey])
        }));
        for (const sec of extraSections || []) {
            groups.push({
                id: sec.id,
                label: sec.label,
                depths: row[sec.depthsKey],
                maxDepth: sec.maxDepth || this._resolveMaxDepth(sec.id, pkg, row[sec.depthsKey])
            });
        }
        return groups;
    },

    computeRowTahmin(row, extraSections, influences, pkg) {
        if (influences == null) {
            influences = this.getCalculationWeights(extraSections);
        }
        const terms = [];
        const activeIds = new Set(this.getActiveMetricIds(extraSections));

        for (const g of this._allDepthGroups(row, extraSections, pkg)) {
            if (!activeIds.has(g.id)) continue;
            this._collectMetricTerms(row, g, influences, terms, pkg);
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
            tahmin: this.computeRowTahmin(row, extraSections, influences, pkg)
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
