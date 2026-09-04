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
        progGanyanLoading: false
    };

    const MUHT_REFRESH_SEC = 15;
    const PROG_GANYAN_REFRESH_SEC = 15;
    const MUHT_SELECT_RESET_MS = 30000;
    const MUHT_RACE_ADVANCE_MS = 3 * 60 * 1000;
    const TJK_TV_DIRECT = 'https://tjktv-live.tjk.org/tjktv/tjktv.m3u8';
    const TJK_TV_PROXY = '/api/public/tjk-tv?f=tjktv.m3u8';
    let muhtPollTimer = null;
    let progGanyanPollTimer = null;
    let muhtSelectTimer = null;
    let tjkTvLoaded = false;
    let tjkHls = null;
    let tjkSourceIdx = 0;
    let tjkWatchdogTimer = null;
    let tjkStallTicks = 0;

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
            + renderProgramSyncDay({ ...data.tomorrow, label: 'Yarın · ' + (data.tomorrow.tarih || '') })
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
        try {
            const res = await fetch('/api/public/program-sync');
            const data = await res.json();
            renderProgramSync(data);
        } catch (err) {
            el.innerHTML = '<div class="pub-program-sync-meta">Bağlantı hatası: ' + escapeHtml(err.message || '') + '</div>';
        }
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
            renderTahminAll();
            if ($('#panel-kosular')?.classList.contains('active')) {
                startProgramGanyanPolling();
            }
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
        refreshProgramGanyanOdds();
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
        progGanyanPollTimer = setInterval(() => {
            if (document.hidden) return;
            if (!$('#panel-kosular')?.classList.contains('active')) return;
            countdown -= 1;
            if (countdown <= 0) {
                countdown = PROG_GANYAN_REFRESH_SEC;
                refreshProgramGanyanOdds({ refresh: true });
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
        return cols.filter((c) => c.always || has(c.key));
    }

    function renderProgramColgroup(cols) {
        return '<colgroup>'
            + cols.map((c) => '<col class="' + c.colCls + '">').join('')
            + '<col class="pub-col-spacer">'
            + '</colgroup>';
    }

    function programHorseCell(h, col, ctx) {
        if (col.key === 'ganyan') {
            const odd = ctx?.ganyanMap?.[String(h.no)] || '';
            return odd || '—';
        }
        if (col.key === 'name') return h.name || '—';
        const v = String(h[col.key] || '').trim();
        return v || '—';
    }

    function renderRaceList(hip) {
        const el = $('#pubRaceList');
        const kosular = hip.kosular || [];
        if (!kosular.length) {
            el.innerHTML = '<div class="pub-empty"><h3>Koşu bulunamadı</h3></div>';
            return;
        }

        const cols = getProgramColumns(kosular);
        const colgroup = renderProgramColgroup(cols);

        el.innerHTML = '<div class="pub-program-list">' + kosular.map((race) => {
            const hdr = formatProgramRaceHeader(race);
            const surfaceClass = getRaceSurfaceClass(race);
            const ganyanMap = getRaceGanyanMap(race.raceNo);
            const leaderNo = findGanyanLeaderNo(ganyanMap);
            const head = cols.map((c) => {
                const titleAttr = c.title ? ' title="' + escapeHtml(c.title) + '"' : '';
                return '<th' + titleAttr + '>' + c.label + '</th>';
            }).join('') + '<th class="pub-col-spacer-hdr" aria-hidden="true"></th>';
            const horses = race.horses || [];
            const body = horses.length
                ? horses.map((h) => {
                    const ctx = { ganyanMap };
                    return '<tr>'
                        + cols.map((c) => {
                            let cls = c.cls;
                            const val = programHorseCell(h, c, ctx);
                            if (c.key === 'ganyan') {
                                if (!ganyanMap[String(h.no)]) cls += ' pub-prog-ganyan-empty';
                                else if (leaderNo && String(h.no) === leaderNo) cls += ' pub-prog-ganyan-leader';
                            }
                            return '<td class="' + cls + '">' + escapeHtml(val) + '</td>';
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
                startMuhtPolling();
            }
            stopProgramGanyanPolling();
        } else {
            stopMuhtPolling();
            pauseTjkTv();
            if (panelId === 'kosular') {
                refreshProgramGanyanOdds();
                startProgramGanyanPolling();
            } else {
                stopProgramGanyanPolling();
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

    function initDate() {
        const input = $('#pubDateInput');
        const iso = localTodayIso();
        input.value = iso;
        input.addEventListener('change', () => {
            state.iso = input.value;
            state.muhtemeller = null;
            state.muhtIso = null;
            state.muhtRaceCache = {};
            state.progGanyanByRace = {};
            state.progGanyanMuhtKey = null;
            loadVitrin(input.value);
            if ($('#panel-muhtemeller')?.classList.contains('active')) {
                loadMuhtemeller(input.value);
            }
        });
        loadVitrin(iso);
        loadProgramSync();
        $('#pubProgramSyncRefresh')?.addEventListener('click', () => {
            const body = $('#pubProgramSyncBody');
            if (body) body.innerHTML = '<div class="pub-loading pub-program-sync-loading"><div class="pub-spinner"></div> Durum kontrol ediliyor…</div>';
            loadProgramSync();
        });
    }

    initTabs();
    initHeader();
    initMuhtControls();
    initDate();
})();
