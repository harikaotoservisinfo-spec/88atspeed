/**
 * Renk gösterge başarı sıralaması — SON·Δ + derinlik çiftleri, indirilebilir .txt
 */
const PtestColorGostergeExport = (function () {
    function collectSonDeltaMetrics(flatEntries) {
        if (typeof GostergeScoringEngine !== 'undefined' && GostergeScoringEngine.collectSonDeltaMetrics) {
            return GostergeScoringEngine.collectSonDeltaMetrics(flatEntries);
        }
        const core = PtestGostergeEngine.METRICS.map(m => ({
            id: m.id,
            label: m.label,
            spec: m,
            mode: 'sonDelta'
        }));
        const seen = new Set(core.map(m => m.id));
        const extras = [];
        for (const entry of flatEntries) {
            for (const sec of entry.row._extraSectionMeta || []) {
                if (!sec?.id || seen.has(sec.id)) continue;
                seen.add(sec.id);
                extras.push({
                    id: sec.id,
                    label: sec.label || sec.id,
                    spec: {
                        id: sec.id,
                        label: sec.label || sec.id,
                        primaryKey: sec.depthsKey,
                        crossKey: 't1drDepths',
                        t1SariKey: 't1drDepths'
                    },
                    mode: 'sonDelta'
                });
            }
        }
        return core.concat(extras);
    }

    function getSuccessBlend() {
        if (typeof GostergeScoringEngine !== 'undefined' && GostergeScoringEngine.SUCCESS_BLEND) {
            return GostergeScoringEngine.SUCCESS_BLEND();
        }
        return PtestGostergeEngine.DEFAULT_SUCCESS_BLEND;
    }

    function countBitisRows(flatEntries, bitisValueForSort) {
        let n = 0;
        for (const entry of flatEntries) {
            if (bitisValueForSort?.(entry) != null) n++;
        }
        return n;
    }

    function collectAllColorRows(flatEntries, host, opts) {
        opts = opts || {};
        const blend = opts.successBlend || getSuccessBlend();
        const onProgress = opts.onProgress || (() => {});
        const rows = [];
        let step = 0;

        const sonMetrics = collectSonDeltaMetrics(flatEntries);
        for (const m of sonMetrics) {
            step++;
            onProgress('SON·Δ · ' + m.label + ' (' + step + '/' + sonMetrics.length + ' metrik)…');
            const ctx = PtestGostergeEngine.createContext(m.spec, host);
            rows.push(...PtestGostergeEngine.collectColorGostergeRows(ctx, host, {
                mode: 'sonDelta',
                successBlend: blend
            }));
        }

        if (typeof PtestGostergeDepthEngine !== 'undefined') {
            const depthMetrics = PtestGostergeDepthEngine.allMetrics(flatEntries);
            const pairs = PtestGostergeDepthEngine.DEPTH_PAIRS;
            const totalDepth = depthMetrics.length * pairs.length;
            let depthStep = 0;
            for (const dm of depthMetrics) {
                const scales = {
                    primary: PtestGostergeDepthEngine.buildGlobalPairScales(
                        flatEntries, dm.primaryKey, pairs.length),
                    cross: PtestGostergeDepthEngine.buildGlobalPairScales(
                        flatEntries, dm.crossKey, pairs.length)
                };
                for (const pair of pairs) {
                    depthStep++;
                    onProgress('Derinlik · ' + dm.label + ' · ' + pair.label
                        + ' (' + depthStep + '/' + totalDepth + ')…');
                    const ctx = PtestGostergeDepthEngine.createPairContext(
                        dm, pair.index, host, scales);
                    rows.push(...PtestGostergeEngine.collectColorGostergeRows(ctx, host, {
                        mode: 'depthPair',
                        pairLabel: pair.label,
                        modePrefix: '[' + pair.label + '] ',
                        successBlend: blend
                    }));
                }
            }
        }

        return PtestGostergeEngine.sortColorGostergeRows(rows);
    }

    function pctFmt(rate) {
        if (rate == null || rate < 0) return '—';
        return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
    }

    function modeLabel(row) {
        if (row.mode === 'depthPair') return 'Derinlik · ' + (row.pairLabel || '');
        return 'SON·Δ';
    }

    function formatTxt(rows, meta) {
        const blend = meta.successBlend || PtestGostergeEngine.DEFAULT_SUCCESS_BLEND;
        const lines = [];
        lines.push('88ATSPEED — Renk Gösterge Başarı Sıralaması');
        lines.push('Oluşturulma: ' + (meta.generatedAt || new Date().toISOString()));
        lines.push('Build: ' + (meta.buildTag || '—'));
        lines.push('Toplam at satırı: ' + (meta.totalRows || 0));
        lines.push('Bitiş kaydı olan satır: ' + (meta.bitisRows || 0));
        lines.push('Toplam gösterge: ' + rows.length);
        lines.push('');
        lines.push('Sıralama formülü (bitiş): %' + Math.round(blend.b1 * 100)
            + ' × 1. + %' + Math.round(blend.b12 * 100)
            + ' × (1–2) + %' + Math.round(blend.b123 * 100) + ' × (1–3)');
        lines.push('Koşu içi BS sıralaması göstergeleri aynı formülle (1./ilk2/ilk3 = koşuda SON·BS sırası).');
        lines.push('');
        lines.push('En başarılıdan en az başarılıya:');
        lines.push('');
        lines.push(
            '#'.padStart(6)
            + '  Karışık'.padStart(9)
            + '  1.'.padStart(7)
            + '  1–2'.padStart(7)
            + '  1–3'.padStart(7)
            + '  n/N'.padStart(10)
            + '  Mod'.padStart(22)
            + '  Metrik'.padStart(14)
            + '  Gösterge'
        );
        lines.push('-'.repeat(120));

        for (const row of rows) {
            const st = row.stats;
            const n = st.withBitis || 0;
            const nStr = n ? (st.matchedRows + ' / ' + n) : (st.matchedRows + ' / 0');
            lines.push(
                String(row.rank).padStart(6)
                + '  ' + pctFmt(row.successRate).padStart(7)
                + '  ' + pctFmt(row.b1Rate).padStart(5)
                + '  ' + pctFmt(row.b12Rate).padStart(5)
                + '  ' + pctFmt(row.b123Rate).padStart(5)
                + '  ' + nStr.padStart(10)
                + '  ' + modeLabel(row).padEnd(20)
                + '  ' + (row.metricLabel || '').padEnd(12)
                + '  ' + row.label
            );
        }

        lines.push('');
        lines.push('— Kategori dağılımı —');
        const catCounts = {};
        for (const row of rows) {
            catCounts[row.category] = (catCounts[row.category] || 0) + 1;
        }
        for (const [cat, cnt] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
            lines.push('  ' + cat + ': ' + cnt);
        }
        lines.push('');
        lines.push('Not: n = eşleşen satır, N = bitiş/koşu içi sıra bilgisi olan örnek sayısı.');
        return lines.join('\n');
    }

    function triggerDownload(text, filename) {
        const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function downloadColorGostergeTxt(flatEntries, host, opts) {
        opts = opts || {};
        if (!flatEntries?.length) {
            throw new Error('Veri yok — önce kayıtları yükleyin.');
        }
        const blend = getSuccessBlend();
        const rows = await new Promise((resolve) => {
            setTimeout(() => {
                resolve(collectAllColorRows(flatEntries, host, {
                    successBlend: blend,
                    onProgress: opts.onProgress
                }));
            }, 0);
        });
        const meta = {
            buildTag: opts.buildTag || '',
            totalRows: flatEntries.length,
            bitisRows: countBitisRows(flatEntries, host.bitisValueForSort),
            successBlend: blend,
            generatedAt: new Date().toLocaleString('tr-TR')
        };
        const text = formatTxt(rows, meta);
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const filename = 'renk-gosterge-siralama-' + flatEntries.length + 'satir-' + ts + '.txt';
        triggerDownload(text, filename);
        return { rows, filename, rowCount: rows.length };
    }

    return {
        collectAllColorRows,
        formatTxt,
        downloadColorGostergeTxt
    };
})();

if (typeof module !== 'undefined') module.exports = PtestColorGostergeExport;
