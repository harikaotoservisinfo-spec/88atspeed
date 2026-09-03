/**
 * Test sekmeleri — SON800-1 derinlik paketi + BAŞ+ Δ boost ortak yardımcılar
 */
const AtestSon800Shared = (function () {
    const NOTE = ' <strong>SON800-1</strong> (SON/Eİ/İÇ/Δ/BS × derinlik) bu sekmede.'
        + ' <strong>BAŞ+</strong> skoru SON800-1 · Δ (gapPct) ile güçlendirilir: SON derinlik en ağır,'
        + ' 5 ÖNCE en hafif; taban ~%10 (Δ=0 tam). SON·Δ=0 ek +%10.'
        + ' Δ=0 + kırmızı +5, mavi +3, yeşil/fosfor +15 (derinliğe göre).';

    const raceCtxCache = new Map();

    function raceCtxKey(race, hedefSehir, programTarih) {
        const rn = race?.raceNo ?? '';
        const hc = (race?.horses || []).length;
        return String(rn) + '|' + String(hedefSehir || '') + '|' + String(programTarih || '') + '|' + hc;
    }

    function clearRaceContextCache() {
        raceCtxCache.clear();
    }

    function canUse() {
        return typeof IstatistikEngine !== 'undefined'
            && typeof Son800DepthUi !== 'undefined'
            && typeof SikletBasDeltaBoost !== 'undefined';
    }

    function buildRaceContext(race, horses, hedefSehir, programTarih) {
        if (!canUse()) return { istatRowByKey: new Map(), maxD1: 0 };
        const cacheKey = raceCtxKey(race, hedefSehir, programTarih);
        if (raceCtxCache.has(cacheKey)) return raceCtxCache.get(cacheKey);
        const raceForIstat = Object.assign({}, race, {
            horses: horses.map(h => Object.assign({}, h, {
                kosular: (typeof veriCache !== 'undefined' && h.atId != null
                    ? (veriCache[h.atId] || veriCache[String(h.atId)])
                    : null) || h.kosular || []
            }))
        });
        const pkg = IstatistikEngine.buildRaceIstatistikPackage(
            raceForIstat, hedefSehir, programTarih
        );
        IstatistikEngine.applyRacePctScales(pkg);
        const istatRowByKey = new Map();
        const maxD1 = pkg.maxDepth1 || 0;
        for (const row of pkg.rows || []) {
            istatRowByKey.set(String(row.no), row);
            if (row.atId != null) istatRowByKey.set(String(row.atId), row);
        }
        const ctx = { istatRowByKey, maxD1 };
        raceCtxCache.set(cacheKey, ctx);
        return ctx;
    }

    function getIstatRow(horse, ctx) {
        if (!ctx?.istatRowByKey || !horse) return {};
        return ctx.istatRowByKey.get(String(horse.no))
            || ctx.istatRowByKey.get(String(horse.atId))
            || {};
    }

    function applyBasDeltaBoost(st, horse, ctx) {
        if (!st || !ctx?.maxD1 || typeof SikletBasDeltaBoost === 'undefined') return st;
        return SikletBasDeltaBoost.applyToStats(st, getIstatRow(horse, ctx), ctx.maxD1);
    }

    function son800Colspan(maxD1) {
        return maxD1 > 0 ? Son800DepthUi.son8001Colspan(maxD1) : 0;
    }

    function headerRowspan(maxD1) {
        return maxD1 > 0 ? Son800DepthUi.headerRowspan() : 1;
    }

    function appendThRowspan(maxD1) {
        return maxD1 > 0 ? (' rowspan="' + Son800DepthUi.headerRowspan() + '"') : '';
    }

    function appendGroupHeaderHtml(maxD1) {
        return maxD1 > 0 ? Son800DepthUi.groupHeaderColspan(maxD1) : '';
    }

    function appendMetricHeaderRows(maxD1) {
        if (!maxD1) return '';
        return '<tr>' + Son800DepthUi.appendMetricGroupHeaderRow(maxD1) + '</tr>'
            + '<tr>' + Son800DepthUi.appendSubHeaderCells(maxD1) + '</tr>';
    }

    function renderRowCells(horse, ctx) {
        if (!ctx?.maxD1) return '';
        return Son800DepthUi.renderRowCells(getIstatRow(horse, ctx), ctx.maxD1, 'SON800-1');
    }

    function tableExtraClass(maxD1) {
        return maxD1 > 0 ? ' siklet-son800-table' : '';
    }

    function raceHeaderSuffix(maxD1) {
        return maxD1 > 0 ? (' · SON800-1 derinlik: ' + maxD1) : '';
    }

    return {
        NOTE,
        canUse,
        buildRaceContext,
        clearRaceContextCache,
        getIstatRow,
        applyBasDeltaBoost,
        son800Colspan,
        headerRowspan,
        appendThRowspan,
        appendGroupHeaderHtml,
        appendMetricHeaderRows,
        renderRowCells,
        tableExtraClass,
        raceHeaderSuffix
    };
})();

if (typeof module !== 'undefined') module.exports = AtestSon800Shared;
