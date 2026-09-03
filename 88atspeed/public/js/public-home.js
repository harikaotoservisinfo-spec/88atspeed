(function() {
    'use strict';

    const state = {
        tarih: '',
        iso: '',
        hipodromlar: [],
        activeHipId: null,
        vitrin: null,
        muhtemeller: null,
        muhtIso: null,
        muhtHipKey: null,
        muhtKosuNo: null,
        muhtRaceCache: {},
        muhtRaceLoading: false,
        muhtAutoRefresh: true,
        muhtRefreshSec: 15,
        muhtCountdown: 15,
        muhtLastUpdate: null,
        muhtPrevOdds: {},
        muhtSelectedNo: null,
        muhtSelectRunKey: null
    };

    const MUHT_REFRESH_SEC = 15;
    const MUHT_SELECT_RESET_MS = 30000;
    const TJK_TV_HLS = 'https://tjktv-live.tjk.org/tjktv.m3u8';
    let muhtPollTimer = null;
    let muhtSelectTimer = null;
    let tjkTvLoaded = false;
    let tjkHls = null;

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
        if (panelId === 'muhtemeller') {
            ensureTjkTvEmbed();
            const iso = state.iso || localTodayIso();
            if (!state.muhtemeller || state.muhtIso !== iso) {
                loadMuhtemeller(iso);
            } else {
                startMuhtPolling();
            }
        } else {
            stopMuhtPolling();
            destroyTjkTv();
        }
    }

    function showTjkTvFallback() {
        const fb = document.getElementById('pubTjkTvFallback');
        const video = document.getElementById('pubTjkTvVideo');
        if (fb) fb.hidden = false;
        if (video) video.style.display = 'none';
    }

    function destroyTjkTv() {
        if (tjkHls) {
            tjkHls.destroy();
            tjkHls = null;
        }
        const video = document.getElementById('pubTjkTvVideo');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.style.display = '';
        }
        const fb = document.getElementById('pubTjkTvFallback');
        if (fb) fb.hidden = true;
        tjkTvLoaded = false;
    }

    function ensureTjkTvEmbed() {
        const video = document.getElementById('pubTjkTvVideo');
        if (!video || tjkTvLoaded) return;
        tjkTvLoaded = true;

        const tryPlay = () => video.play().catch(() => {});

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = TJK_TV_HLS;
            video.addEventListener('loadedmetadata', tryPlay, { once: true });
            video.addEventListener('error', showTjkTvFallback, { once: true });
            return;
        }

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            tjkHls = new Hls({ enableWorker: true, lowLatencyMode: true });
            tjkHls.loadSource(TJK_TV_HLS);
            tjkHls.attachMedia(video);
            tjkHls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
            tjkHls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data.fatal) showTjkTvFallback();
            });
            return;
        }

        showTjkTvFallback();
    }

    function formatClock(d) {
        if (!d) return '—';
        const dt = d instanceof Date ? d : new Date(d);
        return dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function updateMuhtToolbar(isLive) {
        const liveBadge = $('#pubMuhtLiveBadge');
        const updated = $('#pubMuhtUpdated');
        const countdown = $('#pubMuhtCountdown');
        if (liveBadge) liveBadge.hidden = !isLive;
        if (updated) {
            updated.textContent = state.muhtLastUpdate
                ? 'Güncellendi: ' + formatClock(state.muhtLastUpdate)
                : '—';
        }
        if (countdown) {
            countdown.textContent = state.muhtAutoRefresh ? state.muhtCountdown + 's' : 'kapalı';
        }
    }

    function startMuhtPolling() {
        stopMuhtPolling();
        if (!state.muhtAutoRefresh) return;
        if (!$('#panel-muhtemeller')?.classList.contains('active')) return;
        state.muhtCountdown = MUHT_REFRESH_SEC;
        updateMuhtToolbar(isCurrentRaceOpen());
        muhtPollTimer = setInterval(() => {
            if (document.hidden) return;
            if (!state.muhtAutoRefresh) return;
            state.muhtCountdown -= 1;
            updateMuhtToolbar(isCurrentRaceOpen());
            if (state.muhtCountdown <= 0) {
                state.muhtCountdown = MUHT_REFRESH_SEC;
                silentRefreshCurrentRace();
            }
        }, 1000);
    }

    function stopMuhtPolling() {
        if (muhtPollTimer) {
            clearInterval(muhtPollTimer);
            muhtPollTimer = null;
        }
    }

    function isCurrentRaceOpen() {
        const data = state.muhtemeller;
        if (!data || !state.muhtHipKey || !state.muhtKosuNo) return false;
        const hip = data.hipodromlar.find((h) => h.key === state.muhtHipKey);
        const kosu = (hip?.kosular || []).find((k) => String(k.NO) === String(state.muhtKosuNo));
        if (kosu?.DURUM === 'AÇIK') return true;
        const cacheKey = (state.muhtIso || state.iso) + ':' + state.muhtHipKey + '-' + state.muhtKosuNo;
        return !!state.muhtRaceCache[cacheKey]?.muhtemel?.isOpen;
    }

    function getCurrentRunKey() {
        if (!state.muhtHipKey || !state.muhtKosuNo) return '';
        return state.muhtHipKey + '-' + state.muhtKosuNo;
    }

    function collectOddsMap(muht) {
        const map = {};
        (muht?.bahisler || []).forEach((bet) => {
            (bet.muhtemeller || []).forEach((row) => {
                const key = bet.B + '|' + (row.S1 || '') + '|' + (row.S2 || '') + '|' + (row.T || '');
                map[key] = row.G;
            });
        });
        return map;
    }

    function parseOdd(val) {
        const v = parseFloat(String(val || '').replace(',', '.'));
        return isNaN(v) || v <= 0 ? null : v;
    }

    function findLeaderHorseNo(bahisler) {
        const ganyanBet = (bahisler || []).find((b) => b.isGanyan || b.B === 'GANYAN');
        if (!ganyanBet?.muhtemeller?.length) return null;
        let leaderNo = null;
        let minOdd = Infinity;
        ganyanBet.muhtemeller.forEach((row) => {
            const v = parseOdd(row.G);
            if (v != null && v < minOdd) {
                minOdd = v;
                leaderNo = String(row.S1);
            }
        });
        return leaderNo;
    }

    function comboIncludesHorse(row, horseNo) {
        if (!horseNo) return false;
        return String(row.S1) === horseNo || String(row.S2) === horseNo;
    }

    function clearMuhtUserSelection() {
        state.muhtSelectedNo = null;
        state.muhtSelectRunKey = null;
        if (muhtSelectTimer) {
            clearTimeout(muhtSelectTimer);
            muhtSelectTimer = null;
        }
    }

    function isMuhtUserPick() {
        return !!(state.muhtSelectedNo && state.muhtSelectRunKey === getCurrentRunKey());
    }

    function getMuhtHighlightNo(bahisler) {
        if (isMuhtUserPick()) return state.muhtSelectedNo;
        return findLeaderHorseNo(bahisler);
    }

    function scheduleMuhtSelectReset() {
        if (muhtSelectTimer) clearTimeout(muhtSelectTimer);
        muhtSelectTimer = setTimeout(() => {
            muhtSelectTimer = null;
            state.muhtSelectedNo = null;
            state.muhtSelectRunKey = null;
            refreshMuhtHighlightUI();
        }, MUHT_SELECT_RESET_MS);
    }

    function selectMuhtHorse(horseNo) {
        if (!horseNo) return;
        state.muhtSelectedNo = String(horseNo);
        state.muhtSelectRunKey = getCurrentRunKey();
        scheduleMuhtSelectReset();
        refreshMuhtHighlightUI();
    }

    function refreshMuhtHighlightUI() {
        const cacheKey = (state.muhtIso || state.iso || localTodayIso()) + ':' + getCurrentRunKey();
        const cached = state.muhtRaceCache[cacheKey];
        if (!cached?.muhtemel) return;
        showMuhtemelRace(cached);
    }

    function bindMuhtGanyanClicks() {
        $('#pubMuhtContent')?.querySelectorAll('.pub-muht-ganyan-row').forEach((tr) => {
            tr.addEventListener('click', () => {
                const horseNo = tr.dataset.horseNo;
                if (horseNo) selectMuhtHorse(horseNo);
            });
        });
    }

    function showMuhtemelRace(cached, flashKeys) {
        const content = $('#pubMuhtContent');
        if (!content || !cached?.muhtemel) return;
        content.innerHTML = renderMuhtemelRaceBody(cached.muhtemel, flashKeys);
        bindMuhtGanyanClicks();
        updateMuhtToolbar(isCurrentRaceOpen());
    }

    function renderMuhtemelBetPanel(bet, flashKeys, highlightNo, userPick) {
        const isOpen = (bet.D || '').toUpperCase() === 'AÇIK';
        const cnt = (bet.muhtemeller || []).length;
        const isGanyan = bet.isGanyan || bet.B === 'GANYAN';
        const colCls = isGanyan ? ' pub-muht-col-ganyan' : ' pub-muht-col-combo';

        let html = '<div class="pub-muht-bet-section' + colCls + '">'
            + '<div class="pub-muht-bet-status' + (isOpen ? ' open' : '') + '">'
            + '<span>' + escapeHtml(bet.B) + ' <em class="pub-muht-bet-cnt">' + cnt + '</em></span>'
            + '<span>' + escapeHtml(bet.D || '') + '</span></div>'
            + '<div class="pub-muht-table-wrap">';

        if (isGanyan) {
            html += '<table class="pub-muht-table pub-muht-table-ganyan"><thead><tr>'
                + '<th>#</th><th>At</th><th>G</th><th>S</th></tr></thead><tbody>';
            (bet.muhtemeller || []).forEach((row) => {
                const horseNo = String(row.S1);
                const isHighlight = highlightNo && horseNo === highlightNo;
                const oddKey = bet.B + '|' + (row.S1 || '') + '||';
                const flash = flashKeys?.[oddKey] || '';
                const atAd = row.atAdi || row.T || '';
                const rowCls = isHighlight
                    ? (userPick ? 'pub-muht-pick-row pub-muht-ganyan-row' : 'pub-muht-leader-row pub-muht-ganyan-row')
                    : 'pub-muht-ganyan-row';
                html += '<tr class="' + rowCls + '" data-horse-no="' + escapeHtml(horseNo) + '" data-odd-key="' + escapeHtml(oddKey) + '" title="' + escapeHtml(atAd) + '">'
                    + '<td><span class="pub-muht-no-sm' + (isHighlight ? (userPick ? ' pub-muht-pick-no' : ' pub-muht-leader-no') : '') + '">' + escapeHtml(row.S1) + '</span></td>'
                    + '<td class="pub-muht-at-cell' + (isHighlight ? (userPick ? ' pub-muht-pick-at' : ' pub-muht-leader-at') : '') + '">' + escapeHtml(atAd) + '</td>'
                    + '<td class="pub-muht-ganyan' + flash + (isHighlight ? (userPick ? ' pub-muht-pick-odd' : ' pub-muht-leader-odd') : '') + '">' + escapeHtml(row.G || '—') + '</td>'
                    + '<td class="pub-muht-sira">' + escapeHtml(row.R || '—') + '</td></tr>';
            });
            html += '</tbody></table>';
        } else {
            html += '<table class="pub-muht-table pub-muht-table-combo"><thead><tr><th>Komb.</th><th>Oran</th></tr></thead><tbody>';
            (bet.muhtemeller || []).forEach((row) => {
                const isLinked = comboIncludesHorse(row, highlightNo);
                const oddKey = bet.B + '|' + (row.S1 || '') + '|' + (row.S2 || '') + '|';
                const flash = flashKeys?.[oddKey] || '';
                const label = (row.S1 && row.S2) ? (row.S1 + '-' + row.S2) : (row.T || '—');
                const full = row.T || label;
                const rowCls = isLinked ? (userPick ? 'pub-muht-pick-row' : 'pub-muht-linked-row') : '';
                const cellCls = isLinked ? (userPick ? ' pub-muht-pick-cell' : ' pub-muht-linked-cell') : '';
                html += '<tr class="' + rowCls + '" data-odd-key="' + escapeHtml(oddKey) + '" title="' + escapeHtml(full) + '">'
                    + '<td class="pub-muht-komb' + cellCls + '">' + escapeHtml(label) + '</td>'
                    + '<td class="pub-muht-ganyan' + flash + cellCls + '">' + escapeHtml(row.G || '—') + '</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div></div>';
        return html;
    }

    function renderMuhtemelRaceBody(muht, flashKeys) {
        const bahisler = muht.bahisler || [];
        if (!bahisler.length) {
            return '<div class="pub-empty"><p>Bu koşu için muhtemel verisi yok.</p></div>';
        }

        const leaderNo = findLeaderHorseNo(bahisler);
        const userPick = isMuhtUserPick();
        const highlightNo = getMuhtHighlightNo(bahisler);
        const title = escapeHtml(muht.key) + ' · ' + muht.no + '. Koşu';
        const sub = [muht.pist, muht.saat].filter(Boolean).join(' · ');

        let badge = '';
        if (userPick && highlightNo) {
            badge = '<span class="pub-muht-pick-badge">Seçili #' + escapeHtml(highlightNo) + '</span>';
        } else if (leaderNo) {
            badge = '<span class="pub-muht-fav-badge">★ Favori #' + escapeHtml(leaderNo) + '</span>';
        }

        let html = '<div class="pub-muht-race-card" data-leader-no="' + escapeHtml(leaderNo || '') + '">'
            + '<div class="pub-muht-race-top">'
            + '<div class="pub-muht-race-title"><strong>' + title + '</strong>'
            + (sub ? '<span>' + escapeHtml(sub) + '</span>' : '') + '</div>'
            + '<div class="pub-muht-race-meta">'
            + '<span class="pub-badge ' + pistBadgeClass(muht.pist) + '">' + escapeHtml(muht.pist || '') + '</span>'
            + '<span class="pub-muht-durum pub-muht-durum-' + (muht.isOpen ? 'acik' : 'resmi') + '">' + escapeHtml(muht.durum || '') + '</span>'
            + badge
            + '</div></div>';

        html += '<div class="pub-muht-bet-board">';
        bahisler.forEach((bet) => { html += renderMuhtemelBetPanel(bet, flashKeys, highlightNo, userPick); });
        html += '</div></div>';

        return html;
    }

    function computeFlashKeys(prevOdds, nextOdds) {
        const flash = {};
        Object.keys(nextOdds).forEach((key) => {
            const oldV = parseFloat(String(prevOdds[key] || '').replace(',', '.'));
            const newV = parseFloat(String(nextOdds[key] || '').replace(',', '.'));
            if (!isNaN(oldV) && !isNaN(newV) && oldV !== newV) {
                flash[key] = newV > oldV ? ' pub-muht-flash-up' : ' pub-muht-flash-down';
            }
        });
        return flash;
    }

    function renderMuhtemelContent(cached, opts) {
        const content = $('#pubMuhtContent');
        if (!content) return;
        const flashKeys = opts?.flashKeys || null;
        if (cached?.error) {
            content.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">⚠️</div>'
                + '<h3>Koşu yüklenemedi</h3><p>' + escapeHtml(cached.error) + '</p>'
                + '<button type="button" class="pub-btn pub-btn-white" id="pubMuhtRaceRetry" style="margin-top:12px">Tekrar dene</button></div>';
            $('#pubMuhtRaceRetry')?.addEventListener('click', () => {
                const iso = state.muhtIso || state.iso || localTodayIso();
                delete state.muhtRaceCache[iso + ':' + getCurrentRunKey()];
                loadMuhtemelRace(getCurrentRunKey(), iso);
            });
            return;
        }
        if (cached?.muhtemel) {
            showMuhtemelRace(cached, flashKeys);
            return;
        }
        content.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Koşu muhtemelleri yükleniyor…</div>';
    }

    function renderMuhtemeller() {
        const data = state.muhtemeller;
        const hipTabs = $('#pubMuhtHipTabs');
        const kosuTabs = $('#pubMuhtKosuTabs');
        const content = $('#pubMuhtContent');
        const label = $('#pubMuhtLabel');

        if (!data || !data.hipodromlar?.length) {
            hipTabs.innerHTML = '';
            kosuTabs.innerHTML = '';
            content.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">💰</div>'
                + '<h3>Muhtemel bulunamadı</h3><p>Bu tarih için TJK muhtemel verisi yok.</p></div>';
            return;
        }

        label.textContent = trToDisplay(data.tarih) + ' · TJK resmi muhtemeller'
            + (data.guncelleme ? ' · ' + data.guncelleme : '');

        if (!state.muhtHipKey) state.muhtHipKey = data.hipodromlar[0].key;
        const hip = data.hipodromlar.find((h) => h.key === state.muhtHipKey) || data.hipodromlar[0];
        state.muhtHipKey = hip.key;

        hipTabs.innerHTML = data.hipodromlar.map((h) => {
            const sel = h.key === state.muhtHipKey;
            const cnt = (h.kosular || []).length;
            return '<button type="button" class="pub-hip-tab' + (sel ? ' active' : '') + '" data-muht-hip="' + escapeHtml(h.key) + '">'
                + escapeHtml(h.yer || h.key) + '<small>' + cnt + ' koşu</small></button>';
        }).join('');

        hipTabs.querySelectorAll('[data-muht-hip]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.muhtHipKey = btn.dataset.muhtHip;
                state.muhtKosuNo = null;
                clearMuhtUserSelection();
                stopMuhtPolling();
                renderMuhtemeller();
            });
        });

        const kosular = hip.kosular || [];
        if (!state.muhtKosuNo && kosular.length) {
            state.muhtKosuNo = hip.selected || kosular[0].NO;
        }
        kosuTabs.innerHTML = kosular.map((k) => {
            const no = k.NO;
            const sel = String(no) === String(state.muhtKosuNo);
            const durumCls = k.DURUM === 'AÇIK' ? ' pub-muht-open' : '';
            return '<button type="button" class="pub-muht-kosu-btn' + (sel ? ' active' : '') + durumCls + '" data-muht-kosu="' + escapeHtml(no) + '">'
                + no + '. Koşu <small>' + escapeHtml(k.SAAT || '') + ' · ' + escapeHtml(k.PIST || '') + '</small></button>';
        }).join('');

        kosuTabs.querySelectorAll('[data-muht-kosu]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.muhtKosuNo = btn.dataset.muhtKosu;
                clearMuhtUserSelection();
                stopMuhtPolling();
                renderMuhtemeller();
            });
        });

        const runKey = getCurrentRunKey();
        const iso = state.muhtIso || state.iso || localTodayIso();
        const cacheKey = iso + ':' + runKey;
        const cached = state.muhtRaceCache[cacheKey];

        if (state.muhtRaceLoading && !cached) {
            renderMuhtemelContent(null);
            return;
        }
        renderMuhtemelContent(cached);
        if (!cached && runKey) {
            loadMuhtemelRace(runKey, iso);
        } else if (cached?.muhtemel) {
            startMuhtPolling();
        }
    }

    async function silentRefreshCurrentRace() {
        const runKey = getCurrentRunKey();
        const iso = state.muhtIso || state.iso || localTodayIso();
        if (!runKey || !$('#panel-muhtemeller')?.classList.contains('active')) return;

        const btn = $('#pubMuhtRefreshBtn');
        btn?.classList.add('is-syncing');
        const cacheKey = iso + ':' + runKey;
        const prev = state.muhtRaceCache[cacheKey]?.muhtemel;
        const prevOdds = prev ? collectOddsMap(prev) : state.muhtPrevOdds[cacheKey] || {};

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 30000);
            const res = await fetch(
                '/api/public/muhtemeller?iso=' + encodeURIComponent(iso)
                + '&kosu=' + encodeURIComponent(runKey) + '&refresh=1',
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success || !data.muhtemel) return;

            const nextOdds = collectOddsMap(data.muhtemel);
            const flashKeys = computeFlashKeys(prevOdds, nextOdds);
            state.muhtRaceCache[cacheKey] = data;
            state.muhtPrevOdds[cacheKey] = nextOdds;
            state.muhtLastUpdate = new Date();
            renderMuhtemelContent(data, { flashKeys });
        } catch (_err) {
            /* sessiz yenileme — hata gösterme */
        } finally {
            btn?.classList.remove('is-syncing');
            state.muhtCountdown = MUHT_REFRESH_SEC;
            updateMuhtToolbar(isCurrentRaceOpen());
        }
    }

    async function loadMuhtemelRace(runKey, iso, force) {
        if (!runKey) return;
        const cacheKey = iso + ':' + runKey;
        if (!force && state.muhtRaceCache[cacheKey]) {
            renderMuhtemeller();
            return;
        }
        state.muhtRaceLoading = true;
        renderMuhtemeller();
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 50000);
            const res = await fetch(
                '/api/public/muhtemeller?iso=' + encodeURIComponent(iso) + '&kosu=' + encodeURIComponent(runKey)
                + (force ? '&refresh=1' : ''),
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Yükleme hatası');
            state.muhtRaceCache[cacheKey] = data;
            if (data.muhtemel) {
                state.muhtPrevOdds[cacheKey] = collectOddsMap(data.muhtemel);
                state.muhtLastUpdate = new Date();
            }
        } catch (err) {
            state.muhtRaceCache[cacheKey] = {
                error: err.name === 'AbortError' ? 'İstek zaman aşımına uğradı' : (err.message || 'Yüklenemedi')
            };
        } finally {
            state.muhtRaceLoading = false;
            renderMuhtemeller();
            startMuhtPolling();
        }
    }

    async function loadMuhtemeller(iso) {
        const hipTabs = $('#pubMuhtHipTabs');
        const kosuTabs = $('#pubMuhtKosuTabs');
        const content = $('#pubMuhtContent');
        hipTabs.innerHTML = '';
        kosuTabs.innerHTML = '';
        content.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Program listesi yükleniyor…</div>';
        $('#pubMuhtLabel').textContent = 'TJK muhtemel programı yükleniyor…';
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 25000);
            const res = await fetch('/api/public/muhtemeller?iso=' + encodeURIComponent(iso), {
                signal: controller.signal
            });
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Yükleme hatası');
            state.muhtemeller = data;
            state.muhtIso = iso;
            state.muhtHipKey = null;
            state.muhtKosuNo = null;
            state.muhtRaceCache = {};
            state.muhtLastUpdate = null;
            clearMuhtUserSelection();
            renderMuhtemeller();
            startMuhtPolling();
        } catch (err) {
            const msg = err.name === 'AbortError' ? 'TJK yanıt vermedi (zaman aşımı)' : (err.message || 'Bağlantı hatası');
            content.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">⚠️</div>'
                + '<h3>Muhtemel listesi yüklenemedi</h3><p>' + escapeHtml(msg) + '</p>'
                + '<button type="button" class="pub-btn pub-btn-white" id="pubMuhtRetry" style="margin-top:12px">Tekrar dene</button></div>';
            $('#pubMuhtRetry')?.addEventListener('click', () => {
                state.muhtemeller = null;
                loadMuhtemeller(iso);
            });
        }
    }

    function initMuhtControls() {
        $('#pubMuhtAutoRefresh')?.addEventListener('change', (e) => {
            state.muhtAutoRefresh = e.target.checked;
            if (state.muhtAutoRefresh) {
                state.muhtCountdown = MUHT_REFRESH_SEC;
                startMuhtPolling();
            } else {
                stopMuhtPolling();
            }
            updateMuhtToolbar(isCurrentRaceOpen());
        });
        $('#pubMuhtRefreshBtn')?.addEventListener('click', () => {
            state.muhtCountdown = MUHT_REFRESH_SEC;
            silentRefreshCurrentRace();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopMuhtPolling();
            } else if ($('#panel-muhtemeller')?.classList.contains('active')) {
                startMuhtPolling();
            }
        });
    }

    function initTabs() {
        $$('.pub-tab').forEach((tab) => {
            tab.addEventListener('click', () => switchTab(tab.dataset.panel));
        });
        $('#sidebarTahminLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('tahminler');
        });
        $('#sidebarMuhtLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('muhtemeller');
        });
    }

    function initDate() {
        const input = $('#pubDateInput');
        const iso = localTodayIso();
        input.value = iso;
        input.addEventListener('change', () => {
            state.iso = input.value;
            state.muhtemeller = null;
            state.muhtIso = null;
            state.muhtRaceCache = {};
            loadVitrin(input.value);
            if ($('#panel-muhtemeller')?.classList.contains('active')) {
                loadMuhtemeller(input.value);
            }
        });
        loadVitrin(iso);
    }

    initTabs();
    initMuhtControls();
    initDate();
})();
