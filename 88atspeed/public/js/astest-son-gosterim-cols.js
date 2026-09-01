/**
 * SON TEST — HYB sonrası GÖSTERİM (SIRA=1) sütunları · tam renklendirme
 * + GÖSTERİM yanıp sönen hücreler → TAHMİN ödülü
 */
const AtestSonGosterimCols = (function () {
    const TEST9_YANIP_TAHMIN_BONUS = 45;
    const FARK8002_YANIP_TAHMIN_BONUS = 5;
    const TEST123_KIRMIZI_TAHMIN_BONUS = 25;

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
     * pct %100 üstüne çıkabilir; sıra güncellenir.
     */
    function applyTahminBonuses(horseRows, gosByKey) {
        if (!horseRows?.length || !gosByKey?.size) return horseRows;

        for (let i = 0; i < horseRows.length; i++) {
            const row = horseRows[i];
            const tahmin = row.tahmin;
            if (!tahmin || tahmin.rank == null) continue;

            const key = horseKey(row.h);
            if (!key) continue;
            const gosRow = gosByKey.get(key);
            if (!gosRow) continue;

            const flags = gosterimBlinkFlags(gosRow);
            let bonus = 0;
            const bonusTerms = [];

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
            if (!bonus) continue;

            if (tahmin.basePct == null) {
                tahmin.basePct = tahmin.pct;
                tahmin.baseScore = tahmin.score;
            }
            tahmin.gosterimBonus = bonus;
            tahmin.gosterimBonusTerms = bonusTerms;
            tahmin.pct = (tahmin.pct ?? 0) + bonus;
            tahmin.score = (tahmin.score ?? 0) + bonus;
            if (!tahmin.topTerms) tahmin.topTerms = [];
            tahmin.topTerms = bonusTerms.concat(tahmin.topTerms).slice(0, 8);
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
        gosterimBlinkFlags,
        applyTahminBonuses,
        noCellClassList,
        renderNoCell,
        renderHeaderCells,
        renderRowCells,
        TEST9_YANIP_TAHMIN_BONUS,
        FARK8002_YANIP_TAHMIN_BONUS,
        TEST123_KIRMIZI_TAHMIN_BONUS
    };
})();

if (typeof module !== 'undefined') module.exports = { AtestSonGosterimCols };
