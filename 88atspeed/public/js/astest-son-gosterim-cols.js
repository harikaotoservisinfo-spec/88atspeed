/**
 * SON TEST — HYB sonrası GÖSTERİM (SIRA=1) sütunları · tam renklendirme
 */
const AtestSonGosterimCols = (function () {
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

    return {
        getColumnCount() {
            return typeof GosterimHeaders !== 'undefined'
                ? GosterimHeaders.getHeaders().length
                : 0;
        },
        buildSiraOneMap,
        noCellClassList,
        renderNoCell,
        renderHeaderCells,
        renderRowCells
    };
})();

if (typeof module !== 'undefined') module.exports = { AtestSonGosterimCols };
