/**
 * Değişim Skoru — SON800-1 + T1×DR metodolojisi.
 * Yalnızca «Sadece seçili alan» modunda ve son8001 / t1dr seçiliyken TAHMİN hesabına girer.
 */
const DegisimSkoruEngine = {
    ACTIVE_METRICS: new Set(['son8001', 't1dr']),
    MAX_RAW: 111,

    /** Seçili metrikte renklendirilecek alt sütunlar (yalnız SON derinlik) */
    HIGHLIGHT_COLS: {
        son8001: ['gap', 'success'],
        t1dr: ['best', 'self', 'gap', 'success']
    },

    avg(a, b) {
        if (a == null && b == null) return null;
        if (a == null) return b;
        if (b == null) return a;
        return (a + b) / 2;
    },

    tierScore(avg, tiers) {
        if (avg == null || isNaN(avg)) return 0;
        for (const [min, pts] of tiers) {
            if (avg >= min) return pts;
        }
        return 0;
    },

    degisimPuan(sonDelta, t1Delta) {
        if (sonDelta == null || t1Delta == null) return 0;
        if (sonDelta > t1Delta) return 30;
        if (sonDelta < t1Delta) return -20;
        return 10;
    },

    isActiveMetric(metricId) {
        return this.ACTIVE_METRICS.has(metricId);
    },

    shouldUseForTahmin() {
        if (typeof IstatistikTahminEngine === 'undefined') return false;
        const TE = IstatistikTahminEngine;
        const store = TE._loadStore();
        const mode = store.calcMode || TE.CALC_MODE_SOLO;
        if (mode !== TE.CALC_MODE_SOLO) return false;
        const selected = store.selectedMetric || TE.DEFAULT_SELECTED_METRIC;
        return this.isActiveMetric(selected);
    },

    getSelectedMetricId() {
        if (typeof IstatistikTahminEngine === 'undefined') return null;
        const TE = IstatistikTahminEngine;
        return TE._loadStore().selectedMetric || TE.DEFAULT_SELECTED_METRIC;
    },

    highlightColsForMetric(metricId) {
        return this.HIGHLIGHT_COLS[metricId] || [];
    },

    compute(row) {
        const s0 = row.son8001Depths?.[0];
        const t0 = row.t1drDepths?.[0];
        if (!s0 || !t0) return null;

        const sonDelta = s0.gapPct;
        const t1Delta = t0.gapPct;
        const degisimPts = this.degisimPuan(sonDelta, t1Delta);

        const perfAvg = this.avg(s0.successPct, t0.successPct);
        const icAvg = this.avg(s0.selfPct, t0.selfPct);
        const eiAvg = this.avg(s0.horseBestPct, t0.horseBestPct);
        const tekilAvg = this.avg(s0.pct, t0.pct);

        const perfPts = this.tierScore(perfAvg, [[80, 25], [60, 15], [40, 5], [0, 0]]);
        const icPts = this.tierScore(icAvg, [[80, 15], [60, 10], [40, 5], [0, 0]]);
        const eiPts = this.tierScore(eiAvg, [[80, 15], [60, 10], [40, 5], [0, 0]]);
        const tekilPts = this.tierScore(tekilAvg, [[80, 15], [60, 10], [40, 5], [0, 0]]);

        const raw = (degisimPts * 1.5)
            + (perfPts * 1.2)
            + (icPts * 1.0)
            + (eiPts * 0.8)
            + (tekilPts * 0.6);
        const normalized = Math.round(Math.min(100, Math.max(0, (raw / this.MAX_RAW) * 100)));

        const scenario = this.classifyScenario(normalized, sonDelta, t1Delta);

        return {
            normalized,
            raw: Math.round(raw * 10) / 10,
            scenario,
            inputs: {
                sonDelta, t1Delta,
                sonBs: s0.successPct, t1Bs: t0.successPct,
                sonIc: s0.selfPct, t1Ic: t0.selfPct,
                sonEi: s0.horseBestPct, t1Ei: t0.horseBestPct,
                sonPct: s0.pct, t1Pct: t0.pct
            },
            components: {
                degisimPts, perfPts, icPts, eiPts, tekilPts,
                perfAvg, icAvg, eiAvg, tekilAvg
            }
        };
    },

    classifyScenario(score, sonDelta, t1Delta) {
        const s = sonDelta;
        const t = t1Delta;
        const bothLow = s != null && t != null && s < 25 && t < 25;
        const bothZero = s === 0 && t === 0;
        const onlySonZero = s === 0 && t != null && t !== 0;
        const bigDiff = s != null && t != null && Math.abs(s - t) >= 25;

        if (score >= 80 && bothLow) {
            return { id: 'muthis', label: 'Müthiş Yükseliş', cls: 'degisim-scenario-muthis' };
        }
        if (score >= 60 && score < 80 && bothZero) {
            return { id: 'ikili', label: 'İkili Düşüş', cls: 'degisim-scenario-ikili' };
        }
        if (score >= 40 && score < 60 && bigDiff) {
            return { id: 'cift', label: 'Çift Yönlü Değişim', cls: 'degisim-scenario-cift' };
        }
        if (score >= 20 && score < 40 && onlySonZero) {
            return { id: 'son800', label: 'Sadece SON800\'de Düşüş', cls: 'degisim-scenario-son800' };
        }
        if (score < 20) {
            return { id: 'dusuk', label: 'Düşük Performans', cls: 'degisim-scenario-dusuk' };
        }

        if (score >= 80) return { id: 'muthis', label: 'Müthiş Yükseliş', cls: 'degisim-scenario-muthis' };
        if (score >= 60) return { id: 'ikili', label: 'İkili Düşüş', cls: 'degisim-scenario-ikili' };
        if (score >= 40) return { id: 'cift', label: 'Çift Yönlü Değişim', cls: 'degisim-scenario-cift' };
        if (score >= 20) return { id: 'son800', label: 'Sadece SON800\'de Düşüş', cls: 'degisim-scenario-son800' };
        return { id: 'dusuk', label: 'Düşük Performans', cls: 'degisim-scenario-dusuk' };
    },

    toTahmin(ds) {
        if (!ds) {
            return { pct: null, score: 0, rank: null, metricCount: 0, weightSum: 0, terms: [], topTerms: [], degisimSkoru: null };
        }
        const terms = [
            { label: 'Değişim Δ', points: Math.round(ds.components.degisimPts * 1.5) },
            { label: 'Performans BS', points: Math.round(ds.components.perfPts * 1.2) },
            { label: 'İç İÇ', points: ds.components.icPts },
            { label: 'Genel Eİ', points: Math.round(ds.components.eiPts * 0.8) },
            { label: 'Tekil SON', points: Math.round(ds.components.tekilPts * 0.6) }
        ];
        return {
            pct: ds.normalized,
            score: ds.normalized,
            metricCount: 5,
            weightSum: ds.raw,
            terms,
            topTerms: [...terms].sort((a, b) => b.points - a.points),
            degisimSkoru: ds
        };
    },

    attachRaceTahmin(pkg) {
        const scored = pkg.rows.map(row => {
            const ds = this.compute(row);
            row.degisimSkoru = ds;
            return { row, tahmin: this.toTahmin(ds) };
        });

        scored.sort((a, b) => {
            const sa = a.tahmin.score ?? 0;
            const sb = b.tahmin.score ?? 0;
            if (sb !== sa) return sb - sa;
            return (a.row.no || 0) - (b.row.no || 0);
        });

        for (let i = 0; i < scored.length; i++) {
            scored[i].tahmin.rank = scored[i].tahmin.score > 0 || scored[i].tahmin.degisimSkoru ? i + 1 : null;
            scored[i].row.tahmin = scored[i].tahmin;
        }

        const leader = scored[0];
        pkg.tahminOzeti = {
            leader: leader?.row?.name || null,
            leaderPct: leader?.tahmin?.pct ?? null,
            leaderScore: leader?.tahmin?.score ?? 0,
            horseCount: scored.length,
            degisimSkoru: true
        };
        return pkg;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DegisimSkoruEngine };
}
