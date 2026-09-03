/**
 * KOŞU AT SAYISI — T1×DR=TEST1 eşleşme tablosu
 * GÖSTERİM satırlarında T1×DR ile TEST1 aynı olan geçmiş koşular + bugünkü TAHMİN / GÖ / HYB
 */
const AtestT1drTest1Match = (function () {
    const SON_TEST_BAS_KEYS = [
        'fieldSize', 'sehir', 'kcins_kosu', 'taki', 'pist', 'hp', 'siklet'
    ];

    let calibDone = false;
    const raceScoreCache = new Map();
    let renderCtx = null;

    function horseKey(h) {
        if (h?.atId != null && h.atId !== '') return String(h.atId);
        if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
        if (h?.name) return 'name:' + String(h.name);
        return null;
    }

    function enrichRace(race, resolveKosular) {
        const horses = (race.horses || []).map(function (h) {
            return Object.assign({}, h, {
                kosular: resolveKosular ? resolveKosular(h) : (h.kosular || [])
            });
        });
        return Object.assign({}, race, { horses: horses });
    }

    function cellVal(v) {
        if (v == null || v === '' || v === '-') return null;
        return String(v).trim();
    }

    function t1drEqualsTest1(t1dr, test1) {
        const a = cellVal(t1dr);
        const b = cellVal(test1);
        if (!a || !b) return false;
        if (a === b) return true;
        if (typeof AtSpeedUtils !== 'undefined') {
            const sa = AtSpeedUtils.dereceToSalise(a);
            const sb = AtSpeedUtils.dereceToSalise(b);
            if (sa != null && sb != null) return sa === sb;
        }
        return false;
    }

    function extractBitis(h) {
        if (typeof AtSpeedUtils !== 'undefined') {
            return AtSpeedUtils.extractBitisFromHorseName(h?.name);
        }
        return null;
    }

    function cacheKey(meta, race) {
        return (meta?.kayitId || meta?.tarih || '') + '|' + (race?.raceNo ?? '');
    }

    function resetScoreCache() {
        raceScoreCache.clear();
        calibDone = false;
        renderCtx = null;
    }

    async function ensurePtestCalibration() {
        if (calibDone) return !!AtestSonPtestTahmin?.isCalibrated?.();
        if (typeof AtestSonPtestTahmin === 'undefined') return false;
        const ok = await AtestSonPtestTahmin.ensureCalibration();
        calibDone = !!ok;
        return calibDone;
    }

    function computeBasForSource(horse, race, meta, sourceKey, sonCtx, resolveKosular) {
        const kosular = resolveKosular ? resolveKosular(horse) : (horse.kosular || []);
        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        let st;
        if (sourceKey === 'fieldSize') {
            st = FieldSizeStatsEngine.computeStats(
                kosular, programTarih, FieldSizeStatsEngine.raceFieldSize(race));
        } else if (sourceKey === 'sehir') {
            st = SehirStatsEngine.computeStats(kosular, hedefSehir, programTarih);
        } else {
            const dim = KosuDimensionStatsEngine.getDim(sourceKey);
            if (!dim) return { basSuccess: { display: '—' } };
            const horseCtx = Object.assign({}, horse, { kosular: kosular });
            const hedef = dim.getTarget(horseCtx, race);
            st = KosuDimensionStatsEngine.computeStats(kosular, sourceKey, hedef, programTarih);
        }
        if (typeof AtestSon800Shared !== 'undefined' && sonCtx) {
            st = AtestSon800Shared.applyBasDeltaBoost(st, horse, sonCtx);
        }
        return st;
    }

    /** Koşu başına at → TAHMİN / GÖ / HYB skor haritaları */
    async function buildRaceScoreMaps(race, meta, resolveKosular) {
        const key = cacheKey(meta, race);
        if (raceScoreCache.has(key)) return raceScoreCache.get(key);

        const tahminMap = new Map();
        const goMap = new Map();
        const hybMap = new Map();
        let calibrated = false;

        const horses = [...(race.horses || [])].sort(function (a, b) {
            const na = parseInt(a.no, 10);
            const nb = parseInt(b.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
        });

        const programTarih = meta?.tarih || null;
        const hedefSehir = meta?.hipodrom || '';
        const sonCtx = typeof AtestSon800Shared !== 'undefined'
            ? AtestSon800Shared.buildRaceContext(race, horses, hedefSehir, programTarih)
            : null;

        const horseRows = horses.map(function (h) {
            const basBySource = {};
            for (let i = 0; i < SON_TEST_BAS_KEYS.length; i++) {
                const sk = SON_TEST_BAS_KEYS[i];
                basBySource[sk] = computeBasForSource(h, race, meta, sk, sonCtx, resolveKosular);
            }
            const pcts = SON_TEST_BAS_KEYS.map(function (k) {
                return basBySource[k]?.basSuccess?.pct;
            }).filter(function (p) { return p != null; });
            const avgPct = pcts.length
                ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length)
                : null;
            return {
                h: h,
                basBySource: basBySource,
                st: { basSuccess: { pct: avgPct } },
                tahmin: null
            };
        });

        if (typeof DimensionTahminBoostEngine !== 'undefined') {
            DimensionTahminBoostEngine.computeDimensionOnlyFromBasBySource(horseRows);
        }

        const gosByKey = typeof AtestSonGosterimCols !== 'undefined'
            ? AtestSonGosterimCols.buildSiraOneMap(race, meta, resolveKosular)
            : new Map();
        if (typeof AtestSonGosterimCols !== 'undefined' && gosByKey.size) {
            AtestSonGosterimCols.applyTahminBonuses(
                horseRows, gosByKey, race, meta, resolveKosular);
        }

        for (let i = 0; i < horseRows.length; i++) {
            const hk = horseKey(horseRows[i].h);
            if (hk && horseRows[i].tahmin) tahminMap.set(hk, horseRows[i].tahmin);
        }

        calibrated = await ensurePtestCalibration();
        if (calibrated && typeof AtestSonPtestTahmin !== 'undefined') {
            const ptestByCol = AtestSonPtestTahmin.scoreRaceAll(race, meta, resolveKosular);
            const go = ptestByCol.go || new Map();
            const hyb = ptestByCol.hyb || new Map();
            go.forEach(function (v, k) { goMap.set(k, v); });
            hyb.forEach(function (v, k) { hybMap.set(k, v); });
        }

        const result = { tahminMap: tahminMap, goMap: goMap, hybMap: hybMap, calibrated: calibrated };
        raceScoreCache.set(key, result);
        return result;
    }

    function collectMatchRows(race, meta, resolveKosular) {
        const out = [];
        if (typeof GosterimEngine === 'undefined') return out;
        const calcRace = enrichRace(race, resolveKosular);
        const rows = GosterimEngine.buildRaceRows(calcRace, {
            programTarih: meta?.tarih || null,
            hipodromSehir: meta?.hipodrom || '',
            raceIndex: 0
        });
        const COL = GosterimEngine.COL;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const t1dr = row.values[COL.TEST1_ENTEGRE];
            const test1 = row.values[COL.TEST1];
            if (!t1drEqualsTest1(t1dr, test1)) continue;
            const hi = row.meta?.horseIndex;
            const horse = hi != null ? calcRace.horses[hi] : null;
            if (!horse) continue;
            out.push({
                horse: horse,
                gSira: row.values[COL.SIRA_NO] || '—',
                tarih: row.values[COL.TARIH] || '—',
                sehir: row.values[COL.SEHIR] || '—',
                mesafe: row.values[COL.MESAFE] || '—',
                t1dr: t1dr,
                test1: test1
            });
        }
        return out;
    }

    function formatRankPctCell(tahmin, calibrated, cls, missingTitle, loading) {
        if (loading) {
            return '<td class="' + cls + ' t1dr-score-pending" title="Hesaplanıyor…">…</td>';
        }
        if (!calibrated) {
            return '<td class="' + cls + '" title="' + (missingTitle || 'Kalibrasyon gerekli') + '">—</td>';
        }
        if (!tahmin || tahmin.rank == null || tahmin.pct == null) {
            return '<td class="' + cls + '">—</td>';
        }
        const label = tahmin.scenarioLabel || tahmin.source || '';
        const tip = (label ? label + ' · ' : '') + tahmin.rank + '. · %' + tahmin.pct;
        return '<td class="' + cls + '" title="' + tip.replace(/"/g, '&quot;') + '">'
            + '<span class="son-test-tahmin-rank">' + tahmin.rank + '.</span>'
            + '<span class="son-test-tahmin-pct">%' + tahmin.pct + '</span></td>';
    }

    function formatBitisCell(bitis) {
        let cls = 't1dr-match-bitis';
        let display = '—';
        if (bitis != null && bitis >= 1) {
            display = bitis === 1 ? '★ ' + bitis : String(bitis);
            if (bitis === 1) cls += ' t1dr-match-bitis-win';
        }
        const tip = bitis != null
            ? 'Bugünkü koşu bitiş sırası'
            : 'BİTİŞ yok — PUANLAMA TEST veya at adı (sıra) gerekli';
        return '<td class="' + cls + '" title="' + tip + '">' + display + '</td>';
    }

    function buildMatchTableBody(matches, scores, escapeHtml, pending) {
        let html = '';
        for (let mi = 0; mi < matches.length; mi++) {
            const m = matches[mi];
            const hk = horseKey(m.horse);
            const bitis = extractBitis(m.horse);
            const tahmin = hk && scores ? scores.tahminMap.get(hk) : null;
            const go = hk && scores ? scores.goMap.get(hk) : null;
            const hyb = hk && scores ? scores.hybMap.get(hk) : null;
            const horseLabel = m.horse?.no != null
                ? '#' + m.horse.no + ' ' + (m.horse?.name || '').replace(/\(\d+\)\s*$/, '').trim()
                : (m.horse?.name || '—');

            html += '<tr data-horse-key="' + escapeHtml(hk || '') + '">';
            html += formatBitisCell(bitis);
            html += '<td class="col-name">' + escapeHtml(horseLabel) + '</td>';
            html += '<td class="t1dr-match-gsira">' + escapeHtml(String(m.gSira)) + '</td>';
            html += '<td>' + escapeHtml(String(m.tarih)) + '</td>';
            html += '<td>' + escapeHtml(String(m.sehir)) + '</td>';
            html += '<td>' + escapeHtml(String(m.mesafe)) + '</td>';
            html += '<td class="t1dr-match-val t1dr-match-val-t1dr">' + escapeHtml(String(m.t1dr)) + '</td>';
            html += '<td class="t1dr-match-val t1dr-match-val-test1">' + escapeHtml(String(m.test1)) + '</td>';
            html += formatRankPctCell(tahmin, true, 't1dr-match-tahmin', 'TAHMİN hesaplanamadı', pending);
            html += formatRankPctCell(go, scores?.calibrated, 't1dr-match-go', 'PUANLAMA TEST kalibrasyonu gerekli', pending);
            html += formatRankPctCell(hyb, scores?.calibrated, 't1dr-match-hyb', 'PUANLAMA TEST kalibrasyonu gerekli', pending);
            html += '</tr>';
        }
        return html;
    }

    function renderRacesShell(races, meta, resolveKosular, escapeHtml) {
        const matchCache = races.map(function (r) {
            return collectMatchRows(r, meta, resolveKosular);
        });

        let html = '<div class="son-test-wrap t1dr-test1-wrap">';
        if (races.length > 1) {
            html += '<div class="t1dr-race-select-wrap"><label for="t1drRaceSelect">Koşu seç:</label> ';
            html += '<select id="t1drRaceSelect" class="t1dr-race-select">';
            for (let ri = 0; ri < races.length; ri++) {
                const race = races[ri];
                const header = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.formatRaceHeader(race)
                    : ((race.mesafe || '?') + ' ' + (race.pist || '')).trim();
                const label = race.raceNo + '. KOŞU · ' + (race.horses || []).length
                    + ' at · ' + header;
                html += '<option value="' + ri + '">' + escapeHtml(label) + '</option>';
            }
            html += '</select></div>';
        }
        html += '<p class="astest-note">Tüm <strong>GÖSTERİM</strong> satırları taranır; <strong>T1×DR</strong> ile <strong>TEST1</strong> '
            + 'değeri birebir aynı olan satırlar listelenir. '
            + '<strong>BİTİŞ</strong> = bugünkü koşu bitiş sırası · '
            + '<strong>G.SIRA</strong> = geçmiş satır numarası · '
            + '<strong>TAHMİN / GÖ / HYB</strong> = bugünkü koşu motor sıraları. '
            + '<span id="t1drMatchCalibNote" class="t1dr-calib-note"></span></p>';

        for (let ri = 0; ri < races.length; ri++) {
            const race = races[ri];
            const matches = matchCache[ri];
            const header = typeof AtMetaFields !== 'undefined'
                ? AtMetaFields.formatRaceHeader(race)
                : ((race.mesafe || '?') + ' ' + (race.pist || '')).trim();
            const horseCount = (race.horses || []).length;
            const uniqueHorses = new Set(matches.map(function (m) { return horseKey(m.horse); })).size;

            html += '<div class="son-test-race race-card t1dr-test1-race" data-race-idx="' + ri + '"'
                + (races.length > 1 && ri > 0 ? ' style="display:none"' : '') + '>';
            html += '<div class="race-header"><h3>🏁 ' + race.raceNo + '. KOŞU · '
                + horseCount + ' at · ' + escapeHtml(header) + '</h3></div>';
            html += '<p class="t1dr-match-summary">' + matches.length + ' eşleşme satırı · '
                + uniqueHorses + ' at</p>';

            if (!matches.length) {
                html += '<div class="info-box">Bu koşuda T1×DR=TEST1 eşleşmesi yok</div></div>';
                continue;
            }

            html += '<div class="son-test-table-wrap">';
            html += '<table class="son-test-table t1dr-test1-table">';
            html += '<thead><tr>';
            html += '<th class="t1dr-match-th-bitis">BİTİŞ</th>';
            html += '<th class="col-name">AT İSMİ</th>';
            html += '<th class="t1dr-match-th-gsira">G.SIRA</th>';
            html += '<th>TARİH</th><th>ŞEHİR</th><th>MESAFE</th>';
            html += '<th class="t1dr-match-th-t1dr">T1×DR</th>';
            html += '<th class="t1dr-match-th-test1">TEST1</th>';
            html += '<th class="t1dr-match-th-tahmin">TAHMİN</th>';
            html += '<th class="t1dr-match-th-go">GÖ</th>';
            html += '<th class="t1dr-match-th-hyb">HYB</th>';
            html += '</tr></thead>';
            html += '<tbody data-race-body="' + ri + '">';
            html += buildMatchTableBody(matches, null, escapeHtml, true);
            html += '</tbody></table></div></div>';
        }

        html += '</div>';
        return { html: html, matchCache: matchCache };
    }

    function updateRaceScoreCells(host, raceIdx, matches, scores, escapeHtml) {
        const tbody = host.querySelector('tbody[data-race-body="' + raceIdx + '"]');
        if (!tbody) return;
        tbody.innerHTML = buildMatchTableBody(matches, scores, escapeHtml, false);
    }

    function updateCalibNote(host, calibrated) {
        const note = host.querySelector('.t1dr-calib-note');
        if (!note) return;
        note.innerHTML = calibrated
            ? ''
            : '<span style="color:#c62828"> GÖ/HYB kalibrasyonu arka planda yükleniyor veya kayıt+bitiş gerekli.</span>';
    }

    async function hydrateRaceScores(host, raceIdx) {
        if (!renderCtx) return;
        const race = renderCtx.races[raceIdx];
        if (!race) return;
        const matches = renderCtx.matchCache[raceIdx] || [];
        if (!matches.length) return;

        const tbody = host.querySelector('tbody[data-race-body="' + raceIdx + '"]');
        if (tbody && !tbody.querySelector('.t1dr-score-pending')) return;

        try {
            const scores = await buildRaceScoreMaps(race, renderCtx.meta, renderCtx.resolveKosular);
            updateRaceScoreCells(host, raceIdx, matches, scores, renderCtx.escapeHtml);
            if (scores.calibrated) updateCalibNote(host, true);
        } catch (err) {
            console.error('T1DR score hydrate failed', err);
            if (tbody) {
                tbody.querySelectorAll('.t1dr-score-pending').forEach(function (td) {
                    td.textContent = '—';
                    td.title = 'Skor yüklenemedi';
                });
            }
        }
    }

    async function renderRaces(races, meta, resolveKosular, escapeHtml) {
        resetScoreCache();
        renderCtx = { races: races, meta: meta, resolveKosular: resolveKosular, escapeHtml: escapeHtml, matchCache: [] };

        const shell = renderRacesShell(races, meta, resolveKosular, escapeHtml);
        renderCtx.matchCache = shell.matchCache;
        return shell.html;
    }

    async function hydrateVisibleRace(host) {
        if (!renderCtx || !host) return;
        const sel = host.querySelector('#t1drRaceSelect');
        const raceIdx = sel ? parseInt(sel.value, 10) : 0;
        await hydrateRaceScores(host, isNaN(raceIdx) ? 0 : raceIdx);
    }

    function bindRaceSelector(root, races, meta, resolveKosular, escapeHtml) {
        const host = root || document;
        const sel = host.querySelector ? host.querySelector('#t1drRaceSelect') : null;

        async function onRaceChange() {
            const idx = sel ? String(sel.value) : '0';
            host.querySelectorAll('.t1dr-test1-race').forEach(function (el) {
                el.style.display = el.getAttribute('data-race-idx') === idx ? '' : 'none';
            });
            await hydrateRaceScores(host, parseInt(idx, 10) || 0);
        }

        if (sel) sel.addEventListener('change', onRaceChange);
        hydrateVisibleRace(host);
    }

    return {
        t1drEqualsTest1,
        collectMatchRows,
        buildRaceScoreMaps,
        renderRaces,
        hydrateVisibleRace,
        bindRaceSelector,
        resetScoreCache,
        horseKey
    };
})();

if (typeof module !== 'undefined') module.exports = { AtestT1drTest1Match };
