/**
 * At sayısı · faktör analizinden uyarlamalı TAHMİN puanlaması.
 * Her koşu büyüklüğünde en yüksek başarılı faktör + kazanan göstergeler ağırlıklandırılır.
 */
const PtestFieldAdaptiveEngine = (function () {
    const STORAGE_KEY = 'ptestFieldAdaptiveProfiles';
    const ENABLED_KEY = 'fieldAdaptiveScoringEnabled';
    const PROFILE_VERSION = 2;
    const BUCKET_ORDER = ['t9v', 'colors', 'metrics', 'rest'];
    const BUCKET_LABELS = {
        t9v: 'T9V',
        colors: 'Renkler',
        metrics: 'Metrikler',
        rest: 'rest'
    };
    const DEFAULT_BASE = { t9v: 40, colors: 40, metrics: 15, rest: 5 };

    function pct(rate) {
        if (rate == null || !Number.isFinite(rate)) return '—';
        return (Math.round(rate * 1000) / 10).toFixed(1) + '%';
    }

    function normalizeSplit(split) {
        let t = Math.max(0, split.t9v || 0);
        let c = Math.max(0, split.colors || 0);
        let m = Math.max(0, split.metrics || 0);
        let r = Math.max(0, split.rest || 0);
        const sum = t + c + m + r || 100;
        t = Math.round((t / sum) * 1000) / 10;
        c = Math.round((c / sum) * 1000) / 10;
        m = Math.round((m / sum) * 1000) / 10;
        r = Math.round((r / sum) * 1000) / 10;
        const fix = Math.round((100 - (t + c + m + r)) * 10) / 10;
        if (fix) t = Math.round((t + fix) * 10) / 10;
        return { t9v: t, colors: c, metrics: m, rest: r };
    }

    function shareSplitForFactor(factor, base) {
        base = base || DEFAULT_BASE;
        const out = { ...base };
        const boost = {
            t9v: 14,
            colors: 22,
            metrics: 12,
            rest: 10
        }[factor] || 12;
        out[factor] = (out[factor] || 0) + boost;
        const others = BUCKET_ORDER.filter(id => id !== factor);
        let remaining = boost;
        for (const id of others) {
            const take = Math.min(remaining, Math.max(0, (out[id] || 0) - (id === 'rest' ? 3 : 6)));
            out[id] = (out[id] || 0) - take;
            remaining -= take;
        }
        if (remaining > 0) out[factor] = (out[factor] || 0) - remaining;
        return normalizeSplit(out);
    }

    function termPrefixes(rows, limit) {
        const out = [];
        const seen = new Set();
        for (const r of rows || []) {
            const label = r.label || r.id || '';
            if (!label) continue;
            const parts = label.split(' · ');
            const prefix = parts.length > 1 ? parts[0] + ' ·' : parts[0];
            if (seen.has(prefix)) continue;
            seen.add(prefix);
            out.push(prefix);
            if (out.length >= (limit || 10)) break;
        }
        return out;
    }

    function colorGostergeBoostList(colorLadder, limit) {
        const out = [];
        const seen = new Set();
        for (const r of colorLadder || []) {
            const label = r.label || r.id || '';
            if (!label || seen.has(label)) continue;
            seen.add(label);
            out.push(label);
            if (out.length >= (limit || 15)) break;
        }
        return out;
    }

    function selectBestFactor(row, opts) {
        opts = opts || {};
        const minSample = opts.minSample != null ? opts.minSample : 3;
        const primary = ['colors', 't9v', 'metrics'];
        let best = null;
        let bestRate = -1;
        let bestTotal = 0;

        for (const id of primary) {
            const ds = row.dominantSuccess?.[id];
            if (!ds || ds.total < minSample) continue;
            if (ds.rate > bestRate || (ds.rate === bestRate && ds.total > bestTotal)) {
                bestRate = ds.rate;
                best = id;
                bestTotal = ds.total;
            }
        }

        if (!best && row.topDominant && row.topDominant !== 'rest') {
            best = row.topDominant;
        }

        if (!best) {
            let maxW = -1;
            for (const id of primary) {
                const w = row.winnerDominant?.[id] || 0;
                if (w > maxW) {
                    maxW = w;
                    best = id;
                }
            }
        }

        if (!best) best = row.topDominant || 't9v';
        if (best === 'rest') best = row.topDominant || 't9v';
        return { best, bestRate, bestTotal };
    }

    function buildProfile(row, opts) {
        opts = opts || {};
        const base = opts.baseSplit || DEFAULT_BASE;
        const sel = selectBestFactor(row, opts);
        const shareSplit = shareSplitForFactor(sel.best, base);
        const boostTerms = termPrefixes(row.topTermsWinners, 10);
        if (!boostTerms.length) {
            boostTerms.push(...termPrefixes(row.topTerms, 6));
        }
        const topMetrics = (row.topMetrics || []).slice(0, 8).map(m => m.id || m.label);
        const boostColorGosterges = sel.best === 'colors'
            ? colorGostergeBoostList(opts.colorLadder, opts.colorBoostLimit || 15)
            : [];
        const ds = row.dominantSuccess?.[sel.best] || {};
        const blended = row.success?.leaderBlended;
        const bucketBoost = sel.best === 'colors'
            ? (opts.colorsBucketBoost != null ? opts.colorsBucketBoost : 1.45)
            : (opts.bucketBoost != null ? opts.bucketBoost : 1.3);

        return {
            fieldSize: row.fieldSize,
            bestFactor: sel.best,
            bestFactorLabel: BUCKET_LABELS[sel.best] || sel.best,
            exactRate: ds.rate || 0,
            exactSample: ds.total || 0,
            exactHits: ds.exact || 0,
            leaderBlended: blended,
            shareSplit,
            bucketBoost,
            colorScoreMult: sel.best === 'colors'
                ? (opts.colorScoreMult != null ? opts.colorScoreMult : 1.5)
                : 1,
            boostTerms,
            boostColorGosterges,
            topMetrics,
            topTermsWinners: row.topTermsWinners || [],
            reason: BUCKET_LABELS[sel.best] + ' · belirleyici tam isabet '
                + (ds.exact || 0) + '/' + (ds.total || 0) + ' (' + pct(ds.rate) + ')'
                + (blended != null ? ' · Karışık ' + pct(blended) : '')
                + (boostColorGosterges.length
                    ? ' · renk gösterge Top-' + boostColorGosterges.length
                    : '')
        };
    }

    function buildProfiles(fieldFactorResults, opts) {
        opts = opts || {};
        const bySize = {};
        const list = [];
        for (const row of fieldFactorResults?.results || []) {
            if (!row.fieldSize || (row.bitisCount || 0) < (opts.minBitis || 5)) continue;
            const profile = buildProfile(row, opts);
            bySize[row.fieldSize] = profile;
            list.push(profile);
        }
        return { bySize, list, builtAt: Date.now(), colorLadderSize: (opts.colorLadder || []).length };
    }

    function renderProfileTable(profiles, fmtPct) {
        fmtPct = fmtPct || pct;
        if (!profiles?.list?.length) {
            return '<p style="color:#789;font-size:11px">Profil oluşturmak için yeterli bitiş verisi yok.</p>';
        }
        let h = '<table class="ptest-field-factor-mini-table"><thead><tr>';
        h += '<th>At</th><th>Belirleyici</th><th>Tam isabet</th><th>Karışık</th>';
        h += '<th>T9V</th><th>Renk</th><th>Metrik</th><th>rest</th><th>Kazanan göstergeler</th></tr></thead><tbody>';
        for (const p of profiles.list) {
            const s = p.shareSplit || {};
            h += '<tr><td><strong>' + p.fieldSize + '</strong></td>';
            h += '<td>' + (p.bestFactorLabel || '—') + '</td>';
            h += '<td>' + (p.exactHits || 0) + '/' + (p.exactSample || 0) + '<br><small>' + fmtPct(p.exactRate) + '</small></td>';
            h += '<td>' + fmtPct(p.leaderBlended) + '</td>';
            h += '<td>' + s.t9v + '%</td><td>' + s.colors + '%</td><td>' + s.metrics + '%</td><td>' + s.rest + '%</td>';
            h += '<td style="text-align:left;font-size:8px">' + (p.boostTerms || []).slice(0, 4).join(', ') + '</td></tr>';
        }
        h += '</tbody></table>';
        return h;
    }

    function renderDetailBlock(profile) {
        if (!profile) return '';
        let h = '<details open class="ptest-field-factor-block"><summary>Uyarlamalı puanlama profili · '
            + profile.fieldSize + ' at</summary><div style="font-size:11px;padding:6px 0">';
        h += '<p><strong>Belirleyici faktör:</strong> ' + profile.bestFactorLabel
            + ' · ' + profile.reason + '</p>';
        h += '<p><strong>Pay ayarı:</strong> T9V %' + profile.shareSplit.t9v
            + ' · Renk %' + profile.shareSplit.colors
            + ' · Metrik %' + profile.shareSplit.metrics
            + ' · rest %' + profile.shareSplit.rest
            + ' · kova güçlendirme ×' + profile.bucketBoost + '</p>';
        if (profile.boostColorGosterges?.length) {
            h += '<p><strong>Renk gösterge önceliği (kalibrasyon merdiveni):</strong> '
                + profile.boostColorGosterges.slice(0, 6).join(' · ')
                + (profile.boostColorGosterges.length > 6
                    ? ' · +' + (profile.boostColorGosterges.length - 6) + ' daha'
                    : '')
                + '</p>';
        } else if (profile.boostTerms?.length) {
            h += '<p><strong>Öncelikli göstergeler (kazanan):</strong> '
                + profile.boostTerms.slice(0, 8).join(' · ') + '</p>';
        }
        h += '</div></details>';
        return h;
    }

    function saveProfiles(profiles) {
        if (!profiles?.bySize) return false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                version: PROFILE_VERSION,
                bySize: profiles.bySize,
                list: profiles.list || Object.values(profiles.bySize),
                builtAt: profiles.builtAt || Date.now()
            }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function loadProfiles() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.bySize || !Object.keys(parsed.bySize).length) return null;
            if (parsed.version !== PROFILE_VERSION) return null;
            return {
                bySize: parsed.bySize,
                list: parsed.list || Object.values(parsed.bySize),
                builtAt: parsed.builtAt || 0,
                version: parsed.version
            };
        } catch (_) {
            return null;
        }
    }

    function isAdaptiveEnabled() {
        try {
            const v = localStorage.getItem(ENABLED_KEY);
            if (v == null) return true;
            return v !== '0' && v !== 'false';
        } catch (_) {
            return true;
        }
    }

    function setAdaptiveEnabled(enabled) {
        try {
            localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
        } catch (_) { /* ignore */ }
    }

    return {
        buildProfiles,
        buildProfile,
        renderProfileTable,
        renderDetailBlock,
        shareSplitForFactor,
        selectBestFactor,
        colorGostergeBoostList,
        saveProfiles,
        loadProfiles,
        isAdaptiveEnabled,
        setAdaptiveEnabled,
        STORAGE_KEY,
        ENABLED_KEY,
        BUCKET_LABELS,
        DEFAULT_BASE,
        pct
    };
})();

if (typeof module !== 'undefined') module.exports = PtestFieldAdaptiveEngine;
