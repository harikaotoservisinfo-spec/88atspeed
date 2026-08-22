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

const GosterimEngine = {
    COL: {
        AT_ISMI: 1,
        AT_ID: 2,
        TARIH: 3,
        SEHIR: 4,
        MESAFE: 5,
        AT_SIRA: 6,
        SON800_1: 9,
        SON800_2: 10,
        TEST1: 17, TEST2: 18, TEST3: 19, TEST4: 20, TEST5: 21,
        TEST6: 22, TEST7: 23, FARK: 13, FARK8002: 16
    },

    _normalizeSehir(sehir) {
        if (!sehir) return '';
        return String(sehir).trim().toLocaleLowerCase('tr-TR');
    },

    _sehirEslesme(atKosuSehir, hipodromSehir) {
        if (!hipodromSehir) return false;
        const a = this._normalizeSehir(atKosuSehir);
        const b = this._normalizeSehir(hipodromSehir);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    },

    _hedefMesafe(race) {
        const m = (race.mesafe && race.mesafe !== '?') ? race.mesafe : (race.raceDistance || '?');
        return parseInt(m, 10);
    },

    _kosuKey(j, atKosu) {
        return `${j}_${atKosu.tarih || ''}_${atKosu.at_derece || ''}`;
    },

    kosuEquals(k, ref) {
        if (!k || !ref) return false;
        return (k.tarih || '') === (ref.tarih || '')
            && (k.at_derece || '') === (ref.at_derece || '')
            && (k.sehir || '') === (ref.sehir || '')
            && String(k.mesafe || '') === String(ref.mesafe || '');
    },

    _sortKosularChrono(kosular) {
        return [...kosular].sort((a, b) =>
            AtSpeedUtils.parseDateTR(a.tarih) - AtSpeedUtils.parseDateTR(b.tarih)
        );
    },

    _sortKosularNewest(kosular) {
        return [...kosular].sort((a, b) =>
            AtSpeedUtils.parseDateTR(b.tarih) - AtSpeedUtils.parseDateTR(a.tarih)
        );
    },

    /** Kayıt program tarihindeki koşuları hesaplamadan çıkar (ör. bugünün sonuçları) */
    _filterKosular(kosular, programTarih) {
        if (!programTarih || !kosular?.length) return kosular || [];
        return kosular.filter(k => k.tarih !== programTarih);
    },

    _raceForCalc(race, programTarih) {
        if (!programTarih) return race;
        return {
            ...race,
            horses: (race.horses || []).map(h => ({
                ...h,
                kosular: this._filterKosular(h.kosular, programTarih)
            }))
        };
    },

    collectTopTests(race, hedefMesafe) {
        const test1Degerleri = [];
        const test2Degerleri = [];
        const test3Degerleri = [];
        for (let j = 0; j < race.horses.length; j++) {
            const kosular = race.horses[j].kosular || [];
            for (let idx = 0; idx < kosular.length; idx++) {
                const atKosu = kosular[idx];
                const gecmisMesafe = atKosu.mesafe;
                const dereceSalise = AtSpeedUtils.dereceToSalise(atKosu.at_derece);
                const dr_sl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
                let test1Val = null;
                if (dr_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) {
                    test1Val = hedefMesafe * dr_sl;
                }
                if (test1Val !== null) {
                    test1Degerleri.push({ j, atKosu, val: test1Val });
                }
                const son800_1Salise = AtSpeedUtils.dereceToSalise(atKosu.son800_bir);
                const son800_1_sl = son800_1Salise ? son800_1Salise / 800 : null;
                let test2Val = null;
                if (son800_1_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) {
                    test2Val = hedefMesafe * son800_1_sl;
                }
                if (test2Val !== null) {
                    test2Degerleri.push({ j, atKosu, val: test2Val });
                }
                let son800_2 = atKosu.son800_iki;
                if (!son800_2 || son800_2 === '-') son800_2 = atKosu.son800_bir;
                const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);
                const son800_2_sl = son800_2Salise ? son800_2Salise / 800 : null;
                let test3Val = null;
                if (son800_2_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) {
                    test3Val = hedefMesafe * son800_2_sl;
                }
                if (test3Val !== null) {
                    test3Degerleri.push({ j, atKosu, val: test3Val });
                }
            }
        }
        test1Degerleri.sort((a, b) => a.val - b.val);
        test2Degerleri.sort((a, b) => a.val - b.val);
        test3Degerleri.sort((a, b) => a.val - b.val);
        const enIyilerTest1 = new Set();
        const enIyilerTest2 = new Set();
        const enIyilerTest3 = new Set();
        for (let t = 0; t < Math.min(3, test1Degerleri.length); t++) {
            const item = test1Degerleri[t];
            enIyilerTest1.add(this._kosuKey(item.j, item.atKosu));
        }
        for (let t = 0; t < Math.min(3, test2Degerleri.length); t++) {
            const item = test2Degerleri[t];
            enIyilerTest2.add(this._kosuKey(item.j, item.atKosu));
        }
        for (let t = 0; t < Math.min(3, test3Degerleri.length); t++) {
            const item = test3Degerleri[t];
            enIyilerTest3.add(this._kosuKey(item.j, item.atKosu));
        }
        return { enIyilerTest1, enIyilerTest2, enIyilerTest3 };
    },

    /** TEST1 ile TEST2 birbirine en yakın ve değerleri en düşük 3 satır */
    collectClosestTest12(race, hedefMesafe) {
        const pairs = [];
        for (let j = 0; j < race.horses.length; j++) {
            for (const atKosu of race.horses[j].kosular || []) {
                const gecmisMesafe = atKosu.mesafe;
                const dereceSalise = AtSpeedUtils.dereceToSalise(atKosu.at_derece);
                const dr_sl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
                const son800_1Salise = AtSpeedUtils.dereceToSalise(atKosu.son800_bir);
                const son800_1_sl = son800_1Salise ? son800_1Salise / 800 : null;
                if (dr_sl === null || son800_1_sl === null || isNaN(hedefMesafe) || hedefMesafe <= 0) continue;
                const test1 = hedefMesafe * dr_sl;
                const test2 = hedefMesafe * son800_1_sl;
                pairs.push({
                    j,
                    atKosu,
                    fark: Math.abs(test1 - test2),
                    test1,
                    test2
                });
            }
        }
        pairs.sort((a, b) => {
            if (a.fark !== b.fark) return a.fark - b.fark;
            if (a.test1 !== b.test1) return a.test1 - b.test1;
            return a.test2 - b.test2;
        });
        const enIyilerTest12Yakin = new Set();
        for (let t = 0; t < Math.min(3, pairs.length); t++) {
            enIyilerTest12Yakin.add(this._kosuKey(pairs[t].j, pairs[t].atKosu));
        }
        return { enIyilerTest12Yakin };
    },

    _computeTestSalise(atKosu, hedefMesafe) {
        const gecmisMesafe = atKosu.mesafe;
        const dereceSalise = AtSpeedUtils.dereceToSalise(atKosu.at_derece);
        const dr_sl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
        const son800_1Salise = AtSpeedUtils.dereceToSalise(atKosu.son800_bir);
        const son800_1_sl = son800_1Salise ? son800_1Salise / 800 : null;
        let son800_2 = atKosu.son800_iki;
        if (!son800_2 || son800_2 === '-') son800_2 = atKosu.son800_bir;
        const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);
        const son800_2_sl = son800_2Salise ? son800_2Salise / 800 : null;
        if (isNaN(hedefMesafe) || hedefMesafe <= 0) {
            return { test1: null, test2: null, test3: null };
        }
        return {
            test1: dr_sl !== null ? hedefMesafe * dr_sl : null,
            test2: son800_1_sl !== null ? hedefMesafe * son800_1_sl : null,
            test3: son800_2_sl !== null ? hedefMesafe * son800_2_sl : null
        };
    },

    /**
     * TEST3 top-3 + TEST2<TEST3 + TEST1<=TEST2 → fosfor mavi satır.
     * Aynı koşuda kurala uyanlar arasında TEST3−TEST2 farkı en yüksek → TEST2/TEST3 yanıp söner.
     */
    collectMaviFosforTest123(race, hedefMesafe, enIyilerTest3) {
        const qualifying = [];
        for (let j = 0; j < race.horses.length; j++) {
            for (const atKosu of race.horses[j].kosular || []) {
                const kosuKey = this._kosuKey(j, atKosu);
                if (!enIyilerTest3.has(kosuKey)) continue;
                const { test1, test2, test3 } = this._computeTestSalise(atKosu, hedefMesafe);
                if (test1 === null || test2 === null || test3 === null) continue;
                if (!(test2 < test3 && test1 <= test2)) continue;
                qualifying.push({ kosuKey, fark23: test3 - test2 });
            }
        }
        const maviFosforSatir = new Set(qualifying.map(q => q.kosuKey));
        const test23YanipSonen = new Set();
        if (qualifying.length) {
            const maxFark = Math.max(...qualifying.map(q => q.fark23));
            for (const q of qualifying) {
                if (q.fark23 === maxFark) test23YanipSonen.add(q.kosuKey);
            }
        }
        return { maviFosforSatir, test23YanipSonen };
    },

    _computeFark8002_8001(atKosu) {
        let son800_1 = atKosu.son800_bir;
        let son800_2 = atKosu.son800_iki;
        if (!son800_2 || son800_2 === '-') son800_2 = son800_1;
        const son800_1Salise = AtSpeedUtils.dereceToSalise(son800_1);
        const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);
        const son800_1_sl = son800_1Salise ? son800_1Salise / 800 : null;
        const son800_2_sl = son800_2Salise ? son800_2Salise / 800 : null;
        if (son800_2_sl !== null && son800_1_sl !== null) {
            return son800_2_sl - son800_1_sl;
        }
        return null;
    },

    _top3SifiraYakin8002(race, sonKosuSayisi) {
        const ortalamalar = [];
        for (let j = 0; j < race.horses.length; j++) {
            const sonKosular = this._sortKosularNewest(race.horses[j].kosular || [])
                .slice(0, sonKosuSayisi);
            let toplam = 0;
            let adet = 0;
            for (const atKosu of sonKosular) {
                const fark = this._computeFark8002_8001(atKosu);
                if (fark !== null) {
                    toplam += fark;
                    adet++;
                }
            }
            if (adet === 0) continue;
            const ort = toplam / adet;
            ortalamalar.push({ j, ort, absOrt: Math.abs(ort) });
        }
        ortalamalar.sort((a, b) => {
            if (a.absOrt !== b.absOrt) return a.absOrt - b.absOrt;
            return Math.abs(a.ort) - Math.abs(b.ort);
        });
        const set = new Set();
        for (let t = 0; t < Math.min(3, ortalamalar.length); t++) {
            set.add(ortalamalar[t].j);
        }
        return set;
    },

    /** Son 7 → AT İSMİ; son 3 → AT ID; son 2 → TARİH (8002-8001 ort. 0'a yakın 3 at) */
    collectSifiraYakin8002Ortalamalar(race) {
        return {
            sifiraYakinAtlarSon7: this._top3SifiraYakin8002(race, 7),
            sifiraYakinAtlarSon3: this._top3SifiraYakin8002(race, 3),
            sifiraYakinAtlarSon2: this._top3SifiraYakin8002(race, 2)
        };
    },

    /** Koşu içinde SON800-1 ve SON800-2 için en düşük 3 süre */
    collectTopSon800(race) {
        const son800_1 = [];
        const son800_2 = [];
        for (let j = 0; j < race.horses.length; j++) {
            for (const atKosu of race.horses[j].kosular || []) {
                const s1 = AtSpeedUtils.dereceToSalise(atKosu.son800_bir);
                if (s1 !== null) son800_1.push({ j, atKosu, val: s1 });
                let s8002 = atKosu.son800_iki;
                if (!s8002 || s8002 === '-') s8002 = atKosu.son800_bir;
                const s2 = AtSpeedUtils.dereceToSalise(s8002);
                if (s2 !== null) son800_2.push({ j, atKosu, val: s2 });
            }
        }
        son800_1.sort((a, b) => a.val - b.val);
        son800_2.sort((a, b) => a.val - b.val);
        const enIyilerSon800_1 = new Set();
        const enIyilerSon800_2 = new Set();
        for (let t = 0; t < Math.min(3, son800_1.length); t++) {
            const item = son800_1[t];
            enIyilerSon800_1.add(this._kosuKey(item.j, item.atKosu));
        }
        for (let t = 0; t < Math.min(3, son800_2.length); t++) {
            const item = son800_2[t];
            enIyilerSon800_2.add(this._kosuKey(item.j, item.atKosu));
        }
        return { enIyilerSon800_1, enIyilerSon800_2 };
    },

    _son800HucreClass(enIyilerSet, kosuKey, sehirEslesme, eslesmeYesil) {
        if (!enIyilerSet || !enIyilerSet.has(kosuKey)) return '';
        return sehirEslesme ? eslesmeYesil : 'son800-eniyi';
    },

    computeHorseTrends(race, hedefMesafe) {
        const trends = {
            test4Farki: {}, test7Farki: {},
            ilkFark: {}, sonFark: {}, farklarinFarki: {}
        };
        for (let j = 0; j < race.horses.length; j++) {
            const kosularSorted = this._sortKosularChrono(race.horses[j].kosular || []);
            const test4Degerleri = [];
            const test7Degerleri = [];
            const farkDegerleri = [];
            for (const atKosu of kosularSorted) {
                const gecmisMesafe = atKosu.mesafe;
                const dereceSalise = AtSpeedUtils.dereceToSalise(atKosu.at_derece);
                const birinciSalise = AtSpeedUtils.dereceToSalise(atKosu.birinci_derece);
                const dr_sl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
                const birinci_dr_sl = AtSpeedUtils.metreBasiSalise(birinciSalise, gecmisMesafe);
                let test1_salise = (dr_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0)
                    ? hedefMesafe * dr_sl : null;
                let son800_2 = atKosu.son800_iki;
                if (!son800_2 || son800_2 === '-') son800_2 = atKosu.son800_bir;
                const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);
                const son800_2_sl_val = son800_2Salise ? son800_2Salise / 800 : null;
                let test3_salise = (son800_2_sl_val !== null && !isNaN(hedefMesafe) && hedefMesafe > 0)
                    ? hedefMesafe * son800_2_sl_val : null;
                if (test1_salise !== null && test3_salise !== null) {
                    test4Degerleri.push(test3_salise - test1_salise);
                }
                const son800_1_sl = AtSpeedUtils.dereceToSalise(atKosu.son800_bir);
                const s1 = son800_1_sl ? son800_1_sl / 800 : null;
                let test2_salise = (s1 !== null && !isNaN(hedefMesafe) && hedefMesafe > 0)
                    ? hedefMesafe * s1 : null;
                if (test1_salise !== null && test2_salise !== null) {
                    test7Degerleri.push(test1_salise - test2_salise);
                }
                if (birinci_dr_sl !== null && dr_sl !== null) {
                    farkDegerleri.push(birinci_dr_sl - dr_sl);
                }
            }
            trends.test4Farki[j] = test4Degerleri.length
                ? test4Degerleri[test4Degerleri.length - 1] - test4Degerleri[0] : null;
            trends.test7Farki[j] = test7Degerleri.length
                ? test7Degerleri[test7Degerleri.length - 1] - test7Degerleri[0] : null;
            if (farkDegerleri.length) {
                trends.ilkFark[j] = farkDegerleri[0];
                trends.sonFark[j] = farkDegerleri[farkDegerleri.length - 1];
                trends.farklarinFarki[j] = trends.sonFark[j] - trends.ilkFark[j];
            } else {
                trends.ilkFark[j] = null;
                trends.sonFark[j] = null;
                trends.farklarinFarki[j] = null;
            }
        }
        return trends;
    },

    _buildSatirClass({ gucluUyari, maviFosfor, ayniMi, farkBosMu, fark8002BosMu }) {
        const parts = [];
        if (gucluUyari) parts.push('guclu-uyari-satir');
        if (maviFosfor) parts.push('fosfor-mavi-satir');
        if (!gucluUyari && !maviFosfor) {
            if (ayniMi) parts.push('fosfor-yesil-satir');
            else if (farkBosMu && fark8002BosMu) parts.push('pembe-satir');
        }
        return parts.join(' ');
    },

    buildRowValues(horse, atKosu, rowIndex, horseIndex, hedefMesafe, trends, enIyiler, hipodromSehir) {
        const gecmisMesafe = atKosu.mesafe;
        const mesafeSayi = parseInt(String(gecmisMesafe).replace(/[^\d]/g, ''), 10);
        const mesafeEslesme = !isNaN(hedefMesafe) && hedefMesafe > 0
            && !isNaN(mesafeSayi) && mesafeSayi === hedefMesafe;
        const sehirEslesme = this._sehirEslesme(atKosu.sehir, hipodromSehir);
        const eslesmeYesil = 'eslesme-yesil';
        const dereceStr = atKosu.at_derece;
        const birinciDerece = atKosu.birinci_derece;
        let son800_1 = atKosu.son800_bir;
        let son800_2 = atKosu.son800_iki;
        if (!son800_2 || son800_2 === '-') son800_2 = son800_1;

        const dereceSalise = AtSpeedUtils.dereceToSalise(dereceStr);
        const birinciSalise = AtSpeedUtils.dereceToSalise(birinciDerece);
        const son800_1Salise = AtSpeedUtils.dereceToSalise(son800_1);
        const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);

        const dr_sl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
        const birinci_dr_sl = AtSpeedUtils.metreBasiSalise(birinciSalise, gecmisMesafe);
        const son800_1_sl = son800_1Salise ? son800_1Salise / 800 : null;
        const son800_2_sl = son800_2Salise ? son800_2Salise / 800 : null;
        const fark = (birinci_dr_sl !== null && dr_sl !== null) ? birinci_dr_sl - dr_sl : null;
        const fark_8002_8001 = (son800_2_sl !== null && son800_1_sl !== null)
            ? son800_2_sl - son800_1_sl : null;

        let test1_salise = null, test2_salise = null, test3_salise = null;
        if (dr_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) test1_salise = hedefMesafe * dr_sl;
        if (son800_1_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) test2_salise = hedefMesafe * son800_1_sl;
        if (son800_2_sl !== null && !isNaN(hedefMesafe) && hedefMesafe > 0) test3_salise = hedefMesafe * son800_2_sl;

        let kirmiziYazi = false;
        if (test1_salise !== null && test2_salise !== null && test3_salise !== null) {
            kirmiziYazi = test1_salise < test2_salise && test1_salise < test3_salise;
        }

        let test4_salise = null, test5_salise = null, test6_salise = null, test7_salise = null;
        if (test1_salise !== null && test3_salise !== null) test4_salise = test3_salise - test1_salise;
        if (test1_salise !== null && birinciSalise !== null) test5_salise = test1_salise - birinciSalise;
        if (test1_salise !== null && test2_salise !== null) test6_salise = test2_salise - test1_salise;
        if (test1_salise !== null && test2_salise !== null) test7_salise = test1_salise - test2_salise;

        let yesilYazi = test5_salise !== null && (test5_salise / 100) < 1;
        let ayniMi = test4_salise !== null && test6_salise !== null && test4_salise === test6_salise;
        const kosuKey = this._kosuKey(horseIndex, atKosu);

        const gosterimFark = fark;
        const values = [
            (rowIndex + 1).toString(),
            horse.name || '-',
            horse.atId || '-',
            atKosu.tarih || '-',
            atKosu.sehir || '-',
            gecmisMesafe || '-',
            atKosu.sira || '-',
            dereceStr || '-',
            birinciDerece || '-',
            son800_1 || '-',
            son800_2 || '-',
            dr_sl !== null ? dr_sl.toFixed(4) : '-',
            birinci_dr_sl !== null ? birinci_dr_sl.toFixed(4) : '-',
            gosterimFark !== null ? (gosterimFark > 0 ? '+' : '') + gosterimFark.toFixed(4) : '-',
            son800_1_sl !== null ? son800_1_sl.toFixed(4) : '-',
            son800_2_sl !== null ? son800_2_sl.toFixed(4) : '-',
            fark_8002_8001 !== null ? (fark_8002_8001 > 0 ? '+' : '') + fark_8002_8001.toFixed(4) : '-',
            test1_salise !== null ? AtSpeedUtils.saliseToDerece(test1_salise) : '-',
            test2_salise !== null ? AtSpeedUtils.saliseToDerece(test2_salise) : '-',
            test3_salise !== null ? AtSpeedUtils.saliseToDerece(test3_salise) : '-',
            test4_salise !== null ? AtSpeedUtils.saliseToFarkFormat(test4_salise) : '-',
            AtSpeedUtils.saliseToFarkFormat(test5_salise),
            test6_salise !== null ? AtSpeedUtils.saliseToFarkFormat(test6_salise) : '-',
            test7_salise !== null ? AtSpeedUtils.saliseToFarkFormat(test7_salise) : '-',
            trends.test4Farki[horseIndex] !== null ? AtSpeedUtils.saliseToFarkFormat(trends.test4Farki[horseIndex]) : '-',
            trends.test7Farki[horseIndex] !== null ? AtSpeedUtils.saliseToFarkFormat(trends.test7Farki[horseIndex]) : '-',
            trends.ilkFark[horseIndex] !== null ? (trends.ilkFark[horseIndex] > 0 ? '+' : '') + trends.ilkFark[horseIndex].toFixed(4) : '-',
            trends.sonFark[horseIndex] !== null ? (trends.sonFark[horseIndex] > 0 ? '+' : '') + trends.sonFark[horseIndex].toFixed(4) : '-',
            trends.farklarinFarki[horseIndex] !== null ? (trends.farklarinFarki[horseIndex] > 0 ? '+' : '') + trends.farklarinFarki[horseIndex].toFixed(4) : '-'
        ];

        const farkBosMu = values[this.COL.FARK] === '-';
        const fark8002BosMu = values[this.COL.FARK8002] === '-';
        const test12Yakin = enIyiler.enIyilerTest12Yakin?.has(kosuKey);
        const gucluUyari = kirmiziYazi && test12Yakin;
        const maviFosfor = enIyiler.maviFosforSatir?.has(kosuKey);
        const test23Yanip = enIyiler.test23YanipSonen?.has(kosuKey);
        const atIsmiVurgu = enIyiler.sifiraYakinAtlarSon7?.has(horseIndex);
        const atIdVurgu = enIyiler.sifiraYakinAtlarSon3?.has(horseIndex);
        const tarihVurgu = enIyiler.sifiraYakinAtlarSon2?.has(horseIndex);
        const kombineUyari = atIsmiVurgu && atIdVurgu && tarihVurgu && kirmiziYazi;

        return {
            values,
            classes: {
                satirClass: this._buildSatirClass({ gucluUyari, maviFosfor, ayniMi, farkBosMu, fark8002BosMu }),
                maviFosforClass: maviFosfor ? 'fosfor-mavi-yazi' : '',
                test4Class: ayniMi ? 'fosfor-yesil-hucre' : '',
                test6Class: ayniMi ? 'fosfor-yesil-hucre' : '',
                test1Class: enIyiler.enIyilerTest1.has(kosuKey) ? 'eslesme-yesil' : '',
                test2Class: enIyiler.enIyilerTest2.has(kosuKey) ? 'eslesme-yesil' : '',
                test3Class: enIyiler.enIyilerTest3.has(kosuKey) ? 'eslesme-yesil' : '',
                test12YakinClass: test12Yakin ? 'fosfor-sari-yazi' : '',
                test23YanipClass: test23Yanip ? 'test23-yanip-son' : '',
                kirmiziClass: kirmiziYazi ? 'kirmizi-yazi' : '',
                yesilClass: yesilYazi ? 'yesil-yazi' : '',
                farkClass: farkBosMu && !fark8002BosMu ? 'pembe-hucre' : '',
                fark8002Class: !farkBosMu && fark8002BosMu ? 'pembe-hucre' : '',
                mesafeClass: mesafeEslesme ? eslesmeYesil : '',
                sehirClass: sehirEslesme
                    ? (gucluUyari ? `${eslesmeYesil} guclu-sehir-eslesme` : eslesmeYesil)
                    : (gucluUyari ? 'guclu-sehir-farkli' : ''),
                son800_1Class: this._son800HucreClass(enIyiler.enIyilerSon800_1, kosuKey, sehirEslesme, eslesmeYesil),
                son800_2Class: this._son800HucreClass(enIyiler.enIyilerSon800_2, kosuKey, sehirEslesme, eslesmeYesil),
                atIsmiClass: atIsmiVurgu ? 'at-ismi-mavi-vurgu' : '',
                atIdClass: atIdVurgu ? 'at-id-mavi-vurgu' : '',
                tarihClass: tarihVurgu ? 'tarih-koyu-mavi-vurgu' : '',
                atSiraClass: kombineUyari ? 'at-sira-koyu-mavi-vurgu' : ''
            }
        };
    },

    getCellClass(columnIndex, classes) {
        const c = parseInt(columnIndex, 10);
        const { COL } = this;
        const parts = [];
        if (c === COL.MESAFE && classes.mesafeClass) parts.push(classes.mesafeClass);
        if (c === COL.SEHIR && classes.sehirClass) parts.push(classes.sehirClass);
        if (c === COL.AT_ISMI && classes.atIsmiClass) parts.push(classes.atIsmiClass);
        if (c === COL.AT_ID && classes.atIdClass) parts.push(classes.atIdClass);
        if (c === COL.TARIH && classes.tarihClass) parts.push(classes.tarihClass);
        if (c === COL.AT_SIRA && classes.atSiraClass) parts.push(classes.atSiraClass);
        if (c === COL.SON800_1 && classes.son800_1Class) parts.push(classes.son800_1Class);
        if (c === COL.SON800_2 && classes.son800_2Class) parts.push(classes.son800_2Class);
        if (c === COL.TEST1) {
            if (classes.test1Class) parts.push(classes.test1Class);
            if (classes.test12YakinClass) parts.push(classes.test12YakinClass);
            else if (classes.kirmiziClass) parts.push(classes.kirmiziClass);
        } else if (c === COL.TEST2) {
            if (classes.test23YanipClass) parts.push(classes.test23YanipClass);
            if (classes.test2Class) parts.push(classes.test2Class);
            if (classes.test12YakinClass) parts.push(classes.test12YakinClass);
            else if (classes.kirmiziClass) parts.push(classes.kirmiziClass);
        } else if (c === COL.TEST3) {
            if (classes.test23YanipClass) parts.push(classes.test23YanipClass);
            if (classes.test3Class) parts.push(classes.test3Class);
            else if (classes.kirmiziClass) parts.push(classes.kirmiziClass);
        } else if (c === COL.TEST5 && classes.yesilClass) {
            parts.push(classes.yesilClass);
        } else if (c === COL.FARK && classes.farkClass) {
            parts.push(classes.farkClass);
        } else if (c === COL.FARK8002 && classes.fark8002Class) {
            parts.push(classes.fark8002Class);
        } else if (c === COL.TEST4 && classes.test4Class) {
            parts.push(classes.test4Class);
        } else if (c === COL.TEST6 && classes.test6Class) {
            parts.push(classes.test6Class);
        }
        if (classes.maviFosforClass && c !== COL.AT_ISMI && c !== COL.AT_ID && c !== COL.TARIH && c !== COL.AT_SIRA && !parts.includes('test23-yanip-son')) {
            parts.push(classes.maviFosforClass);
        }
        return parts.length ? parts.join(' ') : '';
    },

    buildRaceRows(race, options = {}) {
        const programTarih = options.programTarih || null;
        const hipodromSehir = options.hipodromSehir || null;
        const raceIndex = options.raceIndex ?? 0;
        const hedefMesafe = this._hedefMesafe(race);
        const calcRace = this._raceForCalc(race, programTarih);
        const topTests = this.collectTopTests(calcRace, hedefMesafe);
        const enIyiler = {
            ...topTests,
            ...this.collectTopSon800(calcRace),
            ...this.collectClosestTest12(calcRace, hedefMesafe),
            ...this.collectMaviFosforTest123(calcRace, hedefMesafe, topTests.enIyilerTest3),
            ...this.collectSifiraYakin8002Ortalamalar(calcRace)
        };
        const trends = this.computeHorseTrends(calcRace, hedefMesafe);
        const rows = [];
        for (let j = 0; j < calcRace.horses.length; j++) {
            const horse = calcRace.horses[j];
            const kosularSorted = this._sortKosularNewest(horse.kosular || []);
            for (let idx = 0; idx < kosularSorted.length; idx++) {
                const atKosu = kosularSorted[idx];
                const row = this.buildRowValues(horse, atKosu, idx, j, hedefMesafe, trends, enIyiler, hipodromSehir);
                row.meta = {
                    raceIndex,
                    horseIndex: j,
                    atId: horse.atId,
                    tarih: atKosu.tarih,
                    at_derece: atKosu.at_derece,
                    sehir: atKosu.sehir,
                    mesafe: atKosu.mesafe
                };
                rows.push(row);
            }
        }
        return rows;
    },

    sortRows(rows, sortState) {
        if (sortState.column === null || sortState.column === undefined) return rows;
        const columnIndex = AtSpeedUtils.sortColumnIndex(sortState.column);
        if (columnIndex === null) return rows;
        const type = sortState.type || AtSpeedUtils.getSortType(columnIndex);
        return AtSpeedUtils.sortTableData([...rows], columnIndex, type, sortState.direction || 'asc');
    }
};

if (typeof module !== 'undefined') module.exports = { FormulaEngine, GosterimEngine };
