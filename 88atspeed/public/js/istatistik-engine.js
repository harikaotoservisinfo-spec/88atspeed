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

    _sehirEslesme(atKosuSehir, hedefSehir) {
        if (!hedefSehir) return false;
        const a = this._normalizeSehir(atKosuSehir);
        const b = this._normalizeSehir(hedefSehir);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
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

    /** Koşu listesi için tüm istatistik satırları */
    buildRaceIstatistikRows(race, hedefSehir, programTarih) {
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
            return {
                no: horse.no,
                name: horse.name || '-',
                atId: horse.atId,
                sehir,
                ay3,
                ay1,
                gun15
            };
        });
    }
};
