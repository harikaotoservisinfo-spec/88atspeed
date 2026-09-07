/**
 * Hazır Kupon — TEK/S2/S1/YUV ilk-4 premium tahmin paneli
 */
(function () {
    'use strict';

    const COL_KEYS = ['TEK', 'S2', 'S1', 'YUV'];
    const COL_COLORS = { TEK: '#e65100', S2: '#1565c0', S1: '#2e7d32', YUV: '#6a1b9a' };
    const POLL_MS = 60000;

    let state = {
        data: null,
        iso: null,
        activeHipId: null,
        loading: false,
        pollTimer: null
    };

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getIso() {
        if (window.pubVitrinState?.getIso) return window.pubVitrinState.getIso();
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function stopPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    function startPolling() {
        stopPolling();
        state.pollTimer = setInterval(() => {
            if ($('#panel-hazir')?.classList.contains('active')) {
                loadHazirKupon({ silent: true });
            }
        }, POLL_MS);
    }

    async function loadHazirKupon(opts = {}) {
        const root = $('#pubHazirRoot');
        if (!root) return;
        const iso = opts.iso || getIso();
        if (!opts.silent) {
            state.loading = true;
            root.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Hazır kupon tahminleri yükleniyor…</div>';
        }
        try {
            const qs = '/api/public/hazir-kupon?iso=' + encodeURIComponent(iso)
                + (opts.refresh ? '&refresh=1' : '');
            const res = await fetch(qs, { cache: 'no-store' });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Yükleme hatası');
            state.data = data;
            state.iso = iso;
            if (!state.activeHipId && data.hipodromlar?.length) {
                state.activeHipId = data.hipodromlar[0].id;
            }
            render();
            if (!opts.silent) startPolling();
        } catch (err) {
            if (!opts.silent) {
                root.innerHTML = '<div class="pub-hazir-error">'
                    + '<div class="pub-empty-icon">⚠</div>'
                    + '<h3>Yüklenemedi</h3>'
                    + '<p>' + escapeHtml(err.message) + '</p>'
                    + '<button type="button" class="pub-hazir-refresh-btn" id="pubHazirRetry">Tekrar dene</button>'
                    + '</div>';
                $('#pubHazirRetry')?.addEventListener('click', () => loadHazirKupon({ refresh: true }));
            }
        } finally {
            state.loading = false;
        }
    }

    function renderCalibrationBanner(cal) {
        if (!cal?.columns) return '';
        const pool = cal.pool || {};
        const cols = COL_KEYS.map((k) => {
            const c = cal.columns[k];
            const top4 = c?.top4?.markerHitPct;
            const race = c?.top4?.raceHitAmongMarkedPct;
            return '<div class="pub-hazir-cal-col" style="--col-accent:' + COL_COLORS[k] + '">'
                + '<span class="pub-hazir-cal-key">' + k + '</span>'
                + '<span class="pub-hazir-cal-val">' + (top4 != null ? top4 + '%' : '—') + '</span>'
                + '<span class="pub-hazir-cal-sub">işaret→ilk4</span>'
                + '<span class="pub-hazir-cal-race">' + (race != null ? race + '% koşu' : '') + '</span>'
                + '</div>';
        }).join('');

        return '<div class="pub-hazir-cal-banner pub-hazir-premium-card">'
            + '<div class="pub-hazir-cal-hdr">'
            + '<span class="pub-hazir-premium-badge">PREMIUM</span>'
            + '<h3>Kayıt Kalibrasyonu</h3>'
            + '<p>' + (cal.kayitRaceCount || 0) + ' sonuçlu koşu · TEK/S2/S1/YUV geçmiş isabet oranları</p>'
            + '</div>'
            + '<div class="pub-hazir-cal-grid">' + cols + '</div>'
            + '<div class="pub-hazir-pool-stats">'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.raceHitPct != null ? pool.raceHitPct + '%' : '—') + '</b><span>Havuz koşu isabeti</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.pickHitPct != null ? pool.pickHitPct + '%' : '—') + '</b><span>Seçim isabeti</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.horseTop4Pct != null ? pool.horseTop4Pct + '%' : '—') + '</b><span>İşaretli at→ilk4</span></div>'
            + '<div class="pub-hazir-pool-stat"><b>' + (pool.avgHitsPerRace != null ? pool.avgHitsPerRace : '—') + '</b><span>Ort. isabet/koşu</span></div>'
            + '</div></div>';
    }

    function renderGunlukBasari(g) {
        if (!g) return '';
        return '<div class="pub-hazir-gunluk pub-hazir-premium-card">'
            + '<div class="pub-hazir-gunluk-hdr"><h3>Bugünkü Başarı</h3>'
            + '<span class="pub-hazir-gunluk-meta">' + g.finished + '/' + g.races + ' koşu sonuçlandı</span></div>'
            + '<div class="pub-hazir-gunluk-metrics">'
            + '<div class="pub-hazir-metric ' + (g.poolHitPct >= 50 ? 'pos' : '') + '">'
            + '<span class="pub-hazir-metric-val">' + (g.poolHitPct != null ? g.poolHitPct + '%' : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Havuz isabet</span></div>'
            + '<div class="pub-hazir-metric">'
            + '<span class="pub-hazir-metric-val">' + (g.pickHitPct != null ? g.pickHitPct + '%' : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Seçim isabet</span></div>'
            + '<div class="pub-hazir-metric">'
            + '<span class="pub-hazir-metric-val">' + (g.avgHitsPerRace != null ? g.avgHitsPerRace : '—') + '</span>'
            + '<span class="pub-hazir-metric-lbl">Ort. isabet</span></div>'
            + '</div></div>';
    }

    function renderMarkerTags(markers) {
        if (!markers?.length) return '<span class="pub-hazir-no-mark">—</span>';
        return markers.map((m) =>
            '<span class="pub-hazir-mtag" style="--tag-color:' + (COL_COLORS[m.col] || '#666') + '" title="' + escapeHtml(m.col + ': ' + m.glyphs) + '">'
            + escapeHtml(m.col) + '<small>' + escapeHtml(m.glyphs) + '</small></span>'
        ).join('');
    }

    function renderRaceCard(race) {
        const statusCls = race.status === 'finished'
            ? (race.poolHit ? 'hit' : 'miss')
            : (race.status === 'pending' ? 'pending' : 'empty');
        const statusLabel = race.status === 'finished'
            ? (race.poolHit ? '✓ ' + race.hitCount + '/4 isabet' : '✗ ' + (race.hitCount || 0) + '/4')
            : (race.status === 'pending' ? 'Bekliyor' : 'İşaret yok');

        let picksHtml = '';
        if (race.picks?.length) {
            picksHtml = '<table class="pub-hazir-pick-table"><thead><tr>'
                + '<th>#</th><th>No</th><th>At</th><th>İşaretler</th><th>İlk4%</th><th>Pay</th>'
                + (race.status === 'finished' ? '<th>Sonuç</th>' : '')
                + '</tr></thead><tbody>'
                + race.picks.map((p) => {
                    const resultCell = race.status === 'finished'
                        ? '<td class="' + (p.hit ? 'pub-hazir-hit' : 'pub-hazir-miss') + '">'
                        + (p.hit ? '✓ ' + (p.finishPos || '?') + '.' : '✗')
                        + '</td>'
                        : '';
                    return '<tr class="' + (p.hit ? 'pub-hazir-row-hit' : '') + '">'
                        + '<td>' + p.rank + '</td>'
                        + '<td><b>' + escapeHtml(p.no) + '</b></td>'
                        + '<td>' + escapeHtml((p.name || '').slice(0, 22)) + '</td>'
                        + '<td class="pub-hazir-markers">' + renderMarkerTags(p.markers) + '</td>'
                        + '<td><span class="pub-hazir-pct">' + p.top4Prob + '%</span></td>'
                        + '<td>' + (p.raceSharePct || 0) + '%</td>'
                        + resultCell
                        + '</tr>';
                }).join('')
                + '</tbody></table>';
        } else {
            picksHtml = '<p class="pub-hazir-empty-race">Bu koşuda TEK/S2/S1/YUV işareti taşıyan at yok.</p>';
        }

        const actualLine = race.status === 'finished' && race.actualTop4?.length
            ? '<div class="pub-hazir-actual">Gerçek ilk-4: <b>' + race.actualTop4.join(' · ') + '</b></div>'
            : '';

        return '<div class="pub-hazir-race-card pub-hazir-premium-card ' + statusCls + '" data-race="' + race.raceNo + '">'
            + '<div class="pub-hazir-race-hdr">'
            + '<span class="pub-hazir-race-no">Koşu ' + race.raceNo + '</span>'
            + (race.mesafe ? '<span class="pub-hazir-race-meta">' + escapeHtml(String(race.mesafe)) + 'm</span>' : '')
            + (race.saat ? '<span class="pub-hazir-race-meta">' + escapeHtml(race.saat) + '</span>' : '')
            + '<span class="pub-hazir-race-status pub-hazir-status-' + statusCls + '">' + statusLabel + '</span>'
            + '</div>'
            + picksHtml
            + actualLine
            + '</div>';
    }

    function render() {
        const root = $('#pubHazirRoot');
        const data = state.data;
        if (!root || !data) return;

        const hips = data.hipodromlar || [];
        const activeHip = hips.find((h) => h.id === state.activeHipId) || hips[0];

        const hipTabs = hips.map((h) =>
            '<button type="button" class="pub-hazir-hip-tab' + (h.id === activeHip?.id ? ' active' : '') + '" data-hip="' + escapeHtml(h.id) + '">'
            + escapeHtml(h.name)
            + '<span class="pub-hazir-hip-badge">' + (h.finishedCount || 0) + '/' + (h.races?.length || 0) + '</span>'
            + '</button>'
        ).join('');

        const racesHtml = (activeHip?.races || []).map(renderRaceCard).join('');

        root.innerHTML = ''
            + '<div class="pub-hazir-toolbar">'
            + '<div><h2 class="pub-hazir-title">Hazır Kupon — İlk 4 Tahmin</h2>'
            + '<p class="pub-hazir-subtitle">TEK · S2 · S1 · YUV işaret analizi · ' + escapeHtml(data.tarih || '') + '</p></div>'
            + '<button type="button" class="pub-hazir-refresh-btn" id="pubHazirRefresh" title="Yenile">↻ Yenile</button>'
            + '</div>'
            + renderCalibrationBanner(data.calibration)
            + renderGunlukBasari(data.gunlukBasari)
            + '<div class="pub-hazir-hip-tabs" role="tablist">' + hipTabs + '</div>'
            + '<div class="pub-hazir-races">' + (racesHtml || '<div class="pub-empty"><p>Bugün için program yok.</p></div>') + '</div>';

        $$('.pub-hazir-hip-tab', root).forEach((btn) => {
            btn.addEventListener('click', () => {
                state.activeHipId = btn.dataset.hip;
                render();
            });
        });
        $('#pubHazirRefresh')?.addEventListener('click', () => loadHazirKupon({ refresh: true }));
    }

    function init() {
        const root = $('#pubHazirRoot');
        if (!root) return;
        loadHazirKupon();
    }

    function onTabActivate() {
        if (!state.data || state.iso !== getIso()) {
            loadHazirKupon();
        } else {
            startPolling();
        }
    }

    function onTabDeactivate() {
        stopPolling();
    }

    window.pubHazirKupon = { init, onTabActivate, onTabDeactivate, load: loadHazirKupon };
})();
