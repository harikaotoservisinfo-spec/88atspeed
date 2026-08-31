/**
 * Geçmiş koşulardaki at sayısı istatistikleri (çıkan/koşmaz hariç at_sayisi)
 */
const FieldSizeStatsEngine = {
    RECENT_WINDOWS: [5, 4, 3, 2, 1],

    parseSira(raw) {
        if (raw == null || raw === '' || raw === '-') return null;
        const s = String(raw).trim();
        if (/koşmaz|çekildi|kosmaz/i.test(s)) return null;
        const n = parseInt(s.replace(/[^\d]/g, ''), 10);
        return (isNaN(n) || n < 1) ? null : n;
    },

    isKosmazName(name) {
        if (!name) return false;
        return /\(\s*koşmaz\s*\)/i.test(name)
            || /\(\s*kosmaz\s*\)/i.test(name)
            || /\(\s*çekildi\s*\)/i.test(name)
            || /\(\s*cekildi\s*\)/i.test(name);
    },

    raceFieldSize(race) {
        return (race?.horses || []).filter(h => !this.isKosmazName(h.name)).length;
    },

    sortKosularNewest(kosular) {
        return [...(kosular || [])].sort((a, b) => {
            const da = (a.tarih || '').split('.').reverse().join('');
            const db = (b.tarih || '').split('.').reverse().join('');
            return db.localeCompare(da);
        });
    },

    recentSlice(kosular, windowSize) {
        if (!windowSize) return kosular || [];
        return this.sortKosularNewest(kosular).slice(0, windowSize);
    },

    validRaces(kosular) {
        return (kosular || []).filter(k => {
            const fs = Number(k.at_sayisi);
            const sira = this.parseSira(k.sira);
            return fs > 0 && sira != null;
        });
    },

    racesWithSira(kosular) {
        return (kosular || []).filter(k => this.parseSira(k.sira) != null);
    },

    _computeStatsCore(kosular) {
        const all = kosular || [];
        const fsRaces = this.validRaces(all);
        const siraRaces = this.racesWithSira(all);
        const missing = all.length - fsRaces.length;

        let max1 = 0;
        let max12 = 0;
        let max123 = 0;
        let max1234 = 0;
        let cnt1 = 0;
        let cnt12 = 0;
        let cnt123 = 0;
        let cnt1234 = 0;
        const gecmisList = [];

        for (const k of fsRaces) {
            const fs = Number(k.at_sayisi);
            const sira = this.parseSira(k.sira);
            gecmisList.push({ tarih: k.tarih, fs, sira });
            if (sira === 1) max1 = Math.max(max1, fs);
            if (sira <= 2) max12 = Math.max(max12, fs);
            if (sira <= 3) max123 = Math.max(max123, fs);
            if (sira <= 4) max1234 = Math.max(max1234, fs);
        }

        for (const k of siraRaces) {
            const sira = this.parseSira(k.sira);
            if (sira === 1) cnt1++;
            if (sira <= 2) cnt12++;
            if (sira <= 3) cnt123++;
            if (sira <= 4) cnt1234++;
        }

        return {
            kosuSayisi: fsRaces.length,
            kosuSayisiSira: siraRaces.length,
            missingFieldSize: missing,
            max1: max1 || null,
            max12: max12 || null,
            max123: max123 || null,
            max1234: max1234 || null,
            cnt1,
            cnt12,
            cnt123,
            cnt1234,
            gecmisStr: gecmisList.length
                ? gecmisList.map(x => x.fs).join('→')
                : (siraRaces.length ? siraRaces.map(k => this.parseSira(k.sira)).join('→') : '—'),
            gecmisList
        };
    },

    computeStats(kosular) {
        const base = this._computeStatsCore(kosular);
        const windows = {};
        for (const w of this.RECENT_WINDOWS) {
            windows[w] = this._computeStatsCore(this.recentSlice(kosular, w));
        }
        return Object.assign(base, { windows });
    },

    formatCell(v) {
        return v != null && v !== '' ? String(v) : '—';
    },

    /**
     * MAX-* değerlerini bugünkü koşu alanına göre başarı % dilimine çevirir.
     * MAX-N = eşleşen koşularda N derecesine kadar ulaşılan en geniş alan (at sayısı).
     * % = min(100, MAX / bugünküAlan × 100) — bugünkü kalabalığa göre kanıtlanmış üst sınır.
     */
    computeMaxSuccessPct(st, todayFieldSize) {
        const defs = [
            { key: 'max1', label: 'MAX-1', desc: '1. olunan en geniş alan' },
            { key: 'max12', label: 'MAX-12', desc: '1-2 olunan en geniş alan' },
            { key: 'max123', label: 'MAX-123', desc: '1-2-3 olunan en geniş alan' },
            { key: 'max1234', label: 'MAX-1234', desc: '1-2-3-4 olunan en geniş alan' }
        ];
        if (!st || !todayFieldSize || todayFieldSize < 1) {
            return { display: '—', tooltip: '', parts: [] };
        }
        const hasMatch = (st.matchCount > 0) || (st.matchKosuSayisi > 0);
        if (!hasMatch) {
            return { display: '—', tooltip: 'Eşleşen sıklet koşusu yok', parts: [] };
        }
        const parts = [];
        const tipLines = ['Bugünkü alan: ' + todayFieldSize + ' at'];
        for (let i = 0; i < defs.length; i++) {
            const d = defs[i];
            const max = st[d.key];
            let pct = null;
            if (max != null && max > 0) {
                pct = Math.min(100, Math.round(max / todayFieldSize * 100));
                tipLines.push(d.label + ': ' + max + ' at → %' + pct + ' (' + d.desc + ')');
            } else {
                pct = 0;
                tipLines.push(d.label + ': hiç yok → %0');
            }
            parts.push({ label: d.label, max: max, pct: pct });
        }
        const display = parts.map(function(p) { return p.pct + '%'; }).join('·');
        return { display: display, tooltip: tipLines.join('\n'), parts: parts };
    }
};

if (typeof globalThis !== 'undefined') globalThis.FieldSizeStatsEngine = FieldSizeStatsEngine;
if (typeof module !== 'undefined') module.exports = { FieldSizeStatsEngine };
