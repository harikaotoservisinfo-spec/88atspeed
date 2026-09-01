/**
 * Test sekmeleri — İstatistikler sayfasındaki tüm derinlik grupları (AĞ. ORT. hariç).
 */
const AtestIstatDepthUi = (function () {
    const UI = typeof Son800DepthUi !== 'undefined' ? Son800DepthUi : null;

    const FIVE_STRIP_METRICS = [
        { id: 'son8001', label: 'SON800-1', sub: 'Derinlik bazlı rakip kıyası', grpClass: 'istat-grp-son8001', depthsKey: 'son8001Depths', maxDepthKey: 'maxDepth1', groupLabel: 'SON800-1', twinZeroGap: true },
        { id: 'son8002', label: 'SON800-2', sub: 'Derinlik bazlı rakip kıyası', grpClass: 'istat-grp-son8002', depthsKey: 'son8002Depths', maxDepthKey: 'maxDepth2', groupLabel: 'SON800-2' },
        { id: 'oran1', label: '800-1 ORAN', subKey: 'oran1', grpClass: 'istat-grp-son800oran1', depthsKey: 'oran1Depths', maxDepthKey: 'oranMaxDepth1', groupLabel: '800-1 ORAN' },
        { id: 'oran2', label: '800-2 ORAN', subKey: 'oran2', grpClass: 'istat-grp-son800oran2', depthsKey: 'oran2Depths', maxDepthKey: 'oranMaxDepth2', groupLabel: '800-2 ORAN' },
        { id: 'fark827', label: '800Δ·7', sub: 'Son 7 koşu |8002-8001| ort. 0\'a yakın = %100', grpClass: 'istat-grp-f827', depthsKey: 'fark827Depths', maxDepthKey: 'maxDepthFark827', groupLabel: '800Δ·7' },
        { id: 'ff', label: 'FFΔ', sub: 'FARKLARIN FARKI |0\'a| yakın = %100', grpClass: 'istat-grp-ffd', depthsKey: 'ffDepths', maxDepthKey: 'maxDepthFf', groupLabel: 'FFΔ' },
        { id: 't8', label: 'T8Δ', sub: 'TEST8 |0\'a| yakın = %100', grpClass: 'istat-grp-t8d', depthsKey: 'test8Depths', maxDepthKey: 'maxDepthT8', groupLabel: 'T8Δ' },
        { id: 'test1', label: 'TEST1', sub: 'En iyi TEST1 = %100, derinlik kıyası (TAHMİN ×20)', grpClass: 'istat-grp-test1', depthsKey: 'test1Depths', maxDepthKey: 'maxDepthTest1', groupLabel: 'TEST1' },
        { id: 'test2', label: 'TEST2', sub: 'En iyi TEST2 = %100, derinlik kıyası', grpClass: 'istat-grp-test2', depthsKey: 'test2Depths', maxDepthKey: 'maxDepthTest2', groupLabel: 'TEST2' },
        { id: 'test3', label: 'TEST3', sub: 'En iyi TEST3 = %100 (SON800-2) (TAHMİN ×5)', grpClass: 'istat-grp-test3', depthsKey: 'test3Depths', maxDepthKey: 'maxDepthTest3', groupLabel: 'TEST3' },
        { id: 'testsira', label: 'TEST·SIRA', subKey: 'testsira', grpClass: 'istat-grp-testsira', depthsKey: 'test123SiraliDepths', maxDepthKey: 'maxDepthTest123Sirali', groupLabel: 'TEST·SIRA' },
        { id: 't1dr', label: 'T1×DR', sub: 'En iyi T1×DR = %100', grpClass: 'istat-grp-t1dr', depthsKey: 't1drDepths', maxDepthKey: 'maxDepthT1dr', groupLabel: 'T1×DR' }
    ];

    const SINGLE_PCT_METRICS = [
        { id: 'son800dr1', label: 'SON800·1DR/SL', sub: '1. derece korelasyon', grpClass: 'istat-grp-son800dr1', depthsKey: 'son800Dr1Depths', maxDepthKey: 'maxDepthDr1', drLabel: '1DR/SL' },
        { id: 'son800dr', label: 'SON800·DR/SL', sub: 'At derecesi korelasyon', grpClass: 'istat-grp-son800dr', depthsKey: 'son800DrDepths', maxDepthKey: 'maxDepthDr', drLabel: 'DR/SL' }
    ];

    const SUCCESS_GROUPS = [
        { id: 'donem', label: 'Dönem İçi Koşu Oranı', sub: 'Son dönemdeki koşu / eski koşu payı', grpClass: 'istat-grp-donem', keys: ['ay3', 'ay1', 'gun15'], kind: 'donem' },
        { id: 'genelIlk3', label: 'Genel İlk 3 Oranı', sub: 'Tüm koşularda 1.–3. sıra', grpClass: 'istat-grp-ilk3', keys: ['genelIlk3'], ilkNo: 3, kind: 'genel' },
        { id: 'genelIlk2', label: 'Genel İlk 2 Oranı', sub: 'Tüm koşularda 1.–2. sıra', grpClass: 'istat-grp-ilk2', keys: ['genelIlk2'], ilkNo: 2, kind: 'genel' },
        { id: 'genelIlk1', label: 'Genel İlk 1 Oranı', sub: 'Tüm koşularda birincilik', grpClass: 'istat-grp-ilk1', keys: ['genelIlk1'], ilkNo: 1, kind: 'genel' },
        { id: 'smIlk3', label: 'Şehir + Mesafe İlk 3', sub: 'Bu hipodrom ve mesafede 1.–3. sıra', grpClass: 'istat-grp-sm3', keys: ['smIlk3'], ilkNo: 3, kind: 'sm' },
        { id: 'smIlk2', label: 'Şehir + Mesafe İlk 2', sub: 'Bu hipodrom ve mesafede 1.–2. sıra', grpClass: 'istat-grp-sm2', keys: ['smIlk2'], ilkNo: 2, kind: 'sm' },
        { id: 'smIlk1', label: 'Şehir + Mesafe İlk 1', sub: 'Bu hipodrom ve mesafede birincilik', grpClass: 'istat-grp-sm1', keys: ['smIlk1'], ilkNo: 1, kind: 'sm' },
        { id: 'mesafeIlk3', label: 'Genel Mesafe İlk 3', sub: 'Bu mesafede (tüm şehirler) 1.–3. sıra', grpClass: 'istat-grp-mf3', keys: ['mesafeIlk3'], ilkNo: 3, kind: 'mesafe' },
        { id: 'mesafeIlk2', label: 'Genel Mesafe İlk 2', sub: 'Bu mesafede (tüm şehirler) 1.–2. sıra', grpClass: 'istat-grp-mf2', keys: ['mesafeIlk2'], ilkNo: 2, kind: 'mesafe' },
        { id: 'mesafeIlk1', label: 'Genel Mesafe İlk 1', sub: 'Bu mesafede (tüm şehirler) birincilik', grpClass: 'istat-grp-mf1', keys: ['mesafeIlk1'], ilkNo: 1, kind: 'mesafe' }
    ];

    const PERIOD_LABELS = ['3 AY', '1 AY', '15G'];

    function extraGrpClass(tone) {
        return 'istat-grp-xtra istat-grp-xtra-' + ((tone || 0) % 8);
    }

    function pctClass(pct) {
        return UI ? UI.pctClass(pct) : 'istat-pct-none';
    }

    function oranSubtitle(pkg, which) {
        const ana = which === 'oran1' ? pkg?.oranAnaDerece1 : pkg?.oranAnaDerece2;
        const kotu = which === 'oran1' ? pkg?.oranKotuDerece1 : pkg?.oranKotuDerece2;
        if (!ana && !kotu) return 'Ana/en kötü oran skalası';
        const anaTxt = ana || '?';
        const kotuTxt = kotu || '?';
        return 'Ana: ' + anaTxt + ' (%100) · En kötü: ' + kotuTxt + ' (%0)';
    }

    function testsiraSubtitle(pkg) {
        const min = pkg?.testsiraMinRulePct;
        const max = pkg?.testsiraMaxRulePct;
        if (min == null || max == null) return 'T3≥T2≥T1 · En iyi skor: %100';
        return 'T3≥T2≥T1 · En iyi skor: %' + max + ' (%100) · En kötü skor: %' + min + ' (%0)';
    }

    function metricSubtitle(spec, pkg) {
        if (spec.subKey === 'oran1') return oranSubtitle(pkg, 'oran1');
        if (spec.subKey === 'oran2') return oranSubtitle(pkg, 'oran2');
        if (spec.subKey === 'testsira') return testsiraSubtitle(pkg);
        return spec.sub || '';
    }

    function buildPlan(pkg) {
        if (!pkg) return { sections: [], hasFiveStrip: false };
        const sections = [];
        for (const spec of FIVE_STRIP_METRICS) {
            const maxDepth = pkg[spec.maxDepthKey] || 0;
            if (maxDepth > 0) {
                sections.push(Object.assign({ type: 'fiveStrip', maxDepth }, spec));
            }
        }
        for (const spec of SINGLE_PCT_METRICS) {
            const maxDepth = pkg[spec.maxDepthKey] || 0;
            if (maxDepth > 0) {
                sections.push(Object.assign({ type: 'singlePct', maxDepth }, spec));
            }
        }
        const hasTestOzet = (pkg.maxDepthTest1 || 0) > 0
            || (pkg.maxDepthTest2 || 0) > 0
            || (pkg.maxDepthTest3 || 0) > 0;
        if (hasTestOzet) {
            sections.push({ type: 'testOzet', id: 'testozet', label: 'TEST AĞ. ORT.', sub: 'TEST1 / TEST2 / TEST3 yan yana', grpClass: 'istat-grp-testozet', cols: 3 });
        }
        for (const sec of pkg.extraSections || []) {
            if ((sec.maxDepth || 0) > 0) {
                sections.push(Object.assign({ type: 'extra', maxDepth: sec.maxDepth, grpClass: extraGrpClass(sec.tone) }, sec));
            }
        }
        for (const spec of SUCCESS_GROUPS) {
            sections.push(Object.assign({ type: 'success', cols: 3 }, spec));
        }
        const hasFiveStrip = sections.some(s => s.type === 'fiveStrip');
        return { sections, hasFiveStrip };
    }

    function sectionColspan(section) {
        if (section.type === 'fiveStrip') return UI.fiveStripColspan(section.maxDepth);
        if (section.type === 'singlePct' || section.type === 'extra') return section.maxDepth;
        return section.cols || 3;
    }

    function totalColspan(pkg) {
        const plan = buildPlan(pkg);
        let n = 0;
        for (const s of plan.sections) n += sectionColspan(s);
        return n;
    }

    function hasColumns(pkg) {
        return totalColspan(pkg) > 0;
    }

    function headerRowspan(pkg) {
        const plan = buildPlan(pkg);
        return plan.hasFiveStrip ? 3 : 2;
    }

    function appendGroupTh(spec, pkg, isEnd) {
        const n = sectionColspan(spec);
        let cls = 'istat-th-grp ' + spec.grpClass + ' istat-grp-start';
        if (isEnd) cls += ' istat-grp-end';
        const sub = spec.type === 'extra'
            ? (spec.sub || '')
            : metricSubtitle(spec, pkg) || spec.sub || '';
        return '<th colspan="' + n + '" class="' + cls + '">'
            + '<div class="istat-grp-head">'
            + '<div class="istat-grp-label">' + spec.label
            + '<small>' + sub + '</small></div>'
            + '</div></th>';
    }

    function appendGroupHeaderHtml(pkg) {
        const plan = buildPlan(pkg);
        if (!plan.sections.length) return '';
        let h = '';
        for (let i = 0; i < plan.sections.length; i++) {
            h += appendGroupTh(plan.sections[i], pkg, i === plan.sections.length - 1);
        }
        return h;
    }

    function appendFixedSubHeaders(spec, isEnd) {
        const labels = PERIOD_LABELS;
        let h = '';
        for (let i = 0; i < labels.length; i++) {
            let cls = 'istat-th-metric ' + spec.grpClass;
            if (i === 0) cls += ' istat-grp-start';
            if (i === labels.length - 1 && isEnd) cls += ' istat-grp-end';
            h += '<th class="' + cls + '" rowspan="2"><div class="istat-col-label">' + labels[i] + '</div></th>';
        }
        return h;
    }

    function appendMetricHeaderRows(pkg) {
        const plan = buildPlan(pkg);
        if (!plan.sections.length) return '';
        let row2 = '<tr>';
        let row3 = plan.hasFiveStrip ? '<tr>' : '';
        for (let i = 0; i < plan.sections.length; i++) {
            const spec = plan.sections[i];
            const isEnd = i === plan.sections.length - 1;
            if (spec.type === 'fiveStrip') {
                row2 += UI.appendFiveStripMetricRow(spec.maxDepth, {
                    grpClass: spec.grpClass,
                    grpStart: true,
                    grpEnd: isEnd
                });
                row3 += UI.appendFiveStripDepthRow(spec.maxDepth, {
                    grpClass: spec.grpClass,
                    grpStart: true,
                    grpEnd: isEnd
                });
            } else if (spec.type === 'singlePct' || spec.type === 'extra') {
                row2 += UI.appendSinglePctDepthRow(spec.maxDepth, {
                    grpClass: spec.grpClass,
                    grpStart: true,
                    grpEnd: isEnd,
                    rowspan: plan.hasFiveStrip ? 2 : 1
                });
            } else if (spec.type === 'testOzet') {
                const cols = ['TEST1', 'TEST2', 'TEST3'];
                for (let c = 0; c < cols.length; c++) {
                    let cls = 'istat-th-metric ' + spec.grpClass;
                    if (c === 0) cls += ' istat-grp-start';
                    if (c === cols.length - 1 && isEnd) cls += ' istat-grp-end';
                    const rs = plan.hasFiveStrip ? ' rowspan="2"' : '';
                    row2 += '<th class="' + cls + '"' + rs + '><div class="istat-col-label">' + cols[c] + '</div></th>';
                }
            } else if (spec.type === 'success') {
                row2 += appendFixedSubHeaders(spec, isEnd);
            }
        }
        row2 += '</tr>';
        if (plan.hasFiveStrip) {
            row3 += '</tr>';
            return row2 + row3;
        }
        return row2;
    }

    function formatDrKorelasyonCell(cell, dl, groupLabel, drLabel) {
        if (!cell || cell.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        let title = groupLabel + ' · ' + dl + ' · ' + drLabel;
        if (cell.tarih) title += ' (' + cell.tarih + ')';
        if (cell.corr != null) title += ' | r=' + cell.corr.toFixed(3);
        title += ' → %' + cell.pct;
        if (cell.isBest) title += ' (en iyi korelasyon)';
        return '<span class="istat-pct ' + pctClass(cell.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + cell.pct + '</span>';
    }

    function formatAgirlikliOrt(stat, label) {
        if (!stat || stat.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        let title = label + ' · AĞ. ORT. (derinlik ağırlıklı)';
        if (stat.depthCount != null) title += ' | ' + stat.depthCount + ' derinlik';
        title += ' → %' + stat.pct;
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="'
            + title.replace(/"/g, '&quot;') + '">%' + stat.pct + '</span>';
    }

    function formatDonemPctCell(stat, donemLabel) {
        if (!stat || stat.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        const title = (stat.recent + ' koşu ' + donemLabel + ' içinde, ' + stat.older
            + ' koşu daha eski (toplam ' + stat.total + ')').replace(/"/g, '&quot;');
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="' + title + '">%' + stat.pct + '</span>';
    }

    function formatGenelIlkPctCell(stat, donemLabel, ilkNo) {
        if (!stat || stat.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        const hit = stat.hit ?? stat.top3;
        const miss = stat.miss ?? stat.notTop3;
        const ilkLabel = ilkNo === 1 ? '1. sıra' : 'İlk ' + ilkNo;
        const title = (donemLabel + ': ' + hit + '/' + stat.total + ' koşuda ' + ilkLabel
            + ' (' + miss + ' dışı)').replace(/"/g, '&quot;');
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="' + title + '">%' + stat.pct + '</span>';
    }

    function formatSmIlkPctCell(stat, donemLabel, hedefSehir, hedefMesafe, ilkNo) {
        if (!stat || stat.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        const mesafeTxt = hedefMesafe != null ? hedefMesafe + 'm' : '?';
        const ilkLabel = ilkNo === 1 ? '1. sıra' : 'İlk ' + ilkNo;
        const title = (donemLabel + ' — ' + (hedefSehir || '?') + ' / ' + mesafeTxt + ' (' + ilkLabel + '): '
            + stat.hit + '/' + stat.total + ' koşuda ' + ilkLabel + ' (' + stat.miss + ' dışı)').replace(/"/g, '&quot;');
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="' + title + '">%' + stat.pct + '</span>';
    }

    function formatMesafeIlkPctCell(stat, donemLabel, hedefMesafe, ilkNo) {
        if (!stat || stat.pct === null) {
            return '<span class="istat-pct istat-pct-none">—</span>';
        }
        const mesafeTxt = hedefMesafe != null ? hedefMesafe + 'm' : '?';
        const ilkLabel = ilkNo === 1 ? '1. sıra' : 'İlk ' + ilkNo;
        const title = (donemLabel + ' — ' + mesafeTxt + ' genel mesafe (' + ilkLabel + '): '
            + stat.hit + '/' + stat.total + ' koşuda ' + ilkLabel + ' (' + stat.miss + ' dışı)').replace(/"/g, '&quot;');
        return '<span class="istat-pct ' + pctClass(stat.pct) + '" title="' + title + '">%' + stat.pct + '</span>';
    }

    function renderTestOzetCells(row, isEnd) {
        let h = '';
        const grp = 'istat-grp-testozet';
        const items = [
            { key: 'test1OrtOzeti', label: 'TEST1', start: true },
            { key: 'test2OrtOzeti', label: 'TEST2', start: false },
            { key: 'test3OrtOzeti', label: 'TEST3', start: false }
        ];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            let cls = grp + ' istat-son800-avg';
            if (it.start) cls += ' istat-grp-start';
            if (i === items.length - 1 && isEnd) cls += ' istat-grp-end';
            h += '<td class="' + cls + '">' + formatAgirlikliOrt(row[it.key]?.agirlikli, it.label) + '</td>';
        }
        return h;
    }

    function renderSuccessCells(row, spec, ctx, isEnd) {
        const hedefSehir = ctx?.hedefSehir || '';
        const hedefMesafe = row.hedefMesafe;
        const donemKeys = ['ay3', 'ay1', 'gun15'];
        const donemNames = ['Son 3 ay', 'Son 1 ay', 'Son 15 gün'];
        let h = '';
        if (spec.kind === 'donem') {
            for (let i = 0; i < donemKeys.length; i++) {
                let cls = spec.grpClass;
                if (i === 0) cls += ' istat-grp-start';
                if (i === donemKeys.length - 1 && isEnd) cls += ' istat-grp-end';
                h += '<td class="' + cls + '">' + formatDonemPctCell(row[donemKeys[i]], donemNames[i]) + '</td>';
            }
            return h;
        }
        const bundleKey = spec.keys[0];
        const bundle = row[bundleKey];
        for (let i = 0; i < 3; i++) {
            const period = ['ay3', 'ay1', 'gun15'][i];
            const stat = bundle?.[period];
            let cls = spec.grpClass;
            if (i === 0) cls += ' istat-grp-start';
            if (i === 2 && isEnd) cls += ' istat-grp-end';
            let inner = '<span class="istat-pct istat-pct-none">—</span>';
            if (spec.kind === 'genel') {
                inner = formatGenelIlkPctCell(stat, donemNames[i], spec.ilkNo);
            } else if (spec.kind === 'sm') {
                inner = formatSmIlkPctCell(stat, donemNames[i], hedefSehir, hedefMesafe, spec.ilkNo);
            } else if (spec.kind === 'mesafe') {
                inner = formatMesafeIlkPctCell(stat, donemNames[i], hedefMesafe, spec.ilkNo);
            }
            h += '<td class="' + cls + '">' + inner + '</td>';
        }
        return h;
    }

    function renderSectionCells(row, spec, pkg, ctx, isEnd) {
        if (spec.type === 'fiveStrip') {
            return UI.renderFiveStripCells(row, spec.maxDepth, {
                grpClass: spec.grpClass,
                depthsKey: spec.depthsKey,
                groupLabel: spec.groupLabel,
                grpStart: true,
                grpEnd: isEnd,
                twinZeroGap: !!spec.twinZeroGap
            });
        }
        if (spec.type === 'singlePct') {
            return UI.renderSinglePctCells(row, spec.maxDepth, {
                grpClass: spec.grpClass,
                depthsKey: spec.depthsKey,
                label: spec.label,
                grpStart: true,
                grpEnd: isEnd,
                formatCell: (cell, dl) => formatDrKorelasyonCell(cell, dl, spec.label, spec.drLabel)
            });
        }
        if (spec.type === 'extra') {
            return UI.renderSinglePctCells(row, spec.maxDepth, {
                grpClass: spec.grpClass,
                depthsKey: spec.depthsKey,
                label: spec.label,
                grpStart: true,
                grpEnd: isEnd
            });
        }
        if (spec.type === 'testOzet') return renderTestOzetCells(row, isEnd);
        if (spec.type === 'success') return renderSuccessCells(row, spec, ctx, isEnd);
        return '';
    }

    function renderAllCells(row, pkg, ctx) {
        const plan = buildPlan(pkg);
        let h = '';
        for (let i = 0; i < plan.sections.length; i++) {
            h += renderSectionCells(row, plan.sections[i], pkg, ctx, i === plan.sections.length - 1);
        }
        return h;
    }

    function raceHeaderSuffix(pkg) {
        if (!hasColumns(pkg)) return '';
        const parts = [];
        if (pkg.maxDepth1) parts.push('SON800-1:' + pkg.maxDepth1);
        if (pkg.maxDepth2) parts.push('SON800-2:' + pkg.maxDepth2);
        const extra = (pkg.extraSections || []).filter(s => s.maxDepth > 0).length;
        if (extra) parts.push('+' + extra + ' ek grup');
        return parts.length ? (' · İstat derinlik: ' + parts.join(' · ')) : '';
    }

    return {
        buildPlan,
        totalColspan,
        hasColumns,
        headerRowspan,
        appendGroupHeaderHtml,
        appendMetricHeaderRows,
        renderAllCells,
        raceHeaderSuffix,
        extraGrpClass
    };
})();

if (typeof module !== 'undefined') module.exports = AtestIstatDepthUi;
