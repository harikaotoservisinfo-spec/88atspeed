/* 88ATSPEED - Formül motoru */
const FormulaEngine = {
    applyAdvancedFormula(colName, raceIndex, formula, ctx) {
        const expr = formula.substring(1).toUpperCase();
        const colIndex = ctx.ekSutunlar.indexOf(colName);
        if (colIndex === -1) return;

        const metreMatch = expr.match(/METRE_BASI_SALISE\(([^;]+);([^)]+)\)/);
        if (metreMatch) {
            const kosuNo = parseInt(metreMatch[1].match(/K(\d+)/)?.[1] || 0);
            if (kosuNo > 0) this._applyMetreBasiSalise(colIndex, kosuNo - 1, ctx);
            return;
        }

        const son800Match = expr.match(/SON800_SALISE\(([^)]+)\)/);
        if (son800Match) {
            const sutun = son800Match[1].trim();
            const kosuNo = parseInt(sutun.match(/K(\d+)/)?.[1] || 0);
            const alan = sutun.includes('SON800-2') ? 'son800_iki' : 'son800_bir';
            if (kosuNo > 0) this._applySon800Salise(colIndex, kosuNo - 1, alan, ctx);
            return;
        }

        const saliseMatch = expr.match(/SALISE_CEVIR\(([^)]+)\)/);
        if (saliseMatch) {
            const kosuNo = parseInt(saliseMatch[1].match(/K(\d+)/)?.[1] || 0);
            if (kosuNo > 0) this._applySaliseCevir(colIndex, kosuNo - 1, ctx);
            return;
        }

        const dereceMatch = expr.match(/DERECE_CEVIR\(([^)]+)\)/);
        if (dereceMatch) {
            this._applyDereceCevir(colIndex, ctx);
            return;
        }

        for (const fn of ['MIN', 'MAX', 'TOPLA', 'ORTALAMA', 'FARK', 'MIN_MAX']) {
            const m = expr.match(new RegExp(fn + '\\(([^)]+)\\)'));
            if (m) {
                this._applyAggregate(fn, colIndex, ctx);
                return;
            }
        }

        const esikMatch = expr.match(/ESIK\(([^;)]+)/);
        if (esikMatch) {
            this._applyEsik(colIndex, parseFloat(esikMatch[1]), ctx);
            return;
        }
    },

    _forEachCell(ctx, fn) {
        for (let i = 0; i < ctx.currentKarsilastirmaData.length; i++) {
            const race = ctx.currentKarsilastirmaData[i];
            for (let j = 0; j < race.horses.length; j++) fn(i, j, race.horses[j]);
        }
    },

    _applyMetreBasiSalise(colIndex, kosuIndex, ctx) {
        this._forEachCell(ctx, (i, j, horse) => {
            const mesafe = ctx.getAtHesaplamaVerisi(horse.atId, kosuIndex, 'mesafe');
            const derece = ctx.getAtHesaplamaVerisi(horse.atId, kosuIndex, 'at_derece');
            const salise = AtSpeedUtils.dereceToSalise(derece);
            const m = parseInt(String(mesafe).replace(/\D/g, ''));
            if (m > 0 && salise !== null) ctx.setCellValue(i, j, colIndex, (salise / m).toFixed(4));
        });
    },

    _applySon800Salise(colIndex, kosuIndex, alan, ctx) {
        this._forEachCell(ctx, (i, j, horse) => {
            const derece = ctx.getAtHesaplamaVerisi(horse.atId, kosuIndex, alan);
            const salise = AtSpeedUtils.dereceToSalise(derece);
            if (salise !== null) ctx.setCellValue(i, j, colIndex, salise);
        });
    },

    _applySaliseCevir(colIndex, kosuIndex, ctx) {
        this._forEachCell(ctx, (i, j, horse) => {
            const derece = ctx.getAtHesaplamaVerisi(horse.atId, kosuIndex, 'at_derece');
            const salise = AtSpeedUtils.dereceToSalise(derece);
            if (salise !== null) ctx.setCellValue(i, j, colIndex, salise);
        });
    },

    _applyDereceCevir(colIndex, ctx) {
        this._forEachCell(ctx, (i, j) => {
            const val = ctx.getCellValue(i, j, colIndex);
            const salise = parseFloat(val);
            if (!isNaN(salise)) ctx.setCellValue(i, j, colIndex, AtSpeedUtils.saliseToDerece(salise));
        });
    },

    _applyAggregate(fn, colIndex, ctx) {
        const values = [];
        this._forEachCell(ctx, (i, j) => {
            const v = parseFloat(ctx.getCellValue(i, j, colIndex));
            if (!isNaN(v)) values.push({ i, j, v });
        });
        if (!values.length) return;

        const nums = values.map(x => x.v);
        let result;
        if (fn === 'MIN' || fn === 'MIN_MAX') result = Math.min(...nums);
        else if (fn === 'MAX') result = Math.max(...nums);
        else if (fn === 'TOPLA') result = nums.reduce((a, b) => a + b, 0);
        else if (fn === 'ORTALAMA') result = nums.reduce((a, b) => a + b, 0) / nums.length;
        else if (fn === 'FARK') result = Math.max(...nums) - Math.min(...nums);

        if (['MIN', 'MAX', 'TOPLA', 'ORTALAMA', 'FARK'].includes(fn)) {
            this._forEachCell(ctx, (i, j) => ctx.setCellValue(i, j, colIndex, result.toFixed(4)));
        } else if (fn === 'MIN_MAX') {
            const min = Math.min(...nums), max = Math.max(...nums);
            values.forEach(({ i, j, v }) => {
                if (v === min) ctx.setCellValue(i, j, colIndex, v.toFixed(4));
                else if (v === max) ctx.setCellValue(i, j, colIndex, v.toFixed(4));
            });
        }
    },

    _applyEsik(colIndex, esik, ctx) {
        this._forEachCell(ctx, (i, j) => {
            const v = parseFloat(ctx.getCellValue(i, j, colIndex));
            if (!isNaN(v) && v <= esik) {
                const key = `${i}_${j}_${colIndex}`;
                const cell = document.querySelector(`.cell-${key.replace(/\./g, '_')}`);
                if (cell) cell.style.backgroundColor = '#ffeb3b';
            }
        });
    },

    runOtomatikHesaplamalar(tetikleyici, ctx) {
        if (!ctx.otomatikVerileri?.hesaplamalar) return;
        for (const h of ctx.otomatikVerileri.hesaplamalar) {
            if (!h.aktif || !h.tetikleyici?.includes(tetikleyici)) continue;
            if (h.islem === 'renklendirEnKucuk3') this._renklendirEnKucuk3(ctx);
        }
    },

    _renklendirEnKucuk3(ctx) {
        const renkler = ctx.otomatikVerileri?.renklendirme?.en_kucuk_3 || { 1: '#00ff00', 2: '#66ff66', 3: '#aaffaa' };
        for (let c = 0; c < ctx.ekSutunlar.length; c++) {
            const values = [];
            this._forEachCell(ctx, (i, j) => {
                const v = parseFloat(ctx.getCellValue(i, j, c));
                if (!isNaN(v)) values.push({ i, j, v });
            });
            values.sort((a, b) => a.v - b.v);
            for (let k = 0; k < Math.min(3, values.length); k++) {
                const { i, j } = values[k];
                const key = `${i}_${j}_${c}`;
                const cell = document.querySelector(`.cell-${key.replace(/\./g, '_')}`);
                if (cell) cell.style.backgroundColor = renkler[k + 1] || '#aaffaa';
            }
        }
    }
};

if (typeof module !== 'undefined') module.exports = FormulaEngine;
