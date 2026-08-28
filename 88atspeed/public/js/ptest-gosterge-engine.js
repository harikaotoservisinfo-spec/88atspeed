/**
 * Puanlama test — metrik bazlı gösterge motoru (bitiş raporları + T1 sarı % + alt kırılımlar)
 */
const PtestGostergeEngine = (function () {
    const YESIL_RACE_DELTA_BUCKETS = [
        { label: 'Tam %0', gapTest: g => g === 0 },
        { label: '%5\'e kadar', gapTest: g => g > 0 && g <= 5 },
        { label: '%10\'a kadar', gapTest: g => g > 5 && g <= 10 },
        { label: '%15\'e kadar', gapTest: g => g > 10 && g <= 15 },
        { label: '%15 – %20', gapTest: g => g > 15 && g <= 20 },
        { label: '%20 – %25', gapTest: g => g > 20 && g <= 25 },
        { label: '%25\'ten fazla', gapTest: g => g > 25 }
    ];

    const YESIL_SON_DELTA_BUCKETS = [
        { label: 'Tam %0', gapTest: g => g === 0, blink: false },
        { label: 'Tam %0 · yanıp sönen', gapTest: g => g === 0, blink: true },
        { label: '%5\'e kadar', gapTest: g => g > 0 && g <= 5, blink: false },
        { label: '%5\'e kadar · yanıp sönen', gapTest: g => g > 0 && g <= 5, blink: true },
        { label: '%10\'a kadar', gapTest: g => g > 5 && g <= 10, blink: false },
        { label: '%10\'a kadar · yanıp sönen', gapTest: g => g > 5 && g <= 10, blink: true },
        { label: '%15\'e kadar', gapTest: g => g > 10 && g <= 15, blink: false },
        { label: '%15\'e kadar · yanıp sönen', gapTest: g => g > 10 && g <= 15, blink: true },
        { label: '%15 – %20', gapTest: g => g > 15 && g <= 20, blink: false },
        { label: '%15 – %20 · yanıp sönen', gapTest: g => g > 15 && g <= 20, blink: true },
        { label: '%20 – %25', gapTest: g => g > 20 && g <= 25, blink: false },
        { label: '%20 – %25 · yanıp sönen', gapTest: g => g > 20 && g <= 25, blink: true },
        { label: '%25\'ten fazla', gapTest: g => g > 25, blink: false },
        { label: '%25\'ten fazla · yanıp sönen', gapTest: g => g > 25, blink: true }
    ];

    const YESIL_DELTA_SORT_BUCKETS = [
        { id: 'yesilTam0', label: '2·0 — yeşil · Tam %0', gapTest: g => g === 0 },
        { id: 'yesil5', label: '2·1 — yeşil · %5\'e kadar', gapTest: g => g > 0 && g <= 5 },
        { id: 'yesil10', label: '2·2 — yeşil · %10\'a kadar', gapTest: g => g > 5 && g <= 10 },
        { id: 'yesil15', label: '2·3 — yeşil · %15\'e kadar', gapTest: g => g > 10 && g <= 15 },
        { id: 'yesil15_20', label: '2·4 — yeşil · %15–20', gapTest: g => g > 15 && g <= 20 },
        { id: 'yesil20_25', label: '2·5 — yeşil · %20–25', gapTest: g => g > 20 && g <= 25 },
        { id: 'yesil25plus', label: '2·6 — yeşil · %25+', gapTest: g => g > 25 }
    ];

    const T1_SARI_PRIMARY_BS_BUCKETS = [
        { label: 'tam %100', bsTest: bs => bs === 100 },
        { label: '%95 – %99', bsTest: bs => bs >= 95 && bs <= 99 },
        { label: '%91 – %94', bsTest: bs => bs >= 91 && bs <= 94 },
        { label: '%90 – %95', bsTest: bs => bs >= 90 && bs <= 95 },
        { label: '%85 – %89', bsTest: bs => bs >= 85 && bs <= 89 },
        { label: '%80 – %84', bsTest: bs => bs >= 80 && bs <= 84 },
        { label: '%75 – %79', bsTest: bs => bs >= 75 && bs <= 79 },
        { label: '%75 altı', bsTest: bs => bs != null && bs < 75 }
    ];

    const T1_DR_SON_BS_RANGE_BUCKETS = [
        { label: 'T1×DR · SON·BS tam %100', bsTest: bs => bs === 100 },
        { label: 'T1×DR · SON·BS %95 – %99', bsTest: bs => bs >= 95 && bs <= 99 },
        { label: 'T1×DR · SON·BS %91 – %94', bsTest: bs => bs >= 91 && bs <= 94 },
        { label: 'T1×DR · SON·BS %90 – %95', bsTest: bs => bs >= 90 && bs <= 95 },
        { label: 'T1×DR · SON·BS %85 – %89', bsTest: bs => bs >= 85 && bs <= 89 },
        { label: 'T1×DR · SON·BS %80 – %84', bsTest: bs => bs >= 80 && bs <= 84 },
        { label: 'T1×DR · SON·BS %75 – %79', bsTest: bs => bs >= 75 && bs <= 79 },
        { label: 'T1×DR · SON·BS %75 altı', bsTest: bs => bs != null && bs < 75 }
    ];

    const YESIL_T1_BS_BUCKETS = [
        { label: 'T1×DR · SON·BS kırmızı iç · tam %0', bsTest: bs => bs === 0 },
        { label: 'T1×DR · SON·BS tam %100', bsTest: bs => bs === 100 },
        { label: 'T1×DR · SON·BS %90 – %99', bsTest: bs => bs >= 90 && bs <= 99 },
        { label: 'T1×DR · SON·BS %80 – %89', bsTest: bs => bs >= 80 && bs <= 89 },
        { label: 'T1×DR · SON·BS %70 – %79', bsTest: bs => bs >= 70 && bs <= 79 },
        { label: 'T1×DR · SON·BS %60 – %69', bsTest: bs => bs >= 60 && bs <= 69 },
        { label: 'T1×DR · SON·BS %50 – %59', bsTest: bs => bs >= 50 && bs <= 59 },
        { label: 'T1×DR · SON·BS %1 – %49', bsTest: bs => bs >= 1 && bs <= 49 }
    ];

    const BITIS_REPORT_SECTIONS = [
        { ruleId: 'turuncuHucre', suffix: 'turuncuReport', rowLabel: 'Turuncu hücre' },
        { ruleId: 'turuncuCevre', suffix: 'turuncuCevreReport', rowLabel: 'Turuncu çevre' },
        { ruleId: 'yesilHucre', suffix: 'yesilReport', rowLabel: 'Yeşil hücre' }
    ];

    const BITIS_REPORT_RULE_HINTS = {
        turuncuHucre: ' · (SON·Δ + T1·Δ ikisi %0 · turuncu hücre)',
        turuncuCevre: ' · (SON·Δ + T1·Δ ikisi %0 · turuncu kenarlık)',
        yesilHucre: ' · (SON·Δ + T1·Δ ikisi <%25 · neon yeşil)'
    };

    const PTEST_GOSTERGE_METRICS = [
        { id: 'son8001', label: 'SON800-1', primaryKey: 'son8001Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'oran1', label: '800-1 ORAN', primaryKey: 'oran1Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'oran2', label: '800-2 ORAN', primaryKey: 'oran2Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'fark827', label: '800Δ·7', primaryKey: 'fark827Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'ff', label: 'FFΔ', primaryKey: 'ffDepths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 't8', label: 'T8Δ', primaryKey: 'test8Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'test1', label: 'TEST1', primaryKey: 'test1Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'test2', label: 'TEST2', primaryKey: 'test2Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'test3', label: 'TEST3', primaryKey: 'test3Depths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 'testsira', label: 'TEST·SIRA', primaryKey: 'test123SiraliDepths', crossKey: 't1drDepths', t1SariKey: 't1drDepths' },
        { id: 't1dr', label: 'T1×DR', primaryKey: 't1drDepths', crossKey: 'son8001Depths', t1SariKey: 't1drDepths' }
    ];

    function pid(metricId, suffix) {
        return 'pg_' + metricId + '_' + suffix;
    }

    function pctClass(pct) {
        if (pct === null || pct === undefined) return 'ptest-pct-none';
        if (pct === 0) return 'ptest-pct-low';
        if (pct < 35) return 'ptest-pct-mid';
        if (pct < 70) return 'ptest-pct-good';
        return 'ptest-pct-high';
    }

    function pctFmt(n, total) {
        if (!total) return '—';
        return (Math.round((n / total) * 1000) / 10).toFixed(1) + '%';
    }

    function createContext(spec, host) {
        const primaryKey = spec.primaryKey;
        const crossKey = spec.crossKey;
        const t1SariKey = spec.t1SariKey || 't1drDepths';

        function primaryCell(entry) {
            return entry.row[primaryKey]?.[0] || null;
        }
        function crossCell(entry) {
            return entry.row[crossKey]?.[0] || null;
        }
        function t1SariCell(entry) {
            return entry.row[t1SariKey]?.[0] || null;
        }
        function primaryGapPct(entry) {
            return primaryCell(entry)?.gapPct ?? null;
        }
        function crossGapPct(entry) {
            return crossCell(entry)?.gapPct ?? null;
        }
        function t1SariGapPct(entry) {
            return t1SariCell(entry)?.gapPct ?? null;
        }
        function primaryBsPct(entry) {
            return primaryCell(entry)?.successPct ?? null;
        }
        function t1BsPct(entry) {
            return entry.row.t1drDepths?.[0]?.successPct ?? null;
        }

        function isTwinZero(row) {
            const s = row[primaryKey]?.[0];
            const t = row[crossKey]?.[0];
            return !!(s && t && s.gapPct === 0 && t.gapPct === 0);
        }

        function gapTdClass(row, cell) {
            if (!cell || cell.gapPct == null) return '';
            const p = row[primaryKey]?.[0]?.gapPct;
            const c = row[crossKey]?.[0]?.gapPct;
            if (isTwinZero(row) && cell.gapPct === 0) return ' ptest-gap-twin-zero';
            if (!isTwinZero(row) && p != null && c != null && p < 25 && c < 25) return ' ptest-gap-neon';
            return '';
        }

        function deltaVisualFlags(row, cell) {
            const gap = cell?.gapPct;
            const tdCls = gapTdClass(row, cell).trim();
            const isTwin = tdCls === 'ptest-gap-twin-zero';
            const isNeon = tdCls === 'ptest-gap-neon';
            let pc = 'none';
            if (gap != null) pc = pctClass(gap).replace('ptest-pct-', '');
            return {
                turuncuHucre: isTwin,
                yesilHucre: isNeon,
                turuncuCevre: isTwin,
                kirmiziIc: gap != null && pc === 'low' && !isTwin && !isNeon,
                sariYazi: gap != null && pc === 'mid',
                yanipSonen0: gap === 0,
                acikYesilIc: gap != null && pc === 'good',
                koyuYesilIc: gap != null && pc === 'high',
                gri: gap == null
            };
        }

        function primaryVisualFlags(entry) {
            return deltaVisualFlags(entry.row, primaryCell(entry));
        }
        function t1SariVisualFlags(entry) {
            return deltaVisualFlags(entry.row, t1SariCell(entry));
        }

        function yesilDeltaBucketById(ruleId) {
            return YESIL_DELTA_SORT_BUCKETS.find(b => b.id === ruleId) || null;
        }

        function primaryMatchesRule(entry, ruleId) {
            if (!ruleId || ruleId === '0') return true;
            const bucket = yesilDeltaBucketById(ruleId);
            if (bucket) {
                if (!primaryVisualFlags(entry).yesilHucre) return false;
                const g = primaryGapPct(entry);
                return g != null && bucket.gapTest(g);
            }
            return !!primaryVisualFlags(entry)[ruleId];
        }

        function yesilBucketBlinkMatch(entry, bucket) {
            if (!bucket.blink) return true;
            const g = primaryGapPct(entry);
            if (g === 0) return primaryGapPct(entry) === 0;
            return crossGapPct(entry) === 0;
        }

        function t1SariMatchesPct(entry, pct) {
            if (!t1SariVisualFlags(entry).sariYazi) return false;
            return t1SariGapPct(entry) === pct;
        }

        function primaryBsBuckets() {
            return T1_SARI_PRIMARY_BS_BUCKETS.map(b => ({
                ...b,
                label: spec.label + ' · SON·BS ' + b.label
            }));
        }

        function buildColorTiers() {
            return [
                {
                    id: 'yesilHucre', emoji: '🟢', label: 'yeşil hücre', wrapClass: 'ptest-t1-sari-yesil-wrap',
                    tierMatch(e) { return primaryMatchesRule(e, 'yesilHucre'); },
                    comboMatch(e, t1Pct) { return matchesYesilBlinkZero(e, t1Pct); },
                    comboLabel: 'Δ yeşil yanıp sönen %0'
                },
                {
                    id: 'turuncuHucre', emoji: '🟠', label: 'turuncu hücre', wrapClass: 'ptest-t1-sari-turuncu-wrap',
                    tierMatch(e) { return primaryMatchesRule(e, 'turuncuHucre'); },
                    comboMatch(e, t1Pct) { return t1SariMatchesPct(e, t1Pct) && primaryMatchesRule(e, 'turuncuHucre'); },
                    comboLabel: 'turuncu hücre · Δ tam %0'
                },
                {
                    id: 'sariYazi', emoji: '🟡', label: 'sarı yazı', wrapClass: 'ptest-t1-sari-sariyazi-wrap',
                    tierMatch(e) { return primaryVisualFlags(e).sariYazi; },
                    comboMatch(e, t1Pct) {
                        return t1SariMatchesPct(e, t1Pct) && primaryVisualFlags(e).sariYazi
                            && primaryGapPct(e) === t1Pct;
                    },
                    comboLabel: 'sarı yazı · Δ hizalı'
                },
                {
                    id: 'kirmiziIc', emoji: '🔴', label: 'kırmızı iç', wrapClass: 'ptest-t1-sari-kirmizi-wrap',
                    tierMatch(e) { return primaryVisualFlags(e).kirmiziIc; },
                    comboMatch(e, t1Pct) {
                        return t1SariMatchesPct(e, t1Pct) && primaryVisualFlags(e).kirmiziIc && primaryGapPct(e) === 0;
                    },
                    comboLabel: 'kırmızı iç · Δ tam %0'
                },
                {
                    id: 'acikYesilIc', emoji: '🟢', label: 'açık yeşil iç', wrapClass: 'ptest-t1-sari-acikyesil-wrap',
                    tierMatch(e) { return primaryVisualFlags(e).acikYesilIc; },
                    comboMatch(e, t1Pct) {
                        return t1SariMatchesPct(e, t1Pct) && primaryVisualFlags(e).acikYesilIc
                            && primaryGapPct(e) === t1Pct;
                    },
                    comboLabel: 'açık yeşil · Δ hizalı'
                },
                {
                    id: 'koyuYesilIc', emoji: '🟩', label: 'koyu yeşil iç', wrapClass: 'ptest-t1-sari-koyuyesil-wrap',
                    tierMatch(e) { return primaryVisualFlags(e).koyuYesilIc; },
                    comboMatch(e, t1Pct) {
                        return t1SariMatchesPct(e, t1Pct) && primaryVisualFlags(e).koyuYesilIc
                            && primaryGapPct(e) === t1Pct;
                    },
                    comboLabel: 'koyu yeşil · Δ hizalı'
                }
            ];
        }

        const yesilBlinkZeroBucket = { label: 'Tam %0 · yanıp sönen', gapTest: g => g === 0, blink: true };

        function matchesYesilBlinkZero(entry, t1Pct) {
            if (!t1SariMatchesPct(entry, t1Pct)) return false;
            if (!primaryMatchesRule(entry, 'yesilHucre')) return false;
            const g = primaryGapPct(entry);
            if (g == null || !yesilBlinkZeroBucket.gapTest(g)) return false;
            return yesilBucketBlinkMatch(entry, yesilBlinkZeroBucket);
        }

        return {
            spec,
            primaryKey,
            crossKey,
            primaryCell,
            crossCell,
            primaryGapPct,
            crossGapPct,
            primaryBsPct,
            t1BsPct,
            primaryVisualFlags,
            t1SariVisualFlags,
            primaryMatchesRule,
            yesilBucketBlinkMatch,
            t1SariMatchesPct,
            primaryBsBuckets,
            buildColorTiers,
            isTwinZero,
            gapTdClass
        };
    }

    function renderStatsTableHtml(items, total) {
        let h = '<table class="ptest-stats-table"><thead><tr>'
            + '<th>Metrik</th><th>%</th><th>n/N</th></tr></thead><tbody>';
        for (const it of items) {
            const sub = it.sub ? ' title="' + AtSpeedUtils.escapeHtml(it.sub).replace(/"/g, '&quot;') + '"' : '';
            h += '<tr><td class="ptest-stats-label"' + sub + '>' + AtSpeedUtils.escapeHtml(it.label) + '</td>'
                + '<td class="ptest-stats-pct">' + pctFmt(it.count, total) + '</td>'
                + '<td class="ptest-stats-n">' + it.count + '/' + total + '</td></tr>';
        }
        return h + '</tbody></table>';
    }

    function renderBitisStatsGridHtml(stats) {
        const total = stats.withBitis;
        const items = [
            { label: '1. bitirme', count: stats.b1, sub: 'yalnızca birincilik' },
            { label: '1. veya 2.', count: stats.b12, sub: 'ilk iki' },
            { label: '1., 2. veya 3.', count: stats.b123, sub: 'ilk üç' },
            { label: '4. bitirme', count: stats.b4, sub: 'yalnızca dördüncülük' },
            { label: 'İlk 4 dışı (5+)', count: stats.bOut, sub: 'beşinci ve sonrası' }
        ];
        return renderStatsTableHtml(items, total);
    }

    function renderRaceRankStatsGridHtml(stats) {
        const total = stats.withBitis;
        const items = [
            { label: 'Koşuda SON·BS 1.', count: stats.b1, sub: 'rakipler arası en yüksek' },
            { label: 'Koşuda SON·BS ilk 2', count: stats.b12, sub: 'aynı koşu sıralaması' },
            { label: 'Koşuda SON·BS ilk 3', count: stats.b123, sub: 'aynı koşu sıralaması' },
            { label: 'Koşuda SON·BS 4.', count: stats.b4, sub: 'aynı koşu sıralaması' },
            { label: 'Koşuda SON·BS 5+', count: stats.bOut, sub: 'alt sıralar' }
        ];
        return renderStatsTableHtml(items, total);
    }

    function buildMetricPanelHtml(metric) {
        const mid = metric.id;
        const lbl = AtSpeedUtils.escapeHtml(metric.label);
        let h = '<div class="ptest-metric-panel hidden" data-ptest-metric="' + mid + '">';
        h += '<div class="ptest-gosterge-section-title">Bitiş raporları · ' + lbl + '</div>';
        h += '<div class="ptest-reports-wrap" id="' + pid(mid, 'bitisWrap') + '">';
        h += '<div class="ptest-report-meta-global" id="' + pid(mid, 'bitisGlobalMeta') + '"></div>';

        const panels = [
            { cls: 'ptest-report-green-detail', title: '🟢 Yeşil hücre — SON·Δ aralık detay raporu (14 grup)', detail: pid(mid, 'yesilDetail'), tag: pid(mid, 'yesilDetailTag') },
            { cls: 'ptest-report-green-bs-detail', title: '🟢 Yeşil hücre — SON·Δ + T1×DR · SON·BS bitiş raporu (14×8 grup)', detail: pid(mid, 'yesilBsDetail'), tag: pid(mid, 'yesilBsTag') },
            { cls: 'ptest-report-green-race-detail', title: '🟢 Yeşil hücre — koşu içi SON·BS sıralaması (7 grup)', detail: pid(mid, 'yesilRaceDetail'), tag: pid(mid, 'yesilRaceTag') },
            { cls: 'ptest-report-orange-detail', title: '🟠 Turuncu hücre — SON·Δ aralık detay raporu (14 grup)', detail: pid(mid, 'turuncuDetail'), tag: pid(mid, 'turuncuDetailTag') },
            { cls: 'ptest-report-orange-detail', title: '🟠 Turuncu hücre — SON·Δ + T1×DR · SON·BS bitiş raporu (14×8 grup)', detail: pid(mid, 'turuncuBsDetail'), tag: pid(mid, 'turuncuBsTag') },
            { cls: 'ptest-report-sariyazi-detail', title: '🟡 Sarı yazı — SON·Δ aralık detay raporu (14 grup)', detail: pid(mid, 'sariDetail'), tag: pid(mid, 'sariDetailTag') },
            { cls: 'ptest-report-sariyazi-detail', title: '🟡 Sarı yazı — SON·Δ + T1×DR · SON·BS bitiş raporu (14×8 grup)', detail: pid(mid, 'sariBsDetail'), tag: pid(mid, 'sariBsTag') }
        ];
        for (const p of panels) {
            h += '<div class="ptest-report-panel ' + p.cls + '">';
            h += '<h3>' + p.title + ' <span class="ptest-report-build-tag" id="' + p.tag + '"></span></h3>';
            h += '<div class="ptest-report-scroll ptest-gosterge-subgrid" id="' + p.detail + '"></div></div>';
        }

        h += '<div class="ptest-gosterge-summary-row">';
        for (const sec of BITIS_REPORT_SECTIONS) {
            h += '<div class="ptest-report-panel"><h3>' + AtSpeedUtils.escapeHtml(sec.rowLabel) + ' (SON·Δ) — bitiş raporu</h3>';
            h += '<div class="ptest-report-meta" id="' + pid(mid, sec.suffix + 'Meta') + '"></div>';
            h += '<div class="ptest-stats-wrap" id="' + pid(mid, sec.suffix + 'Grid') + '"></div></div>';
        }
        h += '</div></div>';

        h += '<div class="ptest-gosterge-section-title">T1×DR · SON·Δ sarı yazı göstergeleri · ' + lbl + ' tonları</div>';
        h += '<div class="ptest-t1-sari-delta-wrap">';
        h += '<div class="ptest-report-meta-global" id="' + pid(mid, 't1SariGlobalMeta') + '"></div>';
        h += '<div class="ptest-report-panel ptest-report-t1-sari-delta">';
        h += '<h3>🟡 T1×DR · SON·Δ sarı yazı — %1 … %25 (tek tek) <span class="ptest-report-build-tag" id="' + pid(mid, 't1SariTag') + '"></span></h3>';
        h += '<div id="' + pid(mid, 't1SariContent') + '"></div></div></div>';
        h += '</div>';
        return h;
    }

    function renderReportSubgroupsHtml(buckets, entriesFn, host) {
        let h = '';
        for (const bucket of buckets) {
            const entries = entriesFn(bucket);
            const stats = host.buildBitisStatsFromEntries(entries);
            h += '<div class="ptest-report-subgroup">';
            h += '<div class="ptest-report-subgroup-title">' + AtSpeedUtils.escapeHtml(bucket.label) + '</div>';
            h += '<div class="ptest-report-subgroup-meta">' + stats.matchedRows + ' satır · ' + stats.withBitis + ' bitiş</div>';
            h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(stats) + '</div></div>';
        }
        return h;
    }

    function yieldToMain(sync) {
        if (sync) return Promise.resolve();
        return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    }

    /** Tek geçişte tüm kova dizinleri — 5000+ satırda tekrarlı filter maliyetini düşürür */
    function buildGostergeIndex(ctx, flatEntries) {
        const byRule = { turuncuHucre: [], turuncuCevre: [], yesilHucre: [] };
        const yesilBySonBucket = YESIL_SON_DELTA_BUCKETS.map(() => []);
        const turuncuBySonBucket = YESIL_SON_DELTA_BUCKETS.map(() => []);
        const sariBySonBucket = YESIL_SON_DELTA_BUCKETS.map(() => []);
        const yesilByRaceBucket = YESIL_RACE_DELTA_BUCKETS.map(() => []);
        const t1SariByPct = Array.from({ length: 26 }, () => []);

        for (const entry of flatEntries) {
            const g = ctx.primaryGapPct(entry);
            const flags = ctx.primaryVisualFlags(entry);

            for (const ruleId of Object.keys(byRule)) {
                if (ctx.primaryMatchesRule(entry, ruleId)) byRule[ruleId].push(entry);
            }

            if (ctx.primaryMatchesRule(entry, 'yesilHucre') && g != null) {
                for (let i = 0; i < YESIL_SON_DELTA_BUCKETS.length; i++) {
                    const b = YESIL_SON_DELTA_BUCKETS[i];
                    if (b.gapTest(g) && ctx.yesilBucketBlinkMatch(entry, b)) yesilBySonBucket[i].push(entry);
                }
                for (let i = 0; i < YESIL_RACE_DELTA_BUCKETS.length; i++) {
                    if (YESIL_RACE_DELTA_BUCKETS[i].gapTest(g)) yesilByRaceBucket[i].push(entry);
                }
            }

            if (ctx.primaryMatchesRule(entry, 'turuncuHucre') && g != null) {
                for (let i = 0; i < YESIL_SON_DELTA_BUCKETS.length; i++) {
                    const b = YESIL_SON_DELTA_BUCKETS[i];
                    if (b.gapTest(g) && ctx.yesilBucketBlinkMatch(entry, b)) turuncuBySonBucket[i].push(entry);
                }
            }

            if (flags.sariYazi && g != null) {
                for (let i = 0; i < YESIL_SON_DELTA_BUCKETS.length; i++) {
                    const b = YESIL_SON_DELTA_BUCKETS[i];
                    if (b.gapTest(g) && ctx.yesilBucketBlinkMatch(entry, b)) sariBySonBucket[i].push(entry);
                }
            }

            for (let pct = 1; pct <= 25; pct++) {
                if (ctx.t1SariMatchesPct(entry, pct)) t1SariByPct[pct].push(entry);
            }
        }

        return { byRule, yesilBySonBucket, turuncuBySonBucket, sariBySonBucket, yesilByRaceBucket, t1SariByPct };
    }

    async function renderMetricGostergeAsync(ctx, host, buildTag, opts) {
        opts = opts || {};
        const sync = !!opts.sync;
        const isCancelled = opts.isCancelled || (() => false);
        const onProgress = opts.onProgress || (() => {});

        const mid = ctx.spec.id;
        const flatEntries = host.flatEntries;
        if (!flatEntries.length) return;

        const index = buildGostergeIndex(ctx, flatEntries);
        const tiers = ctx.buildColorTiers();
        const primaryBsBuckets = ctx.primaryBsBuckets();

        const setTag = id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'build ' + buildTag;
        };
        [
            pid(mid, 'yesilDetailTag'), pid(mid, 'yesilBsTag'), pid(mid, 'yesilRaceTag'),
            pid(mid, 'turuncuDetailTag'), pid(mid, 'turuncuBsTag'),
            pid(mid, 'sariDetailTag'), pid(mid, 'sariBsTag'), pid(mid, 't1SariTag')
        ].forEach(setTag);

        function entriesForTierDeltaAndBs(sourceEntries, tierMatch, deltaBucket, bsBucket) {
            const out = [];
            for (const entry of sourceEntries) {
                if (!tierMatch(entry)) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !deltaBucket.gapTest(g)) continue;
                if (deltaBucket.blink != null && !ctx.yesilBucketBlinkMatch(entry, deltaBucket)) continue;
                const bs = ctx.t1BsPct(entry);
                if (bs == null || !bsBucket.bsTest(bs)) continue;
                out.push(entry);
            }
            return out;
        }

        function tierEntriesForDelta(t1Pct, tierMatch, bucket) {
            const out = [];
            for (const entry of index.t1SariByPct[t1Pct]) {
                if (!tierMatch(entry)) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !bucket.gapTest(g)) continue;
                out.push(entry);
            }
            return out;
        }

        onProgress('Özet raporlar…');
        const globalMeta = document.getElementById(pid(mid, 'bitisGlobalMeta'));
        if (globalMeta) {
            globalMeta.textContent = '📊 Bitiş raporları · ' + ctx.spec.label
                + ' · Toplam yarış: ' + host.countUniqueRaces()
                + ' · Toplam at satırı: ' + flatEntries.length
                + ' · build ' + buildTag;
        }

        for (const sec of BITIS_REPORT_SECTIONS) {
            if (isCancelled()) return;
            const meta = document.getElementById(pid(mid, sec.suffix + 'Meta'));
            const grid = document.getElementById(pid(mid, sec.suffix + 'Grid'));
            if (!meta || !grid) continue;
            const matched = index.byRule[sec.ruleId] || [];
            const r = host.buildBitisStatsFromEntries(matched);
            meta.textContent = sec.rowLabel + ' at satırı: ' + r.matchedRows + ' · Bitiş bilgisi olan: ' + r.withBitis
                + (BITIS_REPORT_RULE_HINTS[sec.ruleId] || '');
            grid.innerHTML = renderBitisStatsGridHtml(r);
        }

        await yieldToMain(sync);
        if (isCancelled()) return;

        onProgress('Yeşil / turuncu / sarı Δ detay…');
        function renderIndexedSubgroups(buckets, indexed) {
            let out = '';
            for (let i = 0; i < buckets.length; i++) {
                const stats = host.buildBitisStatsFromEntries(indexed[i]);
                out += '<div class="ptest-report-subgroup">';
                out += '<div class="ptest-report-subgroup-title">' + AtSpeedUtils.escapeHtml(buckets[i].label) + '</div>';
                out += '<div class="ptest-report-subgroup-meta">' + stats.matchedRows + ' satır · ' + stats.withBitis + ' bitiş</div>';
                out += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(stats) + '</div></div>';
            }
            return out;
        }
        const yesilEl = document.getElementById(pid(mid, 'yesilDetail'));
        if (yesilEl) yesilEl.innerHTML = renderIndexedSubgroups(YESIL_SON_DELTA_BUCKETS, index.yesilBySonBucket) || '<p>Veri yok</p>';
        const turuncuEl = document.getElementById(pid(mid, 'turuncuDetail'));
        if (turuncuEl) turuncuEl.innerHTML = renderIndexedSubgroups(YESIL_SON_DELTA_BUCKETS, index.turuncuBySonBucket) || '<p>Veri yok</p>';
        const sariEl = document.getElementById(pid(mid, 'sariDetail'));
        if (sariEl) sariEl.innerHTML = renderIndexedSubgroups(YESIL_SON_DELTA_BUCKETS, index.sariBySonBucket) || '<p>Veri yok</p>';

        await yieldToMain(sync);
        if (isCancelled()) return;

        onProgress('BS kırılımları…');
        const yesilBsEl = document.getElementById(pid(mid, 'yesilBsDetail'));
        if (yesilBsEl) {
            let h = '';
            for (let bi = 0; bi < YESIL_SON_DELTA_BUCKETS.length; bi++) {
                const deltaBucket = YESIL_SON_DELTA_BUCKETS[bi];
                const bucketEntries = index.yesilBySonBucket[bi];
                const parentStats = host.buildBitisStatsFromEntries(bucketEntries);
                h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                    + AtSpeedUtils.escapeHtml(deltaBucket.label) + '</div>';
                h += '<div class="ptest-report-delta-section-meta">' + parentStats.matchedRows + ' satır · '
                    + parentStats.withBitis + ' bitiş</div>';
                h += renderReportSubgroupsHtml(YESIL_T1_BS_BUCKETS, bsBucket => {
                    const out = [];
                    for (const entry of bucketEntries) {
                        const bs = ctx.t1BsPct(entry);
                        if (bs == null || !bsBucket.bsTest(bs)) continue;
                        out.push(entry);
                    }
                    return out;
                }, host);
                h += '</div>';
                if (!sync && bi % 3 === 2) {
                    yesilBsEl.innerHTML = h;
                    await yieldToMain(false);
                    if (isCancelled()) return;
                }
            }
            yesilBsEl.innerHTML = h || '<p>Veri yok</p>';
        }

        const turuncuBsEl = document.getElementById(pid(mid, 'turuncuBsDetail'));
        if (turuncuBsEl) {
            let h = '';
            for (let bi = 0; bi < YESIL_SON_DELTA_BUCKETS.length; bi++) {
                const deltaBucket = YESIL_SON_DELTA_BUCKETS[bi];
                h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                    + AtSpeedUtils.escapeHtml(deltaBucket.label) + '</div>';
                h += renderReportSubgroupsHtml(YESIL_T1_BS_BUCKETS, bsBucket =>
                    entriesForTierDeltaAndBs(index.turuncuBySonBucket[bi],
                        e => ctx.primaryMatchesRule(e, 'turuncuHucre'), deltaBucket, bsBucket), host);
                h += '</div>';
            }
            turuncuBsEl.innerHTML = h || '<p>Veri yok</p>';
        }

        const sariBsEl = document.getElementById(pid(mid, 'sariBsDetail'));
        if (sariBsEl) {
            let h = '';
            for (let bi = 0; bi < YESIL_SON_DELTA_BUCKETS.length; bi++) {
                const deltaBucket = YESIL_SON_DELTA_BUCKETS[bi];
                h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                    + AtSpeedUtils.escapeHtml(deltaBucket.label) + '</div>';
                h += renderReportSubgroupsHtml(YESIL_T1_BS_BUCKETS, bsBucket =>
                    entriesForTierDeltaAndBs(index.sariBySonBucket[bi],
                        e => ctx.primaryVisualFlags(e).sariYazi, deltaBucket, bsBucket), host);
                h += '</div>';
            }
            sariBsEl.innerHTML = h || '<p>Veri yok</p>';
        }

        await yieldToMain(sync);
        if (isCancelled()) return;

        onProgress('Koşu içi BS sıralaması…');
        const raceEl = document.getElementById(pid(mid, 'yesilRaceDetail'));
        if (raceEl) {
            const raceGroups = host.buildRaceEntryGroups();
            let h = '';
            for (let i = 0; i < YESIL_RACE_DELTA_BUCKETS.length; i++) {
                const bucket = YESIL_RACE_DELTA_BUCKETS[i];
                const rankItems = [];
                for (const entry of index.yesilByRaceBucket[i]) {
                    const rk = host.raceKey(entry.kayitId, entry.raceNo);
                    const { rank, field } = host.computeMetricRankInRace(entry, raceGroups.get(rk) || [], ctx.primaryBsPct);
                    rankItems.push({ rank, field });
                }
                const stats = host.buildRaceRankStatsFromItems(rankItems);
                h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                    + AtSpeedUtils.escapeHtml(bucket.label) + '</div>';
                h += '<div class="ptest-report-delta-section-meta">' + stats.matchedRows + ' yeşil at · '
                    + stats.withBitis + ' koşu içi sıra</div>';
                h += '<div class="ptest-stats-wrap">' + renderRaceRankStatsGridHtml(stats) + '</div></div>';
            }
            raceEl.innerHTML = h || '<p>Veri yok</p>';
        }

        await yieldToMain(sync);
        if (isCancelled()) return;

        onProgress('T1×DR sarı %1–25…');
        const t1SariContent = document.getElementById(pid(mid, 't1SariContent'));
        const t1SariGlobalMeta = document.getElementById(pid(mid, 't1SariGlobalMeta'));
        if (t1SariGlobalMeta) {
            t1SariGlobalMeta.textContent = '📈 ' + ctx.spec.label + ' · T1×DR sarı %1–25 × '
                + tiers.length + ' renk tonu × 7 Δ × '
                + primaryBsBuckets.length + ' BS × ' + T1_DR_SON_BS_RANGE_BUCKETS.length + ' T1 BS · build ' + buildTag;
        }
        if (t1SariContent) {
            t1SariContent.innerHTML = '';
            let h = '';
            for (let pct = 1; pct <= 25; pct++) {
                if (isCancelled()) return;
                onProgress('T1 sarı %' + pct + ' / 25…');
                const matched = index.t1SariByPct[pct];
                const stats = host.buildBitisStatsFromEntries(matched);
                h += '<div class="ptest-t1-indicator-block">';
                h += '<div class="ptest-t1-indicator-title">Sarı · SON·Δ %' + pct + '</div>';
                h += '<div class="ptest-t1-indicator-meta">T1×DR sarı · ' + ctx.spec.label + ' tonları · '
                    + stats.matchedRows + ' satır · ' + stats.withBitis + ' bitiş</div>';
                h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(stats) + '</div>';

                for (const tier of tiers) {
                    h += '<div class="ptest-t1-sari-tier-wrap ' + tier.wrapClass + '">';
                    h += '<div class="ptest-t1-sari-tier-heading">' + tier.emoji + ' '
                        + AtSpeedUtils.escapeHtml(ctx.spec.label) + ' · SON·Δ ' + AtSpeedUtils.escapeHtml(tier.label)
                        + ' — 7 kırılım</div>';
                    for (const bucket of YESIL_RACE_DELTA_BUCKETS) {
                        const entries = tierEntriesForDelta(pct, tier.tierMatch, bucket);
                        const st = host.buildBitisStatsFromEntries(entries);
                        h += '<div class="ptest-t1-sari-tier-subgroup"><div class="ptest-t1-sari-tier-subgroup-title">'
                            + AtSpeedUtils.escapeHtml(tier.label) + ' · ' + AtSpeedUtils.escapeHtml(bucket.label) + '</div>';
                        h += '<div class="ptest-t1-sari-tier-subgroup-meta">T1 sarı %' + pct + ' · '
                            + st.matchedRows + ' satır · ' + st.withBitis + ' bitiş</div>';
                        h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(st) + '</div></div>';
                    }
                    h += '</div>';

                    h += '<div class="ptest-t1-sari-tier-bscombo ' + tier.wrapClass + '">';
                    h += '<div class="ptest-t1-sari-tier-bscombo-heading">' + tier.emoji + ' T1 sarı %' + pct + ' · '
                        + AtSpeedUtils.escapeHtml(ctx.spec.label) + ' · ' + AtSpeedUtils.escapeHtml(tier.comboLabel)
                        + ' · SON·BS kırılımları</div>';
                    for (const bsBucket of primaryBsBuckets) {
                        const bsEntries = matched.filter(e => {
                            if (!tier.comboMatch(e, pct)) return false;
                            const bs = ctx.primaryBsPct(e);
                            return bs != null && bsBucket.bsTest(bs);
                        });
                        const st = host.buildBitisStatsFromEntries(bsEntries);
                        h += '<div class="ptest-t1-sari-tier-bs-block"><div class="ptest-t1-sari-tier-bs-block-title">'
                            + AtSpeedUtils.escapeHtml(bsBucket.label) + '</div>';
                        h += '<div class="ptest-t1-sari-tier-bs-block-meta">' + st.matchedRows + ' satır · '
                            + st.withBitis + ' bitiş</div>';
                        h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(st) + '</div>';
                        h += '<div class="ptest-t1-sari-t1bs-nested-wrap"><div class="ptest-t1-sari-t1bs-nested-heading">T1×DR · SON·BS · '
                            + AtSpeedUtils.escapeHtml(bsBucket.label) + '</div>';
                        for (const t1Bs of T1_DR_SON_BS_RANGE_BUCKETS) {
                            const nested = bsEntries.filter(e => {
                                const tbs = ctx.t1BsPct(e);
                                return tbs != null && t1Bs.bsTest(tbs);
                            });
                            const nst = host.buildBitisStatsFromEntries(nested);
                            h += '<div class="ptest-t1-sari-t1bs-nested-subgroup"><div class="ptest-t1-sari-t1bs-nested-subgroup-title">'
                                + AtSpeedUtils.escapeHtml(t1Bs.label) + '</div>';
                            h += '<div class="ptest-t1-sari-t1bs-nested-subgroup-meta">' + nst.matchedRows + ' satır · '
                                + nst.withBitis + ' bitiş</div>';
                            h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(nst) + '</div></div>';
                        }
                        h += '</div></div>';
                    }
                    h += '</div>';
                }
                h += '</div>';
                if (!sync) {
                    t1SariContent.innerHTML = h;
                    await yieldToMain(false);
                }
            }
            t1SariContent.innerHTML = h || '<p>Gösterge yok</p>';
        }
        onProgress('Tamamlandı');
    }

    function renderMetricGosterge(ctx, host, buildTag) {
        return renderMetricGostergeAsync(ctx, host, buildTag, { sync: true });
    }

    function ensureMetricPanels(container) {
        if (!container || container.dataset.built === '1') return;
        let h = '';
        for (const m of PTEST_GOSTERGE_METRICS) {
            h += buildMetricPanelHtml(m);
        }
        container.innerHTML = h;
        container.dataset.built = '1';
    }

    function switchMetricTab(metricId, activeClass) {
        document.querySelectorAll('.ptest-gosterge-metric-tab-btn').forEach(btn => {
            btn.classList.toggle(activeClass || 'active', btn.dataset.ptestMetric === metricId);
        });
        document.querySelectorAll('.ptest-metric-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.ptestMetric !== metricId);
        });
    }

    const DEFAULT_SUCCESS_BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

    function blendedGostergeSuccess(stats, blend) {
        if (!stats?.withBitis) return -1;
        const t = stats.withBitis;
        const b = blend || DEFAULT_SUCCESS_BLEND;
        return b.b1 * (stats.b1 / t) + b.b12 * (stats.b12 / t) + b.b123 * (stats.b123 / t);
    }

    function pushColorRow(rows, base, stats, statKind) {
        const blend = base.successBlend || DEFAULT_SUCCESS_BLEND;
        const t = stats.withBitis || 0;
        const label = (base.modePrefix || '') + base.label;
        rows.push({
            id: base.id,
            metricId: base.metricId,
            metricLabel: base.metricLabel,
            mode: base.mode || 'sonDelta',
            pairLabel: base.pairLabel || '',
            category: base.category || '',
            label,
            stats,
            statKind: statKind || 'bitis',
            successRate: blendedGostergeSuccess(stats, blend),
            b1Rate: t ? stats.b1 / t : 0,
            b12Rate: t ? stats.b12 / t : 0,
            b123Rate: t ? stats.b123 / t : 0
        });
    }

    /** Gösterge sekmesindeki tüm renk başarı panellerini tek listede toplar */
    function collectColorGostergeRows(ctx, host, opts) {
        opts = opts || {};
        const rows = [];
        const flatEntries = host.flatEntries;
        if (!flatEntries?.length) return rows;

        const index = buildGostergeIndex(ctx, flatEntries);
        const tiers = ctx.buildColorTiers();
        const primaryBsBuckets = ctx.primaryBsBuckets();
        const metricLabel = ctx.spec.label;
        const metricId = ctx.spec.id;
        const mode = opts.mode || 'sonDelta';
        const pairLabel = opts.pairLabel || '';
        const modePrefix = opts.modePrefix != null ? opts.modePrefix
            : (pairLabel ? '[' + pairLabel + '] ' : '');
        const blend = opts.successBlend;

        function add(category, label, stats, statKind, idSuffix) {
            pushColorRow(rows, {
                metricId,
                metricLabel,
                mode,
                pairLabel,
                modePrefix,
                category,
                label,
                successBlend: blend,
                id: metricId + '|' + mode + '|' + (pairLabel || '-') + '|' + idSuffix
            }, stats, statKind);
        }

        for (const sec of BITIS_REPORT_SECTIONS) {
            const matched = index.byRule[sec.ruleId] || [];
            add('ozet', sec.rowLabel + ' (SON·Δ)', host.buildBitisStatsFromEntries(matched), 'bitis', 'ozet_' + sec.ruleId);
        }

        for (let i = 0; i < YESIL_SON_DELTA_BUCKETS.length; i++) {
            const b = YESIL_SON_DELTA_BUCKETS[i];
            add('yesil_delta', '🟢 Yeşil · ' + b.label,
                host.buildBitisStatsFromEntries(index.yesilBySonBucket[i]), 'bitis', 'yesil_d' + i);
            add('turuncu_delta', '🟠 Turuncu · ' + b.label,
                host.buildBitisStatsFromEntries(index.turuncuBySonBucket[i]), 'bitis', 'turuncu_d' + i);
            add('sari_delta', '🟡 Sarı · ' + b.label,
                host.buildBitisStatsFromEntries(index.sariBySonBucket[i]), 'bitis', 'sari_d' + i);
        }

        for (let bi = 0; bi < YESIL_SON_DELTA_BUCKETS.length; bi++) {
            const deltaBucket = YESIL_SON_DELTA_BUCKETS[bi];
            const yesilEntries = index.yesilBySonBucket[bi];
            const turuncuEntries = index.turuncuBySonBucket[bi];
            const sariEntries = index.sariBySonBucket[bi];
            for (let bsi = 0; bsi < YESIL_T1_BS_BUCKETS.length; bsi++) {
                const bsBucket = YESIL_T1_BS_BUCKETS[bsi];
                const yesilOut = [];
                for (const entry of yesilEntries) {
                    const bs = ctx.t1BsPct(entry);
                    if (bs != null && bsBucket.bsTest(bs)) yesilOut.push(entry);
                }
                add('yesil_bs', '🟢 Yeşil · ' + deltaBucket.label + ' · ' + bsBucket.label,
                    host.buildBitisStatsFromEntries(yesilOut), 'bitis', 'yesil_bs_' + bi + '_' + bsi);

                const turuncuOut = [];
                for (const entry of turuncuEntries) {
                    const bs = ctx.t1BsPct(entry);
                    if (bs != null && bsBucket.bsTest(bs)) turuncuOut.push(entry);
                }
                add('turuncu_bs', '🟠 Turuncu · ' + deltaBucket.label + ' · ' + bsBucket.label,
                    host.buildBitisStatsFromEntries(turuncuOut), 'bitis', 'turuncu_bs_' + bi + '_' + bsi);

                const sariOut = [];
                for (const entry of sariEntries) {
                    const bs = ctx.t1BsPct(entry);
                    if (bs != null && bsBucket.bsTest(bs)) sariOut.push(entry);
                }
                add('sari_bs', '🟡 Sarı · ' + deltaBucket.label + ' · ' + bsBucket.label,
                    host.buildBitisStatsFromEntries(sariOut), 'bitis', 'sari_bs_' + bi + '_' + bsi);
            }
        }

        const raceGroups = host.buildRaceEntryGroups();
        for (let i = 0; i < YESIL_RACE_DELTA_BUCKETS.length; i++) {
            const bucket = YESIL_RACE_DELTA_BUCKETS[i];
            const rankItems = [];
            for (const entry of index.yesilByRaceBucket[i]) {
                const rk = host.raceKey(entry.kayitId, entry.raceNo);
                const { rank } = host.computeMetricRankInRace(
                    entry, raceGroups.get(rk) || [], ctx.primaryBsPct);
                rankItems.push({ rank });
            }
            add('yesil_race', '🟢 Yeşil · koşu içi BS · ' + bucket.label,
                host.buildRaceRankStatsFromItems(rankItems), 'raceRank', 'yesil_race_' + i);
        }

        for (let pct = 1; pct <= 25; pct++) {
            const matched = index.t1SariByPct[pct];
            add('t1sari_base', '🟡 T1×DR sarı · SON·Δ %' + pct,
                host.buildBitisStatsFromEntries(matched), 'bitis', 't1sari_' + pct);

            for (let ti = 0; ti < tiers.length; ti++) {
                const tier = tiers[ti];
                for (let di = 0; di < YESIL_RACE_DELTA_BUCKETS.length; di++) {
                    const bucket = YESIL_RACE_DELTA_BUCKETS[di];
                    const tierEntries = [];
                    for (const entry of matched) {
                        if (!tier.tierMatch(entry)) continue;
                        const g = ctx.primaryGapPct(entry);
                        if (g != null && bucket.gapTest(g)) tierEntries.push(entry);
                    }
                    add('t1sari_tier_delta',
                        tier.emoji + ' T1 sarı %' + pct + ' · ' + tier.label + ' · ' + bucket.label,
                        host.buildBitisStatsFromEntries(tierEntries), 'bitis',
                        't1sari_' + pct + '_t' + ti + '_d' + di);
                }

                for (let pbi = 0; pbi < primaryBsBuckets.length; pbi++) {
                    const bsBucket = primaryBsBuckets[pbi];
                    const bsEntries = [];
                    for (const entry of matched) {
                        if (!tier.comboMatch(entry, pct)) continue;
                        const bs = ctx.primaryBsPct(entry);
                        if (bs != null && bsBucket.bsTest(bs)) bsEntries.push(entry);
                    }
                    add('t1sari_tier_bs',
                        tier.emoji + ' T1 sarı %' + pct + ' · ' + tier.comboLabel + ' · ' + bsBucket.label,
                        host.buildBitisStatsFromEntries(bsEntries), 'bitis',
                        't1sari_' + pct + '_t' + ti + '_pbs' + pbi);

                    for (let t1i = 0; t1i < T1_DR_SON_BS_RANGE_BUCKETS.length; t1i++) {
                        const t1Bs = T1_DR_SON_BS_RANGE_BUCKETS[t1i];
                        const nested = [];
                        for (const entry of bsEntries) {
                            const tbs = ctx.t1BsPct(entry);
                            if (tbs != null && t1Bs.bsTest(tbs)) nested.push(entry);
                        }
                        add('t1sari_tier_bs_nested',
                            tier.emoji + ' T1 sarı %' + pct + ' · ' + bsBucket.label + ' · ' + t1Bs.label,
                            host.buildBitisStatsFromEntries(nested), 'bitis',
                            't1sari_' + pct + '_t' + ti + '_pbs' + pbi + '_t1bs' + t1i);
                    }
                }
            }
        }

        return rows;
    }

    function sortColorGostergeRows(rows) {
        const sorted = rows.slice();
        sorted.sort((a, b) => {
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            const bw = b.stats.withBitis || 0;
            const aw = a.stats.withBitis || 0;
            if (bw !== aw) return bw - aw;
            if (b.b1Rate !== a.b1Rate) return b.b1Rate - a.b1Rate;
            return a.label.localeCompare(b.label, 'tr');
        });
        for (let i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
        return sorted;
    }

    return {
        METRICS: PTEST_GOSTERGE_METRICS,
        createContext,
        ensureMetricPanels,
        switchMetricTab,
        renderMetricGosterge,
        renderMetricGostergeAsync,
        collectColorGostergeRows,
        sortColorGostergeRows,
        blendedGostergeSuccess,
        DEFAULT_SUCCESS_BLEND,
        pid,
        _YESIL_SON_DELTA_BUCKETS: YESIL_SON_DELTA_BUCKETS,
        _YESIL_RACE_DELTA_BUCKETS: YESIL_RACE_DELTA_BUCKETS,
        _YESIL_T1_BS_BUCKETS: YESIL_T1_BS_BUCKETS,
        _YESIL_DELTA_SORT_BUCKETS: YESIL_DELTA_SORT_BUCKETS,
        _T1_DR_SON_BS_RANGE_BUCKETS: T1_DR_SON_BS_RANGE_BUCKETS,
        _BITIS_REPORT_SECTIONS: BITIS_REPORT_SECTIONS,
        _renderBitisStatsGridHtml: renderBitisStatsGridHtml,
        _renderRaceRankStatsGridHtml: renderRaceRankStatsGridHtml,
        _renderReportSubgroupsHtml: renderReportSubgroupsHtml
    };
})();

if (typeof module !== 'undefined') module.exports = PtestGostergeEngine;
