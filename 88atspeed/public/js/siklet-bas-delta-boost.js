/**
 * SİKLET BAŞ+ ← SON800-1 · Δ (gapPct) katkısı
 *
 * gapPct=0 (en iyi derece) derinlik hücreleri BAŞ+'a eklenir.
 * SON en yüksek, 5 ÖNCE en düşük ağırlık.
 * GÖSTERİM: kırmızı kenar +0, mavi kenar +0, yeşil/fosfor +0 → ekstra bonus.
 */
const SikletBasDeltaBoost = (function () {
    const MAX_BASE_PTS = 10;
    /** SON·Δ=0 iken mevcut katkıya ek +%10 */
    const SON_ZERO_EXTRA = 1.10;
    const BONUS = {
        kirmiziKenar: 5,
        maviKenar: 3,
        yesilFosfor: 15
    };

    function depthLabel(d) {
        return d === 0 ? 'SON' : d + ' ÖNCE';
    }

    /** SON=ağır … eski derinlik=hafif; toplam 1.0 */
    function recencyWeights(maxDepth) {
        const n = maxDepth || 0;
        if (!n) return [];
        let sum = 0;
        for (let d = 0; d < n; d++) sum += n - d;
        return Array.from({ length: n }, (_, d) => (n - d) / sum);
    }

    /** Bonus çarpanı: SON=1, eski derinlikler düşer */
    function recencyFactor(weights, d) {
        if (!weights.length || d < 0 || d >= weights.length) return 0;
        const top = weights[0] || 1;
        return top ? weights[d] / top : 0;
    }

    function gapProximity(gapPct) {
        if (gapPct == null || gapPct < 0) return 0;
        if (gapPct === 0) return 1;
        if (gapPct <= 10) return 0.85;
        if (gapPct <= 25) return 0.55;
        if (gapPct <= 40) return 0.30;
        return 0;
    }

    function isYesilFosfor(g) {
        return !!(g?.yesilSatir || g?.gucluUyari);
    }

    /** SON derinlikte gapPct=0 → +%10 ek çarpan */
    function sonZeroMultiplier(d, gapPct) {
        return d === 0 && gapPct === 0 ? SON_ZERO_EXTRA : 1;
    }

    function computeFromIstatRow(istatRow, maxDepth) {
        const depths = istatRow?.son8001Depths || [];
        const md = maxDepth || depths.length || 0;
        const weights = recencyWeights(md);
        const parts = [];
        let basePts = 0;
        let bonusPts = 0;

        for (let d = 0; d < md; d++) {
            const cell = depths[d];
            if (!cell || cell.gapPct == null) continue;
            const prox = gapProximity(cell.gapPct);
            if (prox <= 0) continue;

            const dl = depthLabel(d);
            const w = weights[d] || 0;
            const rf = recencyFactor(weights, d);
            const g = cell.gosterim || {};
            const sonMul = sonZeroMultiplier(d, cell.gapPct);

            const slice = MAX_BASE_PTS * w * prox * sonMul;
            if (slice > 0) {
                basePts += slice;
                let note = dl + '·Δ %' + cell.gapPct + ' → +' + slice.toFixed(1) + ' (ağırlık×' + prox.toFixed(2);
                if (sonMul > 1) note += ' · SON×' + sonMul.toFixed(2);
                note += ')';
                parts.push(note);
            }

            if (cell.gapPct !== 0) continue;

            if (g.kirmiziKenar) {
                const b = BONUS.kirmiziKenar * rf * sonMul;
                bonusPts += b;
                parts.push(dl + '·Δ ★ kırmızı kenar → +' + b.toFixed(1));
            }
            if (g.maviKenar) {
                const b = BONUS.maviKenar * rf * sonMul;
                bonusPts += b;
                parts.push(dl + '·Δ ★ mavi kenar → +' + b.toFixed(1));
            }
            if (isYesilFosfor(g)) {
                const b = BONUS.yesilFosfor * rf * sonMul;
                bonusPts += b;
                parts.push(dl + '·Δ ★ yeşil/fosfor → +' + b.toFixed(1));
            }
        }

        const total = Math.round((basePts + bonusPts) * 10) / 10;
        return {
            basePts: Math.round(basePts * 10) / 10,
            bonusPts: Math.round(bonusPts * 10) / 10,
            totalPts: total,
            parts,
            maxDepth: md
        };
    }

    /**
     * @param {object} st — KosuDimensionStatsEngine.computeStats çıktısı (mutate)
     * @param {object} istatRow — IstatistikEngine pkg.rows elemanı
     * @param {number} maxDepth
     */
    function applyToStats(st, istatRow, maxDepth) {
        if (!st?.basSuccess || st.basSuccess.pct == null) return st;
        const boost = computeFromIstatRow(istatRow, maxDepth);
        if (!boost.totalPts) return st;

        const before = st.basSuccess.pct;
        const after = Math.round(Math.min(130, Math.max(0, before + boost.totalPts)));
        const tip = (st.basSuccess.tooltip || '').split('\n');
        tip.push('— SON800-1 · Δ katkısı (max taban ' + MAX_BASE_PTS + ' puan) —');
        tip.push('Taban Δ: +' + boost.basePts + ' · GÖSTERİM bonus: +' + boost.bonusPts);
        tip.push('Toplam Δ→BAŞ+: +' + boost.totalPts + ' → %' + before + ' → %' + after);
        for (const p of boost.parts) tip.push('  · ' + p);

        st.basSuccess = Object.assign({}, st.basSuccess, {
            pct: after,
            display: '%' + after,
            boosted: after >= 85,
            penalized: after <= 25,
            tooltip: tip.join('\n'),
            deltaBoost: boost
        });
        return st;
    }

    return {
        MAX_BASE_PTS,
        SON_ZERO_EXTRA,
        BONUS,
        depthLabel,
        recencyWeights,
        recencyFactor,
        gapProximity,
        sonZeroMultiplier,
        computeFromIstatRow,
        applyToStats
    };
})();

if (typeof module !== 'undefined') module.exports = SikletBasDeltaBoost;
