/**
 * İstatistikler — GÖSTERİM görsel profil + trend tabanlı TAHMİN sıralaması.
 * Etki ID: visual:maviKenar, trend:trendUp3, ...
 */
const IstatistikTahminEngine = {
    INFLUENCE_STORAGE_KEY: '88atspeed-istat-visual-influence-v1',
    LEGACY_KEYS: [
        '88atspeed-istat-metric-influence-v2',
        '88atspeed-istat-metric-influence',
        '88atspeed-istat-metric-weights'
    ],
    DEFAULT_INFLUENCE: 10,
    MIN_INFLUENCE: 0,
    MAX_INFLUENCE: 100,
    INFLUENCE_STEP: 1,

    VISUAL_GROUP: 'visual',
    TREND_GROUP: 'trend',

    /** Kenar + dolgu kombinasyonları — başarı sıralamasının temel faktörleri */
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

    /** Son 3 derinlikte % trendi */
    TREND_PROFILES: [
        { id: 'trendUp3', short: 'Son 3 ↑', label: 'Son 3 derinlik yükseliş', defaultInfluence: 12 },
        { id: 'trendDown3', short: 'Son 3 ↓', label: 'Son 3 derinlik düşüş', defaultInfluence: 4 },
        { id: 'trendUpSon', short: 'SON ↑', label: 'SON > 1 ÖNCE', defaultInfluence: 6 },
        { id: 'trendDownSon', short: 'SON ↓', label: 'SON < 1 ÖNCE', defaultInfluence: 3 }
    ],

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

    /** Tablo başlıkları için (TAHMİN skoruna dahil değil) */
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

    _influenceCache: null,

    slotId(group, profileId) {
        return group + ':' + profileId;
    },

    visualSlotId(profileId) {
        return this.slotId(this.VISUAL_GROUP, profileId);
    },

    trendSlotId(profileId) {
        return this.slotId(this.TREND_GROUP, profileId);
    },

    _defaultForSlot(weightId) {
        const idx = String(weightId).indexOf(':');
        if (idx < 0) return this.DEFAULT_INFLUENCE;
        const group = weightId.slice(0, idx);
        const id = weightId.slice(idx + 1);
        if (group === this.VISUAL_GROUP) {
            const p = this.VISUAL_PROFILES.find(x => x.id === id);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        if (group === this.TREND_GROUP) {
            const p = this.TREND_PROFILES.find(x => x.id === id);
            return p?.defaultInfluence ?? this.DEFAULT_INFLUENCE;
        }
        return this.DEFAULT_INFLUENCE;
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
        return v != null ? v : this._defaultForSlot(weightId);
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

    /** Geriye uyumluluk — artık kullanılmıyor */
    gosterimSlotId(flagId) {
        return this.visualSlotId(flagId);
    },

    get GOSTERIM_FLAGS() {
        return this.VISUAL_PROFILES;
    },

    _resolveInfluence(influences, weightId) {
        if (influences && influences[weightId] != null) return influences[weightId];
        return this.getInfluence(weightId);
    },

    _pushVisualTerm(terms, influences, profileId, label) {
        const weightId = this.visualSlotId(profileId);
        const weight = this._resolveInfluence(influences, weightId);
        if (weight <= 0) return;
        terms.push({ weightId, label, weight, points: weight });
    },

    _pushTrendTerm(terms, influences, profileId, label) {
        const weightId = this.trendSlotId(profileId);
        const weight = this._resolveInfluence(influences, weightId);
        if (weight <= 0) return;
        terms.push({ weightId, label, weight, points: weight });
    },

    _collectDepthVisualTerms(depths, groupLabel, influences, terms) {
        if (!depths?.length) return;
        const IE = typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null;
        for (let d = 0; d < depths.length; d++) {
            const cell = depths[d];
            if (!cell) continue;
            const profile = cell.visualProfile
                || (IE && IE.classifyCellVisual ? IE.classifyCellVisual(cell) : null);
            if (!profile) continue;
            const dl = d === 0 ? 'SON' : d + ' ÖNCE';
            const def = this.VISUAL_PROFILES.find(p => p.id === profile);
            this._pushVisualTerm(
                terms, influences, profile,
                groupLabel + ' · ' + dl + ' · ' + (def?.short || profile)
            );
        }
        if (IE?.computeDepthTrend) {
            const trends = IE.computeDepthTrend(depths, 3);
            for (const tid of trends) {
                const def = this.TREND_PROFILES.find(p => p.id === tid);
                this._pushTrendTerm(
                    terms, influences, tid,
                    groupLabel + ' · ' + (def?.short || tid)
                );
            }
        }
    },

    _allDepthGroups(row, extraSections) {
        const groups = this.CORE_GROUPS.map(g => ({
            label: g.label,
            depths: row[g.depthsKey]
        }));
        for (const sec of extraSections || []) {
            groups.push({ label: sec.label, depths: row[sec.depthsKey] });
        }
        return groups;
    },

    computeRowTahmin(row, extraSections, influences) {
        influences = influences || this.getInfluences();
        const terms = [];

        for (const g of this._allDepthGroups(row, extraSections)) {
            this._collectDepthVisualTerms(g.depths, g.label, influences, terms);
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
