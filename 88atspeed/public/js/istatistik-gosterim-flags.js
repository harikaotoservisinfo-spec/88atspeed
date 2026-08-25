/**
 * İstatistikler — GÖSTERİM renklendirme bayraklarını derinlik hücrelerine bağlar.
 * formula-engine.js + istatistik-engine.js sonrası yüklenir.
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
                    if (flags) cell.gosterim = flags;
                }
            }
        }
        return pkg;
    };
})();
