/**
 * İstatistikler — tüm derinlik gruplarının AĞ. ORT.3 birleşik tahmin skoru
 * istatistik-grids-extra.js sonrası yüklenir.
 */
const IstatistikTahminEngine = {
    CORE_ORT_KEYS: [
        { key: 'son8001OrtOzeti', label: 'SON800-1' },
        { key: 'son8002OrtOzeti', label: 'SON800-2' },
        { key: 'oran1OrtOzeti', label: '800-1 ORAN' },
        { key: 'oran2OrtOzeti', label: '800-2 ORAN' },
        { key: 'fark827OrtOzeti', label: '800Δ·7' },
        { key: 'ffOrtOzeti', label: 'FFΔ' },
        { key: 'test8OrtOzeti', label: 'T8Δ' },
        { key: 'son800Dr1OrtOzeti', label: 'SON800·1DR' },
        { key: 'son800DrOrtOzeti', label: 'SON800·DR' },
        { key: 'test1OrtOzeti', label: 'TEST1' },
        { key: 'test2OrtOzeti', label: 'TEST2' },
        { key: 'test3OrtOzeti', label: 'TEST3' },
        { key: 'test123SiraliOrtOzeti', label: 'TEST·SIRA' },
        { key: 't1drOrtOzeti', label: 'T1×DR' }
    ],

    /** ort3 yoksa agirlikli → ort2 → ort1 sırasıyla dene */
    _ortPct(oz) {
        if (!oz) return null;
        if (oz.ort3?.pct != null) return oz.ort3.pct;
        if (oz.agirlikli?.pct != null) return oz.agirlikli.pct;
        if (oz.ort2?.pct != null) return oz.ort2.pct;
        if (oz.ort1?.pct != null) return oz.ort1.pct;
        return null;
    },

    /** Tek at için tüm gruplardan AĞ. ORT.3 ortalaması */
    computeRowTahmin(row, extraSections) {
        const terms = [];
        for (const def of this.CORE_ORT_KEYS) {
            const pct = this._ortPct(row[def.key]);
            if (pct != null) terms.push({ label: def.label, pct, source: 'core' });
        }
        for (const sec of extraSections || []) {
            const pct = this._ortPct(row[sec.ortKey]);
            if (pct != null) terms.push({ label: sec.label, pct, source: 'extra' });
        }
        if (!terms.length) {
            return { pct: null, rank: null, metricCount: 0, terms: [], topTerms: [] };
        }
        let sum = 0;
        for (const t of terms) sum += t.pct;
        const pct = Math.round(sum / terms.length);
        const topTerms = [...terms].sort((a, b) => b.pct - a.pct).slice(0, 8);
        return { pct, metricCount: terms.length, terms, topTerms };
    },

    /** Koşu satırlarını skora göre sırala; row.tahmin doldur */
    attachRaceTahmin(pkg) {
        const extraSections = pkg.extraSections || [];
        const scored = pkg.rows.map(row => ({
            row,
            tahmin: this.computeRowTahmin(row, extraSections)
        }));
        scored.sort((a, b) => {
            const pa = a.tahmin.pct ?? -1;
            const pb = b.tahmin.pct ?? -1;
            if (pb !== pa) return pb - pa;
            const ma = a.tahmin.metricCount;
            const mb = b.tahmin.metricCount;
            if (mb !== ma) return mb - ma;
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

    /**
     * Gerçek sıra ile kalibrasyon analizi (kayıt sonucu girildiğinde).
     * actualOrder: [{ name, finish }] finish 1 = birinci
     */
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
        const compositeRank = winnerRow?.tahmin?.rank ?? null;
        const metricsWhereWinnerFirst = perMetric.filter(m => m.winnerRank === 1).map(m => m.label);
        return {
            winner: winner?.name || null,
            compositeRank,
            compositePct: winnerRow?.tahmin?.pct ?? null,
            metricsWhereWinnerFirst,
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
