/**
 * SON TEST — HYB sonrası GÖSTERİM (SIRA=1) sütunları · tam renklendirme
 * + GÖSTERİM yanıp sönen hücreler → TAHMİN ödülü
 */
const AtestSonGosterimCols = (function () {
    const TEST9_YANIP_TAHMIN_BONUS = 45;
    const FARK8002_YANIP_TAHMIN_BONUS = 5;
    const TEST123_KIRMIZI_TAHMIN_BONUS = 25;
    const TEST1_GREEN_SINGLE_BONUS = 15;
    const TEST1_GREEN_MULTI_BASE = 15;
    const TEST1_GREEN_MULTI_STEP = 3;
    const TEST1_RANK_BONUSES = [7, 5, 3];
    const TEST1_RANK_KIRMIZI_EXTRA = 3;
    const AT_ISMI_MAVI_BONUS = 5;
    const AT_ISMI_MAVI_PENALTY = 5;
    const AT_ID_MAVI_BONUS = 7;
    const AT_ID_MAVI_PENALTY = 3;
    const TARIH_MAVI_BONUS = 5;
    const TARIH_MAVI_PENALTY = 3;
    const AT_ID_TARIH_IKISI_MAVI_BONUS = 4;
    const AT_ISMI_KENAR_MAVI_BONUS = 3;
    const AT_ISMI_KENAR_KIRMIZI_BONUS = 3;

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

    function satirRowClasses(satirClass) {
        if (!satirClass) return [];
        return String(satirClass).split(/\s+/).filter(Boolean).map(function (c) {
            return 'gos-row-' + c;
        });
    }

    /**
     * Koşu başına at → GÖSTERİM SIRA=1 (en yeni geçmiş koşu) satırı
     */
    function buildSiraOneMap(race, meta, resolveKosular) {
        const out = new Map();
        if (typeof GosterimEngine === 'undefined') return out;
        const calcRace = enrichRace(race, resolveKosular);
        const rows = GosterimEngine.buildRaceRows(calcRace, {
            programTarih: meta?.tarih || null,
            hipodromSehir: meta?.hipodrom || '',
            raceIndex: 0
        });
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.values[0] !== '1') continue;
            const hi = row.meta?.horseIndex;
            if (hi == null || hi < 0) continue;
            const horse = calcRace.horses[hi];
            if (!horse) continue;
            const key = horseKey(horse);
            if (key) out.set(key, row);
        }
        return out;
    }

    /** GÖSTERİM SIRA (col 0) ile birebir aynı hücre sınıfları — SON TEST # sütunu */
    function noCellClassList(gosRow) {
        const cls = ['col-no'];
        if (!gosRow || typeof GosterimEngine === 'undefined') return cls;
        cls.push(...satirRowClasses(gosRow.classes?.satirClass));
        const cellClass = GosterimEngine.getCellClass(0, gosRow.classes);
        if (cellClass) cls.push(...String(cellClass).split(/\s+/).filter(Boolean));
        return cls;
    }

    function renderNoCell(h, gosRow, rowIndex, escapeHtml) {
        const val = String(h?.no ?? (rowIndex + 1));
        const cls = noCellClassList(gosRow).join(' ');
        return '<td class="' + cls + '">' + escapeHtml(val) + '</td>';
    }

    function renderHeaderCells(escapeHtml) {
        const headers = typeof GosterimHeaders !== 'undefined'
            ? GosterimHeaders.getHeaders()
            : [];
        let html = '';
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            const edge = i === 0 ? ' col-gos-hdr-first' : '';
            html += '<th class="col-gos-hdr col-gos' + edge + '"'
                + (h.title ? ' title="' + escapeHtml(h.title) + '"' : '')
                + '>' + escapeHtml(h.label) + '</th>';
        }
        return html;
    }

    function renderRowCells(gosRow, escapeHtml) {
        const colCount = typeof GosterimHeaders !== 'undefined'
            ? GosterimHeaders.getHeaders().length
            : 0;
        if (!colCount) return '';
        if (!gosRow) {
            let empty = '';
            for (let i = 0; i < colCount; i++) {
                const edge = i === 0 ? ' col-gos-hdr-first' : '';
                empty += '<td class="col-gos' + edge + '">—</td>';
            }
            return empty;
        }
        const satir = satirRowClasses(gosRow.classes?.satirClass);
        let html = '';
        for (let c = 0; c < gosRow.values.length; c++) {
            const cellClass = GosterimEngine.getCellClass(c, gosRow.classes);
            const cls = ['col-gos'].concat(satir);
            if (c === 0) cls.push('col-gos-hdr-first');
            if (cellClass) cls.push(cellClass);
            html += '<td class="' + cls.join(' ') + '">'
                + escapeHtml(String(gosRow.values[c] ?? '—'))
                + '</td>';
        }
        return html;
    }

    /** TEST1 + TEST2 + TEST3 hücrelerinin üçünün de kirmizi-yazi olması */
    function allTest123Kirmizi(gosRow) {
        if (!gosRow?.classes || typeof GosterimEngine === 'undefined') return false;
        const cols = [
            GosterimEngine.COL.TEST1,
            GosterimEngine.COL.TEST2,
            GosterimEngine.COL.TEST3
        ];
        for (let i = 0; i < cols.length; i++) {
            const cellClass = GosterimEngine.getCellClass(cols[i], gosRow.classes);
            if (!cellClass || !/\bkirmizi-yazi\b/.test(cellClass)) return false;
        }
        return true;
    }

    /** TEST1 hücresi yeşil eşleşme (eslesme-yesil) */
    function isTest1GreenCell(gosRow) {
        if (!gosRow?.classes || typeof GosterimEngine === 'undefined') return false;
        const cellClass = GosterimEngine.getCellClass(GosterimEngine.COL.TEST1, gosRow.classes);
        return !!(cellClass && /\beslesme-yesil\b/.test(cellClass));
    }

    function test1SortKey(gosRow) {
        if (!gosRow?.values || typeof GosterimEngine === 'undefined') return null;
        const raw = gosRow.values[GosterimEngine.COL.TEST1];
        if (!raw || raw === '-') return null;
        if (typeof AtSpeedUtils !== 'undefined' && AtSpeedUtils.dereceToSalise) {
            return AtSpeedUtils.dereceToSalise(raw);
        }
        return null;
    }

    /** TEST1 hücresi kırmızı yazı */
    function isTest1Kirmizi(gosRow) {
        if (!gosRow?.classes || typeof GosterimEngine === 'undefined') return false;
        const cellClass = GosterimEngine.getCellClass(GosterimEngine.COL.TEST1, gosRow.classes);
        return !!(cellClass && /\bkirmizi-yazi\b/.test(cellClass));
    }

    /**
     * Koşuda en iyi 3 TEST1 süresi → +7 / +5 / +3
     * TEST1 hücresi kırmızı yazıysa ek +3
     */
    function computeTest1RankBonuses(horseRows, gosByKey) {
        const out = new Map();
        const ranked = [];
        for (let i = 0; i < horseRows.length; i++) {
            const key = horseKey(horseRows[i].h);
            if (!key) continue;
            const gos = gosByKey.get(key);
            if (!gos) continue;
            const salise = test1SortKey(gos);
            if (salise == null) continue;
            ranked.push({
                key: key,
                salise: salise,
                gos: gos,
                display: gos.values[GosterimEngine.COL.TEST1],
                no: parseInt(horseRows[i].h?.no, 10)
            });
        }
        ranked.sort(function(a, b) {
            if (a.salise !== b.salise) return a.salise - b.salise;
            if (!isNaN(a.no) && !isNaN(b.no) && a.no !== b.no) return a.no - b.no;
            return String(a.key).localeCompare(String(b.key), 'tr');
        });
        const topN = Math.min(3, ranked.length);
        for (let r = 0; r < topN; r++) {
            const entry = ranked[r];
            let bonus = TEST1_RANK_BONUSES[r];
            let label = 'TEST1 top-' + (r + 1) + ' · ' + (entry.display || '?') + ' +' + bonus;
            if (isTest1Kirmizi(entry.gos)) {
                bonus += TEST1_RANK_KIRMIZI_EXTRA;
                label += ' + kırmızı +' + TEST1_RANK_KIRMIZI_EXTRA;
            }
            out.set(entry.key, { bonus: bonus, label: label });
        }
        return out;
    }

    /**
     * Aynı koşuda TEST1 yeşil hücre sayısına göre TAHMİN ödülü.
     * 1 at → +%15 · 2+ at → TEST1 değeri (en iyi süre) sırasıyla 15, 12, 9…
     */
    function computeTest1GreenBonuses(horseRows, gosByKey) {
        const out = new Map();
        const green = [];
        for (let i = 0; i < horseRows.length; i++) {
            const key = horseKey(horseRows[i].h);
            if (!key) continue;
            const gos = gosByKey.get(key);
            if (!gos || !isTest1GreenCell(gos)) continue;
            green.push({
                key: key,
                salise: test1SortKey(gos),
                display: gos.values[GosterimEngine.COL.TEST1]
            });
        }
        if (green.length === 1) {
            out.set(green[0].key, {
                bonus: TEST1_GREEN_SINGLE_BONUS,
                label: 'TEST1 yeşil (tek at)'
            });
        } else if (green.length >= 2) {
            green.sort(function(a, b) {
                if (a.salise == null && b.salise == null) return 0;
                if (a.salise == null) return 1;
                if (b.salise == null) return -1;
                return a.salise - b.salise;
            });
            for (let r = 0; r < green.length; r++) {
                const bonus = Math.max(0, TEST1_GREEN_MULTI_BASE - r * TEST1_GREEN_MULTI_STEP);
                out.set(green[r].key, {
                    bonus: bonus,
                    label: 'TEST1 yeşil #' + (r + 1) + ' · ' + (green[r].display || '?')
                });
            }
        }
        return out;
    }

    /** Son 7/3/2 koşu 8002-8001 ort. 0'a en yakın 3 at → AT İSMİ / AT ID / TARİH mavi */
    function buildSifiraYakinKeySets(race, meta, resolveKosular) {
        const out = { son7: new Set(), son3: new Set(), son2: new Set() };
        if (typeof GosterimEngine === 'undefined' || !race) return out;
        const calcRace = enrichRace(race, resolveKosular);
        const bundle = GosterimEngine.collectSifiraYakin8002Ortalamalar(calcRace);
        for (let j = 0; j < calcRace.horses.length; j++) {
            const k = horseKey(calcRace.horses[j]);
            if (!k) continue;
            if (bundle.sifiraYakinAtlarSon7?.has(j)) out.son7.add(k);
            if (bundle.sifiraYakinAtlarSon3?.has(j)) out.son3.add(k);
            if (bundle.sifiraYakinAtlarSon2?.has(j)) out.son2.add(k);
        }
        return out;
    }

    /** @deprecated use buildSifiraYakinKeySets().son7 */
    function buildAtIsmiMaviKeySet(race, meta, resolveKosular) {
        return buildSifiraYakinKeySets(race, meta, resolveKosular).son7;
    }

    function applyBonusDelta(tahmin, delta, terms) {
        if (!delta) return;
        if (tahmin.basePct == null) {
            tahmin.basePct = tahmin.pct;
            tahmin.baseScore = tahmin.score;
        }
        tahmin.gosterimBonus = (tahmin.gosterimBonus ?? 0) + delta;
        tahmin.gosterimBonusTerms = (tahmin.gosterimBonusTerms || []).concat(terms);
        tahmin.pct = (tahmin.pct ?? 0) + delta;
        tahmin.score = (tahmin.score ?? 0) + delta;
        if (!tahmin.topTerms) tahmin.topTerms = [];
        tahmin.topTerms = terms.concat(tahmin.topTerms).slice(0, 10);
    }

    function satirHasClass(gosRow, className) {
        if (!gosRow?.classes?.satirClass) return false;
        return new RegExp('\\b' + className + '\\b').test(String(gosRow.classes.satirClass));
    }

    /** GÖSTERİM satırında koyu mavi / fosfor kırmızı kenar (AT İSMİ hücre çevresi) */
    function atIsmiKenarFlags(gosRow) {
        return {
            koyuMaviKenar: satirHasClass(gosRow, 'koyu-mavi-kenar-satir'),
            fosforKirmiziKenar: satirHasClass(gosRow, 'fosfor-kirmizi-kenar-satir')
        };
    }

    /** GÖSTERİM SIRA=1 satırında yanıp sönen hücre bayrakları */
    function gosterimBlinkFlags(gosRow) {
        if (!gosRow?.classes) {
            return { test9Yanip: false, fark8002Yanip: false, test123Kirmizi: false };
        }
        const c = gosRow.classes;
        return {
            test9Yanip: !!(c.test9YanipClass && String(c.test9YanipClass).trim()),
            fark8002Yanip: !!(c.fark8002YanipClass && String(c.fark8002YanipClass).trim()),
            test123Kirmizi: allTest123Kirmizi(gosRow)
        };
    }

    /**
     * TEST9 yanıp → +%45 · 8002-8001 yanıp → +%5 · TEST1/2/3 kırmızı → +%25
     * TEST1 yeşil: koşuda 1 at +%15 · 2+ at TEST1 süresine göre 15/12/9…
     * TEST1 en iyi 3 süre: +7 / +5 / +3 · TEST1 kırmızı yazı +3 ekstra
     * AT İSMİ mavi fosfor (son 7): +5 · mavi değil: −5
     * AT ID mavi (son 3): +7 · mavi değil: −3 · TARİH mavi (son 2): +5 · mavi değil: −3
     * AT ID + TARİH ikisi mavi: ekstra +4
     * AT İSMİ mavi kenar: +3 · kırmızı kenar: +3 (mavi fosfor yazıdan bağımsız)
     * pct %100 üstüne çıkabilir; sıra güncellenir.
     */
    function applyTahminBonuses(horseRows, gosByKey, race, meta, resolveKosular) {
        if (!horseRows?.length) return horseRows;

        const sifiraSets = buildSifiraYakinKeySets(race, meta, resolveKosular);
        const test1GreenBonuses = gosByKey?.size
            ? computeTest1GreenBonuses(horseRows, gosByKey)
            : new Map();
        const test1RankBonuses = gosByKey?.size
            ? computeTest1RankBonuses(horseRows, gosByKey)
            : new Map();

        for (let i = 0; i < horseRows.length; i++) {
            const row = horseRows[i];
            const tahmin = row.tahmin;
            if (!tahmin || tahmin.rank == null) continue;

            const key = horseKey(row.h);
            if (!key) continue;

            let bonus = 0;
            const bonusTerms = [];

            if (sifiraSets.son7.has(key)) {
                bonus += AT_ISMI_MAVI_BONUS;
                bonusTerms.push({
                    label: 'AT İSMİ mavi fosfor',
                    points: AT_ISMI_MAVI_BONUS,
                    source: 'gosterim'
                });
            } else {
                bonus -= AT_ISMI_MAVI_PENALTY;
                bonusTerms.push({
                    label: 'AT İSMİ mavi yok',
                    points: -AT_ISMI_MAVI_PENALTY,
                    source: 'gosterim'
                });
            }

            if (sifiraSets.son3.has(key)) {
                bonus += AT_ID_MAVI_BONUS;
                bonusTerms.push({
                    label: 'AT ID mavi (son 3)',
                    points: AT_ID_MAVI_BONUS,
                    source: 'gosterim'
                });
            } else {
                bonus -= AT_ID_MAVI_PENALTY;
                bonusTerms.push({
                    label: 'AT ID mavi yok',
                    points: -AT_ID_MAVI_PENALTY,
                    source: 'gosterim'
                });
            }

            if (sifiraSets.son2.has(key)) {
                bonus += TARIH_MAVI_BONUS;
                bonusTerms.push({
                    label: 'TARİH mavi (son 2)',
                    points: TARIH_MAVI_BONUS,
                    source: 'gosterim'
                });
            } else {
                bonus -= TARIH_MAVI_PENALTY;
                bonusTerms.push({
                    label: 'TARİH mavi yok',
                    points: -TARIH_MAVI_PENALTY,
                    source: 'gosterim'
                });
            }

            if (sifiraSets.son3.has(key) && sifiraSets.son2.has(key)) {
                bonus += AT_ID_TARIH_IKISI_MAVI_BONUS;
                bonusTerms.push({
                    label: 'AT ID + TARİH ikisi mavi',
                    points: AT_ID_TARIH_IKISI_MAVI_BONUS,
                    source: 'gosterim'
                });
            }

            const gosRow = gosByKey?.get(key);
            if (gosRow) {
                const kenar = atIsmiKenarFlags(gosRow);
                if (kenar.koyuMaviKenar) {
                    bonus += AT_ISMI_KENAR_MAVI_BONUS;
                    bonusTerms.push({
                        label: 'AT İSMİ mavi kenar',
                        points: AT_ISMI_KENAR_MAVI_BONUS,
                        source: 'gosterim'
                    });
                }
                if (kenar.fosforKirmiziKenar) {
                    bonus += AT_ISMI_KENAR_KIRMIZI_BONUS;
                    bonusTerms.push({
                        label: 'AT İSMİ kırmızı kenar',
                        points: AT_ISMI_KENAR_KIRMIZI_BONUS,
                        source: 'gosterim'
                    });
                }

                const flags = gosterimBlinkFlags(gosRow);

                if (flags.test9Yanip) {
                    bonus += TEST9_YANIP_TAHMIN_BONUS;
                    bonusTerms.push({
                        label: 'TEST9 yanıp',
                        points: TEST9_YANIP_TAHMIN_BONUS,
                        source: 'gosterim'
                    });
                }
                if (flags.fark8002Yanip) {
                    bonus += FARK8002_YANIP_TAHMIN_BONUS;
                    bonusTerms.push({
                        label: '8002-8001 yanıp',
                        points: FARK8002_YANIP_TAHMIN_BONUS,
                        source: 'gosterim'
                    });
                }
                if (flags.test123Kirmizi) {
                    bonus += TEST123_KIRMIZI_TAHMIN_BONUS;
                    bonusTerms.push({
                        label: 'TEST1/2/3 kırmızı',
                        points: TEST123_KIRMIZI_TAHMIN_BONUS,
                        source: 'gosterim'
                    });
                }
            }

            const t1Green = test1GreenBonuses.get(key);
            if (t1Green && t1Green.bonus > 0) {
                bonus += t1Green.bonus;
                bonusTerms.push({
                    label: t1Green.label,
                    points: t1Green.bonus,
                    source: 'gosterim'
                });
            }
            const t1Rank = test1RankBonuses.get(key);
            if (t1Rank && t1Rank.bonus > 0) {
                bonus += t1Rank.bonus;
                bonusTerms.push({
                    label: t1Rank.label,
                    points: t1Rank.bonus,
                    source: 'gosterim'
                });
            }
            if (!bonus) continue;

            applyBonusDelta(tahmin, bonus, bonusTerms);
        }

        const ranked = horseRows.map(function(row, idx) {
            return { row: row, idx: idx, score: row.tahmin?.score ?? 0 };
        });
        ranked.sort(function(a, b) {
            if (b.score !== a.score) return b.score - a.score;
            const na = parseInt(a.row.h?.no, 10);
            const nb = parseInt(b.row.h?.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return a.idx - b.idx;
        });
        for (let r = 0; r < ranked.length; r++) {
            if (ranked[r].row.tahmin) ranked[r].row.tahmin.rank = r + 1;
        }
        return horseRows;
    }

    return {
        getColumnCount() {
            return typeof GosterimHeaders !== 'undefined'
                ? GosterimHeaders.getHeaders().length
                : 0;
        },
        buildSiraOneMap,
        allTest123Kirmizi,
        isTest1GreenCell,
        isTest1Kirmizi,
        computeTest1GreenBonuses,
        computeTest1RankBonuses,
        buildSifiraYakinKeySets,
        buildAtIsmiMaviKeySet,
        gosterimBlinkFlags,
        atIsmiKenarFlags,
        applyTahminBonuses,
        noCellClassList,
        renderNoCell,
        renderHeaderCells,
        renderRowCells,
        TEST9_YANIP_TAHMIN_BONUS,
        FARK8002_YANIP_TAHMIN_BONUS,
        TEST123_KIRMIZI_TAHMIN_BONUS,
        TEST1_GREEN_SINGLE_BONUS,
        TEST1_GREEN_MULTI_BASE,
        TEST1_GREEN_MULTI_STEP,
        TEST1_RANK_BONUSES,
        TEST1_RANK_KIRMIZI_EXTRA,
        AT_ISMI_MAVI_BONUS,
        AT_ISMI_MAVI_PENALTY,
        AT_ID_MAVI_BONUS,
        AT_ID_MAVI_PENALTY,
        TARIH_MAVI_BONUS,
        TARIH_MAVI_PENALTY,
        AT_ID_TARIH_IKISI_MAVI_BONUS,
        AT_ISMI_KENAR_MAVI_BONUS,
        AT_ISMI_KENAR_KIRMIZI_BONUS
    };
})();

if (typeof module !== 'undefined') module.exports = { AtestSonGosterimCols };
