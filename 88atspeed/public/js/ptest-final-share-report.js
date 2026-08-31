/**
 * Final puanlama pay taraması — yazdırılabilir rapor (PDF olarak kaydet)
 */
const PtestFinalShareReport = (function () {
    function pct(rate) {
        if (rate == null || !Number.isFinite(rate)) return '—';
        return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
    }

    function buildReportHtml(results, meta) {
        meta = meta || {};
        const rows = results || [];
        const best = rows[0] || null;
        const generated = meta.generatedAt || new Date().toLocaleString('tr-TR');
        const blend = meta.successBlend || { b1: 0.8, b12: 0.12, b123: 0.08 };

        let h = '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">';
        h += '<title>88ATSPEED — Final Puanlama Pay Taraması</title>';
        h += '<style>';
        h += 'body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;margin:24px;color:#222}';
        h += 'h1{font-size:18px;color:#4a148c;margin:0 0 8px}';
        h += 'h2{font-size:14px;color:#333;margin:20px 0 8px}';
        h += '.meta{color:#546e7a;font-size:10px;line-height:1.5;margin-bottom:16px}';
        h += '.best-box{background:#e8f5e9;border:2px solid #2e7d32;border-radius:8px;padding:12px;margin:12px 0}';
        h += '.best-box strong{font-size:13px;color:#1b5e20}';
        h += 'table{width:100%;border-collapse:collapse;font-size:10px;margin-top:8px}';
        h += 'th,td{border:1px solid #ccc;padding:5px 6px;text-align:center}';
        h += 'th{background:#ede7f6;position:sticky;top:0}';
        h += 'td.left{text-align:left;font-size:9px}';
        h += 'tr.best{background:#e8f5e9;font-weight:bold}';
        h += '@media print{body{margin:12px}tr.best{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
        h += '</style></head><body>';

        h += '<h1>88ATSPEED — Final Puanlama · Pay Dağılımı Taraması</h1>';
        h += '<div class="meta">';
        h += 'Oluşturulma: ' + generated + '<br>';
        h += 'Build: ' + (meta.buildTag || '—') + '<br>';
        h += 'Satır: ' + (meta.totalRows || '—') + ' · Bitiş: ' + (meta.bitisRows || '—') + '<br>';
        h += 'Kombinasyon: ' + rows.length + ' · Formül: %' + Math.round(blend.b1 * 100)
            + '×1. + %' + Math.round(blend.b12 * 100) + '×1–2 + %' + Math.round(blend.b123 * 100) + '×1–3<br>';
        h += 'Renkler: Top-80 export · Toplam · derinlik (kalıcı model)';
        h += '</div>';

        if (best) {
            const c = best.config || {};
            h += '<div class="best-box"><strong>🏆 EN BAŞARILI PAY DAĞILIMI</strong><br>';
            h += 'T9V %' + c.t9v + ' · Renkler %' + c.colors + ' · Metrikler %' + c.metrics + ' · rest %' + c.rest + '<br>';
            h += 'Karışık (koşu lideri): <strong>' + pct(best.leaderBlended) + '</strong>';
            h += ' · Lider 1. ' + pct(best.leaderB1Rate);
            h += ' · 1–2 ' + pct(best.leaderB12Rate);
            h += ' · 1–3 ' + pct(best.leaderB123Rate);
            h += ' · Tam isabet ' + (best.exact || 0) + '/' + (best.exactTotal || 0);
            h += ' (' + pct(best.exactRate) + ')';
            h += '</div>';
        }

        h += '<h2>Tüm kombinasyonlar (en başarılıdan)</h2>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>T9V</th><th>Renkler</th><th>Metrikler</th><th>rest</th>';
        h += '<th>Lider 1.</th><th>1–2</th><th>1–3</th><th>Karışık</th><th>Tam isabet</th>';
        h += '</tr></thead><tbody>';

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const c = r.config || {};
            h += '<tr class="' + (i === 0 ? 'best' : '') + '">';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td>' + c.t9v + '</td><td>' + c.colors + '</td><td>' + c.metrics + '</td><td>' + c.rest + '</td>';
            h += '<td>' + pct(r.leaderB1Rate) + '</td><td>' + pct(r.leaderB12Rate) + '</td>';
            h += '<td>' + pct(r.leaderB123Rate) + '</td><td><strong>' + pct(r.leaderBlended) + '</strong></td>';
            h += '<td>' + (r.exact || 0) + '/' + (r.exactTotal || 0) + '</td></tr>';
        }

        h += '</tbody></table>';
        h += '<p class="meta" style="margin-top:16px">PDF: Yazdır → Hedef: PDF olarak kaydet</p>';
        h += '</body></html>';
        return h;
    }

    function openPrintReport(results, meta) {
        const html = buildReportHtml(results, meta);
        const w = window.open('', '_blank');
        if (!w) {
            throw new Error('Pop-up engellendi — tarayıcıda pop-up izni verin.');
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.onload = function () {
            w.focus();
            setTimeout(function () { w.print(); }, 300);
        };
        return w;
    }

    function downloadTxt(results, meta) {
        meta = meta || {};
        const lines = [];
        lines.push('88ATSPEED — Final Puanlama Pay Taraması');
        lines.push('Oluşturulma: ' + (meta.generatedAt || new Date().toLocaleString('tr-TR')));
        lines.push('Kombinasyon: ' + (results?.length || 0));
        lines.push('');
        if (results?.[0]) {
            const b = results[0];
            const c = b.config || {};
            lines.push('EN İYİ: T9V %' + c.t9v + ' · Renkler %' + c.colors + ' · Metrikler %' + c.metrics + ' · rest %' + c.rest);
            lines.push('Karışık: ' + pct(b.leaderBlended));
        }
        lines.push('');
        lines.push('#\tT9V\tRenkler\tMetrikler\trest\tKarışık\t1.\t1-2\t1-3\tTam');
        for (let i = 0; i < (results || []).length; i++) {
            const r = results[i];
            const c = r.config || {};
            lines.push([
                i + 1, c.t9v, c.colors, c.metrics, c.rest,
                pct(r.leaderBlended), pct(r.leaderB1Rate), pct(r.leaderB12Rate), pct(r.leaderB123Rate),
                (r.exact || 0) + '/' + (r.exactTotal || 0)
            ].join('\t'));
        }
        const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'final-puanlama-pay-taramasi-' + Date.now() + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return { buildReportHtml, openPrintReport, downloadTxt, pct };
})();

if (typeof module !== 'undefined') module.exports = PtestFinalShareReport;
