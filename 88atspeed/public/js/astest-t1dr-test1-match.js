/**
 * KOŞU AT SAYISI — T1×DR=TEST1 eşleşme tablosu
 * GÖSTERİM satırlarında T1×DR ile TEST1 aynı olan geçmiş koşular + bugünkü TAHMİN / GÖ / HYB
 */
const AtestT1drTest1Match = (function () {
    const SON_TEST_BAS_KEYS = [
        'fieldSize', 'sehir', 'kcins_kosu', 'taki', 'pist', 'hp', 'siklet'
    ];

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
                const key = SON_TEST_BAS_KEYS[i];
                basBySource[key] = computeBasForSource(h, race, meta, key, sonCtx, resolveKosular);
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
            const key = horseKey(horseRows[i].h);
            if (key && horseRows[i].tahmin) tahminMap.set(key, horseRows[i].tahmin);
        }

        if (typeof AtestSonPtestTahmin !== 'undefined') {
            calibrated = await AtestSonPtestTahmin.ensureCalibration();
            if (calibrated) {
                const ptestByCol = AtestSonPtestTahmin.scoreRaceAll(race, meta, resolveKosular);
                const go = ptestByCol.go || new Map();
                const hyb = ptestByCol.hyb || new Map();
                go.forEach(function (v, k) { goMap.set(k, v); });
                hyb.forEach(function (v, k) { hybMap.set(k, v); });
            }
        }

        return { tahminMap: tahminMap, goMap: goMap, hybMap: hybMap, calibrated: calibrated };
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
                gosRow: row,
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

    function formatRankPctCell(tahmin, calibrated, cls, missingTitle) {
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

    function gosTest1KirmiziClass(gosRow) {
        if (!gosRow?.classes || typeof GosterimEngine === 'undefined') return '';
        const cls = GosterimEngine.getCellClass(GosterimEngine.COL.TEST1, gosRow.classes);
        return cls && /\bkirmizi-yazi\b/.test(cls) ? ' kirmizi-yazi' : '';
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

    async function renderRaces(races, meta, resolveKosular, escapeHtml) {
        if (!races || !races.length) {
            return '<div class="info-box">📋 Veri bulunamadı</div>';
        }

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
            + '<span id="t1drMatchCalibNote"></span></p>';

        const scoreCache = [];
        for (let ri = 0; ri < races.length; ri++) {
            scoreCache[ri] = await buildRaceScoreMaps(races[ri], meta, resolveKosular);
        }

        const anyCalibrated = scoreCache.some(function (s) { return s.calibrated; });
        const calibNote = anyCalibrated
            ? ''
            : '<span style="color:#c62828"> GÖ/HYB kalibrasyonu arka planda yükleniyor veya kayıt+bitiş gerekli.</span>';

        html = html.replace('<span id="t1drMatchCalibNote"></span>', calibNote);

        for (let ri = 0; ri < races.length; ri++) {
            const race = races[ri];
            const matches = collectMatchRows(race, meta, resolveKosular);
            const scores = scoreCache[ri];
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
            html += '</tr></thead><tbody>';

            for (let mi = 0; mi < matches.length; mi++) {
                const m = matches[mi];
                const hk = horseKey(m.horse);
                const bitis = extractBitis(m.horse);
                const tahmin = hk ? scores.tahminMap.get(hk) : null;
                const go = hk ? scores.goMap.get(hk) : null;
                const hyb = hk ? scores.hybMap.get(hk) : null;
                const horseLabel = m.horse?.no != null
                    ? '#' + m.horse.no + ' ' + (m.horse?.name || '').replace(/\(\d+\)\s*$/, '').trim()
                    : (m.horse?.name || '—');

                html += '<tr>';
                html += formatBitisCell(bitis);
                html += '<td class="col-name">' + escapeHtml(horseLabel) + '</td>';
                html += '<td class="t1dr-match-gsira">' + escapeHtml(String(m.gSira)) + '</td>';
                html += '<td>' + escapeHtml(String(m.tarih)) + '</td>';
                html += '<td>' + escapeHtml(String(m.sehir)) + '</td>';
                html += '<td>' + escapeHtml(String(m.mesafe)) + '</td>';
                html += '<td class="t1dr-match-val t1dr-match-val-t1dr">' + escapeHtml(String(m.t1dr)) + '</td>';
                html += '<td class="t1dr-match-val t1dr-match-val-test1'
                    + gosTest1KirmiziClass(m.gosRow) + '">' + escapeHtml(String(m.test1)) + '</td>';
                html += formatRankPctCell(
                    tahmin, true, 't1dr-match-tahmin', 'TAHMİN hesaplanamadı');
                html += formatRankPctCell(
                    go, scores.calibrated, 't1dr-match-go', 'PUANLAMA TEST kalibrasyonu gerekli');
                html += formatRankPctCell(
                    hyb, scores.calibrated, 't1dr-match-hyb', 'PUANLAMA TEST kalibrasyonu gerekli');
                html += '</tr>';
            }

            html += '</tbody></table></div></div>';
        }

        html += '</div>';
        return html;
    }

    function bindRaceSelector(root) {
        const host = root || document;
        const sel = host.querySelector ? host.querySelector('#t1drRaceSelect') : null;
        if (!sel) return;
        sel.addEventListener('change', function () {
            const idx = String(sel.value);
            host.querySelectorAll('.t1dr-test1-race').forEach(function (el) {
                el.style.display = el.getAttribute('data-race-idx') === idx ? '' : 'none';
            });
        });
    }

    return {
        t1drEqualsTest1,
        collectMatchRows,
        buildRaceScoreMaps,
        renderRaces,
        bindRaceSelector,
        horseKey
    };
})();

if (typeof module !== 'undefined') module.exports = { AtestT1drTest1Match };
