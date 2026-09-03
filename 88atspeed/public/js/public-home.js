(function() {
    'use strict';

    const state = {
        tarih: '',
        iso: '',
        hipodromlar: [],
        activeHipId: null,
        vitrin: null
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function localTodayIso() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function isoToTr(iso) {
        if (!iso) return '';
        const p = iso.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function trToDisplay(tr) {
        if (!tr) return '';
        const p = tr.split('/');
        if (p.length !== 3) return tr;
        return p[0] + '.' + p[1] + '.' + p[2];
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pistBadgeClass(pist) {
        const p = (pist || '').toLowerCase();
        if (p.includes('çim') || p.includes('cim')) return 'pub-badge-grass';
        if (p.includes('kum')) return 'pub-badge-dirt';
        return 'pub-badge-synth';
    }

    function buildPlaceholderTahminler(race) {
        if (!race.horses || !race.horses.length) return [];
        return race.horses.slice(0, 3).map((h, i) => ({
            rank: i + 1,
            horseNo: h.no,
            horseName: h.name,
            pct: null,
            label: 'Program'
        }));
    }

    function getRaceTahminler(race) {
        if (race.tahminler && race.tahminler.length) return race.tahminler;
        return buildPlaceholderTahminler(race);
    }

    function formatTahminPicks(tahminler) {
        if (!tahminler || !tahminler.length) return '—';
        return tahminler.slice(0, 4).map((t) => t.horseNo || '?').join(' / ');
    }

    async function loadVitrin(iso) {
        const raceList = $('#pubRaceList');
        const hipTabs = $('#pubHipTabs');
        raceList.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Program yükleniyor…</div>';
        hipTabs.innerHTML = '';

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 30000);
            const res = await fetch('/api/public/vitrin?iso=' + encodeURIComponent(iso), {
                signal: controller.signal
            });
            clearTimeout(tid);
            const data = await res.json();

            state.iso = iso;
            state.tarih = data.tarih || isoToTr(iso);
            state.hipodromlar = data.hipodromlar || [];
            state.vitrin = data;

            $('#pubDateLabel').textContent = data.yayinli
                ? trToDisplay(state.tarih) + ' · ' + state.hipodromlar.length + ' hipodrom yayında'
                : trToDisplay(state.tarih) + ' · Program henüz yayınlanmadı';

            if (!data.yayinli || !state.hipodromlar.length) {
                hipTabs.innerHTML = '';
                $('#pubHipInfo').style.display = 'none';
                raceList.innerHTML = '<div class="pub-empty">'
                    + '<div class="pub-empty-icon">📅</div>'
                    + '<h3>Program henüz hazır değil</h3>'
                    + '<p>Bu tarih için yayınlanmış program bulunamadı.<br>'
                    + 'Programlar genellikle bir gün önceden yüklenir.</p>'
                    + '</div>';
                renderTahminPanel(null);
                return;
            }

            renderHipodromTabs();
            const first = state.hipodromlar[0];
            selectHipodrom(first.id);
        } catch (err) {
            raceList.innerHTML = '<div class="pub-empty">'
                + '<div class="pub-empty-icon">⚠️</div>'
                + '<h3>Yükleme hatası</h3>'
                + '<p>' + escapeHtml(err.message || 'Bağlantı kurulamadı') + '</p>'
                + '</div>';
        }
    }

    function renderHipodromTabs() {
        const el = $('#pubHipTabs');
        el.innerHTML = state.hipodromlar.map((h) => {
            const saat = h.ilkKosuSaat ? '1. Koşu — ' + h.ilkKosuSaat : h.kosuSayisi + ' koşu';
            return '<button type="button" class="pub-hip-tab" data-id="' + escapeHtml(h.id) + '" role="tab">'
                + escapeHtml(h.name) + '<small>' + escapeHtml(saat) + '</small></button>';
        }).join('');

        el.querySelectorAll('.pub-hip-tab').forEach((btn) => {
            btn.addEventListener('click', () => selectHipodrom(btn.dataset.id));
        });
    }

    function selectHipodrom(id) {
        state.activeHipId = id;
        $$('.pub-hip-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
        const hip = state.hipodromlar.find((h) => h.id === id);
        if (!hip) return;

        const info = $('#pubHipInfo');
        info.style.display = 'flex';
        info.innerHTML = '<strong>' + escapeHtml(hip.name) + ' Hipodromu</strong>'
            + '<span class="pub-weather"><span>🏇 ' + hip.kosuSayisi + ' koşu</span>'
            + (hip.ilkKosuSaat ? '<span>⏰ İlk koşu ' + escapeHtml(hip.ilkKosuSaat) + '</span>' : '')
            + '</span>';

        renderRaceList(hip);
        renderTahminPanel(hip);
    }

    function renderRaceList(hip) {
        const el = $('#pubRaceList');
        const kosular = hip.kosular || [];
        if (!kosular.length) {
            el.innerHTML = '<div class="pub-empty"><h3>Koşu bulunamadı</h3></div>';
            return;
        }

        el.innerHTML = kosular.map((race) => {
            const tahminler = getRaceTahminler(race);
            const pistCls = pistBadgeClass(race.pist);
            const mesafeBadge = race.mesafe
                ? '<span class="pub-badge ' + pistCls + '">' + escapeHtml(race.mesafe + ' ' + (race.pist || '')) + '</span>'
                : '';
            const tahminBadge = tahminler.length
                ? '<span class="pub-badge pub-badge-tahmin">Tahmin</span>'
                : '';

            return '<article class="pub-race-card" data-race="' + race.raceNo + '">'
                + '<div class="pub-race-no"><strong>' + race.raceNo + '. KOŞU</strong>'
                + '<span>' + escapeHtml(race.saat || '—') + '</span></div>'
                + '<div class="pub-race-desc"><h3>' + escapeHtml(race.baslik || (race.raceNo + '. Koşu')) + '</h3>'
                + '<div class="pub-race-badges">' + mesafeBadge + tahminBadge + '</div></div>'
                + '<div class="pub-race-tahmin"><strong>Öne çıkan</strong>'
                + '<div class="pub-tahmin-picks">' + formatTahminPicks(tahminler) + '</div></div>'
                + '<div class="pub-race-chevron">›</div>'
                + '</article>';
        }).join('');

        el.querySelectorAll('.pub-race-card').forEach((card) => {
            card.addEventListener('click', () => {
                switchTab('tahminler');
                const raceNo = card.dataset.race;
                const target = document.querySelector('[data-tahmin-race="' + raceNo + '"]');
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function renderTahminPanel(hip) {
        const el = $('#pubTahminContent');
        if (!hip || !hip.kosular || !hip.kosular.length) {
            el.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">🎯</div>'
                + '<h3>Tahmin yok</h3><p>Seçili hipodrom için tahmin gösterilemiyor.</p></div>';
            return;
        }

        el.innerHTML = hip.kosular.map((race) => {
            const tahminler = getRaceTahminler(race);
            const rows = tahminler.length
                ? tahminler.map((t) => '<tr>'
                    + '<td><span class="pub-tahmin-rank">' + t.rank + '</span></td>'
                    + '<td><strong>' + escapeHtml(t.horseNo) + '</strong></td>'
                    + '<td>' + escapeHtml(t.horseName) + '</td>'
                    + '<td class="pub-tahmin-pct">' + (t.pct != null ? '%' + t.pct : '—') + '</td>'
                    + '<td>' + escapeHtml(t.label || '') + '</td>'
                    + '</tr>').join('')
                : '<tr><td colspan="5" style="text-align:center;color:#888">Tahmin hazırlanıyor</td></tr>';

            const atRows = (race.horses || []).slice(0, 8).map((h) =>
                '<tr><td>' + escapeHtml(h.no) + '</td><td>' + escapeHtml(h.name) + '</td>'
                + '<td>' + escapeHtml(h.hp || '—') + '</td><td>' + escapeHtml(h.siklet || '—') + '</td></tr>'
            ).join('');

            return '<div class="pub-tahmin-card" data-tahmin-race="' + race.raceNo + '">'
                + '<div class="pub-tahmin-card-hdr">' + race.raceNo + '. Koşu'
                + (race.saat ? ' · ' + escapeHtml(race.saat) : '')
                + (race.mesafe ? ' · ' + escapeHtml(race.mesafe + ' ' + (race.pist || '')) : '')
                + '</div>'
                + '<table class="pub-tahmin-table"><thead><tr>'
                + '<th>#</th><th>No</th><th>At</th><th>Skor</th><th>Kaynak</th></tr></thead><tbody>'
                + rows + '</tbody></table>'
                + (atRows ? '<div style="padding:8px 16px 12px;font-size:11px;color:#888;font-weight:700">PROGRAM</div>'
                + '<table class="pub-tahmin-table"><thead><tr><th>No</th><th>At</th><th>HP</th><th>Sıklet</th></tr></thead><tbody>'
                + atRows + '</tbody></table>' : '')
                + '</div>';
        }).join('');
    }

    function switchTab(panelId) {
        $$('.pub-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === panelId));
        $$('.pub-tab-panel').forEach((p) => {
            const pid = p.id.replace(/^panel-/, '');
            p.classList.toggle('active', pid === panelId);
        });
        if (panelId === 'tahminler') {
            const el = document.getElementById('panel-tahminler');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }

    function initTabs() {
        $$('.pub-tab').forEach((tab) => {
            tab.addEventListener('click', () => switchTab(tab.dataset.panel));
        });
        $('#sidebarTahminLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('tahminler');
        });
    }

    function initDate() {
        const input = $('#pubDateInput');
        const iso = localTodayIso();
        input.value = iso;
        input.addEventListener('change', () => loadVitrin(input.value));
        loadVitrin(iso);
    }

    initTabs();
    initDate();
})();
