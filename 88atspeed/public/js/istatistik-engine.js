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

    /** Atın koşularını yeniden eskiye SON800 zinciri (program günü hariç) */
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
     * Her derinlikte en düşük süre %100, diğerleri (min / değer) × 100.
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
            const comparedCount = atDepth.length;
            for (const e of atDepth) {
                if (minSalise <= 0) continue;
                const pct = Math.round((minSalise / e.salise) * 100);
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
     * Yeni ORAN sütunları — koşunun ana SON800 derecesine göre %.
     * Ana derece = alandaki tüm derinliklerdeki en düşük SON800 (tek referans %100).
     */
    computeSon800AnaOranGrid(race, programTarih, alan = 'bir') {
        const { chains, maxDepth } = this._buildSon800Chains(race, programTarih, alan);
        const byHorse = new Map();
        for (const key of chains.keys()) {
            byHorse.set(key, new Array(maxDepth).fill(null));
        }

        let anaSalise = null;
        let anaDerece = null;
        for (const chain of chains.values()) {
            for (const item of chain) {
                if (anaSalise === null || item.salise < anaSalise) {
                    anaSalise = item.salise;
                    anaDerece = item.derece;
                }
            }
        }

        if (anaSalise !== null && anaSalise > 0) {
            for (let d = 0; d < maxDepth; d++) {
                for (const [key, chain] of chains) {
                    if (!chain[d]) continue;
                    const e = chain[d];
                    const pct = Math.round((anaSalise / e.salise) * 100);
                    byHorse.get(key)[d] = {
                        pct,
                        derece: e.derece,
                        tarih: e.tarih,
                        salise: e.salise,
                        anaDerece,
                        anaSalise,
                        depth: d,
                        isBest: e.salise === anaSalise
                    };
                }
            }
        }

        return { maxDepth, anaDerece, anaSalise, byHorse };
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
     * O gün koşan atlar arasında en düşük TEST1 = %100; diğerleri (min / değer) × 100.
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
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = Math.round((minTest1 / e.test1) * 100);
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
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = Math.round((minTest2 / e.test2) * 100);
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
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = Math.round((minTest3 / e.test3) * 100);
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
     * TEST3≥TEST2≥TEST1 derinlik bazlı rakip kıyası (SON, 1 ÖNCE …).
     * Kuralı tam sağlayan = %100 skor; diğerleri yakınlığa göre alan içi %.
     */
    computeTest123SiraliDepthGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildTest123SiraliChains(race, programTarih);
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

            const bestRulePct = Math.max(...atDepth.map(e => e.rulePct));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = bestRulePct > 0
                    ? Math.round((e.rulePct / bestRulePct) * 100)
                    : null;
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
                    comparedCount,
                    depth: d,
                    isBest: e.rulePct === bestRulePct
                };
            }
        }

        return { maxDepth, byHorse };
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
     * O gün koşan atlar arasında en düşük T1×DR = %100; diğerleri (min / değer) × 100.
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
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const pct = Math.round((minT1dr / e.t1dr) * 100);
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
            const minDrSl = Math.min(...atDepth.map(e => e.drSl));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const son800Pct = Math.round((minSon800 / e.son800Salise) * 100);
                const drPct = Math.round((minDrSl / e.drSl) * 100);
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
            const dr1Depths = son800Dr1Grid.byHorse.get(key) || [];
            const drDepths = son800DrGrid.byHorse.get(key) || [];
            const son8001Depths = son8001Grid.byHorse.get(key) || [];
            const son8002Depths = son8002Grid.byHorse.get(key) || [];
            const oran1Depths = oran1Grid.byHorse.get(key) || [];
            const oran2Depths = oran2Grid.byHorse.get(key) || [];
            const test1Depths = test1Grid.byHorse.get(key) || [];
            const test2Depths = test2Grid.byHorse.get(key) || [];
            const test3Depths = test3Grid.byHorse.get(key) || [];
            const test123SiraliDepths = test123SiraliGrid.byHorse.get(key) || [];
            const t1drDepths = t1drGrid.byHorse.get(key) || [];
            return {
                no: horse.no,
                name: horse.name || '-',
                atId: horse.atId,
                hedefMesafe,
                sehir,
                son8001Depths,
                son8001AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    son8001Depths, son8001Grid.maxDepth
                ),
                son8002Depths,
                son8002AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    son8002Depths, son8002Grid.maxDepth
                ),
                oran1Depths,
                oran1AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    oran1Depths, oran1Grid.maxDepth
                ),
                oran2Depths,
                oran2AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    oran2Depths, oran2Grid.maxDepth
                ),
                son800Dr1Depths: dr1Depths,
                son800Dr1AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    dr1Depths, son800Dr1Grid.maxDepth
                ),
                son800DrDepths: drDepths,
                son800DrAgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    drDepths, son800DrGrid.maxDepth
                ),
                test1Depths,
                test1AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    test1Depths, test1Grid.maxDepth
                ),
                test2Depths,
                test2AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    test2Depths, test2Grid.maxDepth
                ),
                test3Depths,
                test3AgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    test3Depths, test3Grid.maxDepth
                ),
                test123SiraliDepths,
                test123SiraliAgirlikliOrt: this._computeDepthAgirlikliOrtalama(
                    test123SiraliDepths, test123SiraliGrid.maxDepth
                ),
                t1drDepths,
                t1drAgirlikliOrt: this._computeDepthAgirlikliOrtalama(
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
                smIlk1
            };
        });
        return {
            maxDepth1: son8001Grid.maxDepth,
            maxDepth2: son8002Grid.maxDepth,
            oranMaxDepth1: oran1Grid.maxDepth,
            oranMaxDepth2: oran2Grid.maxDepth,
            oranAnaDerece1: oran1Grid.anaDerece,
            oranAnaDerece2: oran2Grid.anaDerece,
            maxDepthDr1: son800Dr1Grid.maxDepth,
            maxDepthDr: son800DrGrid.maxDepth,
            maxDepthTest1: test1Grid.maxDepth,
            maxDepthTest2: test2Grid.maxDepth,
            maxDepthTest3: test3Grid.maxDepth,
            maxDepthTest123Sirali: test123SiraliGrid.maxDepth,
            maxDepthT1dr: t1drGrid.maxDepth,
            rows
        };
    },

    /** @deprecated buildRaceIstatistikPackage kullanın */
    buildRaceIstatistikRows(race, hedefSehir, programTarih) {
        return this.buildRaceIstatistikPackage(race, hedefSehir, programTarih).rows;
    }
};
