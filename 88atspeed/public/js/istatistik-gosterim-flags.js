/**
 * İstatistikler — GÖSTERİM renklendirme bayrakları + görsel profil sınıflandırması.
 */
(function () {
    const IE = IstatistikEngine;
    const GE = typeof GosterimEngine !== 'undefined' ? GosterimEngine : null;

    function extractFlagsFromRow(row, atKosu, horseIndex, hedefMesafe, enIyiler) {
        const c = row.classes || {};
        const satir = c.satirClass || '';
        const kosuKey = GE._kosuKey(horseIndex, atKosu);
        const testSirali = GE._computeTestSiraliKoyuMaviKenar(atKosu, hedefMesafe);
        const son800Mavi = !!enIyiler.enIyilerSon800_1?.has(kosuKey);
        return {
            kirmiziKenar: satir.includes('fosfor-kirmizi-kenar-satir'),
            maviKenar: testSirali || son800Mavi,
            maviKenarSira: testSirali,
            maviKenarSon800: son800Mavi,
            yesilSatir: satir.includes('fosfor-yesil-satir'),
            gucluUyari: satir.includes('guclu-uyari-satir'),
            maviFosfor: satir.includes('fosfor-mavi-satir'),
            pembeSatir: satir.includes('pembe-satir'),
            kirmiziTest: !!c.kirmiziClass,
            sariTest12: !!c.test12YakinClass,
            test1EnIyi: !!c.test1Class,
            test2EnIyi: !!c.test2Class,
            test3EnIyi: !!c.test3Class,
            sehirEslesme: (c.sehirClass || '').includes('eslesme-yesil'),
            mesafeEslesme: !!c.mesafeClass,
            test23Yanip: !!c.test23YanipClass,
            t1drKirmizi: !!c.t1drKirmiziClass,
            t1drEnIyi2: !!c.t1drEnIyi2Class
        };
    }

    /**
     * Hücre görsel profili — kenar + dolgu kombinasyonları (TAHMİN için tek anahtar).
     */
    IE.classifyCellVisual = function (cell) {
        if (!cell?.gosterim) return null;
        const g = cell.gosterim;
        const border = g.kirmiziKenar ? 'kirmizi' : (g.maviKenar ? 'mavi' : 'yok');
        const koyuYesil = !!(g.sehirEslesme || g.mesafeEslesme || g.test1EnIyi || g.test2EnIyi || g.test3EnIyi);
        const acikYesil = !!(g.yesilSatir && !koyuYesil);
        const sari = !!(g.sariTest12 || acikYesil);

        if (koyuYesil && border === 'mavi') return 'yesilMavi';
        if (koyuYesil && border === 'kirmizi') return 'yesilKirmizi';
        if (koyuYesil) return 'yesil';
        if (sari && border === 'mavi') return 'sariMavi';
        if (sari && border === 'kirmizi') return 'sariKirmizi';
        if (sari) return 'sari';
        if (border === 'mavi') return 'maviKenar';
        if (border === 'kirmizi') return 'kirmiziKenar';
        if (g.gucluUyari) return 'gucluUyari';
        if (g.maviFosfor) return 'maviFosfor';
        if (acikYesil) return 'yesilAcik';
        return null;
    };

    /**
     * Derinlik trend isabetleri — sabit indeks (SON=0, 1 ÖNCE=1, 2 ÖNCE=2).
     * Null hücreler atlanır; sıkıştırılmış dizi kullanılmaz.
     * @returns {{ id: string, delta: number, strength: number, detail: string }[]}
     */
    IE.computeDepthTrendHits = function (depths, maxN) {
        maxN = maxN || 3;
        const pct = (d) => {
            if (d < 0 || d >= (depths?.length || 0)) return null;
            const v = depths[d]?.pct;
            return v != null ? v : null;
        };
        const p0 = pct(0);
        const p1 = pct(1);
        const p2 = pct(2);
        const hits = [];

        if (p0 != null && p1 != null && p2 != null) {
            if (p0 < p1 && p1 < p2) {
                const delta = p2 - p0;
                hits.push({
                    id: 'trendDown3',
                    delta,
                    strength: Math.min(1, delta / 100),
                    detail: p0 + ' < ' + p1 + ' < ' + p2 + ' (Δ' + delta + ')'
                });
            }
            if (p0 > p1 && p1 > p2) {
                const delta = p0 - p2;
                hits.push({
                    id: 'trendUp3',
                    delta,
                    strength: Math.min(1, delta / 100),
                    detail: p0 + ' > ' + p1 + ' > ' + p2 + ' (Δ' + delta + ')'
                });
            }
        }

        if (p0 != null && p1 != null) {
            if (p0 < p1) {
                const delta = p1 - p0;
                hits.push({
                    id: 'trendDownSon',
                    delta,
                    strength: Math.min(1, delta / 100),
                    detail: 'SON %' + p0 + ' < 1 ÖNCE %' + p1 + ' (Δ' + delta + ')'
                });
            } else if (p0 > p1) {
                const delta = p0 - p1;
                hits.push({
                    id: 'trendUpSon',
                    delta,
                    strength: Math.min(1, delta / 100),
                    detail: 'SON %' + p0 + ' > 1 ÖNCE %' + p1 + ' (Δ' + delta + ')'
                });
            }
        }

        return hits;
    };

    IE.computeDepthTrend = function (depths, maxN) {
        return this.computeDepthTrendHits(depths, maxN).map(h => h.id);
    };

    IE.buildGosterimFlagIndex = function (race, hedefSehir, programTarih) {
        if (!GE) return new Map();
        const bundle = GE.buildEnIyilerBundle(race, {
            programTarih,
            hipodromSehir: hedefSehir
        });
        const { calcRace, hedefMesafe, enIyiler, trends } = bundle;
        const index = new Map();
        for (let j = 0; j < calcRace.horses.length; j++) {
            const horse = calcRace.horses[j];
            const horseKey = IE._horseKey(horse);
            const kosularSorted = GE._sortKosularNewest(horse.kosular || []);
            for (let idx = 0; idx < kosularSorted.length; idx++) {
                const atKosu = kosularSorted[idx];
                const row = GE.buildRowValues(
                    horse, atKosu, idx, j, hedefMesafe, trends, enIyiler, hedefSehir
                );
                const flags = extractFlagsFromRow(row, atKosu, j, hedefMesafe, enIyiler);
                const tarihKey = IE._normalizeTarih(atKosu.tarih);
                index.set(horseKey + '|' + tarihKey, flags);
            }
        }
        return index;
    };

    IE._pkgDepthKeys = function (pkg) {
        const keys = [
            'son8001Depths', 'son8002Depths', 'oran1Depths', 'oran2Depths',
            'fark827Depths', 'ffDepths', 'test8Depths', 'son800Dr1Depths', 'son800DrDepths',
            'test1Depths', 'test2Depths', 'test3Depths', 'test123SiraliDepths', 't1drDepths'
        ];
        for (const sec of pkg.extraSections || []) {
            if (sec.depthsKey && !keys.includes(sec.depthsKey)) keys.push(sec.depthsKey);
        }
        return keys;
    };

    IE.attachGosterimFlagsToPackage = function (pkg, race, hedefSehir, programTarih) {
        const index = this.buildGosterimFlagIndex(race, hedefSehir, programTarih);
        if (!index.size) return pkg;

        const depthKeys = this._pkgDepthKeys(pkg);
        for (const row of pkg.rows) {
            const horseKey = row.atId != null ? String(row.atId) : String(row.no);
            for (const dk of depthKeys) {
                const depths = row[dk];
                if (!depths) continue;
                for (const cell of depths) {
                    if (!cell || !cell.tarih) continue;
                    const flags = index.get(horseKey + '|' + IE._normalizeTarih(cell.tarih));
                    if (flags) {
                        cell.gosterim = flags;
                        cell.visualProfile = IE.classifyCellVisual(cell);
                    }
                }
            }
        }
        return pkg;
    };
})();
