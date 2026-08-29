/**
 * At sayısı · faktör analizi — koşu büyüklüğüne göre puanlama faktörlerinin etkisi
 */
const PtestFieldFactorEngine = (function () {
    const BUCKET_ORDER = ['t9v', 'colors', 'metrics', 'rest'];
    const BUCKET_LABELS = {
        t9v: 'T9V',
        colors: 'Renkler',
        metrics: 'Metrikler',
        rest: 'rest'
    };

    function pct(rate) {
        if (rate == null || !Number.isFinite(rate)) return '—';
        return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
    }

    function raceKey(entry) {
        return String(entry.kayitId) + '|' + String(entry.raceNo ?? '');
    }

    function buildRaceGroups(flatEntries) {
        const groups = new Map();
        for (const entry of flatEntries || []) {
            const rk = raceKey(entry);
            if (!groups.has(rk)) groups.set(rk, []);
            groups.get(rk).push(entry);
        }
        return groups;
    }

    function termBucketKind(base, metricShareIds) {
        if (base === 't9v') return 't9v';
        if (base === '_colorGosterge') return 'colors';
        if (metricShareIds?.[base]) return 'metrics';
        return 'rest';
    }

    function bucketSum(b) {
        return (b?.t9v || 0) + (b?.colors || 0) + (b?.metrics || 0) + (b?.rest || 0);
    }

    function resolveTahmin(entry, tahmin) {
        let t = tahmin || entry?.row?.tahmin;
        if (!t && entry && GostergeScoringEngine.computeRowTahmin) {
            t = GostergeScoringEngine.computeRowTahmin(entry);
            if (entry.row) entry.row.tahmin = t;
        }
        return t;
    }

    function aggregateFactorBuckets(tahmin, metricShareIds, entry) {
        tahmin = resolveTahmin(entry, tahmin);
        const metricDetail = {};
        const termDetail = {};
        const fromTerms = { t9v: 0, colors: 0, metrics: 0, rest: 0 };

        for (const t of tahmin?.terms || []) {
            const pts = t.points || 0;
            if (pts <= 0) continue;
            const base = String(t.metricId || '').replace(/__dp\d+$/, '');
            const kind = termBucketKind(base, metricShareIds);
            fromTerms[kind] += pts;
            if (kind === 'metrics') {
                metricDetail[base] = (metricDetail[base] || 0) + pts;
            }
            const key = t.label || t.ruleLabel || base;
            if (!termDetail[key]) {
                termDetail[key] = { label: key, points: 0, count: 0, bucket: kind };
            }
            termDetail[key].points += pts;
            termDetail[key].count++;
        }

        let buckets;
        const termsTotal = bucketSum(fromTerms);
        const engineTotal = tahmin?.buckets ? bucketSum(tahmin.buckets) : 0;
        if (engineTotal > 0) {
            buckets = { ...tahmin.buckets };
        } else if (termsTotal > 0) {
            buckets = { ...fromTerms };
        } else if (tahmin?.buckets) {
            buckets = { ...tahmin.buckets };
        } else {
            buckets = { ...fromTerms };
        }
        const total = bucketSum(buckets) || termsTotal || 1;
        return { buckets, metricDetail, termDetail, total };
    }

    function ensureFlatEntriesScored(flatEntries) {
        if (!flatEntries?.length || !GostergeScoringEngine.applyToFlatEntries) return;
        let empty = 0;
        for (const entry of flatEntries) {
            const t = entry.row?.tahmin;
            const bt = bucketSum(t?.buckets);
            if ((t?.terms?.length || 0) === 0 && bt <= 0) empty++;
        }
        if (empty > flatEntries.length * 0.25) {
            GostergeScoringEngine.applyToFlatEntries(flatEntries);
        }
    }

    function horsesForRace(entries, race) {
        if (!entries?.length || !race) return [];
        const groups = buildRaceGroups(entries);
        let horses = groups.get(race.raceKey);
        if (horses?.length) return horses;
        const nk = String(race.raceKey || '');
        for (const [rk, hs] of groups) {
            if (rk === nk || String(rk) === nk) return hs;
        }
        return entries.filter(e =>
            e.tarih === race.tarih
            && e.hipodrom === race.hipodrom
            && String(e.raceNo) === String(race.raceNo)
        );
    }

    function dominantBucket(buckets) {
        let best = 'rest';
        let bestVal = -1;
        for (const id of BUCKET_ORDER) {
            const v = buckets[id] || 0;
            if (v > bestVal) {
                bestVal = v;
                best = id;
            }
        }
        return bestVal > 0 ? best : null;
    }

    function topFromMap(mapObj, limit, labelFn) {
        return Object.entries(mapObj || {})
            .map(([id, val]) => ({
                id,
                label: labelFn ? labelFn(id) : id,
                points: typeof val === 'number' ? val : val.points,
                count: typeof val === 'object' ? val.count : 0,
                bucket: typeof val === 'object' ? val.bucket : null
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, limit || 15);
    }

    function buildFieldSizeLookup(flatEntries) {
        const fieldByRace = new Map();
        const groups = buildRaceGroups(flatEntries);
        for (const [rk, horses] of groups) {
            fieldByRace.set(rk, horses.length);
        }
        return fieldByRace;
    }

    function analyzeFieldFactors(flatEntries, host) {
        if (!flatEntries?.length || !host?.bitisValueForSort) {
            return { fieldSizes: [], results: [] };
        }
        ensureFlatEntriesScored(flatEntries);
        const metricShareIds = GostergeScoringEngine.OTHER_METRIC_SHARES || {};
        const shareInfo = GostergeScoringEngine.getOtherMetricShares?.() || {};
        const fieldByRace = buildFieldSizeLookup(flatEntries);
        const byFieldSize = {};
        const fieldSizeSet = new Set();

        for (const entry of flatEntries) {
            const rk = raceKey(entry);
            const fs = fieldByRace.get(rk) || 0;
            if (!fs) continue;
            fieldSizeSet.add(fs);
            if (!byFieldSize[fs]) {
                byFieldSize[fs] = {
                    fieldSize: fs,
                    raceCount: 0,
                    horseCount: 0,
                    bitisCount: 0,
                    raceKeys: new Set(),
                    bucketSum: { t9v: 0, colors: 0, metrics: 0, rest: 0 },
                    dominantFactor: { t9v: 0, colors: 0, metrics: 0, rest: 0 },
                    dominantExact: { t9v: 0, colors: 0, metrics: 0, rest: 0, total: { t9v: 0, colors: 0, metrics: 0, rest: 0 } },
                    winnerDominant: { t9v: 0, colors: 0, metrics: 0, rest: 0 },
                    leaderDominant: { t9v: 0, colors: 0, metrics: 0, rest: 0 },
                    metricPoints: {},
                    termPoints: {},
                    termWinners: {},
                    termLeaders: {},
                    races: []
                };
            }
            const bucket = byFieldSize[fs];
            bucket.horseCount++;
            if (!bucket.raceKeys.has(rk)) {
                bucket.raceKeys.add(rk);
                bucket.raceCount++;
            }

            const b = host.bitisValueForSort(entry);
            const tahmin = entry.row?.tahmin;
            const agg = aggregateFactorBuckets(tahmin, metricShareIds, entry);
            for (const id of BUCKET_ORDER) bucket.bucketSum[id] += agg.buckets[id] || 0;

            const dom = dominantBucket(agg.buckets);
            if (b != null && b >= 1) {
                bucket.bitisCount++;
                if (dom) {
                    bucket.dominantFactor[dom]++;
                    bucket.dominantExact.total[dom]++;
                    const rank = tahmin?.rank;
                    if (rank != null && Number(rank) === Number(b)) {
                        bucket.dominantExact[dom]++;
                    }
                }
                if (b === 1 && dom) bucket.winnerDominant[dom]++;
            }

            if (tahmin?.rank === 1 && dom) bucket.leaderDominant[dom]++;

            for (const [mid, pts] of Object.entries(agg.metricDetail)) {
                bucket.metricPoints[mid] = (bucket.metricPoints[mid] || 0) + pts;
            }
            for (const [k, v] of Object.entries(agg.termDetail)) {
                if (!bucket.termPoints[k]) bucket.termPoints[k] = { label: v.label, points: 0, count: 0, bucket: v.bucket };
                bucket.termPoints[k].points += v.points;
                bucket.termPoints[k].count += v.count;
            }
            if (b === 1) {
                for (const [k, v] of Object.entries(agg.termDetail)) {
                    bucket.termWinners[k] = (bucket.termWinners[k] || 0) + v.points;
                }
            }
            if (tahmin?.rank === 1) {
                for (const [k, v] of Object.entries(agg.termDetail)) {
                    bucket.termLeaders[k] = (bucket.termLeaders[k] || 0) + v.points;
                }
            }
        }

        const groups = buildRaceGroups(flatEntries);
        for (const fs of fieldSizeSet) {
            const bucket = byFieldSize[fs];
            for (const rk of bucket.raceKeys) {
                const horses = groups.get(rk) || [];
                let raceExact = 0;
                let raceBitis = 0;
                for (const he of horses) {
                    const bv = host.bitisValueForSort(he);
                    if (bv == null || bv < 1) continue;
                    raceBitis++;
                    if (he.row?.tahmin?.rank != null && Number(he.row.tahmin.rank) === Number(bv)) raceExact++;
                }
                if (!horses.length) continue;
                const sample = horses[0];
                bucket.races.push({
                    raceKey: rk,
                    tarih: sample.tarih,
                    hipodrom: sample.hipodrom,
                    raceNo: sample.raceNo,
                    horseCount: fs,
                    bitisCount: raceBitis,
                    exactCount: raceExact
                });
            }
        }

        const fieldSizes = Array.from(fieldSizeSet).sort((a, b) => a - b);
        const results = [];
        const entriesByField = {};
        for (const fs of fieldSizes) entriesByField[fs] = [];

        for (const entry of flatEntries) {
            const fs = fieldByRace.get(raceKey(entry));
            if (fs && entriesByField[fs]) entriesByField[fs].push(entry);
        }

        for (const fs of fieldSizes) {
            const b = byFieldSize[fs];
            const subset = entriesByField[fs] || [];
            const success = GostergeScoringEngine.evaluateTahminSuccess(subset, host.bitisValueForSort);
            const ptTotal = b.bucketSum.t9v + b.bucketSum.colors + b.bucketSum.metrics + b.bucketSum.rest || 1;
            const avgBucketShare = {
                t9v: b.bucketSum.t9v / ptTotal,
                colors: b.bucketSum.colors / ptTotal,
                metrics: b.bucketSum.metrics / ptTotal,
                rest: b.bucketSum.rest / ptTotal
            };

            let topDominant = null;
            let topDomCount = -1;
            for (const id of BUCKET_ORDER) {
                if (b.dominantFactor[id] > topDomCount) {
                    topDomCount = b.dominantFactor[id];
                    topDominant = id;
                }
            }
            if (topDomCount <= 0) topDominant = null;

            const dominantSuccess = {};
            for (const id of BUCKET_ORDER) {
                const tot = b.dominantExact.total[id];
                dominantSuccess[id] = {
                    exact: b.dominantExact[id],
                    total: tot,
                    rate: tot ? b.dominantExact[id] / tot : 0
                };
            }

            results.push({
                fieldSize: fs,
                raceCount: b.raceCount,
                horseCount: b.horseCount,
                bitisCount: b.bitisCount,
                success,
                avgBucketShare,
                dominantFactor: { ...b.dominantFactor },
                dominantSuccess,
                topDominant,
                topDominantLabel: topDominant ? BUCKET_LABELS[topDominant] : '—',
                topMetrics: topFromMap(b.metricPoints, 12, id => shareInfo[id]?.label || id),
                topTerms: topFromMap(b.termPoints, 15, null),
                topTermsWinners: Object.entries(b.termWinners)
                    .map(([label, points]) => ({ label, points }))
                    .sort((a, b) => b.points - a.points)
                    .slice(0, 12),
                topTermsLeaders: Object.entries(b.termLeaders)
                    .map(([label, points]) => ({ label, points }))
                    .sort((a, b) => b.points - a.points)
                    .slice(0, 12),
                winnerDominant: { ...b.winnerDominant },
                leaderDominant: { ...b.leaderDominant },
                races: b.races,
                fieldSize: fs
            });
        }

        return {
            fieldSizes,
            results,
            entriesByField,
            bucketLabels: BUCKET_LABELS
        };
    }

    function renderSummaryTable(results, selectedFieldSize, fmtPct) {
        fmtPct = fmtPct || pct;
        let h = '<table class="ptest-field-factor-summary"><thead><tr>';
        h += '<th>At</th><th>Koşu</th><th>Bitişli</th>';
        h += '<th>Lider 1.</th><th>1–2</th><th>1–3</th><th>Karışık</th><th>Tam isabet</th>';
        h += '<th>T9V pay</th><th>Renk pay</th><th>Metrik pay</th><th>rest</th>';
        h += '<th>Belirleyici</th></tr></thead><tbody>';
        for (const r of results) {
            const s = r.success || {};
            const active = r.fieldSize === selectedFieldSize ? ' active' : '';
            const abs = r.avgBucketShare || {};
            h += '<tr class="ptest-field-factor-row' + active + '" data-field-size="' + r.fieldSize + '">';
            h += '<td><strong>' + r.fieldSize + '</strong></td>';
            h += '<td>' + r.raceCount + '</td>';
            h += '<td>' + r.bitisCount + '</td>';
            h += '<td>' + fmtPct(s.leaderB1Rate) + '</td>';
            h += '<td>' + fmtPct(s.leaderB12Rate) + '</td>';
            h += '<td>' + fmtPct(s.leaderB123Rate) + '</td>';
            h += '<td><strong>' + fmtPct(s.leaderBlended) + '</strong></td>';
            h += '<td>' + (s.exact || 0) + '/' + (s.exactTotal || 0) + '</td>';
            h += '<td>' + fmtPct(abs.t9v) + '</td>';
            h += '<td>' + fmtPct(abs.colors) + '</td>';
            h += '<td>' + fmtPct(abs.metrics) + '</td>';
            h += '<td>' + fmtPct(abs.rest) + '</td>';
            h += '<td style="font-size:9px">' + AtSpeedUtils.escapeHtml(r.topDominantLabel) + '</td>';
            h += '</tr>';
        }
        h += '</tbody></table>';
        return h;
    }

    function renderDetailPanel(row, opts) {
        opts = opts || {};
        const fmtPct = opts.fmtPct || pct;
        if (!row) return '<p style="color:#789">Soldan bir at sayısı satırına tıklayın</p>';

        const s = row.success || {};
        let h = '<div class="ptest-field-factor-detail">';
        h += '<h4 class="ptest-field-factor-detail-title">' + row.fieldSize + ' atlı koşular · '
            + row.raceCount + ' koşu · ' + row.bitisCount + ' bitişli at</h4>';
        h += '<p class="ptest-field-factor-detail-meta">Karışık <strong>' + fmtPct(s.leaderBlended)
            + '</strong> · Tam isabet ' + (s.exact || 0) + '/' + (s.exactTotal || 0)
            + ' (' + fmtPct(s.exactRate) + ') · En sık belirleyici: <strong>'
            + AtSpeedUtils.escapeHtml(row.topDominantLabel) + '</strong></p>';

        h += '<div class="ptest-field-factor-grid">';
        h += renderBucketBlock('Ortalama faktör payı', row.avgBucketShare, fmtPct);
        h += renderDominantBlock('Belirleyici faktör (en yüksek puan)', row.dominantFactor, row.bitisCount);
        h += renderDominantBlock('Kazanan at (bitiş 1.) belirleyici', row.winnerDominant, countObj(row.winnerDominant));
        h += renderDominantBlock('TAHMİN lideri belirleyici', row.leaderDominant, countObj(row.leaderDominant));
        h += '</div>';

        h += '<details open class="ptest-field-factor-block"><summary>Belirleyici faktöre göre tam isabet</summary>';
        h += '<table class="ptest-field-factor-mini-table"><thead><tr><th>Faktör</th><th>Tam isabet</th><th>%</th></tr></thead><tbody>';
        for (const id of BUCKET_ORDER) {
            const ds = row.dominantSuccess[id] || {};
            h += '<tr><td>' + BUCKET_LABELS[id] + '</td><td>' + (ds.exact || 0) + '/' + (ds.total || 0)
                + '</td><td>' + fmtPct(ds.rate) + '</td></tr>';
        }
        h += '</tbody></table></details>';

        h += '<div class="ptest-field-factor-two-col">';
        h += renderTopList('En çok puan veren metrikler', row.topMetrics, 'label', 'points');
        h += renderTopList('En çok puan veren göstergeler', row.topTerms, 'label', 'points');
        h += '</div>';
        h += '<div class="ptest-field-factor-two-col">';
        h += renderTopList('Kazanan atlarda (1.) baskın göstergeler', row.topTermsWinners, 'label', 'points');
        h += renderTopList('TAHMİN liderinde baskın göstergeler', row.topTermsLeaders, 'label', 'points');
        h += '</div>';

        h += renderRaceSamples(row, opts.host, opts.formatTahminCell, opts.raceLimit != null ? opts.raceLimit : 8, opts.entries);
        h += '</div>';
        return h;
    }

    function countObj(o) {
        return Object.values(o || {}).reduce((a, b) => a + b, 0);
    }

    function renderBucketBlock(title, shares, fmtPct) {
        let h = '<div class="ptest-field-factor-card"><h5>' + title + '</h5><ul>';
        for (const id of BUCKET_ORDER) {
            h += '<li><span>' + BUCKET_LABELS[id] + '</span><strong>' + fmtPct(shares[id]) + '</strong></li>';
        }
        h += '</ul></div>';
        return h;
    }

    function renderDominantBlock(title, counts, total) {
        total = total || 1;
        let h = '<div class="ptest-field-factor-card"><h5>' + title + '</h5><ul>';
        for (const id of BUCKET_ORDER) {
            const n = counts[id] || 0;
            h += '<li><span>' + BUCKET_LABELS[id] + '</span><strong>' + n
                + ' <small>(' + pct(n / total) + ')</small></strong></li>';
        }
        h += '</ul></div>';
        return h;
    }

    function renderTopList(title, rows, labelKey, valKey) {
        let h = '<details class="ptest-field-factor-block"><summary>' + title + '</summary>';
        h += '<table class="ptest-field-factor-mini-table"><thead><tr><th>#</th><th>Gösterge</th><th>Puan</th></tr></thead><tbody>';
        for (let i = 0; i < (rows || []).length; i++) {
            const r = rows[i];
            h += '<tr><td>' + (i + 1) + '</td><td style="text-align:left;font-size:9px">'
                + AtSpeedUtils.escapeHtml(r[labelKey] || '—') + '</td><td>' + Math.round(r[valKey] || 0) + '</td></tr>';
        }
        if (!rows?.length) h += '<tr><td colspan="3">Veri yok</td></tr>';
        h += '</tbody></table></details>';
        return h;
    }

    function renderRaceSamples(row, host, formatTahminCell, limit, entries) {
        limit = limit != null ? limit : 8;
        const races = (row.races || []).slice().sort((a, b) => b.exactCount - a.exactCount || b.bitisCount - a.bitisCount);
        let h = '<details class="ptest-field-factor-block"><summary>Örnek koşular (tam isabet / ' + row.fieldSize + ' at)</summary>';
        let shown = 0;
        for (const race of races) {
            if (shown >= limit) break;
            const horses = horsesForRace(entries || row.entries, race);
            if (!horses.length) continue;
            shown++;
            horses.sort((a, b) => (a.row.no ?? 0) - (b.row.no ?? 0));
            h += '<div class="ptest-field-factor-race">';
            h += '<div class="ptest-field-factor-race-title">' + AtSpeedUtils.escapeHtml(race.tarih)
                + ' · ' + AtSpeedUtils.escapeHtml(race.hipodrom || '—') + ' · Koşu ' + race.raceNo
                + ' · tam isabet ' + race.exactCount + '/' + race.bitisCount + '</div>';
            h += '<table class="ptest-field-factor-race-table"><thead><tr><th>#</th><th>At</th><th>Belirleyici</th><th>TAHMİN|BİTİŞ</th></tr></thead><tbody>';
            const metricShareIds = GostergeScoringEngine.OTHER_METRIC_SHARES || {};
            for (const he of horses) {
                const b = host?.bitisValueForSort?.(he);
                const agg = aggregateFactorBuckets(he.row?.tahmin, metricShareIds, he);
                const dom = dominantBucket(agg.buckets);
                const domLabel = dom ? BUCKET_LABELS[dom] : '—';
                const matched = b != null && b >= 1 && he.row?.tahmin?.rank != null
                    && Number(he.row.tahmin.rank) === Number(b);
                h += '<tr' + (matched ? ' class="match"' : '') + '>';
                h += '<td>' + AtSpeedUtils.escapeHtml(String(he.row.no ?? '')) + '</td>';
                h += '<td style="text-align:left">' + AtSpeedUtils.escapeHtml(he.row.name || '—') + '</td>';
                h += '<td style="font-size:9px">' + domLabel + '</td>';
                h += '<td>' + (formatTahminCell ? formatTahminCell(he.row.tahmin, row.fieldSize, b) : '—') + '</td></tr>';
            }
            h += '</tbody></table></div>';
        }
        h += '</details>';
        return h;
    }

    return {
        analyzeFieldFactors,
        renderSummaryTable,
        renderDetailPanel,
        aggregateFactorBuckets,
        dominantBucket,
        BUCKET_LABELS,
        pct
    };
})();

if (typeof module !== 'undefined') module.exports = PtestFieldFactorEngine;
