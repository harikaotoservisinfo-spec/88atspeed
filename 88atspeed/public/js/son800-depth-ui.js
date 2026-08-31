/**
 * SON800 derinlik sütunları — ortak HTML (İstatistikler + SİKLET sekmesi).
 */
const Son800DepthUi = (function () {
    const GRP = 'sk-son8001';

    function pctClass(pct) {
        if (pct === null || pct === undefined) return 'sk-pct-none';
        if (pct === 0) return 'sk-pct-low';
        if (pct <= 33) return 'sk-pct-mid';
        if (pct <= 66) return 'sk-pct-good';
        return 'sk-pct-high';
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

    function formatRacePct(cell, label, depthLabelText) {
        if (!cell || cell.pct === null) {
            return '<span class="sk-pct sk-pct-none">—</span>';
        }
        let title = label + ' · ' + depthLabelText + ': ' + (cell.derece || '?');
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        title += ' | ' + cell.comparedCount + ' at kıyası → %' + cell.pct;
        if (cell.isBest) title += ' (en iyi)';
        return '<span class="sk-pct ' + pctClass(cell.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.pct + '</span>';
    }

    function formatHorseBest(cell, groupLabel, depthLabelText) {
        if (!cell || cell.horseBestPct == null) {
            return '<span class="sk-pct sk-pct-none" title="En iyi derece koşu skalası">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · SON·Eİ';
        if (cell.horseBestDerece) title += ' | atın en iyi: ' + cell.horseBestDerece;
        title += ' → %' + cell.horseBestPct;
        return '<span class="sk-pct ' + pctClass(cell.horseBestPct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.horseBestPct + '</span>';
    }

    function formatSelf(cell, groupLabel, depthLabelText) {
        if (!cell || cell.selfPct == null) {
            return '<span class="sk-pct sk-pct-none" title="SON·İÇ">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · SON·İÇ';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        title += ' → %' + cell.selfPct;
        return '<span class="sk-pct ' + pctClass(cell.selfPct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.selfPct + '</span>';
    }

    function isTwinZero(row) {
        const s800 = row?.son8001Depths?.[0];
        const t1 = row?.t1drDepths?.[0];
        if (!s800 || !t1 || s800.gapPct == null || t1.gapPct == null) return false;
        return s800.gapPct === 0 && t1.gapPct === 0;
    }

    function gapHighlight(row, depthIndex, cell) {
        if (!row || depthIndex !== 0) return { tdExtra: '', twinZero: false, t1drLowGray: false };
        const s800Gap = row.son8001Depths?.[0]?.gapPct;
        const t1Gap = row.t1drDepths?.[0]?.gapPct;
        if (isTwinZero(row) && cell?.gapPct === 0) {
            return { tdExtra: ' sk-gap-twin-zero', twinZero: true, t1drLowGray: false };
        }
        if (!isTwinZero(row) && s800Gap != null && t1Gap != null && s800Gap < 25 && t1Gap < 25) {
            return { tdExtra: ' sk-gap-low-neon', twinZero: false, t1drLowGray: true };
        }
        return { tdExtra: '', twinZero: false, t1drLowGray: false };
    }

    function formatGap(cell, groupLabel, depthLabelText, opts) {
        opts = opts || {};
        if (!cell || cell.gapPct == null) {
            return '<span class="sk-pct sk-pct-none" title="SON·Δ">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · SON·Δ';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        if (cell.gapSalise != null) {
            title += ' | fark: ' + AtSpeedUtils.saliseToDerece(cell.gapSalise);
        }
        title += ' → %' + cell.gapPct;
        let cls = pctClass(cell.gapPct);
        if (groupLabel === 'SON800-1' && cell.gapPct === 0) {
            cls += ' sk-pct-gap-zero';
            if (opts.twinZeroHighlight) title += ' | T1×DR SON·Δ de 0';
            if (opts.t1drLowGray) title += ' | fosforlu yeşil (Δ<%25)';
        }
        return '<span class="sk-pct ' + cls + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.gapPct + '</span>';
    }

    function formatSuccess(cell, groupLabel, depthLabelText) {
        if (!cell || cell.successPct == null) {
            return '<span class="sk-pct sk-pct-none" title="SON·BS">—</span>';
        }
        let title = groupLabel + ' · ' + depthLabelText + ' · SON·BS';
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        title += ' → %' + cell.successPct;
        return '<span class="sk-pct ' + pctClass(cell.successPct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.successPct + '</span>';
    }

    function formatAgirlikli(stat, groupLabel) {
        if (!stat || stat.pct === null) return '<span class="sk-pct sk-pct-none">—</span>';
        let title = groupLabel + ' · AĞ. ORT. (' + stat.depthCount + '/' + stat.maxDepth + ' derinlik) → %' + stat.pct;
        return '<span class="sk-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function formatSonNOrt(stat, groupLabel, label, windowDesc) {
        if (!stat || stat.pct === null) return '<span class="sk-pct sk-pct-none">—</span>';
        let title = groupLabel + ' · ' + label + ' (' + windowDesc + ') → %' + stat.pct;
        return '<span class="sk-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function formatOrt3(stat, groupLabel) {
        if (!stat || stat.pct === null) return '<span class="sk-pct sk-pct-none">—</span>';
        let title = groupLabel + ' · AĞ. ORT.3 → %' + stat.pct;
        return '<span class="sk-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function appendOrtCells(h, ortOzeti, groupLabel, isEnd) {
        const oz = ortOzeti || {};
        h += '<td class="' + GRP + ' sk-son800-avg">' + formatAgirlikli(oz.agirlikli, groupLabel) + '</td>';
        h += '<td class="' + GRP + ' sk-son800-avg">' + formatSonNOrt(oz.ort1, groupLabel, 'AĞ. ORT.1', 'SON+1+2 ÖNCE') + '</td>';
        h += '<td class="' + GRP + ' sk-son800-avg">' + formatSonNOrt(oz.ort2, groupLabel, 'AĞ. ORT.2', 'SON+1 ÖNCE') + '</td>';
        let endCls = GRP + ' sk-son800-avg';
        if (isEnd) endCls += ' sk-son800-end';
        h += '<td class="' + endCls + '">' + formatOrt3(oz.ort3, groupLabel) + '</td>';
        return h;
    }

    function renderRowCells(row, maxDepth, groupLabel) {
        if (!maxDepth) {
            return '<td class="' + GRP + ' sk-son800-empty" colspan="1"><span class="sk-pct sk-pct-none">—</span></td>';
        }
        let h = '';
        const depths = row?.son8001Depths || [];
        const ortOzeti = row?.son8001OrtOzeti;
        for (let d = 0; d < maxDepth; d++) {
            const cell = depths[d] || null;
            const dl = depthLabel(d);
            let cls = GRP + ' sk-son800-depth';
            if (d === 0) cls += ' sk-son800-start';
            h += '<td class="' + cls + '">' + formatRacePct(cell, groupLabel, dl) + '</td>';
            h += '<td class="' + GRP + ' sk-son800-ei">' + formatHorseBest(cell, groupLabel, dl) + '</td>';
            h += '<td class="' + GRP + ' sk-son800-ic">' + formatSelf(cell, groupLabel, dl) + '</td>';
            const gapHi = gapHighlight(row, d, cell);
            h += '<td class="' + GRP + ' sk-son800-delta' + gapHi.tdExtra + '">'
                + formatGap(cell, groupLabel, dl, {
                    twinZeroHighlight: gapHi.twinZero,
                    t1drLowGray: gapHi.t1drLowGray
                }) + '</td>';
            h += '<td class="' + GRP + ' sk-son800-bs">' + formatSuccess(cell, groupLabel, dl) + '</td>';
        }
        return appendOrtCells(h, ortOzeti, groupLabel, true);
    }

    function appendSubHeaderCells(maxDepth) {
        let h = '';
        for (let d = 0; d < maxDepth; d++) {
            const dl = depthLabel(d);
            const edge = d === 0 ? ' sk-son800-start' : '';
            h += '<th class="' + GRP + ' sk-son800-th' + edge + '" title="Rakip kıyası %">' + dl + '</th>';
            h += '<th class="' + GRP + ' sk-son800-th" title="SON·Eİ — en iyi derece skalası">' + dl + '·Eİ</th>';
            h += '<th class="' + GRP + ' sk-son800-th" title="SON·İÇ — at içi ölçek">' + dl + '·İÇ</th>';
            h += '<th class="' + GRP + ' sk-son800-th" title="SON·Δ — en iyi dereceden fark">' + dl + '·Δ</th>';
            h += '<th class="' + GRP + ' sk-son800-th" title="SON·BS — başarı şansı">' + dl + '·BS</th>';
        }
        h += '<th class="' + GRP + ' sk-son800-th sk-son800-avg">AĞ. ORT.</th>';
        h += '<th class="' + GRP + ' sk-son800-th sk-son800-avg">AĞ. ORT.1</th>';
        h += '<th class="' + GRP + ' sk-son800-th sk-son800-avg">AĞ. ORT.2</th>';
        h += '<th class="' + GRP + ' sk-son800-th sk-son800-avg sk-son800-end">AĞ. ORT.3</th>';
        return h;
    }

    function groupHeaderColspan(maxDepth) {
        const n = son8001Colspan(maxDepth);
        if (!n) return '';
        return '<th colspan="' + n + '" class="' + GRP + ' sk-son800-grp" rowspan="1">'
            + 'SON800-1<small>Derinlik bazlı rakip kıyası + ağ. ort.</small></th>';
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
