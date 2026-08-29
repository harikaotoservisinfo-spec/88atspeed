/**
 * Derinlik gelişme göstergeleri — SON↔1ÖNCE, 1↔2ÖNCE … çiftleri arası fark / renk mantığı
 */
const PtestGostergeDepthEngine = (function () {
    const DEPTH_PAIRS = [
        { index: 0, label: 'SON ↔ 1 ÖNCE', newer: 'SON', older: '1 ÖNCE' },
        { index: 1, label: '1 ÖNCE ↔ 2 ÖNCE', newer: '1 ÖNCE', older: '2 ÖNCE' },
        { index: 2, label: '2 ÖNCE ↔ 3 ÖNCE', newer: '2 ÖNCE', older: '3 ÖNCE' },
        { index: 3, label: '3 ÖNCE ↔ 4 ÖNCE', newer: '3 ÖNCE', older: '4 ÖNCE' },
        { index: 4, label: '4 ÖNCE ↔ 5 ÖNCE', newer: '4 ÖNCE', older: '5 ÖNCE' },
        { index: 5, label: '5 ÖNCE ↔ 6 ÖNCE', newer: '5 ÖNCE', older: '6 ÖNCE' }
    ];

    const CORE_DEPTH_METRICS = [
        { id: 'son8001', label: 'SON800-1', primaryKey: 'son8001Depths', crossKey: 't1drDepths' },
        { id: 'son8002', label: 'SON800-2', primaryKey: 'son8002Depths', crossKey: 't1drDepths' },
        { id: 'oran1', label: '800-1 ORAN', primaryKey: 'oran1Depths', crossKey: 't1drDepths' },
        { id: 'oran2', label: '800-2 ORAN', primaryKey: 'oran2Depths', crossKey: 't1drDepths' },
        { id: 'fark827', label: '800Δ·7', primaryKey: 'fark827Depths', crossKey: 't1drDepths' },
        { id: 'ff', label: 'FFΔ', primaryKey: 'ffDepths', crossKey: 't1drDepths' },
        { id: 't8', label: 'T8Δ', primaryKey: 'test8Depths', crossKey: 't1drDepths' },
        { id: 'test1', label: 'TEST1', primaryKey: 'test1Depths', crossKey: 't1drDepths' },
        { id: 'test2', label: 'TEST2', primaryKey: 'test2Depths', crossKey: 't1drDepths' },
        { id: 'test3', label: 'TEST3', primaryKey: 'test3Depths', crossKey: 't1drDepths' },
        { id: 'testsira', label: 'TEST·SIRA', primaryKey: 'test123SiraliDepths', crossKey: 't1drDepths' },
        { id: 't1dr', label: 'T1×DR', primaryKey: 't1drDepths', crossKey: 'son8001Depths' },
        { id: 'son800dr1', label: 'SON800·1DR', primaryKey: 'son800Dr1Depths', crossKey: 't1drDepths' },
        { id: 'son800dr', label: 'SON800·DR', primaryKey: 'son800DrDepths', crossKey: 't1drDepths' }
    ];

    function pid(metricId, pairIndex, suffix) {
        return 'pgd_' + metricId + '_p' + pairIndex + '_' + suffix;
    }

    function panelId(metricId) {
        return 'pgd_panel_' + metricId;
    }

    function pairDiff(entry, depthsKey, pairIndex) {
        const depths = entry.row[depthsKey] || [];
        const a = depths[pairIndex]?.pct;
        const b = depths[pairIndex + 1]?.pct;
        if (a == null || b == null) return null;
        return Math.abs(a - b);
    }

    function pairCells(entry, depthsKey, pairIndex) {
        const depths = entry.row[depthsKey] || [];
        return { newer: depths[pairIndex] || null, older: depths[pairIndex + 1] || null };
    }

    function buildGlobalPairScales(flatEntries, depthsKey, maxPairs) {
        const scales = [];
        for (let p = 0; p < maxPairs; p++) {
            let min = null;
            let max = null;
            for (const entry of flatEntries) {
                const d = pairDiff(entry, depthsKey, p);
                if (d == null) continue;
                if (min === null || d < min) min = d;
                if (max === null || d > max) max = d;
            }
            scales.push({ min, max });
        }
        return scales;
    }

    function scaledPairGap(diff, scale) {
        if (diff == null || scale?.min == null || scale?.max == null) return null;
        return AtSpeedUtils.pctLinearMaxBest(diff, scale.min, scale.max);
    }

    function collectExtraMetrics(flatEntries) {
        const seen = new Set();
        const out = [];
        for (const entry of flatEntries) {
            const sections = entry.row._extraSectionMeta || [];
            for (const sec of sections) {
                if (!sec?.id || seen.has(sec.id)) continue;
                seen.add(sec.id);
                out.push({
                    id: sec.id,
                    label: sec.label || sec.id,
                    primaryKey: sec.depthsKey,
                    crossKey: 't1drDepths'
                });
            }
        }
        return out;
    }

    function allMetrics(flatEntries) {
        const extras = collectExtraMetrics(flatEntries);
        const seen = new Set(CORE_DEPTH_METRICS.map(m => m.id));
        const merged = [...CORE_DEPTH_METRICS];
        for (const e of extras) {
            if (!seen.has(e.id)) merged.push(e);
        }
        return merged;
    }

    function createPairContext(spec, pairIndex, host, scales) {
        const primaryKey = spec.primaryKey;
        const crossKey = spec.crossKey;
        const primaryScale = scales.primary[pairIndex];
        const crossScale = scales.cross[pairIndex];
        const pairLabel = DEPTH_PAIRS[pairIndex]?.label || ('Çift ' + pairIndex);

        function primaryGapPct(entry) {
            return scaledPairGap(pairDiff(entry, primaryKey, pairIndex), primaryScale);
        }
        function crossGapPct(entry) {
            return scaledPairGap(pairDiff(entry, crossKey, pairIndex), crossScale);
        }
        function primaryBsPct(entry) {
            return pairCells(entry, primaryKey, pairIndex).newer?.successPct ?? null;
        }
        function t1BsPct(entry) {
            return entry.row.t1drDepths?.[pairIndex]?.successPct ?? null;
        }
        function t1SariGapPct(entry) {
            const cell = entry.row.t1drDepths?.[pairIndex];
            if (!cell || cell.gapPct == null) {
                const a = entry.row.t1drDepths?.[pairIndex]?.pct;
                const b = entry.row.t1drDepths?.[pairIndex + 1]?.pct;
                if (a == null || b == null) return null;
                return scaledPairGap(Math.abs(a - b), crossScale);
            }
            return cell.gapPct;
        }

        function isTwinZero(row) {
            const pd = pairDiff({ row }, primaryKey, pairIndex);
            const cd = pairDiff({ row }, crossKey, pairIndex);
            return pd === 0 && cd === 0;
        }

        function gapTdClass(row) {
            const gap = primaryGapPct({ row });
            if (gap == null) return '';
            const pg = row[primaryKey]?.[pairIndex]?.pct;
            const cg = row[crossKey]?.[pairIndex]?.pct;
            const pd = pairDiff({ row }, primaryKey, pairIndex);
            if (pd === 0 && pairDiff({ row }, crossKey, pairIndex) === 0) return ' ptest-gap-twin-zero';
            if (pd !== 0 && pg != null && cg != null) {
                const pgp = primaryGapPct({ row });
                const cgp = scaledPairGap(pairDiff({ row }, crossKey, pairIndex), crossScale);
                if (pgp != null && cgp != null && pgp < 25 && cgp < 25) return ' ptest-gap-neon';
            }
            return '';
        }

        function pctClassLocal(pct) {
            if (pct === null || pct === undefined) return 'ptest-pct-none';
            if (pct === 0) return 'ptest-pct-low';
            if (pct < 35) return 'ptest-pct-mid';
            if (pct < 70) return 'ptest-pct-good';
            return 'ptest-pct-high';
        }

        function primaryVisualFlags(entry) {
            const gap = primaryGapPct(entry);
            const tdCls = gapTdClass(entry.row).trim();
            const isTwin = tdCls === 'ptest-gap-twin-zero';
            const isNeon = tdCls === 'ptest-gap-neon';
            let pc = 'none';
            if (gap != null) pc = pctClassLocal(gap).replace('ptest-pct-', '');
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

        function t1SariVisualFlags(entry) {
            const gap = t1SariGapPct(entry);
            if (gap == null) return { sariYazi: false, yesilHucre: false };
            const pc = pctClassLocal(gap).replace('ptest-pct-', '');
            return {
                sariYazi: pc === 'mid',
                yesilHucre: gap != null && gap < 25,
                turuncuHucre: gap === 0
            };
        }

        function yesilDeltaBucketById(ruleId) {
            return PtestGostergeEngine._YESIL_DELTA_SORT_BUCKETS?.find(b => b.id === ruleId) || null;
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

        function pairDirection(entry) {
            const { newer, older } = pairCells(entry, primaryKey, pairIndex);
            if (newer?.pct == null || older?.pct == null) return null;
            if (newer.pct > older.pct) return 'up';
            if (newer.pct < older.pct) return 'down';
            return 'flat';
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

        function primaryBsBuckets() {
            return [
                { label: spec.label + ' · SON·BS tam %100', bsTest: bs => bs === 100 },
                { label: spec.label + ' · SON·BS %95 – %99', bsTest: bs => bs >= 95 && bs <= 99 },
                { label: spec.label + ' · SON·BS %91 – %94', bsTest: bs => bs >= 91 && bs <= 94 },
                { label: spec.label + ' · SON·BS %90 – %95', bsTest: bs => bs >= 90 && bs <= 95 },
                { label: spec.label + ' · SON·BS %85 – %89', bsTest: bs => bs >= 85 && bs <= 89 },
                { label: spec.label + ' · SON·BS %80 – %84', bsTest: bs => bs >= 80 && bs <= 84 },
                { label: spec.label + ' · SON·BS %75 – %79', bsTest: bs => bs >= 75 && bs <= 79 },
                { label: spec.label + ' · SON·BS %75 altı', bsTest: bs => bs != null && bs < 75 }
            ];
        }

        return {
            spec, pairIndex, pairLabel, primaryKey, crossKey,
            primaryGapPct, crossGapPct, primaryBsPct, t1BsPct,
            primaryVisualFlags, t1SariVisualFlags, primaryMatchesRule,
            yesilBucketBlinkMatch, t1SariMatchesPct, primaryBsBuckets,
            buildColorTiers, pairDirection, pairCells
        };
    }

    function attachExtraMeta(flatEntries) {
        for (const entry of flatEntries) {
            if (entry.row._extraSectionMeta) continue;
            const meta = [];
            for (const key of Object.keys(entry.row)) {
                if (!key.endsWith('Depths') || key === 'son8001Depths') continue;
                if (CORE_DEPTH_METRICS.some(m => m.primaryKey === key)) continue;
                const depths = entry.row[key];
                if (!Array.isArray(depths) || !depths.length) continue;
                const id = key.replace(/Depths$/, '');
                meta.push({ id, depthsKey: key, label: id.toUpperCase() });
            }
            entry.row._extraSectionMeta = meta;
        }
    }

    function buildMetricPanelHtml(metric) {
        const mid = metric.id;
        let h = '<div class="ptest-metric-panel ptest-depth-metric-panel hidden" data-ptest-depth-metric="' + mid + '" id="' + panelId(mid) + '">';
        h += '<div class="ptest-gosterge-section-title">Derinlik gelişme · ' + AtSpeedUtils.escapeHtml(metric.label) + '</div>';
        h += '<p class="ptest-depth-mode-hint">Her blok: komşu derinlik çifti (yeni ↔ eski) arasındaki % fark · olumlu = yeni &gt; eski · aynı renk/Δ mantığı</p>';
        for (const pair of DEPTH_PAIRS) {
            const p = pair.index;
            const openAttr = p === 0 ? ' open' : '';
            h += '<details class="ptest-depth-pair-block"' + openAttr + ' data-depth-pair="' + p + '">';
            h += '<summary class="ptest-depth-pair-summary">' + AtSpeedUtils.escapeHtml(pair.label) + '</summary>';
            h += '<div class="ptest-depth-pair-inner" id="' + pid(mid, p, 'inner') + '"'
                + (p === 0 ? '' : ' data-lazy="1"') + '>'
                + (p === 0 ? '' : '<p class="ptest-depth-lazy-hint">Açılınca yüklenecek…</p>')
                + '</div>';
            h += '</details>';
        }
        h += '</div>';
        return h;
    }

    function renderPairBlock(ctx, host, buildTag) {
        const mid = ctx.spec.id;
        const p = ctx.pairIndex;
        const inner = document.getElementById(pid(mid, p, 'inner'));
        if (!inner) return;
        const flatEntries = host.flatEntries;
        if (!flatEntries.length) {
            inner.innerHTML = '<p>Veri yok</p>';
            return;
        }

        const renderBitisStatsGridHtml = PtestGostergeEngine._renderBitisStatsGridHtml;
        const renderRaceRankStatsGridHtml = PtestGostergeEngine._renderRaceRankStatsGridHtml;
        const renderReportSubgroupsHtml = PtestGostergeEngine._renderReportSubgroupsHtml;
        const YESIL_SON_DELTA_BUCKETS = PtestGostergeEngine._YESIL_SON_DELTA_BUCKETS;
        const YESIL_RACE_DELTA_BUCKETS = PtestGostergeEngine._YESIL_RACE_DELTA_BUCKETS;
        const YESIL_T1_BS_BUCKETS = PtestGostergeEngine._YESIL_T1_BS_BUCKETS;
        const T1_DR_SON_BS_RANGE_BUCKETS = PtestGostergeEngine._T1_DR_SON_BS_RANGE_BUCKETS;
        const BITIS_REPORT_SECTIONS = PtestGostergeEngine._BITIS_REPORT_SECTIONS;

        let up = 0, down = 0, flat = 0;
        for (const entry of flatEntries) {
            const dir = ctx.pairDirection(entry);
            if (dir === 'up') up++;
            else if (dir === 'down') down++;
            else if (dir === 'flat') flat++;
        }

        function yesilEntriesForBucket(bucket) {
            const out = [];
            for (const entry of flatEntries) {
                if (!ctx.primaryMatchesRule(entry, 'yesilHucre')) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !bucket.gapTest(g)) continue;
                if (!ctx.yesilBucketBlinkMatch(entry, bucket)) continue;
                out.push(entry);
            }
            return out;
        }

        function turuncuEntriesForBucket(bucket) {
            const out = [];
            for (const entry of flatEntries) {
                if (!ctx.primaryMatchesRule(entry, 'turuncuHucre')) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !bucket.gapTest(g)) continue;
                if (!ctx.yesilBucketBlinkMatch(entry, bucket)) continue;
                out.push(entry);
            }
            return out;
        }

        function sariYaziEntriesForBucket(bucket) {
            const out = [];
            for (const entry of flatEntries) {
                if (!ctx.primaryVisualFlags(entry).sariYazi) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !bucket.gapTest(g)) continue;
                if (!ctx.yesilBucketBlinkMatch(entry, bucket)) continue;
                out.push(entry);
            }
            return out;
        }

        function entriesForTierDeltaAndBs(tierMatch, deltaBucket, bsBucket) {
            const out = [];
            for (const entry of flatEntries) {
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

        function renderDeltaBsPanel(title, cls, entriesFn) {
            let block = '<div class="ptest-report-panel ' + cls + '"><h3>' + title + '</h3>';
            block += '<div class="ptest-gosterge-subgrid">';
            block += renderReportSubgroupsHtml(YESIL_SON_DELTA_BUCKETS, entriesFn, host) || '<p>—</p>';
            block += '</div></div>';
            return block;
        }

        function renderDeltaBsComboPanel(title, cls, tierMatch) {
            let block = '<div class="ptest-report-panel ' + cls + '"><h3>' + title + '</h3>';
            for (const deltaBucket of YESIL_SON_DELTA_BUCKETS) {
                block += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                    + AtSpeedUtils.escapeHtml(deltaBucket.label) + '</div>';
                block += renderReportSubgroupsHtml(YESIL_T1_BS_BUCKETS, bsBucket =>
                    entriesForTierDeltaAndBs(tierMatch, deltaBucket, bsBucket), host);
                block += '</div>';
            }
            block += '</div>';
            return block;
        }

        let h = '<div class="ptest-report-meta-global">📈 ' + AtSpeedUtils.escapeHtml(ctx.pairLabel)
            + ' · ' + AtSpeedUtils.escapeHtml(ctx.spec.label)
            + ' · olumlu↑ ' + up + ' · olumsuz↓ ' + down + ' · değişmez ' + flat
            + ' · Toplam yarış: ' + host.countUniqueRaces()
            + ' · build ' + buildTag + '</div>';

        h += '<div class="ptest-gosterge-summary-row">';
        for (const sec of BITIS_REPORT_SECTIONS) {
            const matched = flatEntries.filter(e => ctx.primaryMatchesRule(e, sec.ruleId));
            const r = host.buildBitisStatsFromEntries(matched);
            h += '<div class="ptest-report-panel"><h3>' + AtSpeedUtils.escapeHtml(sec.rowLabel) + ' — bitiş</h3>';
            h += '<div class="ptest-report-meta">' + r.matchedRows + ' satır · ' + r.withBitis + ' bitiş</div>';
            h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(r) + '</div></div>';
        }
        h += '</div>';

        h += renderDeltaBsPanel('🟢 Yeşil · çift Δ aralık detay (14)', 'ptest-report-green-detail', yesilEntriesForBucket);

        h += '<div class="ptest-report-panel ptest-report-green-bs-detail"><h3>🟢 Yeşil · çift Δ + T1×DR · BS (14×8)</h3>';
        for (const deltaBucket of YESIL_SON_DELTA_BUCKETS) {
            const parentStats = host.buildBitisStatsFromEntries(yesilEntriesForBucket(deltaBucket));
            h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                + AtSpeedUtils.escapeHtml(deltaBucket.label) + '</div>';
            h += '<div class="ptest-report-delta-section-meta">' + parentStats.matchedRows + ' satır · '
                + parentStats.withBitis + ' bitiş</div>';
            h += renderReportSubgroupsHtml(YESIL_T1_BS_BUCKETS, bsBucket => {
                const out = [];
                for (const entry of yesilEntriesForBucket(deltaBucket)) {
                    const bs = ctx.t1BsPct(entry);
                    if (bs == null || !bsBucket.bsTest(bs)) continue;
                    out.push(entry);
                }
                return out;
            }, host);
            h += '</div>';
        }
        h += '</div>';

        h += '<div class="ptest-report-panel ptest-report-green-race-detail"><h3>🟢 Yeşil · koşu içi BS sıralaması (7)</h3>';
        const raceGroups = host.buildRaceEntryGroups();
        for (const bucket of YESIL_RACE_DELTA_BUCKETS) {
            const rankItems = [];
            for (const entry of flatEntries) {
                if (!ctx.primaryMatchesRule(entry, 'yesilHucre')) continue;
                const g = ctx.primaryGapPct(entry);
                if (g == null || !bucket.gapTest(g)) continue;
                const rk = host.raceKey(entry.kayitId, entry.raceNo);
                const { rank, field } = host.computeMetricRankInRace(entry, raceGroups.get(rk) || [], ctx.primaryBsPct);
                rankItems.push({ rank, field });
            }
            const stats = host.buildRaceRankStatsFromItems(rankItems);
            h += '<div class="ptest-report-delta-section"><div class="ptest-report-delta-section-title">'
                + AtSpeedUtils.escapeHtml(bucket.label) + '</div>';
            h += '<div class="ptest-report-delta-section-meta">' + stats.matchedRows + ' yeşil · '
                + stats.withBitis + ' koşu içi sıra</div>';
            h += '<div class="ptest-stats-wrap">' + renderRaceRankStatsGridHtml(stats) + '</div></div>';
        }
        h += '</div>';

        h += renderDeltaBsPanel('🟠 Turuncu · çift Δ aralık detay (14)', 'ptest-report-orange-detail', turuncuEntriesForBucket);
        h += renderDeltaBsComboPanel('🟠 Turuncu · çift Δ + T1×DR · BS (14×8)', 'ptest-report-orange-detail',
            e => ctx.primaryMatchesRule(e, 'turuncuHucre'));
        h += renderDeltaBsPanel('🟡 Sarı yazı · çift Δ aralık detay (14)', 'ptest-report-sariyazi-detail', sariYaziEntriesForBucket);
        h += renderDeltaBsComboPanel('🟡 Sarı yazı · çift Δ + T1×DR · BS (14×8)', 'ptest-report-sariyazi-detail',
            e => ctx.primaryVisualFlags(e).sariYazi);

        const tiers = ctx.buildColorTiers();
        const bsBuckets = ctx.primaryBsBuckets();
        h += '<div class="ptest-gosterge-section-title">T1×DR sarı %1–25 · ' + AtSpeedUtils.escapeHtml(ctx.spec.label) + ' tonları</div>';
        h += '<div class="ptest-report-panel ptest-report-t1-sari-delta"><h3>🟡 T1×DR sarı — %1 … %25</h3>';
        for (let pct = 1; pct <= 25; pct++) {
            const matched = flatEntries.filter(e => ctx.t1SariMatchesPct(e, pct));
            const stats = host.buildBitisStatsFromEntries(matched);
            h += '<div class="ptest-t1-indicator-block"><div class="ptest-t1-indicator-title">Sarı · çift Δ %' + pct + '</div>';
            h += '<div class="ptest-t1-indicator-meta">' + stats.matchedRows + ' satır · ' + stats.withBitis + ' bitiş</div>';
            h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(stats) + '</div>';
            for (const tier of tiers) {
                h += '<div class="ptest-t1-sari-tier-wrap ' + tier.wrapClass + '"><div class="ptest-t1-sari-tier-heading">'
                    + tier.emoji + ' ' + AtSpeedUtils.escapeHtml(tier.label) + ' · 7 Δ</div>';
                for (const bucket of YESIL_RACE_DELTA_BUCKETS) {
                    const entries = flatEntries.filter(e => {
                        if (!ctx.t1SariMatchesPct(e, pct)) return false;
                        if (!tier.tierMatch(e)) return false;
                        const g = ctx.primaryGapPct(e);
                        return g != null && bucket.gapTest(g);
                    });
                    const st = host.buildBitisStatsFromEntries(entries);
                    h += '<div class="ptest-t1-sari-tier-subgroup"><div class="ptest-t1-sari-tier-subgroup-title">'
                        + AtSpeedUtils.escapeHtml(tier.label) + ' · ' + AtSpeedUtils.escapeHtml(bucket.label) + '</div>';
                    h += '<div class="ptest-t1-sari-tier-subgroup-meta">' + st.matchedRows + ' satır · ' + st.withBitis + ' bitiş</div>';
                    h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(st) + '</div></div>';
                }
                h += '</div>';
                h += '<div class="ptest-t1-sari-tier-bscombo ' + tier.wrapClass + '"><div class="ptest-t1-sari-tier-bscombo-heading">'
                    + tier.emoji + ' BS kırılımları · ' + AtSpeedUtils.escapeHtml(tier.comboLabel) + '</div>';
                for (const bsBucket of bsBuckets) {
                    const bsEntries = flatEntries.filter(e => {
                        if (!tier.comboMatch(e, pct)) return false;
                        const bs = ctx.primaryBsPct(e);
                        return bs != null && bsBucket.bsTest(bs);
                    });
                    const st = host.buildBitisStatsFromEntries(bsEntries);
                    h += '<div class="ptest-t1-sari-tier-bs-block"><div class="ptest-t1-sari-tier-bs-block-title">'
                        + AtSpeedUtils.escapeHtml(bsBucket.label) + '</div>';
                    h += '<div class="ptest-t1-sari-tier-bs-block-meta">' + st.matchedRows + ' satır · ' + st.withBitis + ' bitiş</div>';
                    h += '<div class="ptest-stats-wrap">' + renderBitisStatsGridHtml(st) + '</div>';
                    h += '<div class="ptest-t1-sari-t1bs-nested-wrap">';
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
        }
        h += '</div>';

        inner.innerHTML = h;
    }

    const depthScalesCache = new Map();

    function getDepthScales(spec, flatEntries) {
        const key = spec.id + ':' + flatEntries.length;
        if (depthScalesCache.has(key)) return depthScalesCache.get(key);
        const scales = {
            primary: buildGlobalPairScales(flatEntries, spec.primaryKey, DEPTH_PAIRS.length),
            cross: buildGlobalPairScales(flatEntries, spec.crossKey, DEPTH_PAIRS.length)
        };
        depthScalesCache.set(key, scales);
        return scales;
    }

    function bindDepthPairLazy(panelEl, spec, host, buildTag, opts) {
        if (!panelEl || panelEl.dataset.lazyBound === '1') return;
        panelEl.dataset.lazyBound = '1';
        const scales = getDepthScales(spec, host.flatEntries);
        panelEl.querySelectorAll('.ptest-depth-pair-block').forEach(block => {
            block.addEventListener('toggle', async () => {
                if (!block.open) return;
                const inner = block.querySelector('.ptest-depth-pair-inner');
                if (!inner || inner.dataset.rendered === '1' || inner.dataset.loading === '1') return;
                inner.dataset.loading = '1';
                const pairIndex = parseInt(block.dataset.depthPair, 10) || 0;
                const ctx = createPairContext(spec, pairIndex, host, scales);
                if (opts?.onProgress) opts.onProgress(DEPTH_PAIRS[pairIndex]?.label + ' yükleniyor…');
                await yieldToMain(false);
                renderPairBlock(ctx, host, buildTag);
                inner.dataset.rendered = '1';
                delete inner.dataset.loading;
            });
        });
    }

    function yieldToMain(sync) {
        if (sync) return Promise.resolve();
        return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    }

    async function renderDepthMetricGostergeAsync(spec, host, buildTag, opts) {
        opts = opts || {};
        const sync = !!opts.sync;
        const isCancelled = opts.isCancelled || (() => false);
        const onProgress = opts.onProgress || (() => {});

        attachExtraMeta(host.flatEntries);
        const panel = document.getElementById(panelId(spec.id));
        if (!panel) return;

        const scales = getDepthScales(spec, host.flatEntries);
        bindDepthPairLazy(panel, spec, host, buildTag, opts);

        for (const pair of DEPTH_PAIRS) {
            if (isCancelled()) return;
            const inner = document.getElementById(pid(spec.id, pair.index, 'inner'));
            if (!inner) continue;
            const skipLazy = !sync && !opts.renderAllPairs && pair.index > 0 && inner.dataset.lazy === '1';
            if (skipLazy) {
                inner.innerHTML = '<p class="ptest-depth-lazy-hint">Açılınca yüklenecek…</p>';
                inner.dataset.rendered = '';
                continue;
            }
            onProgress(pair.label + '…');
            const ctx = createPairContext(spec, pair.index, host, scales);
            renderPairBlock(ctx, host, buildTag);
            inner.dataset.rendered = '1';
            if (!sync && pair.index < DEPTH_PAIRS.length - 1) await yieldToMain(false);
        }
        onProgress('Tamamlandı');
    }

    function renderDepthMetricGosterge(spec, host, buildTag) {
        return renderDepthMetricGostergeAsync(spec, host, buildTag, { sync: true });
    }

    function ensureDepthPanels(container, flatEntries) {
        if (!container || container.dataset.depthBuilt === '1') return;
        attachExtraMeta(flatEntries);
        let h = '';
        for (const m of allMetrics(flatEntries)) {
            h += buildMetricPanelHtml(m);
        }
        container.innerHTML = h;
        container.dataset.depthBuilt = '1';
    }

    function switchDepthMetricTab(metricId) {
        document.querySelectorAll('.ptest-depth-metric-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.ptestDepthMetric === metricId);
        });
        document.querySelectorAll('.ptest-depth-metric-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.ptestDepthMetric !== metricId);
        });
    }

    return {
        DEPTH_PAIRS,
        CORE_DEPTH_METRICS,
        allMetrics,
        ensureDepthPanels,
        switchDepthMetricTab,
        renderDepthMetricGosterge,
        renderDepthMetricGostergeAsync,
        panelId,
        createPairContext,
        buildGlobalPairScales,
        pairDiff,
        pairCells
    };
})();

if (typeof module !== 'undefined') module.exports = PtestGostergeDepthEngine;
