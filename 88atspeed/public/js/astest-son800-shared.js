/**
 * Test sekmeleri — İstatistikler derinlik paketi + BAŞ+ Δ boost ortak yardımcılar
 */
const AtestSon800Shared = (function () {
    const NOTE = ' <strong>İstatistikler</strong> derinlik grupları (SON800-1/2, ORAN, TEST, ek metrikler, başarı oranları)'
        + ' bu sekmede — İstatistikler sayfasıyla aynı hesap, AĞ. ORT. sütunları hariç.'
        + ' <strong>ALAN 1–5</strong> (düzeltilmiş skor sütunu sonrası): sağdaki istat başlığına tıklayınca'
        + ' ilk boş alana geçici kopyalanır (sekmedeki <strong>tüm koşulara</strong> uygulanır);'
        + ' aynı başlığa tekrar tıklayınca alan boşalır.'
        + ' <strong>BAŞ+</strong> skoru SON800-1 · Δ (gapPct) ile güçlendirilir: SON derinlik en ağır,'
        + ' 5 ÖNCE en hafif; taban ~%10 (Δ=0 tam). SON·Δ=0 ek +%10.'
        + ' Δ=0 + kırmızı +5, mavi +3, yeşil/fosfor +15 (derinliğe göre).';

    function canUse() {
        return typeof IstatistikEngine !== 'undefined'
            && typeof Son800DepthUi !== 'undefined'
            && typeof AtestIstatDepthUi !== 'undefined'
            && typeof SikletBasDeltaBoost !== 'undefined';
    }

    function buildRaceContext(race, horses, hedefSehir, programTarih) {
        if (!canUse()) {
            return { istatRowByKey: new Map(), maxD1: 0, pkg: null, hedefSehir: hedefSehir || '' };
        }
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
        return { pkg, istatRowByKey, maxD1, hedefSehir: hedefSehir || '' };
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

    function hasIstatColumns(ctx) {
        return !!(ctx?.pkg && AtestIstatDepthUi.hasColumns(ctx.pkg));
    }

    function son800Colspan(ctx) {
        if (!ctx?.pkg) return 0;
        return AtestIstatDepthUi.totalColspan(ctx.pkg);
    }

    function headerRowspan(ctx) {
        if (!hasIstatColumns(ctx)) return 1;
        return AtestIstatDepthUi.headerRowspan(ctx.pkg);
    }

    function appendThRowspan(ctx) {
        const rs = headerRowspan(ctx);
        return rs > 1 ? (' rowspan="' + rs + '"') : '';
    }

    function appendGroupHeaderHtml(ctx) {
        if (!hasIstatColumns(ctx)) return '';
        return AtestIstatDepthUi.appendGroupHeaderHtml(ctx.pkg);
    }

    function appendMetricHeaderRows(ctx) {
        if (!hasIstatColumns(ctx)) return '';
        return AtestIstatDepthUi.appendMetricHeaderRows(ctx.pkg);
    }

    function renderRowCells(horse, ctx) {
        if (!hasIstatColumns(ctx)) return '';
        const row = getIstatRow(horse, ctx);
        return AtestIstatDepthUi.renderAllCells(row, ctx.pkg, ctx);
    }

    function tableExtraClass(ctx) {
        return hasIstatColumns(ctx) ? ' astest-istat-table siklet-son800-table' : '';
    }

    function raceHeaderSuffix(ctx) {
        if (!hasIstatColumns(ctx)) return '';
        return AtestIstatDepthUi.raceHeaderSuffix(ctx.pkg);
    }

    return {
        NOTE,
        canUse,
        buildRaceContext,
        getIstatRow,
        applyBasDeltaBoost,
        hasIstatColumns,
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
