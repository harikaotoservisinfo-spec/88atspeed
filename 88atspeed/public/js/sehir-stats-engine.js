/**
 * Geçmiş koşularda hedef hipodrom (şehir) deneyimi istatistikleri
 * kosular[].sehir zaten TJK scrape ile gelir — ek fetch gerekmez
 */
const SehirStatsEngine = {
    normalizeSehir(sehir) {
        if (!sehir) return '';
        return String(sehir).trim().toLocaleLowerCase('tr-TR');
    },

    sehirMatch(atKosuSehir, hedefSehir) {
        if (!hedefSehir) return false;
        const a = this.normalizeSehir(atKosuSehir);
        const b = this.normalizeSehir(hedefSehir);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    },

    abbrevSehir(sehir) {
        if (!sehir) return '—';
        const s = String(sehir).trim();
        if (s.length <= 4) return s;
        return s.slice(0, 4);
    },

    validRaces(kosular) {
        return (kosular || []).filter(k => {
            const sehir = k?.sehir;
            return sehir && sehir !== '-';
        });
    },

    inCityRaces(kosular, hedefSehir) {
        return this.validRaces(kosular).filter(k => this.sehirMatch(k.sehir, hedefSehir));
    },

    _computeStatsCore(kosular, hedefSehir) {
        const all = kosular || [];
        const races = this.validRaces(all);
        const inCity = this.inCityRaces(all, hedefSehir);
        const gecmisMatch = [];
        const gecmisSehir = [];
        for (const k of races) {
            const match = this.sehirMatch(k.sehir, hedefSehir);
            gecmisMatch.push(match ? '✓' : '·');
            gecmisSehir.push(this.abbrevSehir(k.sehir));
        }
        const sehirPct = races.length
            ? Math.round(100 * inCity.length / races.length)
            : null;
        const placement = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine._computeStatsCore(inCity)
            : {
                kosuSayisi: 0, max1: null, max12: null, max123: null, max1234: null,
                cnt1: 0, cnt2: 0, cnt3: 0, cnt4: 0, cnt12: 0, cnt123: 0, cnt1234: 0
            };
        return {
            hedefSehir: hedefSehir || '—',
            kosuSayisi: races.length,
            inCityCount: inCity.length,
            sehirPct,
            max1: placement.max1,
            max12: placement.max12,
            max123: placement.max123,
            max1234: placement.max1234,
            cnt1: placement.cnt1,
            cnt2: placement.cnt2,
            cnt3: placement.cnt3,
            cnt4: placement.cnt4,
            cnt12: placement.cnt12,
            cnt123: placement.cnt123,
            cnt1234: placement.cnt1234,
            inCityKosuSayisi: placement.kosuSayisi,
            gecmisMatchStr: gecmisMatch.length ? gecmisMatch.join('→') : '—',
            gecmisSehirStr: gecmisSehir.length ? gecmisSehir.join('→') : '—',
            missingSehir: all.length - races.length
        };
    },

    computeStats(kosular, hedefSehir, programTarih) {
        const calcKosular = typeof FieldSizeStatsEngine !== 'undefined' && programTarih
            ? FieldSizeStatsEngine.filterKosularForCalc(kosular, programTarih)
            : (kosular || []);
        const base = this._computeStatsCore(calcKosular, hedefSehir);
        const windows = {};
        const recentWindows = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine.RECENT_WINDOWS
            : [5, 4, 3, 2, 1];
        for (const w of recentWindows) {
            const sliced = typeof FieldSizeStatsEngine !== 'undefined'
                ? FieldSizeStatsEngine.recentSlice(calcKosular, w)
                : calcKosular.slice(0, w);
            windows[w] = this._computeStatsCore(sliced, hedefSehir);
        }
        return Object.assign(base, { windows });
    },

    formatCell(v) {
        return v != null && v !== '' ? String(v) : '—';
    },

    formatPct(pct) {
        return pct != null ? '%' + pct : '—';
    }
};

if (typeof globalThis !== 'undefined') globalThis.SehirStatsEngine = SehirStatsEngine;
if (typeof module !== 'undefined') module.exports = { SehirStatsEngine };
