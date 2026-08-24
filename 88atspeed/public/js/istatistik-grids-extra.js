/**
 * İstatistikler — ek derinlik gridleri (GÖSTERİM/Tahminim eksik sütunlar)
 * istatistik-engine.js sonrası yüklenir.
 */
(function () {
    const IE = IstatistikEngine;

    IE._computeDrMetrics = function (kosu, hedefMesafe) {
        const gecmisMesafe = kosu.mesafe;
        const dereceSalise = AtSpeedUtils.dereceToSalise(kosu.at_derece);
        const birinciSalise = AtSpeedUtils.dereceToSalise(kosu.birinci_derece);
        const drSl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
        const birinciDrSl = AtSpeedUtils.metreBasiSalise(birinciSalise, gecmisMesafe);
        const drOran = (drSl !== null && birinciDrSl !== null && birinciDrSl !== 0)
            ? drSl / birinciDrSl : null;
        let test1 = null;
        if (drSl !== null && hedefMesafe > 0) test1 = hedefMesafe * drSl;
        let son800_2 = kosu.son800_iki;
        if (!son800_2 || son800_2 === '-') son800_2 = kosu.son800_bir;
        const son800_2Salise = AtSpeedUtils.dereceToSalise(son800_2);
        const son800_2Sl = son800_2Salise ? son800_2Salise / 800 : null;
        let test3 = null;
        if (son800_2Sl !== null && hedefMesafe > 0) test3 = hedefMesafe * son800_2Sl;
        const son800_1Salise = AtSpeedUtils.dereceToSalise(kosu.son800_bir);
        const son800_1Sl = son800_1Salise ? son800_1Salise / 800 : null;
        let test2 = null;
        if (son800_1Sl !== null && hedefMesafe > 0) test2 = hedefMesafe * son800_1Sl;
        const t1dr = (test1 !== null && drOran !== null) ? test1 * drOran : null;
        const t1drT3 = (test3 !== null && drOran !== null) ? test3 * drOran : null;
        return {
            drSl, birinciDrSl, drOran, test1, test2, test3, t1dr, t1drT3,
            son800_1Sl, son800_2Sl
        };
    };

    IE._buildDepthWindowChains = function (race, programTarih, fn) {
        const chains = new Map();
        let maxDepth = 0;
        for (const horse of race.horses || []) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = [];
            for (let d = 0; d < sorted.length; d++) {
                chain[d] = fn(sorted, d, horse);
            }
            chains.set(this._horseKey(horse), chain);
            maxDepth = Math.max(maxDepth, chain.length);
        }
        return { chains, maxDepth };
    };

    IE._buildPerRaceChains = function (race, programTarih, fn) {
        const chains = new Map();
        let maxDepth = 0;
        for (const horse of race.horses || []) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = sorted.map((k, idx) => fn(k, idx, sorted));
            chains.set(this._horseKey(horse), chain);
            maxDepth = Math.max(maxDepth, chain.length);
        }
        return { chains, maxDepth };
    };

    function fillGrid(byHorse, maxDepth) {
        for (const key of byHorse.keys()) {
            if (!byHorse.get(key) || !byHorse.get(key).length) {
                byHorse.set(key, new Array(maxDepth).fill(null));
            }
        }
    }

    IE._gridMinLower = function (chains, maxDepth, valueKey, extraFn) {
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m && m[valueKey] != null && m[valueKey] > 0) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            const minVal = Math.min(...atDepth.map(e => e[valueKey]));
            for (const e of atDepth) {
                const cell = {
                    pct: Math.round((minVal / e[valueKey]) * 100),
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e[valueKey] === minVal,
                    tarih: e.tarih || null
                };
                if (extraFn) Object.assign(cell, extraFn(e));
                byHorse.get(e.key)[d] = cell;
            }
        }
        return { maxDepth, byHorse };
    };

    IE._gridMinAbs = function (chains, maxDepth, valueKey, absKey, extraFn) {
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (!m) continue;
                const abs = m[absKey] != null ? m[absKey] : Math.abs(m[valueKey]);
                if (abs == null) continue;
                atDepth.push({ key, ...m, _abs: abs });
            }
            if (!atDepth.length) continue;
            const minAbs = Math.min(...atDepth.map(e => e._abs));
            for (const e of atDepth) {
                const pct = e._abs === 0 ? 100 : Math.round((minAbs / e._abs) * 100);
                const cell = {
                    pct,
                    val: e[valueKey],
                    absVal: e._abs,
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e._abs === minAbs,
                    tarih: e.tarih || null
                };
                if (extraFn) Object.assign(cell, extraFn(e));
                byHorse.get(e.key)[d] = cell;
            }
        }
        return { maxDepth, byHorse };
    };

    IE._gridMaxHigher = function (chains, maxDepth, valueKey, extraFn) {
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m && m[valueKey] != null) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            const maxVal = Math.max(...atDepth.map(e => e[valueKey]));
            for (const e of atDepth) {
                const pct = maxVal === 0
                    ? (e[valueKey] === 0 ? 100 : 0)
                    : Math.round((e[valueKey] / maxVal) * 100);
                const cell = {
                    pct,
                    val: e[valueKey],
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e[valueKey] === maxVal,
                    tarih: e.tarih || null
                };
                if (extraFn) Object.assign(cell, extraFn(e));
                byHorse.get(e.key)[d] = cell;
            }
        }
        return { maxDepth, byHorse };
    };

    IE._gridBinary = function (chains, maxDepth, qualifyKey) {
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            for (const e of atDepth) {
                byHorse.get(e.key)[d] = {
                    pct: e[qualifyKey] ? 100 : 0,
                    qualifies: !!e[qualifyKey],
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: !!e[qualifyKey],
                    tarih: e.tarih || null
                };
            }
        }
        return { maxDepth, byHorse };
    };

    IE.computeFark8002OrtWindowGrid = function (race, programTarih, windowSize) {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = [];
            for (let d = 0; d < sorted.length; d++) {
                chain[d] = this._fark8002OrtAtDepth(sorted, d, windowSize);
            }
            chains.set(this._horseKey(horse), chain);
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) atDepth.push({ key, ...chain[d] });
            }
            if (!atDepth.length) continue;
            const minAbs = Math.min(...atDepth.map(e => e.absOrt));
            for (const e of atDepth) {
                const pct = e.absOrt === 0 ? 100 : Math.round((minAbs / e.absOrt) * 100);
                byHorse.get(e.key)[d] = {
                    pct, ort: e.ort, absOrt: e.absOrt, adet: e.adet, tarih: e.tarih,
                    comparedCount: atDepth.length, depth: d, isBest: e.absOrt === minAbs
                };
            }
        }
        return { maxDepth, byHorse };
    };

    IE._test9AtDepth = function (sortedKosular, depth, hedefMesafe) {
        const window = sortedKosular.slice(depth);
        if (!window.length) return null;
        const test7Degerleri = [];
        for (let i = window.length - 1; i >= 0; i--) {
            const m = this._computeDrMetrics(window[i], hedefMesafe);
            if (m.test1 !== null && m.test2 !== null) {
                test7Degerleri.push(m.test1 - m.test2);
            }
        }
        if (!test7Degerleri.length) return null;
        const test9 = test7Degerleri[test7Degerleri.length - 1] - test7Degerleri[0];
        return {
            test9,
            absTest9: Math.abs(test9),
            adet: test7Degerleri.length,
            tarih: sortedKosular[depth]?.tarih || null
        };
    };

    IE._ilkSonFarkAtDepth = function (sortedKosular, depth, which) {
        const window = sortedKosular.slice(depth);
        if (!window.length) return null;
        const farkDegerleri = [];
        for (let i = window.length - 1; i >= 0; i--) {
            const f = this._computeKosuFark(window[i]);
            if (f !== null) farkDegerleri.push(f);
        }
        if (!farkDegerleri.length) return null;
        const val = which === 'ilk' ? farkDegerleri[0] : farkDegerleri[farkDegerleri.length - 1];
        return { fark: val, tarih: sortedKosular[depth]?.tarih || null };
    };

    IE._computeKirmiziMargin = function (kosu, hedefMesafe) {
        const m = this._computeDrMetrics(kosu, hedefMesafe);
        if (m.test1 === null || m.test2 === null || m.test3 === null) return null;
        const qualifies = m.test1 < m.test2 && m.test1 < m.test3;
        const margin = qualifies
            ? Math.min(m.test2 - m.test1, m.test3 - m.test1) : 0;
        return { qualifies, margin, tarih: kosu.tarih || null };
    };

    IE._computeMaviFosforScore = function (kosu, hedefMesafe) {
        const m = this._computeDrMetrics(kosu, hedefMesafe);
        if (m.test1 === null || m.test2 === null || m.test3 === null) return null;
        const rulePass = m.test2 < m.test3 && m.test1 <= m.test2;
        const skor = this._computeTest123SiraliSkor(m.test1, m.test2, m.test3);
        const rulePct = skor ? skor.rulePct : 0;
        const fark23 = m.test3 - m.test2;
        return { rulePass, rulePct, fark23, test3: m.test3, tarih: kosu.tarih || null };
    };

    IE._computeMaviFosforDepthGrid = function (race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const { chains, maxDepth } = this._buildPerRaceChains(race, programTarih, (k) =>
            this._computeMaviFosforScore(k, hedefMesafe)
        );
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m && m.test3 != null) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            const minTest3 = Math.min(...atDepth.map(e => e.test3));
            for (const e of atDepth) {
                const test3Pct = Math.round((minTest3 / e.test3) * 100);
                let pct = e.rulePass
                    ? Math.round(Math.sqrt(test3Pct * Math.max(e.rulePct, 1)))
                    : e.rulePct;
                byHorse.get(e.key)[d] = {
                    pct,
                    rulePass: e.rulePass,
                    test3Pct,
                    rulePct: e.rulePct,
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e.rulePass && test3Pct === 100,
                    tarih: e.tarih || null
                };
            }
        }
        return { maxDepth, byHorse };
    };

    IE._gridLowestWins = function (chains, maxDepth, valueKey, extraFn) {
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m && m[valueKey] != null) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            const minVal = Math.min(...atDepth.map(e => e[valueKey]));
            const maxVal = Math.max(...atDepth.map(e => e[valueKey]));
            const span = maxVal - minVal || 1;
            for (const e of atDepth) {
                let pct;
                if (e[valueKey] === minVal) {
                    pct = 100;
                } else if (minVal > 0) {
                    pct = Math.round((minVal / e[valueKey]) * 100);
                } else {
                    pct = Math.max(0, Math.round(100 - ((e[valueKey] - minVal) / span) * 100));
                }
                const cell = {
                    pct,
                    val: e[valueKey],
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e[valueKey] === minVal,
                    tarih: e.tarih || null
                };
                if (extraFn) Object.assign(cell, extraFn(e));
                byHorse.get(e.key)[d] = cell;
            }
        }
        return { maxDepth, byHorse };
    };

    IE._computeKmaviDepthGrid = function (rows, maxDepth) {
        const byHorse = new Map();
        for (const row of rows) {
            const key = row.atId != null ? String(row.atId) : String(row.no);
            const chain = [];
            for (let d = 0; d < maxDepth; d++) {
                const t = row.test123SiraliDepths?.[d];
                const s = row.son8001Depths?.[d];
                const tPct = t?.pct ?? 0;
                const sPct = s?.pct ?? 0;
                const qualifies = t?.rulePct === 100 || t?.pct === 100 || s?.isBest;
                chain[d] = { tPct, sPct, qualifies, tarih: t?.tarih || s?.tarih || null };
            }
            byHorse.set(key, chain);
        }
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of byHorse) {
                const m = chain[d];
                if (!m) continue;
                const pct = Math.max(m.tPct, m.sPct);
                atDepth.push({ key, ...m, pct });
            }
            if (!atDepth.length) continue;
            const maxPct = Math.max(...atDepth.map(e => e.pct));
            for (const e of atDepth) {
                byHorse.get(e.key)[d] = {
                    pct: maxPct === 0 ? (e.qualifies ? 100 : 0) : Math.round((e.pct / maxPct) * 100),
                    qualifies: e.qualifies,
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e.pct === maxPct && e.qualifies,
                    tarih: e.tarih || null
                };
            }
        }
        return { maxDepth, byHorse };
    };

    IE._computeT9VurguDepthGrid = function (rows, test9Grid, kmaviGrid, maxDepth) {
        const byHorse = new Map();
        for (const row of rows) {
            const key = row.atId != null ? String(row.atId) : String(row.no);
            byHorse.set(key, new Array(maxDepth).fill(null));
        }
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const row of rows) {
                const key = row.atId != null ? String(row.atId) : String(row.no);
                const t9 = test9Grid.byHorse.get(key)?.[d];
                const km = kmaviGrid.byHorse.get(key)?.[d];
                if (!t9 || !km?.qualifies) continue;
                const absTest9 = t9.absVal ?? t9.absTest9 ?? Math.abs(t9.val ?? 0);
                atDepth.push({ key, absTest9, tarih: t9.tarih });
            }
            if (!atDepth.length) continue;
            const minAbs = Math.min(...atDepth.map(e => e.absTest9));
            for (const e of atDepth) {
                const pct = e.absTest9 === 0 ? 100 : Math.round((minAbs / e.absTest9) * 100);
                byHorse.get(e.key)[d] = {
                    pct,
                    absTest9: e.absTest9,
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e.absTest9 === minAbs,
                    tarih: e.tarih || null
                };
            }
        }
        return { maxDepth, byHorse };
    };

    IE._computeKirmiziDepthGrid = function (race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const { chains, maxDepth } = this._buildPerRaceChains(race, programTarih, (k) =>
            this._computeKirmiziMargin(k, hedefMesafe)
        );
        const byHorse = new Map();
        for (const key of chains.keys()) byHorse.set(key, new Array(maxDepth).fill(null));
        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                const m = chain[d];
                if (m) atDepth.push({ key, ...m });
            }
            if (!atDepth.length) continue;
            const maxMargin = Math.max(...atDepth.map(e => e.margin));
            for (const e of atDepth) {
                const pct = e.qualifies && maxMargin > 0
                    ? Math.round((e.margin / maxMargin) * 100)
                    : (e.qualifies ? 100 : 0);
                byHorse.get(e.key)[d] = {
                    pct,
                    qualifies: e.qualifies,
                    margin: e.margin,
                    comparedCount: atDepth.length,
                    depth: d,
                    isBest: e.qualifies && e.margin === maxMargin,
                    tarih: e.tarih || null
                };
            }
        }
        return { maxDepth, byHorse };
    };

    /** Tüm ek grid tanımları */
    IE.ISTAT_EXTRA_SECTIONS = [
        { id: 'f802', label: '800Δ·2', sub: 'Son 2 |8002-8001| ort. 0\'a yakın', tone: 0 },
        { id: 'f803', label: '800Δ·3', sub: 'Son 3 |8002-8001| ort. (AT ID mavi)', tone: 1 },
        { id: 't9', label: 'T9Δ', sub: 'TEST9 |0\'a| yakın', tone: 2 },
        { id: 'dr1dr', label: 'DR/1DR', sub: 'En düşük = %100', tone: 3 },
        { id: 'drsl', label: 'DR/SL', sub: 'En düşük = %100', tone: 4 },
        { id: 'dr1sl', label: '1DR/SL', sub: 'En düşük = %100', tone: 5 },
        { id: 't12y', label: 'T12Δ', sub: '|TEST1−TEST2| 0\'a yakın', tone: 6 },
        { id: 'kirmizi', label: 'T123K', sub: 'Kırmızı TEST + marj', tone: 7 },
        { id: 'yesil', label: 'T46Δ', sub: 'TEST4=TEST6 (|T3−T2|→0)', tone: 0 },
        { id: 'mavif', label: 'T23M', sub: 'Fosfor mavi (TEST3+T2<T3)', tone: 1 },
        { id: 'kmavi', label: 'KMΔ', sub: 'Koyu mavi kenar (T·SIRA∨SON800-1)', tone: 2 },
        { id: 't4', label: 'TEST4', sub: '|TEST3−TEST1| 0\'a yakın', tone: 3 },
        { id: 't5', label: 'TEST5', sub: '|T1×DR−T1×DR-T3| 0\'a yakın', tone: 4 },
        { id: 't6', label: 'TEST6', sub: '|TEST2−TEST1| 0\'a yakın', tone: 5 },
        { id: 't7', label: 'TEST7', sub: '|TEST1−TEST2| 0\'a yakın', tone: 6 },
        { id: 't2m3', label: 'T2−T3', sub: 'En düşük (negatif iyi)', tone: 7 },
        { id: 't1dr3', label: 'T1DR3', sub: 'T1×DR-T3 en düşük', tone: 0 },
        { id: 'fark', label: 'FARK', sub: 'birinci−at DR/SL en yüksek', tone: 1 },
        { id: 'ilkf', label: 'İLK-F', sub: 'Pencerede ilk FARK en yüksek', tone: 2 },
        { id: 'sonf', label: 'SON-F', sub: 'Pencerede son FARK en yüksek', tone: 3 },
        { id: 'sl801', label: '8001/SL', sub: 'En düşük = %100', tone: 4 },
        { id: 'sl802', label: '8002/SL', sub: 'En düşük = %100', tone: 5 },
        { id: 'f8021', label: '8002−1', sub: 'Tek koşu |8002-8001| 0\'a yakın', tone: 6 },
        { id: 'sehirSon', label: 'ŞEH-SON', sub: 'Koşu program şehrinde', tone: 7 },
        { id: 'smGec', label: 'Ş+M-GEÇ', sub: 'Şehir+mesafe geçmişi (o ana kadar)', tone: 0 },
        { id: 'sm12', label: 'Ş+M-12', sub: 'Ş/M koşuda 1. veya 2.', tone: 1 },
        { id: 't9v', label: 'T9V', sub: 'KMΔ + |TEST9| 0\'a yakın', tone: 2 }
    ];

    IE._depthsKey = (id) => id + 'Depths';
    IE._ortKey = (id) => id + 'OrtOzeti';
    IE._maxKey = (id) => 'maxDepth' + id.charAt(0).toUpperCase() + id.slice(1);

    IE.computeExtendedDepthGrids = function (race, programTarih, hedefSehir, baseRows) {
        const hedefMesafe = this._hedefMesafe(race);
        const grids = {};

        grids.f802 = this.computeFark8002OrtWindowGrid(race, programTarih, 2);
        grids.f803 = this.computeFark8002OrtWindowGrid(race, programTarih, 3);

        const t9chains = this._buildDepthWindowChains(race, programTarih, (sorted, d) =>
            this._test9AtDepth(sorted, d, hedefMesafe)
        );
        grids.t9 = this._gridMinAbs(t9chains.chains, t9chains.maxDepth, 'test9', 'absTest9');

        const drChains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.drOran === null || m.drOran <= 0) return null;
            return { drOran: m.drOran, tarih: k.tarih };
        });
        grids.dr1dr = this._gridMinLower(drChains.chains, drChains.maxDepth, 'drOran');

        const drSlChains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.drSl === null || m.drSl <= 0) return null;
            return { drSl: m.drSl, tarih: k.tarih };
        });
        grids.drsl = this._gridMinLower(drSlChains.chains, drSlChains.maxDepth, 'drSl');

        const dr1SlChains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.birinciDrSl === null || m.birinciDrSl <= 0) return null;
            return { birinciDrSl: m.birinciDrSl, tarih: k.tarih };
        });
        grids.dr1sl = this._gridMinLower(dr1SlChains.chains, dr1SlChains.maxDepth, 'birinciDrSl');

        const t12Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test1 === null || m.test2 === null) return null;
            return { absT12: Math.abs(m.test1 - m.test2), tarih: k.tarih };
        });
        grids.t12y = this._gridMinAbs(t12Chains.chains, t12Chains.maxDepth, 'absT12', 'absT12');

        grids.kirmizi = this._computeKirmiziDepthGrid(race, programTarih);

        const yesilChains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test2 === null || m.test3 === null) return null;
            return { absT32: Math.abs(m.test3 - m.test2), tarih: k.tarih };
        });
        grids.yesil = this._gridMinAbs(yesilChains.chains, yesilChains.maxDepth, 'absT32', 'absT32');

        grids.mavif = this._computeMaviFosforDepthGrid(race, programTarih);

        const maxKm = Math.max(
            0,
            ...(baseRows || []).map(r => Math.max(
                r.test123SiraliDepths?.length || 0,
                r.son8001Depths?.length || 0
            ))
        );
        grids.kmavi = this._computeKmaviDepthGrid(baseRows, maxKm);

        const t4Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test1 === null || m.test3 === null) return null;
            const test4 = m.test3 - m.test1;
            return { test4, absTest4: Math.abs(test4), tarih: k.tarih };
        });
        grids.t4 = this._gridMinAbs(t4Chains.chains, t4Chains.maxDepth, 'test4', 'absTest4');

        const t5Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.t1dr === null || m.t1drT3 === null) return null;
            const test5 = m.t1dr - m.t1drT3;
            return { test5, absTest5: Math.abs(test5), tarih: k.tarih };
        });
        grids.t5 = this._gridMinAbs(t5Chains.chains, t5Chains.maxDepth, 'test5', 'absTest5');

        const t6Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test1 === null || m.test2 === null) return null;
            const test6 = m.test2 - m.test1;
            return { test6, absTest6: Math.abs(test6), tarih: k.tarih };
        });
        grids.t6 = this._gridMinAbs(t6Chains.chains, t6Chains.maxDepth, 'test6', 'absTest6');

        const t7Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test1 === null || m.test2 === null) return null;
            const test7 = m.test1 - m.test2;
            return { test7, absTest7: Math.abs(test7), tarih: k.tarih };
        });
        grids.t7 = this._gridMinAbs(t7Chains.chains, t7Chains.maxDepth, 'test7', 'absTest7');

        const t2m3Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.test2 === null || m.test3 === null) return null;
            return { t2m3: m.test2 - m.test3, tarih: k.tarih };
        });
        grids.t2m3 = this._gridLowestWins(t2m3Chains.chains, t2m3Chains.maxDepth, 't2m3');

        const t1dr3Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.t1drT3 === null || m.t1drT3 <= 0) return null;
            return { t1drT3: m.t1drT3, tarih: k.tarih };
        });
        grids.t1dr3 = this._gridMinLower(t1dr3Chains.chains, t1dr3Chains.maxDepth, 't1drT3');

        const farkChains = this._buildPerRaceChains(race, programTarih, (k) => {
            const f = this._computeKosuFark(k);
            if (f === null) return null;
            return { fark: f, tarih: k.tarih };
        });
        grids.fark = this._gridMaxHigher(farkChains.chains, farkChains.maxDepth, 'fark');

        const ilkChains = this._buildDepthWindowChains(race, programTarih, (sorted, d) =>
            this._ilkSonFarkAtDepth(sorted, d, 'ilk')
        );
        grids.ilkf = this._gridMaxHigher(ilkChains.chains, ilkChains.maxDepth, 'fark');

        const sonFChains = this._buildDepthWindowChains(race, programTarih, (sorted, d) =>
            this._ilkSonFarkAtDepth(sorted, d, 'son')
        );
        grids.sonf = this._gridMaxHigher(sonFChains.chains, sonFChains.maxDepth, 'fark');

        const sl801Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.son800_1Sl === null || m.son800_1Sl <= 0) return null;
            return { sl: m.son800_1Sl, tarih: k.tarih };
        });
        grids.sl801 = this._gridMinLower(sl801Chains.chains, sl801Chains.maxDepth, 'sl');

        const sl802Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const m = this._computeDrMetrics(k, hedefMesafe);
            if (m.son800_2Sl === null || m.son800_2Sl <= 0) return null;
            return { sl: m.son800_2Sl, tarih: k.tarih };
        });
        grids.sl802 = this._gridMinLower(sl802Chains.chains, sl802Chains.maxDepth, 'sl');

        const f8021Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const f = this._computeFark8002_8001(k);
            if (f === null) return null;
            return { f8021: f, absF8021: Math.abs(f), tarih: k.tarih };
        });
        grids.f8021 = this._gridMinAbs(f8021Chains.chains, f8021Chains.maxDepth, 'f8021', 'absF8021');

        const sehirChains = this._buildPerRaceChains(race, programTarih, (k) => ({
            qualifies: this._sehirEslesme(k.sehir, hedefSehir),
            tarih: k.tarih
        }));
        grids.sehirSon = this._gridBinary(sehirChains.chains, sehirChains.maxDepth, 'qualifies');

        const smGecChains = this._buildDepthWindowChains(race, programTarih, (sorted, d, horse) => {
            const hedefM = hedefMesafe;
            const slice = sorted.slice(d);
            const qualifies = slice.some(k =>
                this._sehirEslesme(k.sehir, hedefSehir)
                && this._mesafeEslesme(k.mesafe, hedefM)
            );
            return { qualifies, tarih: sorted[d]?.tarih || null };
        });
        grids.smGec = this._gridBinary(smGecChains.chains, smGecChains.maxDepth, 'qualifies');

        const sm12Chains = this._buildPerRaceChains(race, programTarih, (k) => {
            const sira = this._parseSira(k.sira);
            const qualifies = this._sehirEslesme(k.sehir, hedefSehir)
                && this._mesafeEslesme(k.mesafe, hedefMesafe)
                && sira !== null && sira <= 2;
            return { qualifies, tarih: k.tarih };
        });
        grids.sm12 = this._gridBinary(sm12Chains.chains, sm12Chains.maxDepth, 'qualifies');

        grids.t9v = this._computeT9VurguDepthGrid(baseRows, grids.t9, grids.kmavi, grids.t9.maxDepth);

        return grids;
    };

    IE.attachExtendedGrids = function (pkg, race, hedefSehir, programTarih) {
        const grids = this.computeExtendedDepthGrids(race, programTarih, hedefSehir, pkg.rows);
        pkg.extraSections = [];

        for (const sec of this.ISTAT_EXTRA_SECTIONS) {
            const grid = grids[sec.id];
            if (!grid) continue;
            const depthsKey = this._depthsKey(sec.id);
            const ortKey = this._ortKey(sec.id);
            const maxKey = 'maxDepth' + sec.id.charAt(0).toUpperCase() + sec.id.slice(1);

            pkg[maxKey] = grid.maxDepth;
            pkg.extraSections.push({
                ...sec,
                depthsKey,
                ortKey,
                maxKey,
                maxDepth: grid.maxDepth
            });

            for (const row of pkg.rows) {
                const key = row.atId != null ? String(row.atId) : String(row.no);
                const depths = grid.byHorse.get(key) || [];
                row[depthsKey] = depths;
                row[ortKey] = this._computeDepthOrtOzeti(depths, grid.maxDepth);
            }
        }
    };

    const _origBuild = IE.buildRaceIstatistikPackage;
    IE.buildRaceIstatistikPackage = function (race, hedefSehir, programTarih) {
        const pkg = _origBuild.call(this, race, hedefSehir, programTarih);
        if (typeof this.attachExtendedGrids === 'function') {
            this.attachExtendedGrids(pkg, race, hedefSehir, programTarih);
        }
        return pkg;
    };
})();
