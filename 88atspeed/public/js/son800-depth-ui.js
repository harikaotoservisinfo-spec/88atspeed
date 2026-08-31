/**
 * SON800 derinlik sütunları — İstatistikler ile aynı HTML/CSS (SİKLET sekmesi).
 */
const Son800DepthUi = (function () {
    const GRP = 'istat-grp-son8001';
    const GROUP_LABEL = 'SON800-1';

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
        return d * 5 + 4;
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

    function formatAgirlikli(stat, groupLabel) {
        if (!stat || stat.pct === null) return '<span class="istat-pct istat-pct-none">—</span>';
        let title = groupLabel + ' · Ağırlıklı ortalama (' + stat.depthCount + '/' + stat.maxDepth + ' derinlik)';
        title += ' | Ağırlık: SON=' + stat.maxDepth;
        if (stat.maxDepth > 1) title += ' … 1 ÖNCE=' + (stat.maxDepth - 1);
        for (const p of stat.parts || []) {
            const lbl = p.depth === 0 ? 'SON' : p.depth + ' ÖNCE';
            title += ' | ' + lbl + ': %' + p.pct + ' × ' + p.weight;
            if (p.tarih) title += ' (' + p.tarih + ')';
        }
        title += ' → %' + stat.pct;
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function formatSonNOrt(stat, groupLabel, label, windowDesc) {
        if (!stat || stat.pct === null) return '<span class="istat-pct istat-pct-none">—</span>';
        let title = groupLabel + ' · ' + label + ' (' + windowDesc + ', ' + stat.depthCount + ' derinlik)';
        for (const p of stat.parts || []) {
            const lbl = p.depth === 0 ? 'SON' : p.depth + ' ÖNCE';
            title += ' | ' + lbl + ': %' + p.pct;
            if (p.tarih) title += ' (' + p.tarih + ')';
        }
        title += ' → %' + stat.pct;
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function formatOrt3(stat, groupLabel) {
        if (!stat || stat.pct === null) return '<span class="istat-pct istat-pct-none">—</span>';
        let title = groupLabel + ' · AĞ. ORT.3 (ağırlıklı: ORT.2×4 + ORT.1×2 + ORT.×1)';
        if (stat.parts) {
            for (const p of stat.parts) {
                title += ' | ' + p.label + ': %' + p.pct + ' × ' + p.weight;
            }
        }
        title += ' → %' + stat.pct;
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function appendOrtCells(h, ortOzeti, groupLabel, isEnd) {
        const oz = ortOzeti || {};
        h += '<td class="' + GRP + ' istat-son800-avg">' + formatAgirlikli(oz.agirlikli, groupLabel) + '</td>';
        h += '<td class="' + GRP + ' istat-son800-avg">' + formatSonNOrt(oz.ort1, groupLabel, 'AĞ. ORT.1', 'SON+1+2 ÖNCE') + '</td>';
        h += '<td class="' + GRP + ' istat-son800-avg">' + formatSonNOrt(oz.ort2, groupLabel, 'AĞ. ORT.2', 'SON+1 ÖNCE') + '</td>';
        let endCls = GRP + ' istat-son800-avg';
        if (isEnd) endCls += ' istat-grp-end';
        h += '<td class="' + endCls + '">' + formatOrt3(oz.ort3, groupLabel) + '</td>';
        return h;
    }

    function renderRowCells(row, maxDepth, groupLabel) {
        groupLabel = groupLabel || GROUP_LABEL;
        if (!maxDepth) {
            return '<td class="' + GRP + ' istat-son800-depth istat-grp-start istat-grp-end">'
                + '<span class="istat-pct istat-pct-none">—</span></td>';
        }
        let h = '';
        const depths = row?.son8001Depths || [];
        const ortOzeti = row?.son8001OrtOzeti;
        for (let d = 0; d < maxDepth; d++) {
            const cell = depths[d] || null;
            const dl = depthLabel(d);
            let cls = GRP + ' istat-son800-depth';
            if (d === 0) cls += ' istat-grp-start';
            h += '<td class="' + depthTdClass(cls, cell) + '">'
                + wrapDepthCellInner(formatRacePct(cell, groupLabel, dl), cell) + '</td>';
            const bestCls = GRP + ' istat-best-depth';
            h += '<td class="' + depthTdClass(bestCls, cell) + '">'
                + wrapDepthCellInner(formatHorseBest(cell, groupLabel, dl), cell) + '</td>';
            const selfCls = GRP + ' istat-self-depth';
            h += '<td class="' + depthTdClass(selfCls, cell) + '">'
                + wrapDepthCellInner(formatSelf(cell, groupLabel, dl), cell) + '</td>';
            const gapHi = gapHighlight(row, d, cell);
            const gapCls = GRP + ' istat-gap-depth' + gapHi.tdExtra;
            h += '<td class="' + depthTdClass(gapCls, cell) + '">'
                + wrapDepthCellInner(formatGap(cell, groupLabel, dl, {
                    twinZeroHighlight: gapHi.twinZero,
                    t1drLowGray: gapHi.t1drLowGray
                }), cell) + '</td>';
            const successCls = GRP + ' istat-success-depth';
            h += '<td class="' + depthTdClass(successCls, cell) + '">'
                + wrapDepthCellInner(formatSuccess(cell, groupLabel, dl), cell) + '</td>';
        }
        return appendOrtCells(h, ortOzeti, groupLabel, true);
    }

    function appendSubHeaderCells(maxDepth) {
        let h = '';
        for (let d = 0; d < maxDepth; d++) {
            const dl = depthLabel(d);
            let cls = 'istat-th-metric istat-th-son800-depth ' + GRP;
            if (d === 0) cls += ' istat-grp-start';
            h += '<th class="' + cls + '"><div class="istat-col-label">' + dl + '</div></th>';
            h += '<th class="' + cls + ' istat-th-best-depth"><div class="istat-col-label">' + dl + '·Eİ</div></th>';
            h += '<th class="' + cls + ' istat-th-self-depth"><div class="istat-col-label">' + dl + '·İÇ</div></th>';
            h += '<th class="' + cls + ' istat-th-gap-depth"><div class="istat-col-label">' + dl + '·Δ</div></th>';
            h += '<th class="' + cls + ' istat-th-success-depth"><div class="istat-col-label">' + dl + '·BS</div></th>';
        }
        const avgCols = ['AĞ. ORT.', 'AĞ. ORT.1', 'AĞ. ORT.2', 'AĞ. ORT.3'];
        for (let i = 0; i < avgCols.length; i++) {
            let cls = 'istat-th-metric istat-th-son800-avg ' + GRP;
            if (i === avgCols.length - 1) cls += ' istat-grp-end';
            h += '<th class="' + cls + '"><div class="istat-col-label">' + avgCols[i] + '</div></th>';
        }
        return h;
    }

    function groupHeaderColspan(maxDepth) {
        const n = son8001Colspan(maxDepth);
        if (!n) return '';
        return '<th colspan="' + n + '" class="istat-th-grp ' + GRP + ' istat-grp-start istat-grp-end">'
            + '<div class="istat-grp-head">'
            + '<div class="istat-grp-label">SON800-1<small>Derinlik bazlı rakip kıyası + ağ. ort.</small></div>'
            + '</div></th>';
    }

    return {
        GRP,
        pctClass,
        depthLabel,
        son8001Colspan,
        renderRowCells,
        appendSubHeaderCells,
        groupHeaderColspan
    };
})();

if (typeof module !== 'undefined') module.exports = Son800DepthUi;
