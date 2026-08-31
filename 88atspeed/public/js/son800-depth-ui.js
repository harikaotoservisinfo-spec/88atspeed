/**
 * SON800 derinlik sütunları — SİKLET sekmesi (metrik satırı × derinlik yan yana).
 * SON | 1 ÖNCE | … · Eİ | … · İÇ · Δ · BS — AĞ. ORT. sütunları yok.
 */
const Son800DepthUi = (function () {
    const GRP = 'istat-grp-son8001';
    const GROUP_LABEL = 'SON800-1';

    const METRIC_STRIPS = [
        { id: 'son', label: 'SON', tdClass: 'istat-son800-depth', thClass: 'istat-th-son800-depth' },
        { id: 'ei', label: 'Eİ', tdClass: 'istat-best-depth', thClass: 'istat-th-best-depth' },
        { id: 'ic', label: 'İÇ', tdClass: 'istat-self-depth', thClass: 'istat-th-self-depth' },
        { id: 'delta', label: 'Δ', tdClass: 'istat-gap-depth', thClass: 'istat-th-gap-depth' },
        { id: 'bs', label: 'BS', tdClass: 'istat-success-depth', thClass: 'istat-th-success-depth' }
    ];

    const GOSTERIM_FLAG_LABELS = {
        kirmiziKenar: 'Kırmızı kenar',
        maviKenar: 'Mavi kenar',
        maviKenarSira: 'Mavi·TEST·SIRA',
        maviKenarSon800: 'Mavi·SON800-1',
        yesilSatir: 'Yeşil satır',
        gucluUyari: 'Güçlü uyarı',
        maviFosfor: 'Fosfor mavi',
        pembeSatir: 'Pembe satır',
        kirmiziTest: 'Kırmızı TEST',
        sariTest12: 'Sarı TEST1≈2',
        test1EnIyi: 'TEST1 en iyi',
        test2EnIyi: 'TEST2 en iyi',
        test3EnIyi: 'TEST3 en iyi',
        sehirEslesme: 'Şehir eşleşme',
        mesafeEslesme: 'Mesafe eşleşme',
        test23Yanip: 'TEST23 yanıp',
        t1drKirmizi: 'T1×DR kırmızı',
        t1drEnIyi2: 'T1×DR top2'
    };

    function pctClass(pct) {
        if (pct === null || pct === undefined) return 'istat-pct-none';
        if (pct === 0) return 'istat-pct-low';
        if (pct <= 33) return 'istat-pct-mid';
        if (pct <= 66) return 'istat-pct-good';
        return 'istat-pct-high';
    }

    function depthLabel(d) {
        if (d === 0) return 'SON';
        return d + ' ÖNCE';
    }

    function son8001Colspan(maxDepth) {
        const d = maxDepth || 0;
        if (!d) return 0;
        return d * METRIC_STRIPS.length;
    }

    function headerRowspan() {
        return 3;
    }

    function gosterimTdExtraClasses(cell) {
        if (!cell?.gosterim) return '';
        const g = cell.gosterim;
        const parts = [];
        if (g.kirmiziKenar) parts.push('istat-gos-kirmizi-kenar');
        else if (g.maviKenar) parts.push('istat-gos-mavi-kenar');
        if (g.yesilSatir) parts.push('istat-gos-yesil-satir');
        if (g.gucluUyari) parts.push('istat-gos-guclu-uyari');
        if (g.maviFosfor) parts.push('istat-gos-mavi-fosfor');
        if (g.pembeSatir) parts.push('istat-gos-pembe-satir');
        if (g.sariTest12) parts.push('istat-gos-sari');
        if (g.kirmiziTest) parts.push('istat-gos-kirmizi-test');
        if (g.sehirEslesme || g.mesafeEslesme) parts.push('istat-gos-eslesme');
        return parts.join(' ');
    }

    function depthTdClass(baseCls, cell) {
        const extra = gosterimTdExtraClasses(cell);
        return extra ? baseCls + ' ' + extra : baseCls;
    }

    function gosterimTitleSuffix(cell) {
        if (!cell?.gosterim) return '';
        const tags = [];
        for (const [key, label] of Object.entries(GOSTERIM_FLAG_LABELS)) {
            if (cell.gosterim[key]) tags.push(label);
        }
        return tags.length ? ' | GÖSTERİM: ' + tags.join(', ') : '';
    }

    function wrapDepthCellInner(inner, cell) {
        const suffix = gosterimTitleSuffix(cell);
        if (!suffix) return inner;
        if (inner.includes('title="')) {
            return inner.replace(/title="([^"]*)"/, (m, t) => 'title="' + t + suffix.replace(/"/g, '&quot;') + '"');
        }
        return inner;
    }

    function formatRacePct(cell, label, depthLabelText) {
        if (!cell || cell.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        let title = label + ' · ' + depthLabelText + ': ' + (cell.derece || '?');
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        title += ' | ' + cell.comparedCount + ' at kıyası → %' + cell.pct;
        if (cell.isBest) title += ' (en iyi)';
        return '<span class="istat-pct ' + pctClass(cell.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.pct + '</span>';
    }

    function formatHorseBest(cell, groupLabel, depthLabelText) {
        if (!cell || cell.horseBestPct == null) {
            return '<span class="istat-pct istat-pct-none" title="En iyi derece koşu skalası">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · EN İYİ koşu skalası';
        if (cell.horseBestDerece) title += ' | atın en iyi: ' + cell.horseBestDerece;
        title += ' → %' + cell.horseBestPct;
        if (cell.isHorseBestRaceBest) title += ' ★ koşu en iyi derece';
        if (cell.isHorseBestRaceWorst) title += ' ★ koşu en kötü derece (%0)';
        return '<span class="istat-pct ' + pctClass(cell.horseBestPct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.horseBestPct + '</span>';
    }

    function formatSelf(cell, groupLabel, depthLabelText) {
        if (!cell || cell.selfPct == null) {
            return '<span class="istat-pct istat-pct-none" title="AT İÇİ ölçek">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · AT İÇİ';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        title += ' → %' + cell.selfPct;
        if (cell.isSelfBest) title += ' ★ at içi en iyi';
        return '<span class="istat-pct ' + pctClass(cell.selfPct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.selfPct + '</span>';
    }

    function isTwinZero(row) {
        const s800 = row?.son8001Depths?.[0];
        const t1 = row?.t1drDepths?.[0];
        if (!s800 || !t1 || s800.gapPct == null || t1.gapPct == null) return false;
        return s800.gapPct === 0 && t1.gapPct === 0;
    }

    function gapHighlight(row, depthIndex, cell) {
        if (!row || depthIndex !== 0) {
            return { tdExtra: '', twinZero: false, t1drLowGray: false };
        }
        const s800Gap = row.son8001Depths?.[0]?.gapPct;
        const t1Gap = row.t1drDepths?.[0]?.gapPct;
        if (isTwinZero(row) && cell?.gapPct === 0) {
            return { tdExtra: ' istat-gap-son8001-t1dr-twin-zero', twinZero: true, t1drLowGray: false };
        }
        if (!isTwinZero(row) && s800Gap != null && t1Gap != null && s800Gap < 25 && t1Gap < 25) {
            return { tdExtra: ' istat-gap-son8001-t1dr-low-neon', twinZero: false, t1drLowGray: true };
        }
        return { tdExtra: '', twinZero: false, t1drLowGray: false };
    }

    function formatGap(cell, groupLabel, depthLabelText, opts) {
        opts = opts || {};
        if (!cell || cell.gapPct == null) {
            return '<span class="istat-pct istat-pct-none" title="En iyi dereceden fark ölçeği">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · en iyi dereceden fark';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        if (cell.gapSalise != null) {
            title += ' | fark: ' + AtSpeedUtils.saliseToDerece(cell.gapSalise);
        }
        if (cell.horseBestVal != null && cell.derece) {
            title += ' | en iyi: ' + (cell.horseBestDerece || AtSpeedUtils.saliseToDerece(cell.horseBestVal));
        }
        title += ' → %' + cell.gapPct;
        if (cell.isGapMin) title += ' ★ en yakın (en iyi)';
        if (cell.isGapMax) title += ' ★ en uzak fark';
        let cls = pctClass(cell.gapPct);
        if (groupLabel === 'SON800-1' && cell.gapPct === 0) {
            cls += ' istat-pct-gap-zero-blink';
            title += ' | ★ en iyi derece (Δ=0)';
            if (opts.twinZeroHighlight) title += ' | ★ T1×DR SON·Δ de 0 (turuncu)';
            if (opts.t1drLowGray) title += ' | SON800-1 ve T1×DR SON·Δ ikisi <%25 (fosforlu yeşil)';
        }
        return '<span class="istat-pct ' + cls + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.gapPct + '</span>';
    }

    function formatSuccess(cell, groupLabel, depthLabelText) {
        if (!cell || cell.successPct == null) {
            return '<span class="istat-pct istat-pct-none" title="Başarı şansı">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · BAŞARI ŞANSI (ağ. ort.)';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        for (const p of cell.successParts || []) {
            title += ' | ' + p.label + ' %' + p.val;
        }
        title += ' → %' + cell.successPct;
        return '<span class="istat-pct ' + pctClass(cell.successPct) + ' istat-pct-success" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.successPct + '</span>';
    }

    function formatStripCell(stripId, cell, row, depthIndex, groupLabel, dl) {
        switch (stripId) {
            case 'son':
                return formatRacePct(cell, groupLabel, dl);
            case 'ei':
                return formatHorseBest(cell, groupLabel, dl);
            case 'ic':
                return formatSelf(cell, groupLabel, dl);
            case 'delta': {
                const gapHi = gapHighlight(row, depthIndex, cell);
                return formatGap(cell, groupLabel, dl, {
                    twinZeroHighlight: gapHi.twinZero,
                    t1drLowGray: gapHi.t1drLowGray
                });
            }
            case 'bs':
                return formatSuccess(cell, groupLabel, dl);
            default:
                return '<span class="istat-pct istat-pct-none">—</span>';
        }
    }

    function stripTdClasses(strip, depthIndex, maxDepth, gapHi) {
        let cls = GRP + ' ' + strip.tdClass;
        if (depthIndex === 0) cls += ' istat-son800-strip-start';
        if (depthIndex === maxDepth - 1) cls += ' istat-son800-strip-end';
        if (strip.id === 'son' && depthIndex === 0) cls += ' istat-grp-start';
        if (strip.id === 'bs' && depthIndex === maxDepth - 1) cls += ' istat-grp-end';
        if (strip.id === 'delta' && gapHi?.tdExtra) cls += gapHi.tdExtra;
        return cls;
    }

    function renderRowCells(row, maxDepth, groupLabel) {
        groupLabel = groupLabel || GROUP_LABEL;
        if (!maxDepth) {
            return '<td class="' + GRP + ' istat-son800-depth istat-grp-start istat-grp-end">'
                + '<span class="istat-pct istat-pct-none">—</span></td>';
        }
        let h = '';
        const depths = row?.son8001Depths || [];
        for (let si = 0; si < METRIC_STRIPS.length; si++) {
            const strip = METRIC_STRIPS[si];
            for (let d = 0; d < maxDepth; d++) {
                const cell = depths[d] || null;
                const dl = depthLabel(d);
                const gapHi = strip.id === 'delta' ? gapHighlight(row, d, cell) : null;
                const cls = stripTdClasses(strip, d, maxDepth, gapHi);
                const inner = formatStripCell(strip.id, cell, row, d, groupLabel, dl);
                h += '<td class="' + depthTdClass(cls, cell) + '">'
                    + wrapDepthCellInner(inner, cell) + '</td>';
            }
        }
        return h;
    }

    function appendMetricGroupHeaderRow(maxDepth) {
        let h = '';
        for (let si = 0; si < METRIC_STRIPS.length; si++) {
            const strip = METRIC_STRIPS[si];
            let cls = 'istat-th-metric istat-son800-metric-hdr ' + GRP + ' ' + strip.thClass;
            if (si === 0) cls += ' istat-grp-start';
            if (si === METRIC_STRIPS.length - 1) cls += ' istat-grp-end';
            h += '<th colspan="' + maxDepth + '" class="' + cls + '">'
                + '<div class="istat-col-label istat-son800-metric-label">' + strip.label + '</div></th>';
        }
        return h;
    }

    function appendSubHeaderCells(maxDepth) {
        let h = '';
        for (let si = 0; si < METRIC_STRIPS.length; si++) {
            const strip = METRIC_STRIPS[si];
            for (let d = 0; d < maxDepth; d++) {
                const dl = depthLabel(d);
                let cls = 'istat-th-metric istat-th-son800-depth ' + GRP + ' ' + strip.thClass;
                if (d === 0) cls += ' istat-son800-strip-start';
                if (d === maxDepth - 1) cls += ' istat-son800-strip-end';
                if (si === 0 && d === 0) cls += ' istat-grp-start';
                if (si === METRIC_STRIPS.length - 1 && d === maxDepth - 1) cls += ' istat-grp-end';
                h += '<th class="' + cls + '"><div class="istat-col-label">' + dl + '</div></th>';
            }
        }
        return h;
    }

    function groupHeaderColspan(maxDepth) {
        const n = son8001Colspan(maxDepth);
        if (!n) return '';
        return '<th colspan="' + n + '" class="istat-th-grp ' + GRP + ' istat-grp-start istat-grp-end">'
            + '<div class="istat-grp-head">'
            + '<div class="istat-grp-label">SON800-1<small>Derinlik bazlı rakip kıyası</small></div>'
            + '</div></th>';
    }

    return {
        GRP,
        METRIC_STRIPS,
        pctClass,
        depthLabel,
        son8001Colspan,
        headerRowspan,
        renderRowCells,
        appendMetricGroupHeaderRow,
        appendSubHeaderCells,
        groupHeaderColspan
    };
})();

if (typeof module !== 'undefined') module.exports = Son800DepthUi;
