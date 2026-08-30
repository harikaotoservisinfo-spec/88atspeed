/**
 * İstatistikler sekmesi — koşu bazlı at istatistikleri
 */
const IstatistikEngine = {
    _normalizeSehir(sehir) {
        if (!sehir) return '';
        return String(sehir).trim().toLocaleLowerCase('tr-TR');
    },

    _normalizeTarih(tarih) {
        if (!tarih) return '';
        return String(tarih).trim().replace(/\//g, '.');
    },

    _parseKosuTarih(tarih) {
        if (!tarih || tarih === '-') return null;
        const d = AtSpeedUtils.parseDateTR(this._normalizeTarih(tarih));
        return d.getTime() === 0 ? null : d;
    },

    _subtractPeriod(refDate, { months = 0, days = 0 }) {
        const d = new Date(refDate.getTime());
        if (months) d.setMonth(d.getMonth() - months);
        if (days) d.setDate(d.getDate() - days);
        return d;
    },

    _parseSira(sira) {
        if (sira === null || sira === undefined || sira === '-') return null;
        const s = String(sira).trim().toLocaleLowerCase('tr-TR');
        if (!s || s === 'kosmaz' || s === 'koşmaz' || s === 'cekildi' || s === 'çekildi') return null;
        const n = parseInt(s.replace(/[^\d]/g, ''), 10);
        return isNaN(n) || n <= 0 ? null : n;
    },

    _kosuDonemIcinde(k, ref, cutoff, programNorm) {
        const d = this._parseKosuTarih(k.tarih);
        if (!d) return false;
        if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
        if (d > ref) return false;
        return d >= cutoff;
    },

    _sehirEslesme(atKosuSehir, hedefSehir) {
        if (!hedefSehir) return false;
        const a = this._normalizeSehir(atKosuSehir);
        const b = this._normalizeSehir(hedefSehir);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    },

    _parseMesafe(mesafe) {
        if (mesafe === null || mesafe === undefined || mesafe === '-' || mesafe === '?') return null;
        const n = parseInt(String(mesafe).replace(/[^\d]/g, ''), 10);
        return isNaN(n) || n <= 0 ? null : n;
    },

    _mesafeEslesme(atKosuMesafe, hedefMesafe) {
        const a = this._parseMesafe(atKosuMesafe);
        if (a === null || hedefMesafe === null) return false;
        return a === hedefMesafe;
    },

    _hedefMesafe(race) {
        const m = (race.mesafe && race.mesafe !== '?') ? race.mesafe : (race.raceDistance || '?');
        return this._parseMesafe(m);
    },

    /**
     * Atın bilinen koşularında hedef şehirde yarışma oranı.
     * @returns {{ pct: number|null, total: number, inCity: number }}
     */
    computeSehirDeneyimi(kosular, hedefSehir) {
        if (!kosular?.length || !hedefSehir) {
            return { pct: null, total: 0, inCity: 0 };
        }
        let total = 0;
        let inCity = 0;
        for (const k of kosular) {
            const sehir = k?.sehir;
            if (!sehir || sehir === '-') continue;
            total++;
            if (this._sehirEslesme(sehir, hedefSehir)) inCity++;
        }
        if (total === 0) return { pct: null, total: 0, inCity: 0 };
        return {
            pct: Math.round((inCity / total) * 100),
            total,
            inCity
        };
    },

    /**
     * Dönem içi koşu oranı: son X ay/gün içindeki koşular / daha eski koşular.
     * Yüzde = recent / (recent + older) × 100
     */
    computeDonemOrani(kosular, programTarih, period) {
        const ref = this._parseKosuTarih(programTarih);
        if (!ref) return { pct: null, recent: 0, older: 0, total: 0 };
        const cutoff = this._subtractPeriod(ref, period);
        const programNorm = this._normalizeTarih(programTarih);
        let recent = 0;
        let older = 0;
        for (const k of kosular || []) {
            const d = this._parseKosuTarih(k.tarih);
            if (!d) continue;
            if (programNorm && this._normalizeTarih(k.tarih) === programNorm) continue;
            if (d > ref) continue;
            if (d >= cutoff) recent++;
            else older++;
        }
        const total = recent + older;
        if (total === 0) return { pct: null, recent, older, total };
        return {
            pct: Math.round((recent / total) * 100),
            recent,
            older,
            total
        };
    },

    /**
     * Dönem içindeki koşularda ilk N başarısı (tüm koşular).
     */
    computeDonemIlkBasari(kosular, programTarih, period, ilkLimit = 3) {
        const ref = this._parseKosuTarih(programTarih);
        if (!ref) return { pct: null, hit: 0, miss: 0, total: 0, ilkLimit };
        const cutoff = this._subtractPeriod(ref, period);
        const programNorm = this._normalizeTarih(programTarih);
        let hit = 0;
        let total = 0;
        for (const k of kosular || []) {
            if (!this._kosuDonemIcinde(k, ref, cutoff, programNorm)) continue;
            const sira = this._parseSira(k.sira);
            if (sira === null) continue;
            total++;
            if (sira <= ilkLimit) hit++;
        }
        if (total === 0) return { pct: null, hit, miss: 0, total, ilkLimit };
        return {
            pct: Math.round((hit / total) * 100),
            hit,
            miss: total - hit,
            total,
            ilkLimit
        };
    },

    /** @deprecated computeDonemIlkBasari kullanın */
    computeDonemIlk3Basari(kosular, programTarih, period) {
        const r = this.computeDonemIlkBasari(kosular, programTarih, period, 3);
        return { pct: r.pct, top3: r.hit, notTop3: r.miss, total: r.total };
    },

    _genelIlkBundle(kosular, programTarih, ilkLimit) {
        return {
            ay3: this.computeDonemIlkBasari(kosular, programTarih, { months: 3 }, ilkLimit),
            ay1: this.computeDonemIlkBasari(kosular, programTarih, { months: 1 }, ilkLimit),
            gun15: this.computeDonemIlkBasari(kosular, programTarih, { days: 15 }, ilkLimit)
        };
    },

    /**
     * Dönem + şehir + mesafe eşleşen koşularda ilk N başarısı (N=1,2,3).
     */
    computeSehirMesafeDonemIlkBasari(kosular, programTarih, hedefSehir, hedefMesafe, period, ilkLimit = 3) {
        const ref = this._parseKosuTarih(programTarih);
        if (!ref || !hedefSehir || hedefMesafe === null) {
            return { pct: null, hit: 0, miss: 0, total: 0, ilkLimit };
        }
        const cutoff = this._subtractPeriod(ref, period);
        const programNorm = this._normalizeTarih(programTarih);
        let hit = 0;
        let total = 0;
        for (const k of kosular || []) {
            if (!this._kosuDonemIcinde(k, ref, cutoff, programNorm)) continue;
            if (!this._sehirEslesme(k.sehir, hedefSehir)) continue;
            if (!this._mesafeEslesme(k.mesafe, hedefMesafe)) continue;
            const sira = this._parseSira(k.sira);
            if (sira === null) continue;
            total++;
            if (sira <= ilkLimit) hit++;
        }
        if (total === 0) return { pct: null, hit, miss: 0, total, ilkLimit };
        return {
            pct: Math.round((hit / total) * 100),
            hit,
            miss: total - hit,
            total,
            ilkLimit
        };
    },

    _smIlkBundle(kosular, programTarih, hedefSehir, hedefMesafe, ilkLimit) {
        return {
            ay3: this.computeSehirMesafeDonemIlkBasari(
                kosular, programTarih, hedefSehir, hedefMesafe, { months: 3 }, ilkLimit
            ),
            ay1: this.computeSehirMesafeDonemIlkBasari(
                kosular, programTarih, hedefSehir, hedefMesafe, { months: 1 }, ilkLimit
            ),
            gun15: this.computeSehirMesafeDonemIlkBasari(
                kosular, programTarih, hedefSehir, hedefMesafe, { days: 15 }, ilkLimit
            )
        };
    },

    /**
     * Dönem + mesafe eşleşen koşularda ilk N başarısı (şehir filtresi yok).
     */
    computeMesafeDonemIlkBasari(kosular, programTarih, hedefMesafe, period, ilkLimit = 3) {
        const ref = this._parseKosuTarih(programTarih);
        if (!ref || hedefMesafe === null) {
            return { pct: null, hit: 0, miss: 0, total: 0, ilkLimit };
        }
        const cutoff = this._subtractPeriod(ref, period);
        const programNorm = this._normalizeTarih(programTarih);
        let hit = 0;
        let total = 0;
        for (const k of kosular || []) {
            if (!this._kosuDonemIcinde(k, ref, cutoff, programNorm)) continue;
            if (!this._mesafeEslesme(k.mesafe, hedefMesafe)) continue;
            const sira = this._parseSira(k.sira);
            if (sira === null) continue;
            total++;
            if (sira <= ilkLimit) hit++;
        }
        if (total === 0) return { pct: null, hit, miss: 0, total, ilkLimit };
        return {
            pct: Math.round((hit / total) * 100),
            hit,
            miss: total - hit,
            total,
            ilkLimit
        };
    },

    _mesafeIlkBundle(kosular, programTarih, hedefMesafe, ilkLimit) {
        return {
            ay3: this.computeMesafeDonemIlkBasari(
                kosular, programTarih, hedefMesafe, { months: 3 }, ilkLimit
            ),
            ay1: this.computeMesafeDonemIlkBasari(
                kosular, programTarih, hedefMesafe, { months: 1 }, ilkLimit
            ),
            gun15: this.computeMesafeDonemIlkBasari(
                kosular, programTarih, hedefMesafe, { days: 15 }, ilkLimit
            )
        };
    },

    /** @deprecated computeSehirMesafeDonemIlkBasari kullanın */
    computeSehirMesafeDonemIlk3Basari(kosular, programTarih, hedefSehir, hedefMesafe, period) {
        const r = this.computeSehirMesafeDonemIlkBasari(
            kosular, programTarih, hedefSehir, hedefMesafe, period, 3
        );
        return { pct: r.pct, top3: r.hit, notTop3: r.miss, total: r.total };
    },

    /** SON800-1/2 derece — SON800-2 yoksa bu koşu atlanır (sütun 2 için) */
    _sonKosuSon800Derece(k, alan) {
        if (alan === 'iki') {
            const v = k.son800_iki;
            if (!v || v === '-') return null;
            return v;
        }
        const v = k.son800_bir;
        if (!v || v === '-') return null;
        return v;
    },

    /**
     * Zincir boş kaldığında yalnızca program günü koşusu varsa onu tek derinlik olarak kullan.
     * Tip A edge case (MİRAÇ): geçmiş yok, sadece o günün koşusu var.
     */
    _appendProgramDayOnlyChain(chain, kosular, programTarih, toChainItem) {
        if (chain.length || !programTarih || typeof toChainItem !== 'function') return chain;
        const programNorm = this._normalizeTarih(programTarih);
        if (!programNorm) return chain;
        for (const k of kosular || []) {
            if (!k?.tarih) continue;
            if (this._normalizeTarih(k.tarih) !== programNorm) continue;
            const item = toChainItem(k);
            if (item) {
                chain.push(item);
                break;
            }
        }
        return chain;
    },

    /** Tek koşu kaydında SON800 veya TEST1 için yeterli ham alan var mı */
    _kosuHasUsableMetrics(kosu) {
        if (!kosu) return false;
        if (kosu.son800_bir && kosu.son800_bir !== '-') return true;
        const d = kosu.at_derece;
        return !!(d && d !== '-' && AtSpeedUtils.dereceToSalise(d) != null);
    },

    /**
     * Geçmiş koşu profili — debut / kısmi / tam; TAHMİN uygunluğu.
     * API en fazla 7 koşu döner; program günü hariç geçmiş sayılır.
     */
    analyzeKosuHistory(kosular, programTarih) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        let total = 0;
        let pastExcludingProgram = 0;
        let usablePast = 0;
        let son800Past = 0;
        let test1Past = 0;
        let programDayMetrics = false;

        for (const k of kosular || []) {
            if (!k?.tarih) continue;
            total++;
            const isProgramDay = programNorm && this._normalizeTarih(k.tarih) === programNorm;
            if (isProgramDay) {
                if (this._kosuHasUsableMetrics(k)) programDayMetrics = true;
                continue;
            }
            pastExcludingProgram++;
            if (this._kosuHasUsableMetrics(k)) usablePast++;
            if (k.son800_bir && k.son800_bir !== '-') son800Past++;
            const d = k.at_derece;
            if (d && d !== '-' && AtSpeedUtils.dereceToSalise(d) != null) test1Past++;
        }

        const noHistory = total === 0;
        const debut = !noHistory && pastExcludingProgram === 0;
        const partial = pastExcludingProgram > 0 && pastExcludingProgram < 3;
        const tahminEligible = !noHistory && (pastExcludingProgram > 0 || programDayMetrics);
        const depthEligible = usablePast > 0 || programDayMetrics;

        return {
            total,
            pastExcludingProgram,
            usablePast,
            son800Past,
            test1Past,
            programDayMetrics,
            noHistory,
            debut,
            partial,
            tahminEligible,
            depthEligible,
            tier: noHistory ? 'yok' : debut ? 'debut' : partial ? 'kismi' : 'tam'
        };
    },

    /** Atın koşularını yeniden eskiye SON800 zinciri (program günü hariç; yalnız koşu varsa fallback) */
    _kosularSon800Zinciri(kosular, programTarih, alan = 'bir') {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const derece = this._sonKosuSon800Derece(k, alan);
            if (!derece) continue;
            const salise = AtSpeedUtils.dereceToSalise(derece);
            if (salise === null) continue;
            chain.push({ salise, derece, tarih: k.tarih });
        }
        this._appendProgramDayOnlyChain(chain, kosular, programTarih, k => {
            const derece = this._sonKosuSon800Derece(k, alan);
            if (!derece) return null;
            const salise = AtSpeedUtils.dereceToSalise(derece);
            if (salise === null) return null;
            return { salise, derece, tarih: k.tarih, programDayOnly: true };
        });
        return chain;
    },

    _buildSon800Chains(race, programTarih, alan = 'bir') {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(this._horseKey(horse), this._kosularSon800Zinciri(horse.kosular, programTarih, alan));
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth };
    },

    /**
     * Mevcut SON800 sütunları — derinlik bazlı rakip kıyası.
     * Her derinlikte en düşük süre %100, en yüksek %0; aradakiler doğrusal ölçek.
     */
    computeSon800DepthGrid(race, programTarih, alan = 'bir') {
        const { chains, maxDepth } = this._buildSon800Chains(race, programTarih, alan);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, salise: chain[d].salise, derece: chain[d].derece, tarih: chain[d].tarih });
                }
            }
            if (!atDepth.length) continue;
            const minSalise = Math.min(...atDepth.map(e => e.salise));
            const maxSalise = Math.max(...atDepth.map(e => e.salise));
            const comparedCount = atDepth.length;
            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.salise, minSalise, maxSalise);
                byHorse.get(e.key)[d] = {
                    pct,
                    derece: e.derece,
                    tarih: e.tarih,
                    salise: e.salise,
                    comparedCount,
                    depth: d,
                    isBest: e.salise === minSalise
                };
            }
        }
        return { maxDepth, byHorse };
    },

    /**
     * ORAN sütunları — koşudaki tüm SON800 değerlerinde min–max doğrusal ölçek.
     * Ana derece (en düşük süre) = %100, en yüksek süre = %0; aradakiler doğrusal.
     */
    computeSon800AnaOranGrid(race, programTarih, alan = 'bir') {
        const { chains, maxDepth } = this._buildSon800Chains(race, programTarih, alan);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        let anaSalise = null;
        let anaDerece = null;
        let kotuSalise = null;
        let kotuDerece = null;
        for (const chain of chains.values()) {
            for (const item of chain) {
                if (anaSalise === null || item.salise < anaSalise) {
                    anaSalise = item.salise;
                    anaDerece = item.derece;
                }
                if (kotuSalise === null || item.salise > kotuSalise) {
                    kotuSalise = item.salise;
                    kotuDerece = item.derece;
                }
            }
        }

        if (anaSalise !== null && anaSalise > 0) {
            for (let d = 0; d < maxDepth; d++) {
                for (const [key, chain] of chains) {
                    if (!chain[d]) continue;
                    const e = chain[d];
                    const pct = AtSpeedUtils.pctLinearMinBest(e.salise, anaSalise, kotuSalise);
                    byHorse.get(key)[d] = {
                        pct,
                        derece: e.derece,
                        tarih: e.tarih,
                        salise: e.salise,
                        anaDerece,
                        anaSalise,
                        kotuDerece,
                        kotuSalise,
                        depth: d,
                        isBest: e.salise === anaSalise,
                        isWorst: e.salise === kotuSalise
                    };
                }
            }
        }

        return { maxDepth, anaDerece, anaSalise, kotuDerece, kotuSalise, byHorse };
    },

    /** GÖSTERİM FARK = birinci_dr/sl − at_dr/sl */
    _computeKosuFark(kosu) {
        const mesafe = parseInt(String(kosu.mesafe || '').replace(/\D/g, ''), 10);
        if (!mesafe) return null;
        const dereceSalise = AtSpeedUtils.dereceToSalise(kosu.at_derece);
        const birinciSalise = AtSpeedUtils.dereceToSalise(kosu.birinci_derece);
        const drSl = AtSpeedUtils.metreBasiSalise(dereceSalise, mesafe);
        const birinciDrSl = AtSpeedUtils.metreBasiSalise(birinciSalise, mesafe);
        if (birinciDrSl !== null && drSl !== null) return birinciDrSl - drSl;
        return null;
    },

    /** Derinlik d'den geriye tüm koşularda FARKLARIN FARKI (sonFark − ilkFark) */
    _farklarinFarkiAtDepth(sortedKosular, depth) {
        const window = sortedKosular.slice(depth);
        if (!window.length) return null;
        const farkDegerleri = [];
        for (let i = window.length - 1; i >= 0; i--) {
            const fark = this._computeKosuFark(window[i]);
            if (fark !== null) farkDegerleri.push(fark);
        }
        if (!farkDegerleri.length) return null;
        const ilkFark = farkDegerleri[0];
        const sonFark = farkDegerleri[farkDegerleri.length - 1];
        const ff = sonFark - ilkFark;
        return {
            fark: ff,
            absFark: Math.abs(ff),
            adet: farkDegerleri.length,
            tarih: sortedKosular[depth]?.tarih || null
        };
    },

    _buildFarklarinFarkiChains(race, programTarih) {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = [];
            for (let d = 0; d < sorted.length; d++) {
                chain[d] = this._farklarinFarkiAtDepth(sorted, d);
            }
            chains.set(this._horseKey(horse), chain);
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { chains, maxDepth };
    },

    /**
     * FFΔ derinlik kıyası — GÖSTERİM FARKLARIN FARKI.
     * Her derinlikte o noktadan geriye |farkların farkı| 0'a en yakın = %100.
     */
    computeFarklarinFarkiDepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildFarklarinFarkiChains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minAbsFark = Math.min(...atDepth.map(e => e.absFark));
            const maxAbsFark = Math.max(...atDepth.map(e => e.absFark));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.absFark, minAbsFark, maxAbsFark);
                byHorse.get(e.key)[d] = {
                    pct,
                    fark: e.fark,
                    absFark: e.absFark,
                    adet: e.adet,
                    tarih: e.tarih,
                    comparedCount,
                    depth: d,
                    isBest: e.absFark === minAbsFark
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** GÖSTERİM TEST4 = TEST3 − TEST1 (salise) */
    _computeKosuTest4(kosu, hedefMesafe) {
        const t1 = this._kosuTest1Metrikleri(kosu, hedefMesafe);
        const t3 = this._kosuTest3Metrikleri(kosu, hedefMesafe);
        if (!t1 || !t3) return null;
        return t3.test3 - t1.test1;
    },

    /** Derinlik d'den geriye TEST8 = son TEST4 − ilk TEST4 (GÖSTERİM ile aynı) */
    _test8AtDepth(sortedKosular, depth, hedefMesafe) {
        const window = sortedKosular.slice(depth);
        if (!window.length) return null;
        const test4Degerleri = [];
        for (let i = window.length - 1; i >= 0; i--) {
            const t4 = this._computeKosuTest4(window[i], hedefMesafe);
            if (t4 !== null) test4Degerleri.push(t4);
        }
        if (!test4Degerleri.length) return null;
        const test8 = test4Degerleri[test4Degerleri.length - 1] - test4Degerleri[0];
        return {
            test8,
            absTest8: Math.abs(test8),
            adet: test4Degerleri.length,
            tarih: sortedKosular[depth]?.tarih || null
        };
    },

    _buildTest8Chains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = [];
            for (let d = 0; d < sorted.length; d++) {
                chain[d] = this._test8AtDepth(sorted, d, hedefMesafe);
            }
            chains.set(this._horseKey(horse), chain);
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { chains, maxDepth, hedefMesafe };
    },

    /**
     * T8Δ derinlik kıyası — GÖSTERİM TEST8 (TEST4 trendi).
     * Her derinlikte o noktadan geriye |TEST8| 0'a en yakın = %100.
     */
    computeTest8DepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest8Chains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minAbs = Math.min(...atDepth.map(e => e.absTest8));
            const maxAbs = Math.max(...atDepth.map(e => e.absTest8));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.absTest8, minAbs, maxAbs);
                byHorse.get(e.key)[d] = {
                    pct,
                    test8: e.test8,
                    absTest8: e.absTest8,
                    adet: e.adet,
                    tarih: e.tarih,
                    comparedCount,
                    depth: d,
                    isBest: e.absTest8 === minAbs
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** FARK 8002-8001 = SON800_2/SL − SON800_1/SL (GÖSTERİM ile aynı) */
    _computeFark8002_8001(kosu) {
        let son800_1 = kosu.son800_bir;
        let son800_2 = kosu.son800_iki;
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

    _kosularYenidenEskiye(kosular, programTarih) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        return [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
    },

    /** Derinlik d'den geriye son 7 koşuda FARK 8002-8001 ortalaması */
    _fark8002OrtAtDepth(sortedKosular, depth, windowSize = 7) {
        const window = sortedKosular.slice(depth, depth + windowSize);
        if (!window.length) return null;
        let toplam = 0;
        let adet = 0;
        for (const k of window) {
            const fark = this._computeFark8002_8001(k);
            if (fark !== null) {
                toplam += fark;
                adet++;
            }
        }
        if (adet === 0) return null;
        const ort = toplam / adet;
        return {
            ort,
            absOrt: Math.abs(ort),
            adet,
            tarih: sortedKosular[depth]?.tarih || null
        };
    },

    _buildFark8002OrtChains(race, programTarih) {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            const sorted = this._kosularYenidenEskiye(horse.kosular, programTarih);
            const chain = [];
            for (let d = 0; d < sorted.length; d++) {
                chain[d] = this._fark8002OrtAtDepth(sorted, d, 7);
            }
            chains.set(this._horseKey(horse), chain);
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { chains, maxDepth };
    },

    /**
     * 800Δ·7 derinlik kıyası — GÖSTERİM AT İSMİ mavi fosfor kuralı.
     * Her derinlikte son 7 koşu FARK 8002-8001 ort.; |ort| 0'a en yakın = %100.
     */
    computeFark8002OrtDepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildFark8002OrtChains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minAbsOrt = Math.min(...atDepth.map(e => e.absOrt));
            const maxAbsOrt = Math.max(...atDepth.map(e => e.absOrt));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.absOrt, minAbsOrt, maxAbsOrt);
                byHorse.get(e.key)[d] = {
                    pct,
                    ort: e.ort,
                    absOrt: e.absOrt,
                    adet: e.adet,
                    tarih: e.tarih,
                    comparedCount,
                    depth: d,
                    isBest: e.absOrt === minAbsOrt
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** @deprecated computeSon800DepthGrid kullanın */
    computeSon800RaceKiyaslama(race, programTarih, alan = 'bir') {
        return this.computeSon800DepthGrid(race, programTarih, alan);
    },

    computeSon8001RaceKiyaslama(race, programTarih) {
        return this.computeSon800DepthGrid(race, programTarih, 'bir');
    },

    computeSon8002RaceKiyaslama(race, programTarih) {
        return this.computeSon800DepthGrid(race, programTarih, 'iki');
    },

    _horseKey(horse) {
        return horse.atId != null ? String(horse.atId) : String(horse.no);
    },

    /** Atın son koşusu (program günü hariç, yeniden eskiye) */
    _sonKosuTam(kosular, programTarih) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        return sorted[0] || null;
    },

    /** Son koşudan SON800-1 + DR/SL (at veya birinci derece) */
    _sonKosuSon800DrKorelasyonMetrikleri(kosu, useAtDerece = false) {
        if (!kosu) return null;
        const son800 = kosu.son800_bir;
        if (!son800 || son800 === '-') return null;
        const son800Salise = AtSpeedUtils.dereceToSalise(son800);
        if (son800Salise === null || son800Salise <= 0) return null;

        const mesafe = this._parseMesafe(kosu.mesafe);
        const drDerece = useAtDerece ? kosu.at_derece : kosu.birinci_derece;
        const drSalise = AtSpeedUtils.dereceToSalise(drDerece);
        const drSl = (drSalise !== null && mesafe !== null)
            ? AtSpeedUtils.metreBasiSalise(drSalise, mesafe)
            : null;
        if (drSl === null || drSl <= 0) return null;

        return {
            son800Salise,
            son800Derece: son800,
            drSl,
            drDerece: drDerece || null,
            mesafe,
            tarih: kosu.tarih || null
        };
    },

    /** @deprecated _sonKosuSon800DrKorelasyonMetrikleri kullanın */
    _sonKosuSon800Dr1slMetrikleri(kosu) {
        return this._sonKosuSon800DrKorelasyonMetrikleri(kosu, false);
    },

    _kosularSon800DrKorelasyonZinciri(kosular, programTarih, useAtDerece = false) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._sonKosuSon800DrKorelasyonMetrikleri(k, useAtDerece);
            if (!metrik) continue;
            chain.push(metrik);
        }
        this._appendProgramDayOnlyChain(chain, kosular, programTarih, k => {
            const metrik = this._sonKosuSon800DrKorelasyonMetrikleri(k, useAtDerece);
            return metrik ? Object.assign({ programDayOnly: true }, metrik) : null;
        });
        return chain;
    },

    /** @deprecated _kosularSon800DrKorelasyonZinciri kullanın */
    _kosularSon800Dr1slZinciri(kosular, programTarih) {
        return this._kosularSon800DrKorelasyonZinciri(kosular, programTarih, false);
    },

    _buildSon800DrKorelasyonChains(race, programTarih, useAtDerece = false) {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularSon800DrKorelasyonZinciri(horse.kosular, programTarih, useAtDerece)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth };
    },

    /** @deprecated _buildSon800DrKorelasyonChains kullanın */
    _buildSon800Dr1slChains(race, programTarih) {
        return this._buildSon800DrKorelasyonChains(race, programTarih, false);
    },

    /** Geçmiş koşudan TEST1 (hedef mesafeye ölçekli DR/SL) */
    _kosuTest1Metrikleri(kosu, hedefMesafe) {
        if (!kosu || hedefMesafe === null || hedefMesafe <= 0) return null;
        const gecmisMesafe = kosu.mesafe;
        const dereceSalise = AtSpeedUtils.dereceToSalise(kosu.at_derece);
        const drSl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
        if (drSl === null || drSl <= 0) return null;
        const test1 = hedefMesafe * drSl;
        if (test1 <= 0) return null;
        return {
            test1,
            atDerece: kosu.at_derece || null,
            mesafe: this._parseMesafe(gecmisMesafe),
            tarih: kosu.tarih || null
        };
    },

    /** Atın koşularını yeniden eskiye TEST1 zinciri (program günü hariç) */
    _kosularTest1Zinciri(kosular, programTarih, hedefMesafe) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._kosuTest1Metrikleri(k, hedefMesafe);
            if (!metrik) continue;
            chain.push(metrik);
        }
        this._appendProgramDayOnlyChain(chain, kosular, programTarih, k => {
            const metrik = this._kosuTest1Metrikleri(k, hedefMesafe);
            return metrik ? Object.assign({ programDayOnly: true }, metrik) : null;
        });
        return chain;
    },

    _buildTest1Chains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularTest1Zinciri(horse.kosular, programTarih, hedefMesafe)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth, hedefMesafe };
    },

    /**
     * TEST1 derinlik bazlı rakip kıyası (SON, 1 ÖNCE …).
     * O gün koşan atlar arasında en düşük TEST1 = %100, en yüksek = %0; aradakiler doğrusal.
     */
    computeTest1DepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest1Chains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minTest1 = Math.min(...atDepth.map(e => e.test1));
            const maxTest1 = Math.max(...atDepth.map(e => e.test1));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.test1, minTest1, maxTest1);
                byHorse.get(e.key)[d] = {
                    pct,
                    test1: e.test1,
                    atDerece: e.atDerece,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.test1 === minTest1
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** Geçmiş koşudan TEST2 (hedef mesafeye ölçekli SON800-1/SL) */
    _kosuTest2Metrikleri(kosu, hedefMesafe) {
        if (!kosu || hedefMesafe === null || hedefMesafe <= 0) return null;
        const son800Salise = AtSpeedUtils.dereceToSalise(kosu.son800_bir);
        const son800Sl = son800Salise ? son800Salise / 800 : null;
        if (son800Sl === null || son800Sl <= 0) return null;
        const test2 = hedefMesafe * son800Sl;
        if (test2 <= 0) return null;
        return {
            test2,
            son800Derece: kosu.son800_bir || null,
            mesafe: this._parseMesafe(kosu.mesafe),
            tarih: kosu.tarih || null
        };
    },

    /** Atın koşularını yeniden eskiye TEST2 zinciri (program günü hariç) */
    _kosularTest2Zinciri(kosular, programTarih, hedefMesafe) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._kosuTest2Metrikleri(k, hedefMesafe);
            if (!metrik) continue;
            chain.push(metrik);
        }
        return chain;
    },

    _buildTest2Chains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularTest2Zinciri(horse.kosular, programTarih, hedefMesafe)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth, hedefMesafe };
    },

    /**
     * TEST2 derinlik bazlı rakip kıyası (SON, 1 ÖNCE …).
     * O gün koşan atlar arasında en düşük TEST2 = %100; diğerleri (min / değer) × 100.
     */
    computeTest2DepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest2Chains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minTest2 = Math.min(...atDepth.map(e => e.test2));
            const maxTest2 = Math.max(...atDepth.map(e => e.test2));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.test2, minTest2, maxTest2);
                byHorse.get(e.key)[d] = {
                    pct,
                    test2: e.test2,
                    son800Derece: e.son800Derece,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.test2 === minTest2
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** Geçmiş koşudan TEST3 (hedef mesafeye ölçekli SON800-2/SL; yoksa SON800-1) */
    _kosuTest3Metrikleri(kosu, hedefMesafe) {
        if (!kosu || hedefMesafe === null || hedefMesafe <= 0) return null;
        let son800Derece = kosu.son800_iki;
        let usedSon8002 = true;
        if (!son800Derece || son800Derece === '-') {
            son800Derece = kosu.son800_bir;
            usedSon8002 = false;
        }
        const son800Salise = AtSpeedUtils.dereceToSalise(son800Derece);
        const son800Sl = son800Salise ? son800Salise / 800 : null;
        if (son800Sl === null || son800Sl <= 0) return null;
        const test3 = hedefMesafe * son800Sl;
        if (test3 <= 0) return null;
        return {
            test3,
            son800Derece: son800Derece || null,
            usedSon8002,
            mesafe: this._parseMesafe(kosu.mesafe),
            tarih: kosu.tarih || null
        };
    },

    /** Atın koşularını yeniden eskiye TEST3 zinciri (program günü hariç) */
    _kosularTest3Zinciri(kosular, programTarih, hedefMesafe) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._kosuTest3Metrikleri(k, hedefMesafe);
            if (!metrik) continue;
            chain.push(metrik);
        }
        return chain;
    },

    _buildTest3Chains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularTest3Zinciri(horse.kosular, programTarih, hedefMesafe)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth, hedefMesafe };
    },

    /**
     * TEST3 derinlik bazlı rakip kıyası (SON, 1 ÖNCE …).
     * O gün koşan atlar arasında en düşük TEST3 = %100; diğerleri (min / değer) × 100.
     */
    computeTest3DepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest3Chains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minTest3 = Math.min(...atDepth.map(e => e.test3));
            const maxTest3 = Math.max(...atDepth.map(e => e.test3));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.test3, minTest3, maxTest3);
                byHorse.get(e.key)[d] = {
                    pct,
                    test3: e.test3,
                    son800Derece: e.son800Derece,
                    usedSon8002: e.usedSon8002,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.test3 === minTest3
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** TEST1≤TEST2≤TEST3 (T3≥T2≥T1) kural skoru — GÖSTERİM koyu mavi kenar ile aynı */
    _computeTest123SiraliSkor(test1, test2, test3) {
        if (test1 === null || test2 === null || test3 === null) return null;
        if (test1 <= 0 || test2 <= 0 || test3 <= 0) return null;
        const qualifies = test3 >= test2 && test2 >= test1;
        const score12 = test2 >= test1 ? 100 : Math.round((test2 / test1) * 100);
        const score23 = test3 >= test2 ? 100 : Math.round((test3 / test2) * 100);
        const rulePct = Math.round(Math.sqrt(score12 * score23));
        return {
            test1,
            test2,
            test3,
            qualifies,
            score12,
            score23,
            rulePct,
            violation12: Math.max(0, test1 - test2),
            violation23: Math.max(0, test2 - test3)
        };
    },

    /** Geçmiş koşudan TEST1+TEST2+TEST3 sıralı kural metrikleri */
    _kosuTest123SiraliMetrikleri(kosu, hedefMesafe) {
        const t1 = this._kosuTest1Metrikleri(kosu, hedefMesafe);
        const t2 = this._kosuTest2Metrikleri(kosu, hedefMesafe);
        const t3 = this._kosuTest3Metrikleri(kosu, hedefMesafe);
        if (!t1 || !t2 || !t3) return null;
        const skor = this._computeTest123SiraliSkor(t1.test1, t2.test2, t3.test3);
        if (!skor) return null;
        return {
            ...skor,
            atDerece: t1.atDerece,
            son800Bir: t2.son800Derece,
            son800Iki: t3.usedSon8002 ? t3.son800Derece : null,
            son800Derece: t3.son800Derece,
            usedSon8002: t3.usedSon8002,
            mesafe: t1.mesafe,
            tarih: t1.tarih || t2.tarih || t3.tarih
        };
    },

    _kosularTest123SiraliZinciri(kosular, programTarih, hedefMesafe) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._kosuTest123SiraliMetrikleri(k, hedefMesafe);
            if (!metrik) continue;
            chain.push(metrik);
        }
        return chain;
    },

    _buildTest123SiraliChains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularTest123SiraliZinciri(horse.kosular, programTarih, hedefMesafe)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth, hedefMesafe };
    },

    /**
     * TEST3≥TEST2≥TEST1 derinlik grid — koşu genelinde kural skoru min–max doğrusal ölçek.
     * En yüksek rulePct = %100, en düşük rulePct = %0.
     */
    computeTest123SiraliDepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest123SiraliChains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        let minRulePct = null;
        let maxRulePct = null;
        for (const chain of chains.values()) {
            for (const item of chain) {
                if (item.rulePct == null) continue;
                if (minRulePct === null || item.rulePct < minRulePct) minRulePct = item.rulePct;
                if (maxRulePct === null || item.rulePct > maxRulePct) maxRulePct = item.rulePct;
            }
        }

        if (minRulePct === null || maxRulePct === null) {
            return { maxDepth, minRulePct, maxRulePct, byHorse };
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) atDepth.push({ key, ...chain[d] });
            }
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMaxBest(e.rulePct, minRulePct, maxRulePct);
                byHorse.get(e.key)[d] = {
                    pct,
                    rulePct: e.rulePct,
                    score12: e.score12,
                    score23: e.score23,
                    test1: e.test1,
                    test2: e.test2,
                    test3: e.test3,
                    qualifies: e.qualifies,
                    atDerece: e.atDerece,
                    son800Derece: e.son800Derece,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    minRulePct,
                    maxRulePct,
                    comparedCount,
                    depth: d,
                    isBest: e.rulePct === maxRulePct,
                    isWorst: e.rulePct === minRulePct
                };
            }
        }

        return { maxDepth, minRulePct, maxRulePct, byHorse };
    },

    /** Geçmiş koşudan T1×DR (TEST1 × DR/1DR) — GÖSTERİM ile aynı */
    _kosuT1drMetrikleri(kosu, hedefMesafe) {
        if (!kosu || hedefMesafe === null || hedefMesafe <= 0) return null;
        const gecmisMesafe = kosu.mesafe;
        const dereceSalise = AtSpeedUtils.dereceToSalise(kosu.at_derece);
        const birinciSalise = AtSpeedUtils.dereceToSalise(kosu.birinci_derece);
        const drSl = AtSpeedUtils.metreBasiSalise(dereceSalise, gecmisMesafe);
        const birinciDrSl = AtSpeedUtils.metreBasiSalise(birinciSalise, gecmisMesafe);
        const drOran = (drSl !== null && birinciDrSl !== null && birinciDrSl !== 0)
            ? drSl / birinciDrSl
            : null;
        if (drSl === null || drOran === null) return null;
        const test1 = hedefMesafe * drSl;
        const t1dr = test1 * drOran;
        if (t1dr <= 0) return null;
        return {
            t1dr,
            test1,
            drOran,
            drSl,
            birinciDrSl,
            atDerece: kosu.at_derece || null,
            birinciDerece: kosu.birinci_derece || null,
            mesafe: this._parseMesafe(gecmisMesafe),
            tarih: kosu.tarih || null
        };
    },

    _kosularT1drZinciri(kosular, programTarih, hedefMesafe) {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const sorted = [...(kosular || [])]
            .filter(k => {
                if (!k?.tarih) return false;
                if (programNorm && this._normalizeTarih(k.tarih) === programNorm) return false;
                return true;
            })
            .sort((a, b) => {
                const da = this._parseKosuTarih(a.tarih);
                const db = this._parseKosuTarih(b.tarih);
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return db - da;
            });
        const chain = [];
        for (const k of sorted) {
            const metrik = this._kosuT1drMetrikleri(k, hedefMesafe);
            if (!metrik) continue;
            chain.push(metrik);
        }
        return chain;
    },

    _buildT1drChains(race, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(
                this._horseKey(horse),
                this._kosularT1drZinciri(horse.kosular, programTarih, hedefMesafe)
            );
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth, hedefMesafe };
    },

    /**
     * T1×DR derinlik bazlı rakip kıyası (SON, 1 ÖNCE …).
     * O gün koşan atlar arasında en düşük T1×DR = %100, en yüksek = %0; aradakiler doğrusal.
     */
    computeT1drDepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildT1drChains(race, programTarih);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minT1dr = Math.min(...atDepth.map(e => e.t1dr));
            const maxT1dr = Math.max(...atDepth.map(e => e.t1dr));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = AtSpeedUtils.pctLinearMinBest(e.t1dr, minT1dr, maxT1dr);
                byHorse.get(e.key)[d] = {
                    pct,
                    t1dr: e.t1dr,
                    t1drDerece: AtSpeedUtils.saliseToDerece(e.t1dr),
                    test1: e.test1,
                    drOran: e.drOran,
                    atDerece: e.atDerece,
                    birinciDerece: e.birinciDerece,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.t1dr === minT1dr
                };
            }
        }

        return { maxDepth, byHorse };
    },

    /** @deprecated computeTest1DepthGrid kullanın */
    computeTest12DepthGrid(race, programTarih) {
        return this.computeTest1DepthGrid(race, programTarih);
    },

    /**
     * SON800-1 + DR/SL derinlik bazlı korelasyon (SON, 1 ÖNCE …).
     * useAtDerece=false → 1DR/SL (birinci), true → DR/SL (at derecesi).
     */
    computeSon800DrKorelasyonGrid(race, programTarih, useAtDerece = false) {
        const { chains, maxDepth } = this._buildSon800DrKorelasyonChains(race, programTarih, useAtDerece);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, ...chain[d] });
                }
            }
            if (!atDepth.length) continue;

            const minSon800 = Math.min(...atDepth.map(e => e.son800Salise));
            const maxSon800 = Math.max(...atDepth.map(e => e.son800Salise));
            const minDrSl = Math.min(...atDepth.map(e => e.drSl));
            const maxDrSl = Math.max(...atDepth.map(e => e.drSl));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const son800Pct = AtSpeedUtils.pctLinearMinBest(e.son800Salise, minSon800, maxSon800);
                const drPct = AtSpeedUtils.pctLinearMinBest(e.drSl, minDrSl, maxDrSl);
                const pct = Math.round(Math.sqrt(son800Pct * drPct));
                byHorse.get(e.key)[d] = {
                    pct,
                    son800Pct,
                    drPct,
                    dr1Pct: drPct,
                    son800Derece: e.son800Derece,
                    drDerece: e.drDerece,
                    birinciDerece: e.drDerece,
                    son800Salise: e.son800Salise,
                    drSl: e.drSl,
                    birinciDrSl: e.drSl,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.son800Salise === minSon800 && e.drSl === minDrSl
                };
            }
        }

        return { maxDepth, byHorse };
    },

    computeSon800Dr1slKorelasyonGrid(race, programTarih) {
        return this.computeSon800DrKorelasyonGrid(race, programTarih, false);
    },

    computeSon800DrslKorelasyonGrid(race, programTarih) {
        return this.computeSon800DrKorelasyonGrid(race, programTarih, true);
    },

    /**
     * Derinlik dizisi ağırlıklı ortalama — SON en yüksek ağırlık, geriye gidildikçe azalır.
     * Ağırlık(depth d) = maxDepth - d; eksik derinlikler hesaba katılmaz.
     */
    _computeDepthAgirlikliOrtalama(depths, maxDepth) {
        if (!maxDepth || !depths?.length) return null;
        let weightedSum = 0;
        let weightSum = 0;
        const parts = [];
        for (let d = 0; d < maxDepth; d++) {
            const cell = depths[d];
            if (!cell || cell.pct === null || cell.pct === undefined) continue;
            const weight = maxDepth - d;
            weightedSum += cell.pct * weight;
            weightSum += weight;
            parts.push({
                depth: d,
                pct: cell.pct,
                weight,
                tarih: cell.tarih || null
            });
        }
        if (weightSum === 0) return null;
        return {
            pct: Math.round(weightedSum / weightSum),
            depthCount: parts.length,
            maxDepth,
            weightSum,
            parts
        };
    },

    /**
     * TAHMİN — derinlik ağırlıklı yüzde bileşenleri.
     * Dolu hücreler: katkı = (pct/100) × W(d); W(d) = maxDepth − d.
     * @returns {{ normalized: number, baseRatio: number, weightSum: number, trendSlope: number|null, sonZeroPenalty: number, parts: object[] }|null}
     */
    computeDepthPctTahminComponents(depths, maxDepth, options = {}) {
        const penaltyRef = options.sonZeroPenaltyRef ?? 8;
        const effectiveMaxDepth = maxDepth || depths?.length || 0;
        if (!effectiveMaxDepth || !depths?.length) return null;

        let weightedSum = 0;
        let weightSum = 0;
        const parts = [];

        for (let d = 0; d < effectiveMaxDepth; d++) {
            const cell = depths[d];
            if (!cell || cell.pct == null || cell.pct === undefined) continue;
            const w = effectiveMaxDepth - d;
            const contrib = (cell.pct / 100) * w;
            weightedSum += contrib;
            weightSum += w;
            parts.push({ depth: d, pct: cell.pct, weight: w, contrib });
        }

        if (weightSum === 0) return null;

        const baseRatio = weightedSum / weightSum;
        const normalized = baseRatio * 100;

        const p0 = depths[0]?.pct;
        const p2 = depths[2]?.pct;
        let trendSlope = null;
        if (p0 != null && p2 != null) {
            trendSlope = (p0 - p2) / 2;
        }

        let sonZeroPenalty = 0;
        if (p0 === 0) {
            sonZeroPenalty = penaltyRef;
        }

        return {
            normalized,
            baseRatio,
            weightedSum,
            weightSum,
            trendSlope,
            sonZeroPenalty,
            depthCount: parts.length,
            maxDepth: effectiveMaxDepth,
            parts
        };
    },

    /** SON … (n−1) ÖNCE derinlik yüzdelerinin aritmetik ortalaması */
    _computeDepthSonNOrtalama(depths, count) {
        if (!count || !depths?.length) return null;
        let sum = 0;
        let adet = 0;
        const parts = [];
        for (let d = 0; d < count; d++) {
            const cell = depths[d];
            if (!cell || cell.pct === null || cell.pct === undefined) continue;
            sum += cell.pct;
            adet++;
            parts.push({ depth: d, pct: cell.pct, tarih: cell.tarih || null });
        }
        if (adet === 0) return null;
        return {
            pct: Math.round(sum / adet),
            depthCount: adet,
            windowSize: count,
            parts
        };
    },

    /** AĞ. ORT.3 — AĞ. ORT.2 (ağırlık 4) > AĞ. ORT.1 (2) > AĞ. ORT. (1) */
    _computeDepthOrt3Agirlikli(agirlikli, ort1, ort2) {
        const terms = [];
        if (ort2?.pct != null) terms.push({ pct: ort2.pct, weight: 4, label: 'AĞ. ORT.2' });
        if (ort1?.pct != null) terms.push({ pct: ort1.pct, weight: 2, label: 'AĞ. ORT.1' });
        if (agirlikli?.pct != null) terms.push({ pct: agirlikli.pct, weight: 1, label: 'AĞ. ORT.' });
        if (!terms.length) return null;
        let weightedSum = 0;
        let weightSum = 0;
        for (const t of terms) {
            weightedSum += t.pct * t.weight;
            weightSum += t.weight;
        }
        return {
            pct: Math.round(weightedSum / weightSum),
            count: terms.length,
            weightSum,
            parts: terms
        };
    },

    /** Derinlik özeti: AĞ. ORT. + son 3/2 ort. + ağırlıklı AĞ. ORT.3 (eksik derinlik = 0 sayılmaz) */
    _computeDepthOrtOzeti(depths, maxDepth) {
        const agirlikli = this._computeDepthAgirlikliOrtalama(depths, maxDepth);
        const ort1 = this._computeDepthSonNOrtalama(depths, 3);
        const ort2 = this._computeDepthSonNOrtalama(depths, 2);
        const ort3 = this._computeDepthOrt3Agirlikli(agirlikli, ort1, ort2);
        return { agirlikli, ort1, ort2, ort3 };
    },

    /** @deprecated _computeDepthOrtOzeti kullanın */
    _computeFark827OrtOzeti(depths, maxDepth) {
        return this._computeDepthOrtOzeti(depths, maxDepth);
    },

    /** @deprecated _computeDepthAgirlikliOrtalama kullanın */
    _computeSon800Dr1AgirlikliOrtalama(depths, maxDepth) {
        return this._computeDepthAgirlikliOrtalama(depths, maxDepth);
    },

    /** @deprecated computeSon800Dr1slKorelasyonGrid kullanın */
    computeSon800Dr1slKorelasyon(race, programTarih) {
        const grid = this.computeSon800Dr1slKorelasyonGrid(race, programTarih);
        const byHorse = new Map();
        let comparedCount = 0;
        for (const [key, depths] of grid.byHorse) {
            byHorse.set(key, depths[0] || null);
            if (depths[0]?.comparedCount) comparedCount = depths[0].comparedCount;
        }
        return { byHorse, comparedCount };
    },

    /** Koşu listesi için tüm istatistik satırları + SON800 derinlik meta */
    buildRaceIstatistikPackage(race, hedefSehir, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const son8001Grid = this.computeSon800DepthGrid(race, programTarih, 'bir');
        const son8002Grid = this.computeSon800DepthGrid(race, programTarih, 'iki');
        const oran1Grid = this.computeSon800AnaOranGrid(race, programTarih, 'bir');
        const oran2Grid = this.computeSon800AnaOranGrid(race, programTarih, 'iki');
        const fark827Grid = this.computeFark8002OrtDepthGrid(race, programTarih);
        const ffGrid = this.computeFarklarinFarkiDepthGrid(race, programTarih);
        const test8Grid = this.computeTest8DepthGrid(race, programTarih);
        const son800Dr1Grid = this.computeSon800Dr1slKorelasyonGrid(race, programTarih);
        const son800DrGrid = this.computeSon800DrslKorelasyonGrid(race, programTarih);
        const test1Grid = this.computeTest1DepthGrid(race, programTarih);
        const test2Grid = this.computeTest2DepthGrid(race, programTarih);
        const test3Grid = this.computeTest3DepthGrid(race, programTarih);
        const test123SiraliGrid = this.computeTest123SiraliDepthGrid(race, programTarih);
        const t1drGrid = this.computeT1drDepthGrid(race, programTarih);
        const horses = [...(race.horses || [])].sort((a, b) => {
            const na = parseInt(a.no, 10);
            const nb = parseInt(b.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
        });
        const rows = horses.map(horse => {
            const key = this._horseKey(horse);
            const kosular = horse.kosular || [];
            const sehir = this.computeSehirDeneyimi(kosular, hedefSehir);
            const ay3 = this.computeDonemOrani(kosular, programTarih, { months: 3 });
            const ay1 = this.computeDonemOrani(kosular, programTarih, { months: 1 });
            const gun15 = this.computeDonemOrani(kosular, programTarih, { days: 15 });
            const genelIlk3 = this._genelIlkBundle(kosular, programTarih, 3);
            const genelIlk2 = this._genelIlkBundle(kosular, programTarih, 2);
            const genelIlk1 = this._genelIlkBundle(kosular, programTarih, 1);
            const smIlk3 = this._smIlkBundle(kosular, programTarih, hedefSehir, hedefMesafe, 3);
            const smIlk2 = this._smIlkBundle(kosular, programTarih, hedefSehir, hedefMesafe, 2);
            const smIlk1 = this._smIlkBundle(kosular, programTarih, hedefSehir, hedefMesafe, 1);
            const mesafeIlk3 = this._mesafeIlkBundle(kosular, programTarih, hedefMesafe, 3);
            const mesafeIlk2 = this._mesafeIlkBundle(kosular, programTarih, hedefMesafe, 2);
            const mesafeIlk1 = this._mesafeIlkBundle(kosular, programTarih, hedefMesafe, 1);
            const dr1Depths = son800Dr1Grid.byHorse.get(key) || [];
            const drDepths = son800DrGrid.byHorse.get(key) || [];
            const son8001Depths = son8001Grid.byHorse.get(key) || [];
            const son8002Depths = son8002Grid.byHorse.get(key) || [];
            const oran1Depths = oran1Grid.byHorse.get(key) || [];
            const oran2Depths = oran2Grid.byHorse.get(key) || [];
            const fark827Depths = fark827Grid.byHorse.get(key) || [];
            const ffDepths = ffGrid.byHorse.get(key) || [];
            const test8Depths = test8Grid.byHorse.get(key) || [];
            const test1Depths = test1Grid.byHorse.get(key) || [];
            const test2Depths = test2Grid.byHorse.get(key) || [];
            const test3Depths = test3Grid.byHorse.get(key) || [];
            const test123SiraliDepths = test123SiraliGrid.byHorse.get(key) || [];
            const t1drDepths = t1drGrid.byHorse.get(key) || [];
            const kosuHistory = this.analyzeKosuHistory(kosular, programTarih);
            const row = {
                no: horse.no,
                name: horse.name || '-',
                atId: horse.atId,
                kosular,
                kosuHistory,
                hedefMesafe,
                sehir,
                son8001Depths,
                son8001OrtOzeti: this._computeDepthOrtOzeti(
                    son8001Depths, son8001Grid.maxDepth
                ),
                son8002Depths,
                son8002OrtOzeti: this._computeDepthOrtOzeti(
                    son8002Depths, son8002Grid.maxDepth
                ),
                oran1Depths,
                oran1OrtOzeti: this._computeDepthOrtOzeti(
                    oran1Depths, oran1Grid.maxDepth
                ),
                oran2Depths,
                oran2OrtOzeti: this._computeDepthOrtOzeti(
                    oran2Depths, oran2Grid.maxDepth
                ),
                fark827Depths,
                fark827OrtOzeti: this._computeDepthOrtOzeti(
                    fark827Depths, fark827Grid.maxDepth
                ),
                ffDepths,
                ffOrtOzeti: this._computeDepthOrtOzeti(
                    ffDepths, ffGrid.maxDepth
                ),
                test8Depths,
                test8OrtOzeti: this._computeDepthOrtOzeti(
                    test8Depths, test8Grid.maxDepth
                ),
                son800Dr1Depths: dr1Depths,
                son800Dr1OrtOzeti: this._computeDepthOrtOzeti(
                    dr1Depths, son800Dr1Grid.maxDepth
                ),
                son800DrDepths: drDepths,
                son800DrOrtOzeti: this._computeDepthOrtOzeti(
                    drDepths, son800DrGrid.maxDepth
                ),
                test1Depths,
                test1OrtOzeti: this._computeDepthOrtOzeti(
                    test1Depths, test1Grid.maxDepth
                ),
                test2Depths,
                test2OrtOzeti: this._computeDepthOrtOzeti(
                    test2Depths, test2Grid.maxDepth
                ),
                test3Depths,
                test3OrtOzeti: this._computeDepthOrtOzeti(
                    test3Depths, test3Grid.maxDepth
                ),
                test123SiraliDepths,
                test123SiraliOrtOzeti: this._computeDepthOrtOzeti(
                    test123SiraliDepths, test123SiraliGrid.maxDepth
                ),
                t1drDepths,
                t1drOrtOzeti: this._computeDepthOrtOzeti(
                    t1drDepths, t1drGrid.maxDepth
                ),
                ay3,
                ay1,
                gun15,
                genelIlk3,
                genelIlk2,
                genelIlk1,
                smIlk3,
                smIlk2,
                smIlk1,
                mesafeIlk3,
                mesafeIlk2,
                mesafeIlk1
            };
            if (typeof AtMetaFields !== 'undefined') {
                AtMetaFields.attachToIstatistikRow(row, horse, race);
            }
            return row;
        });
        return {
            maxDepth1: son8001Grid.maxDepth,
            maxDepth2: son8002Grid.maxDepth,
            oranMaxDepth1: oran1Grid.maxDepth,
            oranMaxDepth2: oran2Grid.maxDepth,
            oranAnaDerece1: oran1Grid.anaDerece,
            oranAnaDerece2: oran2Grid.anaDerece,
            oranKotuDerece1: oran1Grid.kotuDerece,
            oranKotuDerece2: oran2Grid.kotuDerece,
            maxDepthFark827: fark827Grid.maxDepth,
            maxDepthFf: ffGrid.maxDepth,
            maxDepthT8: test8Grid.maxDepth,
            maxDepthDr1: son800Dr1Grid.maxDepth,
            maxDepthDr: son800DrGrid.maxDepth,
            maxDepthTest1: test1Grid.maxDepth,
            maxDepthTest2: test2Grid.maxDepth,
            maxDepthTest3: test3Grid.maxDepth,
            maxDepthTest123Sirali: test123SiraliGrid.maxDepth,
            testsiraMinRulePct: test123SiraliGrid.minRulePct,
            testsiraMaxRulePct: test123SiraliGrid.maxRulePct,
            maxDepthT1dr: t1drGrid.maxDepth,
            programTarih,
            hedefSehir,
            rows
        };
    },

    /** Koşu içi derinlik % — o koşudaki tüm atların tüm derinliklerinde tek min/max (en iyi %100, en kötü %0) */
    RACE_PCT_SPECS: [
        { depthsKey: 'test1Depths', valueKey: 'test1', maxDepthKey: 'maxDepthTest1', ortKey: 'test1OrtOzeti' },
        { depthsKey: 'test2Depths', valueKey: 'test2', maxDepthKey: 'maxDepthTest2', ortKey: 'test2OrtOzeti' },
        { depthsKey: 'test3Depths', valueKey: 'test3', maxDepthKey: 'maxDepthTest3', ortKey: 'test3OrtOzeti' },
        { depthsKey: 't1drDepths', valueKey: 't1dr', maxDepthKey: 'maxDepthT1dr', ortKey: 't1drOrtOzeti' },
        { depthsKey: 'son8001Depths', valueKey: 'salise', maxDepthKey: 'maxDepth1', ortKey: 'son8001OrtOzeti' },
        { depthsKey: 'son8002Depths', valueKey: 'salise', maxDepthKey: 'maxDepth2', ortKey: 'son8002OrtOzeti' },
        { depthsKey: 'fark827Depths', valueKey: 'absOrt', maxDepthKey: 'maxDepthFark827', ortKey: 'fark827OrtOzeti' },
        { depthsKey: 'ffDepths', valueKey: 'absFark', maxDepthKey: 'maxDepthFf', ortKey: 'ffOrtOzeti' },
        { depthsKey: 'test8Depths', valueKey: 'absTest8', maxDepthKey: 'maxDepthT8', ortKey: 'test8OrtOzeti' }
    ],

    RACE_SON800_DR_SPECS: [
        { depthsKey: 'son800Dr1Depths', maxDepthKey: 'maxDepthDr1', ortKey: 'son800Dr1OrtOzeti' },
        { depthsKey: 'son800DrDepths', maxDepthKey: 'maxDepthDr', ortKey: 'son800DrOrtOzeti' }
    ],

    _collectRaceValueBounds(pkg, depthsKey, valueKey) {
        let minVal = null;
        let maxVal = null;
        for (const row of pkg.rows || []) {
            for (const cell of row[depthsKey] || []) {
                if (!cell) continue;
                const v = cell[valueKey];
                if (v == null || Number.isNaN(v)) continue;
                if (minVal === null || v < minVal) minVal = v;
                if (maxVal === null || v > maxVal) maxVal = v;
            }
        }
        return { minVal, maxVal };
    },

    _applyRaceLinearPct(pkg, spec) {
        const { minVal, maxVal } = this._collectRaceValueBounds(
            pkg, spec.depthsKey, spec.valueKey
        );
        if (minVal === null || maxVal === null) return null;
        const maxDepth = pkg[spec.maxDepthKey] || 0;
        for (const row of pkg.rows || []) {
            const depths = row[spec.depthsKey] || [];
            for (let d = 0; d < depths.length; d++) {
                const cell = depths[d];
                if (!cell || cell[spec.valueKey] == null) continue;
                cell.pct = AtSpeedUtils.pctLinearMinBest(cell[spec.valueKey], minVal, maxVal);
                cell.isBest = cell[spec.valueKey] === minVal;
            }
            if (spec.ortKey) {
                row[spec.ortKey] = this._computeDepthOrtOzeti(depths, maxDepth);
            }
        }
        return { minVal, maxVal };
    },

    /**
     * Atın kendi derinlikleri içinde min–max ölçek (selfPct).
     * minBest: en düşük değer %100; maxBest: en yüksek değer %100.
     */
    _applyHorseSelfPctOnRows(rows, depthsKey, valueKey, scale = 'minBest') {
        if (!rows?.length) return;
        for (const row of rows) {
            const depths = row[depthsKey] || [];
            let minVal = null;
            let maxVal = null;
            for (const cell of depths) {
                if (!cell) continue;
                const v = cell[valueKey];
                if (v == null || Number.isNaN(v)) continue;
                if (minVal === null || v < minVal) minVal = v;
                if (maxVal === null || v > maxVal) maxVal = v;
            }
            if (minVal === null || maxVal === null) continue;
            for (const cell of depths) {
                if (!cell || cell[valueKey] == null) continue;
                const v = cell[valueKey];
                if (scale === 'maxBest') {
                    cell.selfPct = AtSpeedUtils.pctLinearMaxBest(v, minVal, maxVal);
                    cell.isSelfBest = v === maxVal;
                } else {
                    cell.selfPct = AtSpeedUtils.pctLinearMinBest(v, minVal, maxVal);
                    cell.isSelfBest = v === minVal;
                }
            }
        }
    },

    _applyHorseSelfPctSpecs(pkg, specs) {
        for (const spec of specs) {
            this._applyHorseSelfPctOnRows(
                pkg.rows,
                spec.depthsKey,
                spec.valueKey,
                spec.scale || 'minBest'
            );
        }
    },

    /**
     * SON·Δ: derinlikteki değer ile atın kendi en iyi değeri arasındaki salise farkı.
     * Her derinlik sütununda min fark %0, max fark %100.
     */
    _applyPctGapSpecs(pkg, specs) {
        for (const spec of specs) {
            const scale = spec.scale || 'minBest';
            const valueKey = spec.valueKey;
            const maxDepth = pkg[spec.maxDepthKey] || 0;
            const rows = pkg.rows || [];
            const { minVal: raceMin, maxVal: raceMax } = this._collectRaceValueBounds(
                pkg, spec.depthsKey, spec.valueKey
            );

            for (const row of rows) {
                const depths = row[spec.depthsKey] || [];
                let horseBest = null;
                let horseBestDerece = null;
                for (const cell of depths) {
                    if (!cell) continue;
                    const v = cell[valueKey];
                    if (v == null || Number.isNaN(v)) continue;
                    if (horseBest === null) {
                        horseBest = v;
                    } else if (scale === 'maxBest') {
                        horseBest = Math.max(horseBest, v);
                    } else {
                        horseBest = Math.min(horseBest, v);
                    }
                }
                let horseBestPct = null;
                if (horseBest != null && raceMin != null && raceMax != null) {
                    horseBestPct = scale === 'maxBest'
                        ? AtSpeedUtils.pctLinearMaxBest(horseBest, raceMin, raceMax)
                        : AtSpeedUtils.pctLinearMinBest(horseBest, raceMin, raceMax);
                }
                if (horseBest != null) {
                    for (const cell of depths) {
                        if (!cell || cell[valueKey] == null) continue;
                        if (cell[valueKey] !== horseBest) continue;
                        horseBestDerece = cell.derece || cell.son800Derece || cell.t1drDerece
                            || (cell.salise != null ? AtSpeedUtils.saliseToDerece(cell.salise) : null);
                        if (horseBestDerece) break;
                        if (scale === 'maxBest' && valueKey === 'rulePct') {
                            horseBestDerece = '%' + cell.rulePct;
                            break;
                        }
                        if (valueKey !== 'salise' && valueKey !== 'rulePct') {
                            horseBestDerece = String(cell[valueKey]);
                            break;
                        }
                    }
                    if (!horseBestDerece && horseBest != null) {
                        horseBestDerece = scale === 'maxBest' && valueKey === 'rulePct'
                            ? '%' + horseBest
                            : AtSpeedUtils.saliseToDerece(horseBest);
                    }
                }
                for (const cell of depths) {
                    if (!cell || cell[valueKey] == null || horseBest == null) continue;
                    cell.gapSalise = Math.abs(cell[valueKey] - horseBest);
                    cell.horseBestVal = horseBest;
                    cell.horseBestDerece = horseBestDerece;
                    cell.horseBestPct = horseBestPct;
                    cell.isHorseBestRaceBest = scale === 'maxBest'
                        ? horseBest === raceMax
                        : horseBest === raceMin;
                    cell.isHorseBestRaceWorst = scale === 'maxBest'
                        ? horseBest === raceMin
                        : horseBest === raceMax;
                }
            }

            for (let d = 0; d < maxDepth; d++) {
                let minGap = null;
                let maxGap = null;
                for (const row of rows) {
                    const cell = row[spec.depthsKey]?.[d];
                    if (!cell || cell.gapSalise == null) continue;
                    if (minGap === null || cell.gapSalise < minGap) minGap = cell.gapSalise;
                    if (maxGap === null || cell.gapSalise > maxGap) maxGap = cell.gapSalise;
                }
                for (const row of rows) {
                    const cell = row[spec.depthsKey]?.[d];
                    if (!cell || cell.gapSalise == null) continue;
                    cell.gapPct = AtSpeedUtils.pctLinearMaxBest(cell.gapSalise, minGap, maxGap);
                    cell.isGapMax = maxGap != null && cell.gapSalise === maxGap;
                    cell.isGapMin = minGap != null && cell.gapSalise === minGap;
                }
            }

            for (const row of rows) {
                for (const cell of row[spec.depthsKey] || []) {
                    if (!cell) continue;
                    this._applyDepthSuccessPct(cell);
                }
            }
        }
    },

    /**
     * SON·BS — dört sinyalin geometrik ortalaması (başarı şansı).
     * SON, Eİ, İÇ yüksek = iyi; Δ düşük = iyi → yakınlık = 100 − Δ.
     */
    _applyDepthSuccessPct(cell) {
        const yakınlık = this._depthSuccessYakinlik(cell);
        const parts = [];
        if (cell.pct != null) parts.push({ label: 'SON', val: cell.pct });
        if (cell.horseBestPct != null) parts.push({ label: 'Eİ', val: cell.horseBestPct });
        if (cell.selfPct != null) parts.push({ label: 'İÇ', val: cell.selfPct });
        if (yakınlık != null) parts.push({ label: 'Yakınlık', val: yakınlık });
        cell.successParts = parts;
        if (parts.length < 2) {
            cell.successPct = parts.length === 1 ? parts[0].val : null;
            return;
        }
        cell.successPct = AtSpeedUtils.pctGeometricMean(parts.map(p => p.val));
    },

    /** Δ=0 → %100; sütunda eşit fark → nötr %100; aksi halde 100−Δ */
    _depthSuccessYakinlik(cell) {
        if (cell.gapSalise == null) return null;
        if (cell.gapSalise === 0) return 100;
        if (cell.gapPct == null) return null;
        if (cell.isGapMin && cell.isGapMax) return 100;
        return 100 - cell.gapPct;
    },

    _applyRaceSon800DrPct(pkg) {
        let minSon800 = null;
        let maxSon800 = null;
        let minDr = null;
        let maxDr = null;
        for (const spec of this.RACE_SON800_DR_SPECS) {
            for (const row of pkg.rows || []) {
                for (const cell of row[spec.depthsKey] || []) {
                    if (!cell) continue;
                    if (cell.son800Salise != null) {
                        if (minSon800 === null || cell.son800Salise < minSon800) minSon800 = cell.son800Salise;
                        if (maxSon800 === null || cell.son800Salise > maxSon800) maxSon800 = cell.son800Salise;
                    }
                    if (cell.drSl != null) {
                        if (minDr === null || cell.drSl < minDr) minDr = cell.drSl;
                        if (maxDr === null || cell.drSl > maxDr) maxDr = cell.drSl;
                    }
                }
            }
        }
        if (minSon800 === null && minDr === null) return null;
        for (const spec of this.RACE_SON800_DR_SPECS) {
            const maxDepth = pkg[spec.maxDepthKey] || 0;
            for (const row of pkg.rows || []) {
                const depths = row[spec.depthsKey] || [];
                for (let d = 0; d < depths.length; d++) {
                    const cell = depths[d];
                    if (!cell) continue;
                    const son800Pct = minSon800 != null && maxSon800 != null
                        ? AtSpeedUtils.pctLinearMinBest(cell.son800Salise, minSon800, maxSon800)
                        : null;
                    const drPct = minDr != null && maxDr != null
                        ? AtSpeedUtils.pctLinearMinBest(cell.drSl, minDr, maxDr)
                        : null;
                    if (son800Pct != null) cell.son800Pct = son800Pct;
                    if (drPct != null) {
                        cell.drPct = drPct;
                        cell.dr1Pct = drPct;
                    }
                    if (son800Pct != null && drPct != null) {
                        cell.pct = Math.round(Math.sqrt(son800Pct * drPct));
                    }
                    cell.isBest = cell.son800Salise === minSon800 && cell.drSl === minDr;
                }
                if (spec.ortKey) {
                    row[spec.ortKey] = this._computeDepthOrtOzeti(depths, maxDepth);
                }
            }
        }
        return { minSon800, maxSon800, minDr, maxDr };
    },

    /** Tek koşu paketinde derinlik yüzdelerini koşu içi min/max ile yeniden hesapla */
    applyRacePctScales(pkg) {
        if (!pkg) return {};
        const bounds = {};
        const specs = [
            ...this.RACE_PCT_SPECS,
            ...(this.RACE_PCT_EXTRA_SPECS || this.PROGRAM_GLOBAL_PCT_EXTRA_SPECS || [])
        ];
        for (const spec of specs) {
            const b = this._applyRaceLinearPct(pkg, spec);
            if (b) bounds[spec.depthsKey] = b;
        }
        const drBounds = this._applyRaceSon800DrPct(pkg);
        if (drBounds) bounds.son800Dr = drBounds;

        const selfSpecs = [
            ...specs,
            { depthsKey: 'oran1Depths', valueKey: 'salise', scale: 'minBest', maxDepthKey: 'oranMaxDepth1' },
            { depthsKey: 'oran2Depths', valueKey: 'salise', scale: 'minBest', maxDepthKey: 'oranMaxDepth2' },
            { depthsKey: 'test123SiraliDepths', valueKey: 'rulePct', scale: 'maxBest', maxDepthKey: 'maxDepthTest123Sirali' }
        ];
        this._applyHorseSelfPctSpecs(pkg, selfSpecs);
        this._applyPctGapSpecs(pkg, selfSpecs);
        this.attachDepthCoverageFlags(pkg);
        return bounds;
    },

    /** depths[0] doluluk — TAHMİN depthsMissing yönlendirmesi için */
    attachDepthCoverageFlags(pkg) {
        if (!pkg?.rows?.length) return pkg;
        const n = pkg.rows.length;
        let son8001 = 0;
        let test1 = 0;
        let t1dr = 0;
        let anyCore = 0;
        let programDayOnly = 0;
        let tahminEligible = 0;
        let debut = 0;
        let partial = 0;

        for (const row of pkg.rows) {
            const hist = row.kosuHistory || {};
            if (hist.debut) debut++;
            else if (hist.partial) partial++;
            if (hist.tahminEligible) tahminEligible++;

            const miss = {
                son8001: row.son8001Depths?.[0]?.pct == null,
                test1: row.test1Depths?.[0]?.pct == null,
                t1dr: row.t1drDepths?.[0]?.pct == null
            };
            miss.anyPrimary = miss.son8001 || miss.test1;
            miss.anyCore = miss.son8001 && miss.test1 && miss.t1dr;
            row.depthsMissing = miss;
            if (!hist.tahminEligible) row.tahminIneligible = true;

            const pd = !!(row.son8001Depths?.[0]?.programDayOnly
                || row.test1Depths?.[0]?.programDayOnly
                || row.t1drDepths?.[0]?.programDayOnly);
            if (pd) row.programDayOnlyDepth = true;

            if (!miss.son8001) son8001++;
            if (!miss.test1) test1++;
            if (!miss.t1dr) t1dr++;
            if (miss.anyCore) anyCore++;
            if (pd) programDayOnly++;
        }

        pkg.depthCoverage = {
            fieldSize: n,
            son8001: n ? son8001 / n : 0,
            test1: n ? test1 / n : 0,
            t1dr: n ? t1dr / n : 0,
            coreMissingRate: n ? anyCore / n : 0,
            programDayOnlyRate: n ? programDayOnly / n : 0,
            tahminEligibleRate: n ? tahminEligible / n : 0,
            debutRate: n ? debut / n : 0,
            partialRate: n ? partial / n : 0
        };
        pkg.kosuHistorySummary = { fieldSize: n, tahminEligible, debut, partial, excluded: n - tahminEligible };
        return pkg;
    },

    /** @deprecated applyRacePctScales kullanın — her paket koşu içi ölçeklenir */
    applyProgramGlobalPctScales(packages) {
        if (!packages?.length) return {};
        const bounds = {};
        for (const pkg of packages) {
            bounds[pkg.rows?.[0]?.no ?? packages.indexOf(pkg)] = this.applyRacePctScales(pkg);
        }
        return bounds;
    },

    /** @deprecated buildRaceIstatistikPackage kullanın */
    buildRaceIstatistikRows(race, hedefSehir, programTarih) {
        return this.buildRaceIstatistikPackage(race, hedefSehir, programTarih).rows;
    }
};
