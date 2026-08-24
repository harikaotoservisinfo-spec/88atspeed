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

    /**
     * Koşudaki rakiplerin SON800 değerlerini koşu koşu geriye giderek kıyaslar.
     * Derinlik 0 = son koşu, 1 = bir önceki … her derinlikte en düşük %100.
     * Atın nihai skoru = derinlik bazlı yüzdelerin ortalaması.
     */
    computeSon800RaceKiyaslama(race, programTarih, alan = 'bir') {
        const horses = race.horses || [];
        const chains = new Map();
        for (const horse of horses) {
            const key = this._horseKey(horse);
            chains.set(key, this._kosularSon800Zinciri(horse.kosular, programTarih, alan));
        }
        const maxDepth = Math.max(0, ...[...chains.values()].map(c => c.length));
        const depthPctsByKey = new Map();
        for (const key of chains.keys()) depthPctsByKey.set(key, []);

        for (let d = 0; d < maxDepth; d++) {
            const atDepth = [];
            for (const [key, chain] of chains) {
                if (chain[d]) {
                    atDepth.push({ key, salise: chain[d].salise, derece: chain[d].derece, tarih: chain[d].tarih });
                }
            }
            if (!atDepth.length) continue;
            const minSalise = Math.min(...atDepth.map(e => e.salise));
            for (const e of atDepth) {
                if (minSalise <= 0) continue;
                depthPctsByKey.get(e.key).push(Math.round((minSalise / e.salise) * 100));
            }
        }

        const byKey = new Map();
        const fieldCount = horses.length;
        for (const horse of horses) {
            const key = this._horseKey(horse);
            const chain = chains.get(key) || [];
            const depthPcts = depthPctsByKey.get(key) || [];
            let pct = null;
            if (depthPcts.length) {
                pct = Math.round(depthPcts.reduce((a, b) => a + b, 0) / depthPcts.length);
            }
            const last = chain[0] || null;
            byKey.set(key, {
                pct,
                salise: last?.salise ?? null,
                derece: last?.derece ?? null,
                kosuCount: depthPcts.length,
                depthPcts,
                fieldCount,
                isBest: false
            });
        }

        const validPcts = [...byKey.values()].map(v => v.pct).filter(p => p !== null);
        const maxPct = validPcts.length ? Math.max(...validPcts) : null;
        for (const v of byKey.values()) {
            v.isBest = v.pct !== null && maxPct !== null && v.pct === maxPct;
        }
        return byKey;
    },

    /** @deprecated computeSon800RaceKiyaslama(race, programTarih, 'bir') kullanın */
    computeSon8001RaceKiyaslama(race, programTarih) {
        return this.computeSon800RaceKiyaslama(race, programTarih, 'bir');
    },

    computeSon8002RaceKiyaslama(race, programTarih) {
        return this.computeSon800RaceKiyaslama(race, programTarih, 'iki');
    },

    _emptySon800Stat() {
        return {
            pct: null, salise: null, derece: null, kosuCount: 0,
            depthPcts: [], fieldCount: 0, isBest: false
        };
    },

    _horseKey(horse) {
        return horse.atId != null ? String(horse.atId) : String(horse.no);
    },

    /** Koşu listesi için tüm istatistik satırları */
    buildRaceIstatistikRows(race, hedefSehir, programTarih) {
        const hedefMesafe = this._hedefMesafe(race);
        const son8001Map = this.computeSon800RaceKiyaslama(race, programTarih, 'bir');
        const son8002Map = this.computeSon800RaceKiyaslama(race, programTarih, 'iki');
        const horses = [...(race.horses || [])].sort((a, b) => {
            const na = parseInt(a.no, 10);
            const nb = parseInt(b.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
        });
        return horses.map(horse => {
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
            const son8001 = son8001Map.get(this._horseKey(horse)) || this._emptySon800Stat();
            const son8002 = son8002Map.get(this._horseKey(horse)) || this._emptySon800Stat();
            return {
                no: horse.no,
                name: horse.name || '-',
                atId: horse.atId,
                hedefMesafe,
                sehir,
                son8001,
                son8002,
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
    }
};
