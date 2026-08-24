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

    /** Atın son geçerli koşusundaki SON800-1/2 salise değeri */
    _sonKosuSon800Derece(k, alan) {
        if (alan === 'iki') {
            let v = k.son800_iki;
            if (!v || v === '-') v = k.son800_bir;
            return v;
        }
        return k.son800_bir;
    },

    /** Atın tüm geçerli koşularındaki SON800-1/2 ortalama salise değeri */
    _tumKosularSon800Ortalama(kosular, programTarih, alan = 'bir') {
        const programNorm = programTarih ? this._normalizeTarih(programTarih) : null;
        const saliseler = [];
        let bestSalise = null;
        let bestDerece = null;
        for (const k of kosular || []) {
            if (!k?.tarih) continue;
            if (programNorm && this._normalizeTarih(k.tarih) === programNorm) continue;
            const derece = this._sonKosuSon800Derece(k, alan);
            const salise = AtSpeedUtils.dereceToSalise(derece);
            if (salise === null) continue;
            saliseler.push(salise);
            if (bestSalise === null || salise < bestSalise) {
                bestSalise = salise;
                bestDerece = derece;
            }
        }
        if (saliseler.length === 0) {
            return {
                salise: null, avgSalise: null, derece: null, avgDerece: null,
                bestSalise: null, bestDerece: null, kosuCount: 0
            };
        }
        const sum = saliseler.reduce((a, b) => a + b, 0);
        const avgSalise = Math.round(sum / saliseler.length);
        const avgDerece = AtSpeedUtils.saliseToDerece(avgSalise);
        return {
            salise: avgSalise,
            avgSalise,
            derece: avgDerece,
            avgDerece,
            bestSalise,
            bestDerece,
            kosuCount: saliseler.length
        };
    },

    /** @deprecated _tumKosularSon800Ortalama kullanın */
    _sonKosuSon800(kosular, programTarih, alan = 'bir') {
        return this._tumKosularSon800Ortalama(kosular, programTarih, alan);
    },

    /**
     * Koşudaki rakiplerin tüm yarışlarındaki SON800-1/2 ortalamalarını kıyaslar.
     * En düşük ortalama %100; diğerleri (min / değer) × 100.
     */
    computeSon800RaceKiyaslama(race, programTarih, alan = 'bir') {
        const horses = race.horses || [];
        const entries = horses.map(horse => {
            const agg = this._tumKosularSon800Ortalama(horse.kosular, programTarih, alan);
            return { atId: horse.atId, no: horse.no, ...agg };
        });
        const valid = entries.filter(e => e.salise !== null);
        const minSalise = valid.length ? Math.min(...valid.map(e => e.salise)) : null;
        const minEntry = valid.find(e => e.salise === minSalise);
        const minDerece = minEntry?.avgDerece || minEntry?.derece || null;
        const byKey = new Map();
        for (const e of entries) {
            let pct = null;
            if (e.salise !== null && minSalise !== null && minSalise > 0) {
                pct = Math.round((minSalise / e.salise) * 100);
            }
            const key = e.atId != null ? String(e.atId) : String(e.no);
            byKey.set(key, {
                pct,
                salise: e.salise,
                derece: e.avgDerece || e.derece,
                avgDerece: e.avgDerece || e.derece,
                bestDerece: e.bestDerece,
                kosuCount: e.kosuCount,
                minSalise,
                minDerece,
                fieldCount: valid.length,
                isBest: e.salise !== null && e.salise === minSalise
            });
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
            pct: null, salise: null, derece: null, avgDerece: null, bestDerece: null,
            kosuCount: 0, minSalise: null, minDerece: null, fieldCount: 0, isBest: false
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
