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

    /** Son koşudan SON800-1 salise + 1DR/SL (birinci_dr_sl) */
    _sonKosuSon800Dr1slMetrikleri(kosu) {
        if (!kosu) return null;
        const son800 = kosu.son800_bir;
        if (!son800 || son800 === '-') return null;
        const son800Salise = AtSpeedUtils.dereceToSalise(son800);
        if (son800Salise === null || son800Salise <= 0) return null;

        const mesafe = this._parseMesafe(kosu.mesafe);
        const birinciSalise = AtSpeedUtils.dereceToSalise(kosu.birinci_derece);
        const birinciDrSl = (birinciSalise !== null && mesafe !== null)
            ? AtSpeedUtils.metreBasiSalise(birinciSalise, mesafe)
            : null;
        if (birinciDrSl === null || birinciDrSl <= 0) return null;

        return {
            son800Salise,
            son800Derece: son800,
            birinciDrSl,
            birinciDerece: kosu.birinci_derece || null,
            mesafe,
            tarih: kosu.tarih || null
        };
    },

    /** Atın koşularını yeniden eskiye SON800+1DR/SL korelasyon zinciri */
    _kosularSon800Dr1slZinciri(kosular, programTarih) {
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
            const metrik = this._sonKosuSon800Dr1slMetrikleri(k);
            if (!metrik) continue;
            chain.push(metrik);
        }
        return chain;
    },

    _buildSon800Dr1slChains(race, programTarih) {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            chains.set(this._horseKey(horse), this._kosularSon800Dr1slZinciri(horse.kosular, programTarih));
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        return { horses, chains, maxDepth };
    },

    /**
     * SON800-1 + 1DR/SL derinlik bazlı korelasyon (SON, 1 ÖNCE …).
     * Her derinlikte rakip kıyası; birleşik = geometrik ortalama.
     */
    computeSon800Dr1slKorelasyonGrid(race, programTarih) {
        const { chains, maxDepth } = this._buildSon800Dr1slChains(race, programTarih);
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
            const minDr1sl = Math.min(...atDepth.map(e => e.birinciDrSl));
            const comparedCount = atDepth.length;

            for (const e of atDepth) {
                const son800Pct = Math.round((minSon800 / e.son800Salise) * 100);
                const dr1Pct = Math.round((minDr1sl / e.birinciDrSl) * 100);
                const pct = Math.round(Math.sqrt(son800Pct * dr1Pct));
                byHorse.get(e.key)[d] = {
                    pct,
                    son800Pct,
                    dr1Pct,
                    son800Derece: e.son800Derece,
                    birinciDerece: e.birinciDerece,
                    son800Salise: e.son800Salise,
                    birinciDrSl: e.birinciDrSl,
                    tarih: e.tarih,
                    mesafe: e.mesafe,
                    comparedCount,
                    depth: d,
                    isBest: e.son800Salise === minSon800 && e.birinciDrSl === minDr1sl
                };
            }
        }

        return { maxDepth, byHorse };
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
            const son8001Depths = son8001Grid.byHorse.get(key) || [];
            const son8002Depths = son8002Grid.byHorse.get(key) || [];
            const oran1Depths = oran1Grid.byHorse.get(key) || [];
            const oran2Depths = oran2Grid.byHorse.get(key) || [];
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
            rows
        };
    },

    /** @deprecated buildRaceIstatistikPackage kullanın */
    buildRaceIstatistikRows(race, hedefSehir, programTarih) {
        return this.buildRaceIstatistikPackage(race, hedefSehir, programTarih).rows;
    }
};
