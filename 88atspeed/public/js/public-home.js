(function() {
    'use strict';

    const state = {
        tarih: '',
        iso: '',
        hipodromlar: [],
        activeHipId: null,
        activeTahminHipId: null,
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
        muhtSelectRunKey: null,
        progGanyanByRace: {},
        progGanyanMuhtKey: null,
        progGanyanLoading: false,
        progBltData: null,
        progBltHipId: null,
        progGpData: null,
        progGpHipId: null,
        progGpLoading: false,
        progFobData: null,
        progFobHipId: null,
        progFobLoading: false,
        progFobMode: 'off',
        progBtData: null,
        progBtHipId: null,
        progBtLoading: false,
        sonucData: null,
        sonucByHip: {},
        sonucHipId: null,
        sonucLastUpdate: null,
        sonucLoading: false,
        yarinFetch: null,
        rehberData: null
    };

    const MUHT_REFRESH_SEC = 15;
    const PROG_GANYAN_REFRESH_SEC = 15;
    const PROG_BLT_REFRESH_SEC = 300;
    const PROG_GP_REFRESH_SEC = 300;
    const PROG_FOB_REFRESH_SEC = 60;
    const PROG_BT_REFRESH_SEC = 60;
    const SONUC_REFRESH_SEC = 60;
    const SONUC_CLIENT_CACHE_MS = 30 * 1000;
    const YARIN_STATUS_POLL_MS = 8000;
    const MUHT_SELECT_RESET_MS = 30000;
    const MUHT_RACE_ADVANCE_MS = 3 * 60 * 1000;
    const TJK_TV_DIRECT = 'https://tjktv-live.tjk.org/tjktv/tjktv.m3u8';
    const TJK_TV_PROXY = '/api/public/tjk-tv?f=tjktv.m3u8';
    let muhtPollTimer = null;
    let progGanyanPollTimer = null;
    let sonucPollTimer = null;
    let rehberPollTimer = null;
    let muhtSelectTimer = null;
    let tjkTvLoaded = false;
    let tjkHls = null;
    let tjkSourceIdx = 0;
    let tjkWatchdogTimer = null;
    let tjkStallTicks = 0;
    let yarinStatusTimer = null;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function localTodayIso() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function localTomorrowIso() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function clampProgramIso(iso) {
        const today = localTodayIso();
        const tomorrow = localTomorrowIso();
        if (!iso || iso < today) return today;
        if (iso > tomorrow) return tomorrow;
        return iso;
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

    function muhtRaceTopClass(pist) {
        const p = (pist || '').toLowerCase();
        if (p.includes('çim') || p.includes('cim')) return 'pub-muht-race-top-grass';
        if (p.includes('kum')) return 'pub-muht-race-top-dirt';
        return 'pub-muht-race-top-synth';
    }

    function muhtPistPillClass(pist) {
        const p = (pist || '').toLowerCase();
        if (p.includes('çim') || p.includes('cim')) return 'pub-muht-pill-grass';
        if (p.includes('kum')) return 'pub-muht-pill-dirt';
        return 'pub-muht-pill-synth';
    }

    function muhtDurumPillClass(isOpen) {
        return isOpen ? 'pub-muht-pill-open' : 'pub-muht-pill-closed';
    }

    function parseRaceDateTime(iso, saat) {
        if (!iso || !saat) return null;
        const m = String(saat).trim().match(/^(\d{1,2}):(\d{2})/);
        if (!m) return null;
        const parts = iso.split('-').map((n) => parseInt(n, 10));
        if (parts.length < 3 || parts.some((n) => isNaN(n))) return null;
        return new Date(parts[0], parts[1] - 1, parts[2], parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    }

    function getAutoMuhtKosuNo(kosular, iso) {
        if (!kosular?.length) return null;
        const now = Date.now();
        const sorted = [...kosular].sort((a, b) => Number(a.NO) - Number(b.NO));
        for (let i = 0; i < sorted.length; i++) {
            const raceTime = parseRaceDateTime(iso, sorted[i].SAAT);
            if (!raceTime) continue;
            if (now < raceTime.getTime() + MUHT_RACE_ADVANCE_MS) {
                return sorted[i].NO;
            }
        }
        return sorted[sorted.length - 1].NO;
    }

    function checkMuhtAutoAdvance() {
        if (!state.muhtemeller || !state.muhtHipKey) return;
        if (!$('#panel-muhtemeller')?.classList.contains('active')) return;
        const hip = state.muhtemeller.hipodromlar.find((h) => h.key === state.muhtHipKey);
        const kosular = hip?.kosular || [];
        if (!kosular.length) return;
        const iso = state.muhtIso || state.iso || localTodayIso();
        const autoNo = getAutoMuhtKosuNo(kosular, iso);
        if (!autoNo || String(autoNo) === String(state.muhtKosuNo)) return;
        state.muhtKosuNo = autoNo;
        clearMuhtUserSelection();
        renderMuhtemeller();
    }

    function getRaceTahminler(race) {
        if (Array.isArray(race.tahminler)) return race.tahminler;
        return [];
    }

    function formatTahminSkor(t) {
        if (t.pct != null && t.pct > 0) return '%' + t.pct;
        if (t.score != null && t.score > 0) return String(t.score);
        return '—';
    }

    function formatScoreCell(t) {
        if (!t || t.rank == null || t.pct == null || t.pct <= 0) return '—';
        return t.rank + '. %' + t.pct;
    }

    function getTahminScoreColumnDefs(kosular) {
        const all = [
            { key: 'score_tahmin', scoreKey: 'tahmin', label: 'TAHMİN', cls: 'pub-prog-score pub-prog-score-tahmin', colCls: 'pub-col-score pub-col-score-tahmin', title: '7 BAŞ+ boyut karışımı · dimension-tahmin motoru' },
            { key: 'score_r2', scoreKey: 'r2', label: 'R2', cls: 'pub-prog-score pub-prog-score-r2', colCls: 'pub-col-score pub-col-score-r2', title: 'Renk Puanlama Test · R2' },
            { key: 'score_mtr', scoreKey: 'mtr', label: 'MTR', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'Metrik Tarama · SON800-1 %10 · T9V %40' },
            { key: 'score_t9v', scoreKey: 't9v', label: 'T9V', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'T9V Tarama · T9V pay %40' },
            { key: 'score_asf', scoreKey: 'asf', label: 'ASF', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'At sayısı · Faktör · adaptive profil' },
            { key: 'score_g1side', scoreKey: 'g1side', label: 'G1↕', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'Gösterge 1 · tek metrik alt/üst' },
            { key: 'score_g1pair', scoreKey: 'g1pair', label: 'G1⇄', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'Gösterge 1 · çift yön' },
            { key: 'score_go', scoreKey: 'go', label: 'GÖ', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'Gösterge · tam puanlama motoru' },
            { key: 'score_hyb', scoreKey: 'hyb', label: 'HYB', cls: 'pub-prog-score pub-prog-score-ptest', colCls: 'pub-col-score pub-col-score-ptest', title: 'Hibrit TAHMİN' }
        ];
        const races = Array.isArray(kosular) ? kosular : (kosular?.kosular || []);
        const horses = races.flatMap((r) => r.horses || []);
        return all.filter((col) => horses.some((h) => {
            const t = h.scores?.[col.scoreKey];
            return t && t.rank != null && (t.pct != null || t.score != null);
        }));
    }

    function formatTahminPicks(tahminler) {
        if (!tahminler || !tahminler.length) return '—';
        return tahminler.slice(0, 4).map((t) => t.horseNo || '?').join(' / ');
    }

    function formatSyncTime(isoOrSql) {
        if (!isoOrSql) return '—';
        const d = new Date(isoOrSql);
        if (Number.isNaN(d.getTime())) return isoOrSql;
        return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function syncBadgeClass(durum, day) {
        if (durum === 'tam') return 'pub-program-sync-badge-ok';
        if (durum === 'kayitli' && day && !(day.eksik || []).length) return 'pub-program-sync-badge-ok';
        if (durum === 'eksik' || durum === 'kayitli') return 'pub-program-sync-badge-warn';
        return 'pub-program-sync-badge-empty';
    }

    function syncBadgeLabel(day) {
        const durum = day.durum;
        if (durum === 'tam') return 'Tamam';
        if (durum === 'kayitli' && !(day.eksik || []).length) return 'Tamam';
        if (durum === 'eksik') return 'Eksik';
        if (durum === 'kayitli') return 'Kayıtlı';
        if (durum === 'bos') return 'Boş';
        return durum || '—';
    }

    function formatSyncCountLabel(day) {
        const db = day.dbCount || 0;
        const tjk = day.tjkDomesticCount || 0;
        const eksik = day.eksik || [];
        const fazla = day.fazla || [];
        if (!tjk) return db + ' hipodrom kayıtlı';
        if (eksik.length) return db + '/' + tjk + ' hipodrom';
        if (fazla.length || db > tjk) return db + ' hipodrom kayıtlı';
        return db + '/' + tjk + ' hipodrom';
    }

    function renderProgramSyncDay(day) {
        const countLabel = formatSyncCountLabel(day);
        const kayitli = (day.kayitli || []).map((h) =>
            h.name + ' (' + h.kosuSayisi + ' koşu)'
        ).join(' · ') || '—';
        const eksik = (day.eksik || []).map((h) => h.name).join(', ');
        const fazla = (day.fazla || []).map((h) => h.name).join(', ');
        const eksikLine = eksik
            ? '<div class="pub-program-sync-meta" style="color:#e65100">TJK\'da var, bizde yok: <strong>' + escapeHtml(eksik) + '</strong></div>'
            : '';
        const fazlaLine = fazla
            ? '<div class="pub-program-sync-meta" style="color:#1565c0">DB\'de kayıtlı (TJK sekmesinde şu an görünmüyor): ' + escapeHtml(fazla) + '</div>'
            : '';
        const tjkWarn = day.tjkError
            ? '<div class="pub-program-sync-meta" style="color:#c62828">TJK kontrolü: ' + escapeHtml(day.tjkError) + '</div>'
            : '';
        return '<div class="pub-program-sync-day">'
            + '<div class="pub-program-sync-day-hdr">'
            + '<span class="pub-program-sync-day-title">' + escapeHtml(day.label || day.tarih) + '</span>'
            + '<span class="pub-program-sync-badge ' + syncBadgeClass(day.durum, day) + '">' + syncBadgeLabel(day) + '</span>'
            + '</div>'
            + '<div class="pub-program-sync-meta">' + escapeHtml(countLabel)
            + (day.lastFetch ? ' · Son çekim: ' + escapeHtml(formatSyncTime(day.lastFetch)) : '')
            + '</div>'
            + '<div class="pub-program-sync-hips">' + escapeHtml(kayitli) + '</div>'
            + eksikLine + fazlaLine + tjkWarn
            + '</div>';
    }

    function renderProgramSync(data) {
        const el = $('#pubProgramSyncBody');
        if (!el) return;
        if (!data || !data.success) {
            el.innerHTML = '<div class="pub-program-sync-meta">Durum alınamadı.</div>';
            return;
        }
        let html = '<div class="pub-program-sync-grid">'
            + renderProgramSyncDay({ ...data.today, label: 'Bugün · ' + (data.today.tarih || '') })
            + '</div>';
        if (data.lastRuns && data.lastRuns.length) {
            const last = data.lastRuns[0];
            html += '<div class="pub-program-sync-log">Son işlem: '
                + escapeHtml(formatSyncTime(last.startedAt))
                + ' · ' + escapeHtml(last.tarih)
                + ' · ' + (last.basarili || 0) + '/' + (last.hipodromSayisi || 0)
                + ' hipodrom (' + escapeHtml(last.trigger || 'cli') + ')</div>';
        }
        el.innerHTML = html;
    }

    async function loadProgramSync() {
        const el = $('#pubProgramSyncBody');
        if (!el) return;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch('/api/public/program-sync', { signal: controller.signal });
            clearTimeout(tid);
            const data = await res.json();
            renderProgramSync(data);
        } catch (err) {
            clearTimeout(tid);
            const msg = err.name === 'AbortError'
                ? 'Durum zaman aşımı (15 sn). Sunucu yoğun olabilir — ↻ ile tekrar deneyin.'
                : ('Bağlantı hatası: ' + (err.message || ''));
            el.innerHTML = '<div class="pub-program-sync-meta">' + escapeHtml(msg) + '</div>';
        }
    }

    async function parseJsonResponse(res) {
        const text = await res.text();
        if (!text) throw new Error('Sunucu boş yanıt döndü (HTTP ' + res.status + ')');
        try {
            return JSON.parse(text);
        } catch (_) {
            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
            throw new Error('Sunucu JSON yerine başka yanıt döndü (HTTP ' + res.status + '): ' + snippet);
        }
    }

    function isRetryableLoadError(err, res) {
        if (err?.name === 'AbortError') return true;
        const status = res?.status;
        if (status === 502 || status === 503 || status === 504) return true;
        const msg = err?.message || '';
        if (/aborted|network|fetch failed|failed to fetch/i.test(msg)) return true;
        if (/HTTP 502|HTTP 503|HTTP 504|Bad Gateway|Gateway Timeout/i.test(msg)) return true;
        return false;
    }

    function isTomorrowIso(iso) {
        return iso === localTomorrowIso();
    }

    function syncDatePills(iso) {
        const todayPill = $('#pubDatePillToday');
        const tomorrowPill = $('#pubDatePillTomorrow');
        const isTomorrow = isTomorrowIso(iso);
        todayPill?.classList.toggle('active', !isTomorrow);
        tomorrowPill?.classList.toggle('active', isTomorrow);
    }

    let vitrinAbortController = null;
    let vitrinLoadSeq = 0;

    function renderYarinFetchUi() {
        const bar = $('#gunun-kosulari');
        const statusLine = $('#pubYarinStatusLine');
        const tomorrowPill = $('#pubDatePillTomorrow');
        const badge = $('#pubYarinPillBadge');
        const hipTabs = $('#pubHipTabs');
        const f = state.yarinFetch || {};
        const isTomorrow = isTomorrowIso(state.iso);
        const yarinBusy = f.running || f.status === 'running' || f.status === 'pending';
        const ready = !!f.tahminReady;

        bar?.classList.remove('pub-date-bar-loading', 'pub-date-bar-ready');
        tomorrowPill?.classList.remove('pub-date-pill-loading', 'pub-date-pill-ready');
        hipTabs?.classList.remove('pub-hip-tabs-ready');

        if (yarinBusy) {
            tomorrowPill?.classList.add('pub-date-pill-loading');
            if (isTomorrow) {
                bar?.classList.add('pub-date-bar-loading');
            }
            if (badge) {
                badge.hidden = false;
                badge.innerHTML = '<span class="pub-yarin-spin" title="Yükleniyor"></span>';
            }
            if (statusLine) {
                const progress = (f.enrichTotal > 0)
                    ? (' (' + (f.enrichDone || 0) + '/' + f.enrichTotal + ' at)')
                    : '';
                const prefix = isTomorrow ? '' : 'Yarın: ';
                statusLine.hidden = false;
                statusLine.className = 'pub-yarin-status-line'
                    + (isTomorrow ? '' : ' pub-yarin-status-line-secondary');
                statusLine.innerHTML = '<span class="pub-yarin-spin"></span>'
                    + '<span>'
                    + prefix
                    + escapeHtml(f.message || 'yeni günün koşuları yükleniyor…')
                    + escapeHtml(progress)
                    + '</span>';
            }
        } else if (ready) {
            tomorrowPill?.classList.add('pub-date-pill-ready');
            if (badge) {
                badge.hidden = false;
                badge.textContent = '✓';
            }
            if (isTomorrow) {
                bar?.classList.add('pub-date-bar-ready');
                hipTabs?.classList.add('pub-hip-tabs-ready');
            }
            if (statusLine) {
                if (isTomorrow) {
                    statusLine.hidden = false;
                    statusLine.innerHTML = '✓ '
                        + escapeHtml(trToDisplay(f.yarinTarih || isoToTr(localTomorrowIso())))
                        + ' tam veri hazır · '
                        + (f.scoredHorses || 0) + '/' + (f.totalHorses || 0) + ' at skorlu';
                } else {
                    statusLine.hidden = true;
                    statusLine.innerHTML = '';
                }
            }
        } else {
            if (badge) {
                badge.hidden = true;
                badge.innerHTML = '';
            }
            if (statusLine) {
                statusLine.hidden = true;
                statusLine.innerHTML = '';
            }
        }
    }

    async function loadYarinFetchStatus() {
        try {
            const res = await fetch('/api/public/yarin-fetch-status');
            const data = await parseJsonResponse(res);
            if (!res.ok || data.success === false) return;
            const prevStatus = state.yarinFetch?.status;
            state.yarinFetch = data;
            renderYarinFetchUi();
            if (prevStatus === 'running' && data.tahminReady && isTomorrowIso(state.iso)) {
                loadVitrin(state.iso);
            }
        } catch (_) { /* */ }
    }

    function startYarinStatusPolling() {
        loadYarinFetchStatus();
        if (yarinStatusTimer) clearInterval(yarinStatusTimer);
        yarinStatusTimer = setInterval(loadYarinFetchStatus, YARIN_STATUS_POLL_MS);
    }

    async function loadVitrin(iso) {
        const raceList = $('#pubRaceList');
        const hipTabs = $('#pubHipTabs');
        const clampedIso = clampProgramIso(iso);
        const dateInput = $('#pubDateInput');
        if (dateInput && dateInput.value !== clampedIso) dateInput.value = clampedIso;

        const loadId = ++vitrinLoadSeq;
        if (vitrinAbortController) vitrinAbortController.abort();
        vitrinAbortController = new AbortController();

        raceList.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Program yükleniyor…</div>';
        hipTabs.innerHTML = '';

        const maxAttempts = 5;
        let lastErr = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (loadId !== vitrinLoadSeq) return;
            const signal = vitrinAbortController.signal;
            let res = null;
            try {
                const tid = setTimeout(() => vitrinAbortController?.abort(), 35000);
                res = await fetch('/api/public/vitrin?iso=' + encodeURIComponent(clampedIso), {
                    signal,
                    cache: 'no-store'
                });
                clearTimeout(tid);
                if (loadId !== vitrinLoadSeq) return;
            const data = await parseJsonResponse(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }

            state.iso = clampedIso;
            state.tarih = data.tarih || isoToTr(clampedIso);
            state.hipodromlar = data.hipodromlar || [];
            state.vitrin = data;

            $('#pubDateLabel').textContent = data.yayinli
                ? trToDisplay(state.tarih) + ' · ' + state.hipodromlar.length + ' hipodrom yayında'
                : trToDisplay(state.tarih) + ' · Program henüz yayınlanmadı';

            syncDatePills(clampedIso);
            renderYarinFetchUi();

            if (!data.yayinli || !state.hipodromlar.length) {
                hipTabs.innerHTML = '';
                $('#pubHipInfo').style.display = 'none';
                const pastNote = data.filtered === 'past_date'
                    ? '<p>Geçmiş günlere ait programlar gösterilmez.</p>'
                    : '';
                raceList.innerHTML = '<div class="pub-empty">'
                    + '<div class="pub-empty-icon">📅</div>'
                    + '<h3>Program henüz hazır değil</h3>'
                    + '<p>Bu tarih için yayınlanmış program bulunamadı.<br>'
                    + 'Sadece bugün ve yarın koşusu olan hipodromlar listelenir.</p>'
                    + pastNote
                    + '</div>';
                renderTahminPanel(null);
                return;
            }

            renderHipodromTabs();
            renderSonucHipTabs();
            selectHipodrom(state.hipodromlar[0].id);
            renderTahminAll();
            if ($('#panel-kosular')?.classList.contains('active')) {
                startProgramGanyanPolling();
            }
            if ($('#panel-rehber')?.classList.contains('active')) {
                loadRehberLeaderboard({ silent: true });
            }
            return;
            } catch (err) {
                lastErr = err;
                if (loadId !== vitrinLoadSeq) return;
                if (attempt < maxAttempts && isRetryableLoadError(err, res)) {
                    raceList.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>'
                        + 'Sunucu hazırlanıyor, yeniden deneniyor (' + (attempt + 1) + '/' + maxAttempts + ')…</div>';
                    await new Promise((r) => setTimeout(r, 2000 * attempt));
                    vitrinAbortController = new AbortController();
                    continue;
                }
                break;
            }
        }

        if (loadId !== vitrinLoadSeq) return;
        const msg = lastErr?.name === 'AbortError'
            ? 'Sunucu yanıt vermedi. Arka planda veri çekimi sürüyor olabilir — birkaç saniye sonra tekrar deneyin.'
            : (lastErr?.message || 'Bağlantı kurulamadı');
        raceList.innerHTML = '<div class="pub-empty">'
            + '<div class="pub-empty-icon">⚠️</div>'
            + '<h3>Yükleme hatası</h3>'
            + '<p>' + escapeHtml(msg) + '</p>'
            + '<p><button type="button" class="pub-btn-retry" id="pubVitrinRetry">Tekrar dene</button></p>'
            + '</div>';
        $('#pubVitrinRetry')?.addEventListener('click', () => loadVitrin(clampedIso));
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
        refreshProgramGanyanOdds();
        if (state.progBltHipId !== hip.id || !state.progBltData) {
            refreshProgramBltData();
        }
        if (state.progGpHipId !== hip.id || !state.progGpData) {
            refreshProgramGpData();
        }
        if (state.progFobMode !== 'off') {
            refreshProgramFobData();
        }
        refreshProgramBtData();
    }

    function normalizeHipLabel(s) {
        return String(s || '').toLocaleLowerCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '').trim();
    }

    function resolveMuhtHipKey(hipName) {
        const data = state.muhtemeller;
        if (!data?.hipodromlar?.length) return null;
        const target = normalizeHipLabel(hipName);
        const hit = data.hipodromlar.find((h) => {
            const yer = normalizeHipLabel(h.yer);
            const key = normalizeHipLabel(h.key);
            const hip = normalizeHipLabel(h.hipodrom);
            return yer === target || key === target || hip === target
                || yer.includes(target) || target.includes(yer);
        });
        return hit?.key || null;
    }

    function extractGanyanOdds(muhtemel) {
        const map = {};
        const ganyanBet = (muhtemel?.bahisler || []).find((b) => b.isGanyan || b.B === 'GANYAN');
        if (!ganyanBet?.muhtemeller?.length) return map;
        ganyanBet.muhtemeller.forEach((row) => {
            if (row.S1 != null && row.S1 !== '') map[String(row.S1)] = row.G || '';
        });
        return map;
    }

    function findGanyanLeaderNo(ganyanMap) {
        let leaderNo = null;
        let minOdd = Infinity;
        Object.entries(ganyanMap || {}).forEach(([no, val]) => {
            const v = parseOdd(val);
            if (v != null && v < minOdd) {
                minOdd = v;
                leaderNo = no;
            }
        });
        return leaderNo;
    }

    async function ensureMuhtemellerOverview(iso) {
        if (state.muhtemeller && state.muhtIso === iso) return state.muhtemeller;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 25000);
        try {
            const res = await fetch('/api/public/muhtemeller?iso=' + encodeURIComponent(iso), {
                signal: controller.signal
            });
            const data = await res.json();
            if (!data.success) return null;
            state.muhtemeller = data;
            state.muhtIso = iso;
            return data;
        } catch (_) {
            return null;
        } finally {
            clearTimeout(tid);
        }
    }

    async function fetchRaceGanyanOdds(iso, runKey, refresh) {
        const cacheKey = iso + ':' + runKey;
        let cached = state.muhtRaceCache[cacheKey];
        const needsFetch = refresh || !cached?.muhtemel;
        if (needsFetch) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 45000);
            try {
                const res = await fetch(
                    '/api/public/muhtemeller?iso=' + encodeURIComponent(iso)
                    + '&kosu=' + encodeURIComponent(runKey)
                    + (refresh ? '&refresh=1' : ''),
                    { signal: controller.signal }
                );
                const data = await res.json();
                if (data.success && data.muhtemel) {
                    state.muhtRaceCache[cacheKey] = data;
                    cached = data;
                }
            } catch (_) {
                /* mevcut cache korunur */
            } finally {
                clearTimeout(tid);
            }
        }
        return extractGanyanOdds(cached?.muhtemel);
    }

    async function refreshProgramGanyanOdds(opts = {}) {
        const iso = state.iso || localTodayIso();
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (!hip || !$('#panel-kosular')?.classList.contains('active')) return;

        const overview = await ensureMuhtemellerOverview(iso);
        const muhtKey = resolveMuhtHipKey(hip.name);
        state.progGanyanMuhtKey = muhtKey;
        if (!muhtKey || !overview) return;

        const races = hip.kosular || [];
        if (!races.length) return;

        state.progGanyanLoading = true;
        const refresh = !!opts.refresh;
        const batchSize = 4;
        try {
            for (let i = 0; i < races.length; i += batchSize) {
                const batch = races.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(async (race) => {
                    const runKey = muhtKey + '-' + race.raceNo;
                    const odds = await fetchRaceGanyanOdds(iso, runKey, refresh);
                    return { runKey, odds };
                }));
                results.forEach(({ runKey, odds }) => {
                    state.progGanyanByRace[runKey] = odds;
                });
            }
        } finally {
            state.progGanyanLoading = false;
        }

        const activeHip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (activeHip) renderRaceList(activeHip);
    }

    function startProgramGanyanPolling() {
        stopProgramGanyanPolling();
        if (!$('#panel-kosular')?.classList.contains('active')) return;
        let countdown = PROG_GANYAN_REFRESH_SEC;
        let bltCountdown = PROG_BLT_REFRESH_SEC;
        let gpCountdown = PROG_GP_REFRESH_SEC;
        let fobCountdown = PROG_FOB_REFRESH_SEC;
        let btCountdown = PROG_BT_REFRESH_SEC;
        progGanyanPollTimer = setInterval(() => {
            if (document.hidden) return;
            if (!$('#panel-kosular')?.classList.contains('active')) return;
            countdown -= 1;
            bltCountdown -= 1;
            gpCountdown -= 1;
            fobCountdown -= 1;
            btCountdown -= 1;
            if (countdown <= 0) {
                countdown = PROG_GANYAN_REFRESH_SEC;
                refreshProgramGanyanOdds({ refresh: true });
            }
            if (bltCountdown <= 0) {
                bltCountdown = PROG_BLT_REFRESH_SEC;
                refreshProgramBltData({ refresh: true });
            }
            if (gpCountdown <= 0) {
                gpCountdown = PROG_GP_REFRESH_SEC;
                refreshProgramGpData({ refresh: true });
            }
            if (state.progFobMode !== 'off' && fobCountdown <= 0) {
                fobCountdown = PROG_FOB_REFRESH_SEC;
                refreshProgramFobData({ refresh: true });
            }
            if (btCountdown <= 0) {
                btCountdown = PROG_BT_REFRESH_SEC;
                refreshProgramBtData({ refresh: true });
            }
        }, 1000);
    }

    function stopProgramGanyanPolling() {
        if (progGanyanPollTimer) {
            clearInterval(progGanyanPollTimer);
            progGanyanPollTimer = null;
        }
    }

    function getRaceGanyanMap(raceNo) {
        const muhtKey = state.progGanyanMuhtKey;
        if (!muhtKey) return {};
        return state.progGanyanByRace[muhtKey + '-' + raceNo] || {};
    }

    function formatProgramRaceHeader(race) {
        let title = race.raceNo + '. Koşu';
        if (race.saat) title += ' · ' + race.saat;
        const meta = [];
        if (race.mesafe || race.pist) {
            meta.push([race.mesafe, race.pist].filter(Boolean).join(' '));
        }
        const kat = race.kategori || race.kcins_kosu || '';
        if (kat && !/^\d+\.\s*Koşu$/i.test(kat)) {
            meta.push(kat);
        } else if (race.baslik && !/^\d+\.\s*Koşu$/i.test(race.baslik)) {
            meta.push(race.baslik);
        }
        return { title, meta: meta.join(' · ') };
    }

    function getRaceSurfaceClass(race) {
        const text = [
            race.pist,
            race.mesafe,
            race.kategori,
            race.kcins_kosu,
            race.baslik
        ].filter(Boolean).join(' ');
        if (/\bçim\b/i.test(text) || /^ç[:|]/i.test(text)) return 'pub-program-race-hdr--cim';
        if (/\bkum\b/i.test(text) || /^k[:|]/i.test(text)) return 'pub-program-race-hdr--kum';
        return '';
    }

    function getBitalihColumnDefs() {
        return [
            { key: 'bt_ganyan', label: 'Ganyan', cls: 'pub-prog-bt', colCls: 'pub-col-bt', betKey: 'ganyan', title: "Bi'Talih Ganyan" },
            { key: 'bt_ilk2', label: 'İlk 2', cls: 'pub-prog-bt', colCls: 'pub-col-bt', betKey: 'ilk2', title: "Bi'Talih İlk 2" },
            { key: 'bt_ilk3', label: 'İlk 3', cls: 'pub-prog-bt', colCls: 'pub-col-bt', betKey: 'ilk3', title: "Bi'Talih İlk 3" },
            { key: 'bt_ilk4', label: 'İlk 4', cls: 'pub-prog-bt', colCls: 'pub-col-bt', betKey: 'ilk4', title: "Bi'Talih İlk 4" }
        ];
    }

    function getFobColumnDefs() {
        const mode = state.progFobMode;
        if (!mode || mode === 'off') return [];
        if (mode === 'compare') {
            return [
                { key: 'fob_ganyan', label: 'Ganyan', cls: 'pub-prog-fob', colCls: 'pub-col-fob', betKey: 'ganyan', title: 'Hipodrom sabit ihtimalli Ganyan' },
                { key: 'fob_ilk2', label: 'İlk 2', cls: 'pub-prog-fob', colCls: 'pub-col-fob', betKey: 'ilk2', title: 'Hipodrom sabit ihtimalli İlk 2' },
                { key: 'fob_ilk3', label: 'İlk 3', cls: 'pub-prog-fob', colCls: 'pub-col-fob', betKey: 'ilk3', title: 'Hipodrom sabit ihtimalli İlk 3' }
            ];
        }
        const labels = { ganyan: 'Ganyan', ilk2: 'İlk 2', ilk3: 'İlk 3' };
        return [{
            key: 'fob_' + mode,
            label: labels[mode] || mode,
            cls: 'pub-prog-fob',
            colCls: 'pub-col-fob',
            betKey: mode,
            title: 'Hipodrom sabit ihtimalli ' + (labels[mode] || mode)
        }];
    }

    function getProgramColumns(kosular) {
        const races = Array.isArray(kosular) ? kosular : (kosular.kosular || []);
        const horses = races.flatMap((r) => r.horses || []);
        const has = (key) => horses.some((h) => String(h[key] || '').trim());
        const cols = [
            { key: 'no', label: 'No', cls: 'pub-prog-no', colCls: 'pub-col-no', always: true },
            { key: 'ganyan', label: 'G', cls: 'pub-prog-ganyan', colCls: 'pub-col-ganyan', always: true, title: 'Ganyan' },
            { key: 'name', label: 'At', cls: 'pub-prog-at', colCls: 'pub-col-name', always: true },
            { key: 'yas', label: 'Yaş', cls: 'pub-prog-yas', colCls: 'pub-col-yas' },
            { key: 'siklet', label: 'Sıklet', cls: 'pub-prog-siklet', colCls: 'pub-col-siklet' },
            { key: 'hp', label: 'HP', cls: 'pub-prog-hp', colCls: 'pub-col-hp' },
            { key: 'jokey', label: 'Jokey', cls: 'pub-prog-jokey', colCls: 'pub-col-jokey' },
            { key: 'taki', label: 'Takı', cls: 'pub-prog-taki', colCls: 'pub-col-taki' }
        ];
        const filtered = cols.filter((c) => c.always || has(c.key));
        const bltCol = {
            key: 'blt',
            label: '@',
            cls: 'pub-prog-blt',
            colCls: 'pub-col-blt',
            always: true,
            title: 'Bülten (yenibeygir Blt)'
        };
        const gp2Col = {
            key: 'gp2',
            label: '@2',
            cls: 'pub-prog-gp2',
            colCls: 'pub-col-gp2',
            always: true,
            title: 'GP Puanı (liderform)'
        };
        const takiIdx = filtered.findIndex((c) => c.key === 'taki');
        if (takiIdx >= 0) filtered.splice(takiIdx + 1, 0, bltCol, gp2Col);
        else filtered.push(bltCol, gp2Col);
        filtered.push(...getBitalihColumnDefs());
        filtered.push(...getTahminScoreColumnDefs(kosular));
        const fobCols = getFobColumnDefs();
        if (fobCols.length) filtered.push(...fobCols);
        return filtered;
    }

    function computeTakiColWidth(kosular) {
        let maxChars = 4;
        for (const race of kosular || []) {
            for (const h of race.horses || []) {
                const len = String(h.taki || '').trim().length;
                if (len > maxChars) maxChars = len;
            }
        }
        return Math.min(128, Math.max(56, maxChars * 7 + 18));
    }

    function renderProgramColgroup(cols, colWidths) {
        return '<colgroup>'
            + cols.map((c) => {
                const w = colWidths?.[c.key];
                const style = w ? ' style="width:' + w + 'px"' : '';
                return '<col class="' + c.colCls + '"' + style + '>';
            }).join('')
            + '<col class="pub-col-spacer">'
            + '</colgroup>';
    }

    function isPlaceholderBtOdd(val) {
        if (val == null || val === '' || val === '—') return true;
        const v = parseFloat(String(val).replace(',', '.'));
        return !isNaN(v) && v <= 1.01;
    }

    function programHorseCell(h, col, ctx) {
        if (col.key === 'ganyan') {
            const odd = ctx?.ganyanMap?.[String(h.no)] || '';
            return odd || '—';
        }
        if (col.key === 'blt') {
            const blt = ctx?.bltMap?.[String(h.no)] || ctx?.bltByName?.[normalizeHorseName(h.name)] || '';
            return blt || '—';
        }
        if (col.key === 'gp2') {
            const gp = ctx?.gpMap?.[String(h.no)] || ctx?.gpByName?.[normalizeHorseName(h.name)] || '';
            if (gp) return gp;
            if (state.progGpLoading) return '…';
            return '—';
        }
        if (col.key && col.key.startsWith('fob_')) {
            const betKey = col.betKey || col.key.replace(/^fob_/, '');
            const odd = ctx?.fobMaps?.[betKey]?.[String(h.no)] || '';
            if (odd) return odd;
            if (state.progFobLoading) return '…';
            return '—';
        }
        if (col.key && col.key.startsWith('bt_')) {
            const betKey = col.betKey || col.key.replace(/^bt_/, '');
            const maps = ctx?.btMaps?.[betKey] || {};
            const odd = maps.byNo?.[String(h.no)] || maps.byName?.[normalizeHorseName(h.name)] || '';
            if (odd && !isPlaceholderBtOdd(odd)) return odd;
            if (state.progBtLoading) return '…';
            return '—';
        }
        if (col.scoreKey) {
            const t = h.scores?.[col.scoreKey];
            return formatScoreCell(t);
        }
        if (col.key === 'name') return formatHorseNameCell(h);
        const v = String(h[col.key] || '').trim();
        return v || '—';
    }

    function formatHorseNameCell(h) {
        const name = escapeHtml(h.name || '—');
        let stars = '';
        if (h.t1drTest1) {
            stars += '<span class="pub-prog-t1dr-star" title="T1×DR=TEST1 — geçmiş koşuda eşleşme var">★</span>';
        }
        if (h.test123Kirmizi) {
            stars += '<span class="pub-prog-t123-star" title="TEST1·TEST2·TEST3 kırmızı">★</span>';
        }
        if (h.test9Yanip) {
            stars += '<span class="pub-prog-t9-star" title="TEST9 yanıp sönen renk kuralı">★</span>';
        }
        if (h.fark8002Yanip) {
            stars += '<span class="pub-prog-f8002-star" title="8002-8001 yanıp sönen kural">★</span>';
        }
        if (h.test1Yesil) {
            stars += '<span class="pub-prog-t1yesil-star" title="Son 7 yarışta TEST1 hücresi yeşil">★</span>';
        }
        if (!stars) return name;
        return stars + ' <span class="pub-prog-at-name">' + name + '</span>';
    }

    function normalizeHorseName(s) {
        return String(s || '').toLocaleUpperCase('tr-TR')
            .normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/[^A-Z0-9]/g, '');
    }

    function getRaceBltMaps(raceNo) {
        const race = state.progBltData?.races?.[String(raceNo)] || null;
        return {
            bltMap: race?.byNo || {},
            bltByName: race?.byName || {}
        };
    }

    function findBltLeaderNo(bltMap) {
        let leaderNo = null;
        let maxVal = -Infinity;
        Object.entries(bltMap || {}).forEach(([no, val]) => {
            const v = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(v) && v > maxVal) {
                maxVal = v;
                leaderNo = no;
            }
        });
        return leaderNo;
    }

    function getRaceGpMaps(raceNo) {
        const race = state.progGpData?.races?.[String(raceNo)] || null;
        return {
            gpMap: race?.byNo || {},
            gpByName: race?.byName || {}
        };
    }

    function findGpLeaderNo(gpMap) {
        let leaderNo = null;
        let maxVal = -Infinity;
        Object.entries(gpMap || {}).forEach(([no, val]) => {
            const v = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(v) && v > maxVal) {
                maxVal = v;
                leaderNo = no;
            }
        });
        return leaderNo;
    }

    function getRaceFobMaps(raceNo) {
        const race = state.progFobData?.races?.[String(raceNo)] || null;
        const bets = race?.bets || {};
        return {
            ganyan: bets.ganyan?.byNo || {},
            ilk2: bets.ilk2?.byNo || {},
            ilk3: bets.ilk3?.byNo || {}
        };
    }

    function findFobLeaderNo(oddMap) {
        let leaderNo = null;
        let minVal = Infinity;
        Object.entries(oddMap || {}).forEach(([no, val]) => {
            const v = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(v) && v > 0 && v < minVal) {
                minVal = v;
                leaderNo = no;
            }
        });
        return leaderNo;
    }

    function setFobStatus(text, isError) {
        const el = $('#pubFobStatus');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('pub-fob-status--err', !!isError);
    }

    async function refreshProgramFobData(opts = {}) {
        const mode = state.progFobMode;
        if (!mode || mode === 'off') return;
        const iso = state.iso || localTodayIso();
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (!hip || !$('#panel-kosular')?.classList.contains('active')) return;
        if (state.progFobLoading && !opts.refresh) return;

        state.progFobLoading = true;
        setFobStatus('yükleniyor…');
        renderRaceList(hip);

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 45000);
            const res = await fetch(
                '/api/public/hipodrom-fob?iso=' + encodeURIComponent(iso)
                + '&hipodrom=' + encodeURIComponent(hip.name)
                + (opts.refresh ? '&refresh=1' : ''),
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success) {
                setFobStatus(data.error || 'yüklenemedi', true);
                return;
            }
            state.progFobData = data;
            state.progFobHipId = hip.id;
            setFobStatus(data.raceCount + ' koşu');
            const activeHip = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (activeHip) renderRaceList(activeHip);
        } catch (err) {
            setFobStatus('bağlantı hatası', true);
        } finally {
            state.progFobLoading = false;
            const activeHip = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (activeHip) renderRaceList(activeHip);
        }
    }

    function onFobModeChange(mode) {
        state.progFobMode = mode || 'off';
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (state.progFobMode === 'off') {
            state.progFobData = null;
            state.progFobHipId = null;
            setFobStatus('');
            if (hip) renderRaceList(hip);
            return;
        }
        if (hip) {
            state.progFobData = null;
            state.progFobHipId = null;
            renderRaceList(hip);
            refreshProgramFobData({ refresh: true });
        }
    }

    function getRaceBtMaps(raceNo) {
        const race = state.progBtData?.races?.[String(raceNo)] || null;
        const bets = race?.bets || {};
        const out = {};
        ['ganyan', 'ilk2', 'ilk3', 'ilk4'].forEach((key) => {
            out[key] = {
                byNo: bets[key]?.byNo || {},
                byName: bets[key]?.byName || {}
            };
        });
        return out;
    }

    function findBtLeaderNo(maps) {
        let leaderNo = null;
        let minVal = Infinity;
        Object.entries(maps?.byNo || {}).forEach(([no, val]) => {
            const v = parseFloat(String(val).replace(',', '.'));
            if (!isNaN(v) && v > 0 && v < minVal) {
                minVal = v;
                leaderNo = no;
            }
        });
        return leaderNo;
    }

    async function refreshProgramBtData(opts = {}) {
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (!hip || !$('#panel-kosular')?.classList.contains('active')) return;
        if (state.progBtLoading && !opts.refresh) return;

        state.progBtLoading = true;
        const activeHip = hip;
        renderRaceList(activeHip);

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 45000);
            const res = await fetch(
                '/api/public/bitalih-fob?hipodrom=' + encodeURIComponent(hip.name)
                + (opts.refresh ? '&refresh=1' : ''),
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success) return;
            state.progBtData = data;
            state.progBtHipId = hip.id;
            const cur = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (cur) renderRaceList(cur);
        } catch (_) {
            /* sessiz */
        } finally {
            state.progBtLoading = false;
            const cur = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (cur) renderRaceList(cur);
        }
    }

    async function refreshProgramBltData(opts = {}) {
        const iso = state.iso || localTodayIso();
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (!hip || !$('#panel-kosular')?.classList.contains('active')) return;

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 45000);
            const res = await fetch(
                '/api/public/yenibeygir-blt?iso=' + encodeURIComponent(iso)
                + '&hipodrom=' + encodeURIComponent(hip.name)
                + (opts.refresh ? '&refresh=1' : ''),
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (!data.success) return;
            state.progBltData = data;
            state.progBltHipId = hip.id;
            const activeHip = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (activeHip) renderRaceList(activeHip);
        } catch (_) {
            /* sessiz */
        }
    }

    async function refreshProgramGpData(opts = {}) {
        const iso = state.iso || localTodayIso();
        const hip = state.hipodromlar.find((h) => h.id === state.activeHipId);
        if (!hip || !$('#panel-kosular')?.classList.contains('active')) return;

        const raceNos = (hip.kosular || []).map((r) => r.raceNo).filter(Boolean);
        if (!raceNos.length) return;
        if (state.progGpLoading && !opts.refresh) return;

        state.progGpLoading = true;
        if (!state.progGpData || state.progGpHipId !== hip.id || opts.refresh) {
            state.progGpData = { success: true, races: {}, hipodrom: hip.name };
            state.progGpHipId = hip.id;
        }
        renderRaceList(hip);

        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 120000);
            const res = await fetch(
                '/api/public/liderform-gp?iso=' + encodeURIComponent(iso)
                + '&hipodrom=' + encodeURIComponent(hip.name)
                + '&races=' + encodeURIComponent(raceNos.join(','))
                + (opts.refresh ? '&refresh=1' : ''),
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();
            if (data.success && data.races) {
                state.progGpData = { success: true, races: data.races, hipodrom: hip.name };
                state.progGpHipId = hip.id;
            }
        } catch (_) {
            /* disk önbellek veya kısmi veri kalır */
        } finally {
            state.progGpLoading = false;
            const activeHip = state.hipodromlar.find((h) => h.id === state.activeHipId);
            if (activeHip) renderRaceList(activeHip);
        }
    }

    function renderSonucHipTabs() {
        const el = $('#pubSonucHipTabs');
        if (!el) return;
        if (!state.hipodromlar.length) {
            el.innerHTML = '';
            return;
        }
        const activeId = state.sonucHipId && state.hipodromlar.some((h) => h.id === state.sonucHipId)
            ? state.sonucHipId
            : state.activeHipId || state.hipodromlar[0].id;
        el.innerHTML = state.hipodromlar.map((h) => {
            const saat = h.ilkKosuSaat ? '1. Koşu — ' + h.ilkKosuSaat : h.kosuSayisi + ' koşu';
            return '<button type="button" class="pub-hip-tab' + (h.id === activeId ? ' active' : '') + '" data-id="' + escapeHtml(h.id) + '" role="tab">'
                + escapeHtml(h.name) + '<small>' + escapeHtml(saat) + '</small></button>';
        }).join('');
        el.querySelectorAll('.pub-hip-tab').forEach((btn) => {
            btn.addEventListener('click', () => selectSonucHip(btn.dataset.id, { forceRefresh: true }));
        });
    }

    function selectSonucHip(id, opts = {}) {
        state.sonucHipId = id;
        $$('#pubSonucHipTabs .pub-hip-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
        const hip = state.hipodromlar.find((h) => h.id === id);
        if (!hip) return;

        const info = $('#pubSonucHipInfo');
        if (info) {
            info.style.display = 'flex';
            info.innerHTML = '<strong>' + escapeHtml(hip.name) + ' Hipodromu</strong>'
                + '<span class="pub-weather"><span>🏇 ' + hip.kosuSayisi + ' koşu</span>'
                + (hip.ilkKosuSaat ? '<span>⏰ İlk koşu ' + escapeHtml(hip.ilkKosuSaat) + '</span>' : '')
                + '</span>';
        }

        const force = !!opts.forceRefresh;
        const cached = state.sonucByHip[id];
        const cacheAge = cached?.fetchedAt ? Date.now() - cached.fetchedAt : Infinity;
        if (!force && cached?.data && cacheAge < SONUC_CLIENT_CACHE_MS) {
            state.sonucData = cached.data;
            state.sonucLastUpdate = cached.fetchedAt;
            renderSonuclarList(hip, cached.data);
            return;
        }
        refreshSonuclarData({ refresh: true });
    }

    function formatSonucRaceHeader(race, progRace) {
        if (progRace) return formatProgramRaceHeader(progRace);
        const title = race.raceNo + '. Koşu';
        const meta = race.raceHeaderLine || '';
        return { title, meta };
    }

    function mergeSonucWithProgram(progRaces, apiRaces) {
        const byNo = new Map();
        for (const race of apiRaces || []) {
            byNo.set(String(race.raceNo), race);
        }
        const programList = progRaces || [];
        if (!programList.length) return apiRaces || [];
        return programList.map((progRace) => {
            const no = String(progRace.raceNo);
            const hit = byNo.get(no);
            if (hit) return hit;
            return {
                raceNo: no,
                raceHeaderLine: '',
                horses: [],
                horseCount: 0,
                pending: true
            };
        });
    }

    function renderSonuclarList(hip, data) {
        const el = $('#pubSonucList');
        const label = $('#pubSonucLabel');
        if (!el) return;

        const progRaces = hip?.kosular || [];
        const apiRaces = data?.races || [];
        const mergedRaces = mergeSonucWithProgram(progRaces, apiRaces);
        const finishedCount = apiRaces.filter((r) => (r.horses || []).length > 0).length;
        const hasAnyResults = finishedCount > 0 || data?.hasResults;

        if (label) {
            const parts = [];
            if (state.tarih) parts.push(trToDisplay(state.tarih));
            if (hasAnyResults) {
                parts.push(finishedCount + ' koşu sonuçlandı');
                if (progRaces.length > finishedCount) {
                    parts.push((progRaces.length - finishedCount) + ' koşu bekleniyor');
                }
            } else {
                parts.push('henüz sonuç yok');
            }
            if (data?.stale) parts.push('güncelleniyor…');
            if (state.sonucLastUpdate) {
                parts.push('güncelleme ' + new Date(state.sonucLastUpdate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
            }
            label.textContent = parts.join(' · ');
        }

        if (!hasAnyResults) {
            el.innerHTML = '<div class="pub-empty">'
                + '<div class="pub-empty-icon">⏳</div>'
                + '<h3>Henüz sonuç yok</h3>'
                + '<p>' + escapeHtml(data?.message || 'Koşular tamamlandıkça sonuçlar burada görünecek.') + '</p>'
                + '</div>';
            return;
        }

        const races = mergedRaces;
        el.innerHTML = '<div class="pub-program-list">' + races.map((race) => {
            const progRace = progRaces.find((r) => String(r.raceNo) === String(race.raceNo));
            const hdr = formatSonucRaceHeader(race, progRace);
            const surfaceClass = progRace ? getRaceSurfaceClass(progRace) : getRaceSurfaceClass({ pist: race.raceHeaderLine });
            const horses = race.horses || [];

            if (race.pending || !horses.length) {
                return '<section class="pub-program-race pub-sonuc-race pub-sonuc-pending" data-race="' + race.raceNo + '">'
                    + '<div class="pub-program-race-hdr' + (surfaceClass ? ' ' + surfaceClass : '') + '">'
                    + '<span class="pub-program-race-title">' + escapeHtml(hdr.title) + '</span>'
                    + (hdr.meta ? '<span class="pub-program-race-meta">' + escapeHtml(hdr.meta) + '</span>' : '')
                    + '</div>'
                    + '<div class="pub-sonuc-pending-msg">Sonuç bekleniyor…</div>'
                    + '</section>';
            }

            const head = '<th>S</th><th>No</th><th>At</th><th>Derece</th><th>Gny</th><th>HP</th><th>Jokey</th>';
            const body = horses.map((h) => {
                let cls = 'pub-sonuc-row';
                if (String(h.sira) === '1') cls += ' pub-sonuc-winner';
                if (h.kosmaz) cls += ' pub-sonuc-kosmaz';
                return '<tr class="' + cls + '">'
                    + '<td class="pub-sonuc-sira">' + escapeHtml(h.sira || '—') + '</td>'
                    + '<td class="pub-sonuc-no">' + escapeHtml(h.no || '—') + '</td>'
                    + '<td class="pub-sonuc-at">' + escapeHtml(h.name || '—') + '</td>'
                    + '<td class="pub-sonuc-derece">' + escapeHtml(h.derece || '—') + '</td>'
                    + '<td class="pub-sonuc-gny">' + escapeHtml(h.gny || '—') + '</td>'
                    + '<td class="pub-sonuc-hp">' + escapeHtml(h.hp || '—') + '</td>'
                    + '<td class="pub-sonuc-jokey">' + escapeHtml(h.jokey || '—') + '</td>'
                    + '</tr>';
            }).join('');

            const metaHtml = hdr.meta
                ? '<span class="pub-program-race-meta">' + escapeHtml(hdr.meta) + '</span>'
                : '';

            return '<section class="pub-program-race pub-sonuc-race" data-race="' + race.raceNo + '">'
                + '<div class="pub-program-race-hdr' + (surfaceClass ? ' ' + surfaceClass : '') + '">'
                + '<span class="pub-program-race-title">' + escapeHtml(hdr.title) + '</span>'
                + metaHtml
                + '</div>'
                + '<div class="pub-program-table-wrap">'
                + '<table class="pub-program-table pub-sonuc-table"><thead><tr>' + head + '</tr></thead><tbody>'
                + body + '</tbody></table>'
                + '</div></section>';
        }).join('') + '</div>';
    }

    async function fetchSonuclarApi(iso, hip, opts = {}) {
        const attempts = opts.attempts || 3;
        let lastErr;
        const qs = '/api/public/sonuclar?iso=' + encodeURIComponent(iso)
            + '&hipodrom=' + encodeURIComponent(hip.name)
            + '&hipodromId=' + encodeURIComponent(hip.id)
            + '&kosuSayisi=' + encodeURIComponent(hip.kosuSayisi || (hip.kosular || []).length || 0)
            + (opts.refresh ? '&refresh=1' : '');

        for (let i = 0; i < attempts; i++) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 90000);
            try {
                const res = await fetch(qs, { signal: controller.signal });
                clearTimeout(tid);
                const data = await parseJsonResponse(res);
                if (!res.ok || data.success === false) {
                    throw new Error(data.error || ('HTTP ' + res.status));
                }
                return data;
            } catch (err) {
                clearTimeout(tid);
                lastErr = err;
                if (err.name === 'AbortError') throw err;
                if (i < attempts - 1) {
                    await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
                }
            }
        }
        throw lastErr || new Error('Sonuç alınamadı');
    }

    async function refreshSonuclarData(opts = {}) {
        const iso = state.iso || localTodayIso();
        const hipId = state.sonucHipId || state.activeHipId;
        const hip = state.hipodromlar.find((h) => h.id === hipId);
        const el = $('#pubSonucList');
        if (!hip || !$('#panel-sonuclar')?.classList.contains('active')) return;

        if (state.sonucLoading && !opts.refresh) return;
        state.sonucLoading = true;
        if (el && (!state.sonucData || opts.refresh)) {
            el.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Sonuçlar yükleniyor…</div>';
        }

        try {
            const data = await fetchSonuclarApi(iso, hip, { refresh: !!opts.refresh });
            state.sonucData = data;
            state.sonucHipId = hip.id;
            state.sonucLastUpdate = Date.now();
            state.sonucByHip[hip.id] = { data, fetchedAt: state.sonucLastUpdate };
            renderSonuclarList(hip, data);
            if (data.stale) {
                setTimeout(() => {
                    if (state.sonucHipId === hip.id && $('#panel-sonuclar')?.classList.contains('active')) {
                        refreshSonuclarData({ refresh: true });
                    }
                }, 2500);
            }
        } catch (err) {
            if (el) {
                el.innerHTML = '<div class="pub-empty">'
                    + '<div class="pub-empty-icon">⚠️</div>'
                    + '<h3>Sonuç yüklenemedi</h3>'
                    + '<p>' + escapeHtml(err.message || 'Bağlantı hatası') + '</p>'
                    + '</div>';
            }
        } finally {
            state.sonucLoading = false;
        }
    }

    function startSonucPolling() {
        stopSonucPolling();
        if (!$('#panel-sonuclar')?.classList.contains('active')) return;
        let countdown = SONUC_REFRESH_SEC;
        sonucPollTimer = setInterval(() => {
            if (document.hidden) return;
            if (!$('#panel-sonuclar')?.classList.contains('active')) return;
            countdown -= 1;
            if (countdown <= 0) {
                countdown = SONUC_REFRESH_SEC;
                refreshSonuclarData({ refresh: true });
            }
        }, 1000);
    }

    function stopSonucPolling() {
        if (sonucPollTimer) {
            clearInterval(sonucPollTimer);
            sonucPollTimer = null;
        }
    }

    function initSonuclarPanel() {
        if (!state.hipodromlar.length) {
            const list = $('#pubSonucList');
            if (list) {
                list.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">📅</div><h3>Program yok</h3><p>Önce günün programını yükleyin.</p></div>';
            }
            return;
        }
        renderSonucHipTabs();
        const hipId = state.sonucHipId || state.activeHipId || state.hipodromlar[0].id;
        selectSonucHip(hipId, { forceRefresh: true });
        startSonucPolling();
    }

    const REHBER_COL_CLS = {
        r2: 'pub-rehber-col--r2',
        tahmin: 'pub-rehber-col--tahmin',
        blt: 'pub-rehber-col--at'
    };

    function renderRehberTierList(rows) {
        if (!rows || !rows.length) {
            return '<div class="pub-rehber-empty-row">Henüz değerlendirilecek koşu yok</div>';
        }
        return '<ol class="pub-rehber-list">' + rows.map((row, idx) => {
            const rankCls = idx === 0 ? ' pub-rehber-row--top1' : (idx === 1 ? ' pub-rehber-row--top2' : (idx === 2 ? ' pub-rehber-row--top3' : ''));
            const colCls = REHBER_COL_CLS[row.id] || '';
            return '<li class="pub-rehber-row' + rankCls + '">'
                + '<span class="pub-rehber-rank">' + (idx + 1) + '</span>'
                + '<span class="pub-rehber-col ' + colCls + '">' + escapeHtml(row.label) + '</span>'
                + '<span class="pub-rehber-hits">' + row.hits + '/' + row.total + '</span>'
                + '<span class="pub-rehber-pct">%' + row.pct + '</span>'
                + '</li>';
        }).join('') + '</ol>';
    }

    function renderRehberPanel(data, opts = {}) {
        const root = $('#pubRehberRoot');
        if (!root) return;

        const loadingNote = opts.loading
            ? '<div class="pub-rehber-sub" style="color:#1565c0"><span class="pub-yarin-spin"></span> Güncelleniyor…</div>'
            : '';

        if (!data || data.success === false) {
            if (!opts.loading) {
                root.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">📅</div>'
                    + '<h3>Veri alınamadı</h3><p>Lütfen yenileyin.</p></div>';
            }
            return;
        }

        const dateLabel = data.tarih ? trToDisplay(data.tarih) : (state.tarih ? trToDisplay(state.tarih) : 'Bugün');
        const raceCount = data.raceCount || 0;
        const hipCount = data.hipodromCount || state.hipodromlar.length || 0;
        const finishedHips = data.finishedHipCount || 0;
        const updated = data.updatedAt
            ? new Date(data.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
            : '';

        root.innerHTML = '<div class="pub-rehber-wrap">'
            + '<div class="pub-rehber-hdr">'
            + '<div>'
            + '<h2 class="pub-rehber-title">Günün Tahmin Liderleri</h2>'
            + '<div class="pub-rehber-sub">' + escapeHtml(dateLabel)
            + ' · ' + raceCount + ' sonuçlanan koşu'
            + ' · ' + hipCount + ' hipodrom'
            + (finishedHips ? ' (' + finishedHips + ' sonuçlu)' : '')
            + (updated ? ' · güncelleme ' + escapeHtml(updated) : '')
            + '</div>'
            + loadingNote
            + '</div>'
            + '<button type="button" class="pub-rehber-refresh" id="pubRehberRefresh">Yenile</button>'
            + '</div>'
            + '<div class="pub-rehber-grid">'
            + '<div class="pub-rehber-card">'
            + '<div class="pub-rehber-card-hdr pub-rehber-card-hdr--gold">1. Bilen'
            + '<div class="pub-rehber-card-desc">Kazananı en çok doğru tahmin eden sütunlar</div></div>'
            + renderRehberTierList(data.top1)
            + '</div>'
            + '<div class="pub-rehber-card">'
            + '<div class="pub-rehber-card-hdr pub-rehber-card-hdr--silver">1–2 Bilen'
            + '<div class="pub-rehber-card-desc">İlk iki atı tam sırayla bilen sütunlar</div></div>'
            + renderRehberTierList(data.top2)
            + '</div>'
            + '<div class="pub-rehber-card">'
            + '<div class="pub-rehber-card-hdr pub-rehber-card-hdr--bronze">1–2–3 Bilen'
            + '<div class="pub-rehber-card-desc">Podyumu tam sırayla bilen sütunlar</div></div>'
            + renderRehberTierList(data.top3)
            + '</div>'
            + '</div>'
            + (raceCount === 0
                ? '<div class="pub-rehber-help" style="margin-top:0;background:#fff8e1;border-color:#ffe082">'
                + 'Henüz sonuçlanan koşu yok veya sonuçlar kaydedilmedi. '
                + 'Koşular bittikçe liste otomatik dolacak — <em>Sonuçlar</em> sekmesinden bir hipodrom açmak senkronu hızlandırır.'
                + '</div>'
                : '')
            + '<div class="pub-rehber-help">'
            + '<strong>Nasıl okunur?</strong> Her sütun (R2, MTR, T9V, ASF, G1↕, G1⇄, GÖ, HYB, TAHMİN, @) '
            + 'koşu başına kendi sıralamasını üretir. <em>1. Bilen</em> = 1 numaralı tahmin kazandı; '
            + '<em>1–2 Bilen</em> = ilk iki tahmin 1. ve 2. oldu; <em>1–2–3 Bilen</em> = podyum tam isabet. '
            + 'Liste gün içinde sonuçlandıkça güncellenir.'
            + '</div>'
            + '</div>';

        $('#pubRehberRefresh')?.addEventListener('click', () => loadRehberLeaderboard({ refresh: true }));
    }

    async function loadRehberLeaderboard(opts = {}) {
        const root = $('#pubRehberRoot');
        if (!root || !$('#panel-rehber')?.classList.contains('active')) return;

        const iso = state.iso || localTodayIso();
        if (!opts.silent && !state.rehberData) {
            root.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Liderlik tablosu yükleniyor…</div>';
        } else if (state.rehberData) {
            renderRehberPanel(state.rehberData, { loading: true });
        }

        try {
            const res = await fetch('/api/public/rehber-leaderboard?iso=' + encodeURIComponent(iso));
            const data = await parseJsonResponse(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }
            state.rehberData = data;
            renderRehberPanel(data);
        } catch (err) {
            if (state.rehberData) {
                renderRehberPanel(state.rehberData);
                return;
            }
            root.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">⚠️</div>'
                + '<h3>Liderlik tablosu yüklenemedi</h3>'
                + '<p>' + escapeHtml(err.message || 'Bağlantı hatası') + '</p>'
                + '<button type="button" class="pub-btn pub-btn-white" id="pubRehberRetry" style="margin-top:12px">Tekrar dene</button></div>';
            $('#pubRehberRetry')?.addEventListener('click', () => loadRehberLeaderboard({ refresh: true }));
        }
    }

    function startRehberPolling() {
        stopRehberPolling();
        if (!$('#panel-rehber')?.classList.contains('active')) return;
        let countdown = SONUC_REFRESH_SEC;
        rehberPollTimer = setInterval(() => {
            if (document.hidden) return;
            if (!$('#panel-rehber')?.classList.contains('active')) return;
            countdown -= 1;
            if (countdown <= 0) {
                countdown = SONUC_REFRESH_SEC;
                loadRehberLeaderboard({ silent: true });
            }
        }, 1000);
    }

    function stopRehberPolling() {
        if (rehberPollTimer) {
            clearInterval(rehberPollTimer);
            rehberPollTimer = null;
        }
    }

    function initRehberPanel() {
        loadRehberLeaderboard();
        startRehberPolling();
    }

    function renderRaceList(hip) {
        const el = $('#pubRaceList');
        const kosular = hip.kosular || [];
        if (!kosular.length) {
            el.innerHTML = '<div class="pub-empty"><h3>Koşu bulunamadı</h3></div>';
            return;
        }

        const cols = getProgramColumns(kosular);
        const colWidths = {
            taki: computeTakiColWidth(kosular),
            blt: 40,
            gp2: 40,
            bt_ganyan: 52,
            bt_ilk2: 48,
            bt_ilk3: 48,
            bt_ilk4: 48,
            score_tahmin: 58,
            score_r2: 52,
            score_mtr: 52,
            score_t9v: 52,
            score_asf: 52,
            score_g1side: 52,
            score_g1pair: 52,
            score_go: 52,
            score_hyb: 52,
            fob_ganyan: 52,
            fob_ilk2: 48,
            fob_ilk3: 48
        };
        cols.forEach((c) => {
            if (c.key && c.key.startsWith('fob_') && !colWidths[c.key]) colWidths[c.key] = 52;
            if (c.key && c.key.startsWith('bt_') && !colWidths[c.key]) colWidths[c.key] = 48;
            if (c.key && c.key.startsWith('score_') && !colWidths[c.key]) colWidths[c.key] = 52;
        });
        const colgroup = renderProgramColgroup(cols, colWidths);

        el.innerHTML = '<div class="pub-program-list">' + kosular.map((race) => {
            const hdr = formatProgramRaceHeader(race);
            const surfaceClass = getRaceSurfaceClass(race);
            const ganyanMap = getRaceGanyanMap(race.raceNo);
            const leaderNo = findGanyanLeaderNo(ganyanMap);
            const bltMaps = getRaceBltMaps(race.raceNo);
            const bltLeaderNo = findBltLeaderNo(bltMaps.bltMap);
            const gpMaps = getRaceGpMaps(race.raceNo);
            const gpLeaderNo = findGpLeaderNo(gpMaps.gpMap);
            const raceFobMaps = getRaceFobMaps(race.raceNo);
            const fobLeaders = {
                ganyan: findFobLeaderNo(raceFobMaps.ganyan),
                ilk2: findFobLeaderNo(raceFobMaps.ilk2),
                ilk3: findFobLeaderNo(raceFobMaps.ilk3)
            };
            const btMaps = getRaceBtMaps(race.raceNo);
            const btLeaders = {
                ganyan: findBtLeaderNo(btMaps.ganyan),
                ilk2: findBtLeaderNo(btMaps.ilk2),
                ilk3: findBtLeaderNo(btMaps.ilk3),
                ilk4: findBtLeaderNo(btMaps.ilk4)
            };
            const head = cols.map((c) => {
                const titleAttr = c.title ? ' title="' + escapeHtml(c.title) + '"' : '';
                const clsAttr = c.colCls ? ' class="' + escapeHtml(c.colCls) + '"' : '';
                return '<th' + clsAttr + titleAttr + '>' + c.label + '</th>';
            }).join('') + '<th class="pub-col-spacer-hdr" aria-hidden="true"></th>';
            const horses = race.horses || [];
            const body = horses.length
                ? horses.map((h) => {
                    const ctx = { ganyanMap, ...bltMaps, ...gpMaps, fobMaps: raceFobMaps, btMaps };
                    return '<tr>'
                        + cols.map((c) => {
                            let cls = c.cls;
                            const val = programHorseCell(h, c, ctx);
                            const isNameCol = c.key === 'name';
                            if (c.key === 'ganyan') {
                                if (!ganyanMap[String(h.no)]) cls += ' pub-prog-ganyan-empty';
                                else if (leaderNo && String(h.no) === leaderNo) cls += ' pub-prog-ganyan-leader';
                            }
                            if (c.key === 'blt') {
                                const hasBlt = bltMaps.bltMap[String(h.no)] || bltMaps.bltByName[normalizeHorseName(h.name)];
                                if (!hasBlt) cls += ' pub-prog-blt-empty';
                                else if (bltLeaderNo && String(h.no) === bltLeaderNo) cls += ' pub-prog-blt-leader';
                            }
                            if (c.key === 'gp2') {
                                const hasGp = gpMaps.gpMap[String(h.no)] || gpMaps.gpByName[normalizeHorseName(h.name)];
                                if (!hasGp && state.progGpLoading) cls += ' pub-prog-gp2-loading';
                                else if (!hasGp) cls += ' pub-prog-gp2-empty';
                                else if (gpLeaderNo && String(h.no) === gpLeaderNo) cls += ' pub-prog-gp2-leader';
                            }
                            if (c.key && c.key.startsWith('fob_')) {
                                const betKey = c.betKey || c.key.replace(/^fob_/, '');
                                const hasFob = raceFobMaps[betKey]?.[String(h.no)];
                                if (!hasFob && state.progFobLoading) cls += ' pub-prog-fob-loading';
                                else if (!hasFob) cls += ' pub-prog-fob-empty';
                                else if (fobLeaders[betKey] && String(h.no) === fobLeaders[betKey]) cls += ' pub-prog-fob-leader';
                            }
                            if (c.key && c.key.startsWith('bt_')) {
                                const betKey = c.betKey || c.key.replace(/^bt_/, '');
                                const maps = btMaps[betKey] || {};
                                const hasBt = maps.byNo?.[String(h.no)] || maps.byName?.[normalizeHorseName(h.name)];
                                if (!hasBt && state.progBtLoading) cls += ' pub-prog-bt-loading';
                                else if (!hasBt) cls += ' pub-prog-bt-empty';
                                else if (btLeaders[betKey] && String(h.no) === btLeaders[betKey]) cls += ' pub-prog-bt-leader';
                            }
                            if (c.scoreKey) {
                                const t = h.scores?.[c.scoreKey];
                                if (!t || t.pct == null || t.pct <= 0) cls += ' pub-prog-score-empty';
                                else if (t.rank === 1) cls += ' pub-prog-score-leader';
                                if (c.scoreKey === 'tahmin' && t?.rank === 1) cls += ' pub-prog-score-tahmin-top';
                            }
                            return '<td class="' + cls + '">' + (isNameCol ? val : escapeHtml(val)) + '</td>';
                        }).join('')
                        + '<td class="pub-col-spacer-cell" aria-hidden="true"></td>'
                        + '</tr>';
                }).join('')
                : '<tr><td colspan="' + (cols.length + 1) + '" class="pub-prog-empty">At listesi yok</td></tr>';

            const metaHtml = hdr.meta
                ? '<span class="pub-program-race-meta">' + escapeHtml(hdr.meta) + '</span>'
                : '';

            return '<section class="pub-program-race" data-race="' + race.raceNo + '">'
                + '<div class="pub-program-race-hdr' + (surfaceClass ? ' ' + surfaceClass : '') + '">'
                + '<span class="pub-program-race-title">' + escapeHtml(hdr.title) + '</span>'
                + metaHtml
                + '</div>'
                + '<div class="pub-program-table-wrap">'
                + '<table class="pub-program-table">' + colgroup
                + '<thead><tr>' + head + '</tr></thead><tbody>'
                + body + '</tbody></table>'
                + '</div></section>';
        }).join('') + '</div>';
    }

    function formatTahminRaceHeader(race) {
        const kosuLine = race.raceNo + '. Koşu';
        const metaParts = [];
        if (race.mesafe || race.pist) {
            metaParts.push([race.mesafe, race.pist].filter(Boolean).join(' '));
        }
        const alt = race.kategori || race.kcins_kosu || '';
        if (alt && !String(alt).match(/^\d+\.\s*Koşu$/i)) {
            metaParts.push(alt);
        } else if (race.baslik && !String(race.baslik).match(/^\d+\.\s*Koşu$/i)) {
            metaParts.push(race.baslik);
        }
        return { kosuLine, metaLine: metaParts.join(' · ') };
    }

    function renderTahminHipTabs() {
        const tabsEl = $('#pubTahminHipTabs');
        if (!tabsEl) return;
        if (!state.hipodromlar.length) {
            tabsEl.hidden = true;
            tabsEl.innerHTML = '';
            return;
        }
        tabsEl.hidden = false;
        tabsEl.innerHTML = state.hipodromlar.map((h) => {
            const sub = h.kosuSayisi + ' koşu'
                + (h.ilkKosuSaat ? ' · 1. ' + h.ilkKosuSaat : '');
            return '<button type="button" class="pub-tahmin-hip-tab" data-id="' + escapeHtml(h.id) + '" role="tab">'
                + escapeHtml(h.name) + '<small>' + escapeHtml(sub) + '</small></button>';
        }).join('');

        tabsEl.querySelectorAll('.pub-tahmin-hip-tab').forEach((btn) => {
            btn.addEventListener('click', () => selectTahminHipodrom(btn.dataset.id));
        });
    }

    function selectTahminHipodrom(id) {
        state.activeTahminHipId = id;
        $$('.pub-tahmin-hip-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
        const hip = state.hipodromlar.find((h) => h.id === id);
        renderTahminRaces(hip);
    }

    function renderTahminAll() {
        renderTahminHipTabs();
        if (!state.hipodromlar.length) {
            renderTahminRaces(null);
            return;
        }
        const keepId = state.activeTahminHipId
            && state.hipodromlar.some((h) => h.id === state.activeTahminHipId)
            ? state.activeTahminHipId
            : state.hipodromlar[0].id;
        selectTahminHipodrom(keepId);
    }

    function renderTahminRaces(hip) {
        const el = $('#pubTahminContent');
        if (!hip || !hip.kosular || !hip.kosular.length) {
            el.innerHTML = '<div class="pub-empty"><div class="pub-empty-icon">🎯</div>'
                + '<h3>Tahmin yok</h3><p>Seçili hipodrom için tahmin gösterilemiyor.</p></div>';
            return;
        }

        el.innerHTML = '<div class="pub-tahmin-row">' + hip.kosular.map((race) => {
            const tahminler = getRaceTahminler(race);
            const rows = tahminler.length
                ? tahminler.map((t) => '<tr>'
                    + '<td><span class="pub-tahmin-rank">' + t.rank + '</span></td>'
                    + '<td><strong>' + escapeHtml(t.horseNo) + '</strong></td>'
                    + '<td class="pub-tahmin-at">' + escapeHtml(t.horseName) + '</td>'
                    + '<td class="pub-tahmin-pct">' + escapeHtml(formatTahminSkor(t)) + '</td>'
                    + '</tr>').join('')
                : '<tr><td colspan="4" style="text-align:center;color:#888">Tahmin henüz üretilmedi</td></tr>';

            const hdr = formatTahminRaceHeader(race);
            const metaHtml = hdr.metaLine
                ? '<span class="pub-tahmin-card-meta">' + escapeHtml(hdr.metaLine) + '</span>'
                : '';

            return '<div class="pub-tahmin-card" data-tahmin-race="' + race.raceNo + '">'
                + '<div class="pub-tahmin-card-hdr">'
                + '<span class="pub-tahmin-card-kosu">' + escapeHtml(hdr.kosuLine) + '</span>'
                + metaHtml
                + '</div>'
                + '<table class="pub-tahmin-table"><thead><tr>'
                + '<th>#</th><th>No</th><th>At</th><th>Skor</th></tr></thead><tbody>'
                + rows + '</tbody></table>'
                + '</div>';
        }).join('') + '</div>';
    }

    function renderTahminPanel(hip) {
        if (hip && hip.id) state.activeTahminHipId = hip.id;
        renderTahminAll();
    }

    function switchTab(panelId) {
        $$('.pub-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === panelId));
        $$('.pub-tab-panel').forEach((p) => {
            const pid = p.id.replace(/^panel-/, '');
            p.classList.toggle('active', pid === panelId);
        });
        updateTabIndicator();
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
                checkMuhtAutoAdvance();
                renderMuhtemeller();
                startMuhtPolling();
            }
            stopProgramGanyanPolling();
        } else {
            stopMuhtPolling();
            pauseTjkTv();
            stopSonucPolling();
            stopRehberPolling();
            if (panelId === 'kosular') {
                refreshProgramGanyanOdds();
                refreshProgramBltData();
                refreshProgramGpData();
                startProgramGanyanPolling();
            } else {
                stopProgramGanyanPolling();
            }
            if (panelId === 'sonuclar') {
                initSonuclarPanel();
            }
            if (panelId === 'rehber') {
                initRehberPanel();
            }
        }
        if (panelId === 'kazanc') {
            window.pubKazanc?.init();
        }
    }

    function getTjkSources() {
        return [TJK_TV_DIRECT, TJK_TV_PROXY];
    }

    function stopTjkWatchdog() {
        if (tjkWatchdogTimer) {
            clearInterval(tjkWatchdogTimer);
            tjkWatchdogTimer = null;
        }
        tjkStallTicks = 0;
    }

    function bindTjkVideoWatchdog(video) {
        stopTjkWatchdog();
        let lastT = -1;
        tjkWatchdogTimer = setInterval(() => {
            if (!video || video.paused || !$('#panel-muhtemeller')?.classList.contains('active')) {
                tjkStallTicks = 0;
                return;
            }
            const t = video.currentTime;
            if (t > 0 && Math.abs(t - lastT) < 0.05 && video.readyState < 3) {
                tjkStallTicks += 1;
                if (tjkStallTicks >= 2) recoverTjkTvSoft();
            } else {
                tjkStallTicks = 0;
            }
            lastT = t;
        }, 5000);
    }

    function createTjkHls() {
        return new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 20,
            maxBufferLength: 25,
            maxMaxBufferLength: 45,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 8,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 4,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
            startFragPrefetch: true
        });
    }

    function pickStableLevel(hls) {
        const levels = hls.levels || [];
        if (!levels.length) return;
        let idx = levels.findIndex((l) => (l.name || '').toUpperCase().includes('480') || l.height === 480);
        if (idx < 0) idx = levels.findIndex((l) => (l.name || '').toUpperCase().includes('720') || l.height === 720);
        if (idx < 0) idx = Math.max(0, levels.length - 1);
        hls.currentLevel = idx;
    }

    function recoverTjkTvSoft() {
        tjkStallTicks = 0;
        const video = document.getElementById('pubTjkTvVideo');
        if (tjkHls) {
            try { tjkHls.startLoad(-1); } catch (_e) { /* ignore */ }
            if (video) video.play().catch(() => {});
            return;
        }
        if (video) {
            video.load();
            video.play().catch(() => {});
        }
    }

    function pauseTjkTv() {
        stopTjkWatchdog();
        document.getElementById('pubTjkTvVideo')?.pause();
    }

    function loadTjkSource(video, src, onReady, onError) {
        if (tjkHls) {
            tjkHls.destroy();
            tjkHls = null;
        }

        const useNative = video.canPlayType('application/vnd.apple.mpegurl')
            && (typeof Hls === 'undefined' || !Hls.isSupported());

        if (useNative) {
            video.src = src;
            video.addEventListener('loadedmetadata', onReady, { once: true });
            video.addEventListener('error', onError, { once: true });
            bindTjkVideoWatchdog(video);
            return;
        }

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            tjkHls = createTjkHls();
            tjkHls.loadSource(src);
            tjkHls.attachMedia(video);
            tjkHls.on(Hls.Events.MANIFEST_PARSED, () => {
                pickStableLevel(tjkHls);
                onReady();
            });
            tjkHls.on(Hls.Events.ERROR, (_evt, data) => {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    try { tjkHls.startLoad(); return; } catch (_e) { /* ignore */ }
                }
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    try { tjkHls.recoverMediaError(); return; } catch (_e) { /* ignore */ }
                }
                onError();
            });
            bindTjkVideoWatchdog(video);
            return;
        }

        onError();
    }

    function hideTjkTvLoading() {
        const el = document.getElementById('pubTjkTvLoading');
        if (el) el.hidden = true;
    }

    function showTjkTvLoading() {
        const el = document.getElementById('pubTjkTvLoading');
        const fb = document.getElementById('pubTjkTvFallback');
        const video = document.getElementById('pubTjkTvVideo');
        if (el) el.hidden = false;
        if (fb) fb.hidden = true;
        if (video) video.style.display = '';
    }

    function showTjkTvFallback() {
        hideTjkTvLoading();
        const fb = document.getElementById('pubTjkTvFallback');
        const video = document.getElementById('pubTjkTvVideo');
        if (fb) fb.hidden = false;
        if (video) video.style.display = 'none';
    }

    function destroyTjkTv() {
        stopTjkWatchdog();
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
        hideTjkTvLoading();
        const fb = document.getElementById('pubTjkTvFallback');
        if (fb) fb.hidden = true;
        tjkTvLoaded = false;
        tjkSourceIdx = 0;
    }

    function ensureTjkTvEmbed() {
        const video = document.getElementById('pubTjkTvVideo');
        if (!video) return;
        if (tjkTvLoaded) {
            video.play().catch(() => {});
            return;
        }
        tjkTvLoaded = true;
        tjkSourceIdx = 0;
        showTjkTvLoading();

        const onReady = () => {
            hideTjkTvLoading();
            video.play().catch(() => {});
        };

        const onError = () => {
            const sources = getTjkSources();
            tjkSourceIdx += 1;
            if (tjkSourceIdx < sources.length) {
                loadTjkSource(video, sources[tjkSourceIdx], onReady, onError);
                return;
            }
            showTjkTvFallback();
        };

        loadTjkSource(video, getTjkSources()[0], onReady, onError);
    }

    function retryTjkTv() {
        destroyTjkTv();
        ensureTjkTvEmbed();
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
            checkMuhtAutoAdvance();
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
            badge = '<span class="pub-muht-pill pub-muht-pill-pick">Seçili #' + escapeHtml(highlightNo) + '</span>';
        } else if (leaderNo) {
            badge = '<span class="pub-muht-pill pub-muht-pill-fav">'
                + '<span class="pub-muht-pill-star" aria-hidden="true">★</span> Favori #' + escapeHtml(leaderNo) + '</span>';
        }

        let html = '<div class="pub-muht-race-card" data-leader-no="' + escapeHtml(leaderNo || '') + '">'
            + '<div class="pub-muht-race-top ' + muhtRaceTopClass(muht.pist) + '">'
            + '<div class="pub-muht-race-title"><strong>' + title + '</strong>'
            + (sub ? '<span>' + escapeHtml(sub) + '</span>' : '') + '</div>'
            + '<div class="pub-muht-race-meta">'
            + '<span class="pub-muht-pill ' + muhtPistPillClass(muht.pist) + '">' + escapeHtml(muht.pist || '') + '</span>'
            + '<span class="pub-muht-pill ' + muhtDurumPillClass(muht.isOpen) + '">' + escapeHtml(muht.durum || '') + '</span>'
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
        content.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Koşu muhtemelleri yükleniyor…<p class="pub-loading-hint">TJK koşu verisi alınıyor</p></div>';
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
        const iso = state.muhtIso || state.iso || localTodayIso();
        if (!state.muhtKosuNo && kosular.length) {
            state.muhtKosuNo = getAutoMuhtKosuNo(kosular, iso) || hip.selected || kosular[0].NO;
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
            const tid = setTimeout(() => controller.abort(), 20000);
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
        content.innerHTML = '<div class="pub-loading"><div class="pub-spinner"></div>Program listesi yükleniyor…<p class="pub-loading-hint">TJK muhtemelleri alınıyor (genelde birkaç saniye)</p></div>';
        $('#pubMuhtLabel').textContent = 'TJK muhtemel programı yükleniyor…';
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 20000);
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
        $('#pubTjkTvRetry')?.addEventListener('click', retryTjkTv);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                pauseTjkTv();
            } else if ($('#panel-muhtemeller')?.classList.contains('active')) {
                document.getElementById('pubTjkTvVideo')?.play().catch(() => {});
                checkMuhtAutoAdvance();
                startMuhtPolling();
            }
        });
    }

    function updateTabIndicator() {
        const track = $('#pubTabTrack');
        const indicator = $('#pubTabIndicator');
        const active = track?.querySelector('.pub-tab.active');
        if (!track || !indicator || !active) return;
        const trackRect = track.getBoundingClientRect();
        const tabRect = active.getBoundingClientRect();
        indicator.style.width = tabRect.width + 'px';
        indicator.style.transform = 'translateX(' + (tabRect.left - trackRect.left) + 'px)';
        const accent = active.dataset.accent;
        if (accent) {
            indicator.style.background = 'linear-gradient(135deg, ' + accent + ' 0%, ' + accent + 'cc 100%)';
            indicator.style.boxShadow = '0 4px 16px ' + accent + '66, inset 0 1px 0 rgba(255,255,255,0.25)';
        }
    }

    function formatHeaderClock(d) {
        return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatHeaderDate(d) {
        return d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }

    function updateHeaderClock() {
        const el = $('#pubHeaderClock');
        const dateEl = $('#pubHeaderDate');
        if (!el) return;
        const now = new Date();
        el.textContent = formatHeaderClock(now);
        el.setAttribute('datetime', now.toISOString());
        el.setAttribute('title', formatHeaderDate(now));
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
        }
    }

    function initTabs() {
        $$('.pub-tab').forEach((tab) => {
            tab.addEventListener('click', () => switchTab(tab.dataset.panel));
        });
        updateTabIndicator();
        window.addEventListener('resize', updateTabIndicator);
    }

    function initHeader() {
        updateHeaderClock();
        setInterval(updateHeaderClock, 1000);
        $('#pubHeaderTahminBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('tahminler');
        });
    }

    function initFobToolbar() {
        const sel = $('#pubFobMode');
        if (!sel) return;
        sel.addEventListener('change', () => onFobModeChange(sel.value));
    }

    function selectProgramDate(iso) {
        const clamped = clampProgramIso(iso);
        const input = $('#pubDateInput');
        if (input) input.value = clamped;
        state.iso = clamped;
        syncDatePills(clamped);
        state.muhtemeller = null;
        state.muhtIso = null;
        state.muhtRaceCache = {};
        state.progGanyanByRace = {};
        state.progGanyanMuhtKey = null;
        state.progBltData = null;
        state.progBltHipId = null;
        state.progGpData = null;
        state.progGpHipId = null;
        state.progGpLoading = false;
        state.progFobData = null;
        state.progFobHipId = null;
        state.progFobLoading = false;
        state.progBtData = null;
        state.progBtHipId = null;
        state.progBtLoading = false;
        state.sonucData = null;
        state.sonucByHip = {};
        state.sonucHipId = null;
        state.sonucLastUpdate = null;
        state.rehberData = null;
        loadVitrin(clamped);
        if ($('#panel-muhtemeller')?.classList.contains('active')) {
            loadMuhtemeller(clamped);
        }
    }

    function initDate() {
        const input = $('#pubDateInput');
        const today = localTodayIso();
        const tomorrow = localTomorrowIso();
        input.min = today;
        input.max = tomorrow;
        input.value = today;
        input.title = 'Sadece bugün ve yarın programları gösterilir';
        $('#pubDatePillToday')?.addEventListener('click', () => selectProgramDate(today));
        $('#pubDatePillTomorrow')?.addEventListener('click', () => selectProgramDate(tomorrow));
        input.addEventListener('change', () => {
            selectProgramDate(input.value);
        });
        loadVitrin(today);
        loadProgramSync();
        startYarinStatusPolling();
        $('#pubSonucRefresh')?.addEventListener('click', () => refreshSonuclarData({ refresh: true }));
        $('#pubProgramSyncRefresh')?.addEventListener('click', () => {
            const body = $('#pubProgramSyncBody');
            if (body) body.innerHTML = '<div class="pub-loading pub-program-sync-loading"><div class="pub-spinner"></div> Durum kontrol ediliyor…</div>';
            loadProgramSync();
        });
    }

    initTabs();
    initHeader();
    initMuhtControls();
    initFobToolbar();
    initDate();
})();
