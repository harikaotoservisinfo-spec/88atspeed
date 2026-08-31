/**
 * Geçmiş koşularda hedef boyut (kcins_kosu, taki, pist, hp, siklet) istatistikleri
 * ŞEHİR DURUMU sekmesiyle aynı mantık — kosular[] TJK scrape ile gelir
 */
const KosuDimensionStatsEngine = {
    DIMENSIONS: {
        kcins_kosu: {
            label: 'KOŞU CİNSİ',
            pctLabel: 'KC%',
            matchLabel: 'KC-KOŞU',
            note: 'Hedef koşu cinsi (kcins_kosu) geçmiş koşularla karşılaştırılır.',
            targetFrom: 'race',
            getTarget(_horse, race) {
                return race?.kcins_kosu || '';
            },
            getKosuValue(k) {
                return k?.kcins_kosu || '';
            },
            match(a, b) {
                const x = KosuDimensionStatsEngine.normalizeText(a);
                const y = KosuDimensionStatsEngine.normalizeText(b);
                return !!y && !!x && x === y;
            },
            abbrev(v) {
                const s = String(v || '').trim();
                if (!s || s === '—') return '—';
                if (s.length <= 14) return s;
                return s.slice(0, 12) + '…';
            }
        },
        taki: {
            label: 'TAKİ',
            pctLabel: 'TK%',
            matchLabel: 'TK-KOŞU',
            note: 'Hedef takı (KG DB SK GKR vb.) geçmiş koşulardaki taki ile eşleşir.',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                return hm.taki && hm.taki !== '—' ? hm.taki : (horse?.taki || '');
            },
            getKosuValue(k) {
                return k?.taki || '';
            },
            match(a, b) {
                const ta = KosuDimensionStatsEngine.takiTokens(a);
                const tb = KosuDimensionStatsEngine.takiTokens(b);
                if (!tb.length || !ta.length) return false;
                return tb.every(t => ta.includes(t));
            },
            abbrev(v) {
                const s = String(v || '').trim();
                if (!s || s === '—') return '—';
                if (s.length <= 10) return s;
                return s.slice(0, 8) + '…';
            }
        },
        pist: {
            label: 'PİST',
            pctLabel: 'PİST%',
            matchLabel: 'P-KOŞU',
            note: 'Hedef pist (Kum/Çim/Sentetik) geçmiş koşulardaki pist/pist_kosu ile eşleşir.',
            targetFrom: 'race',
            getTarget(_horse, race) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.normalizePist(race?.pist) || AtMetaFields.val(race, 'pist', '');
                }
                return race?.pist || '';
            },
            getKosuValue(k) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.normalizePist(k?.pist || k?.pist_kosu)
                        || AtMetaFields.val(k, 'pist', '');
                }
                return k?.pist || k?.pist_kosu || '';
            },
            match(a, b) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.pistMatch(a, b);
                }
                const x = String(a || '').trim().toLocaleLowerCase('tr-TR');
                const y = String(b || '').trim().toLocaleLowerCase('tr-TR');
                return !!x && !!y && x === y;
            },
            abbrev(v) {
                const s = String(v || '').trim();
                return s && s !== '—' ? s.slice(0, 4) : '—';
            }
        },
        hp: {
            label: 'HP',
            pctLabel: 'HP%',
            matchLabel: 'HP-KOŞU',
            note: 'Hedef handikap puanı geçmiş koşulardaki hp ile eşleşir.',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                return hm.hp && hm.hp !== '—' ? hm.hp : (horse?.hp || '');
            },
            getKosuValue(k) {
                return k?.hp || '';
            },
            match(a, b) {
                return KosuDimensionStatsEngine.numMatch(a, b);
            },
            abbrev(v) {
                const n = KosuDimensionStatsEngine.parseNum(v);
                return n != null ? String(n) : '—';
            }
        },
        siklet: {
            label: 'SİKLET',
            pctLabel: 'SK%',
            matchLabel: 'SK-KOŞU',
            note: 'Hedef sıklet geçmiş koşulardaki siklet ile eşleşir.',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                const raw = hm.siklet && hm.siklet !== '—' ? hm.siklet : (horse?.siklet || '');
                const n = KosuDimensionStatsEngine.parseSiklet(raw);
                return n != null ? String(Math.round(n)) : raw;
            },
            getKosuValue(k) {
                const n = KosuDimensionStatsEngine.parseSiklet(k?.siklet);
                return n != null ? String(Math.round(n)) : (k?.siklet || '');
            },
            match(a, b) {
                return KosuDimensionStatsEngine.sikletMatch(a, b);
            },
            abbrev(v) {
                const n = KosuDimensionStatsEngine.parseSiklet(v);
                return n != null ? String(Math.round(n)) : '—';
            }
        }
    },

    normalizeText(s) {
        if (!s || s === '—' || s === '-') return '';
        return String(s).replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    },

    takiTokens(s) {
        return String(s || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(t => t.toLocaleUpperCase('tr-TR'));
    },

    parseNum(v) {
        if (v == null || v === '' || v === '-' || v === '—') return null;
        const n = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    },

    /** TJK program: "56 +1", "57+2" → taşınan kg; düz "56" → 56 */
    parseSiklet(v) {
        if (v == null || v === '' || v === '-' || v === '—') return null;
        const s = String(v).replace(/\s+/g, ' ').trim();
        const plus = s.match(/^(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)$/);
        if (plus) {
            const base = parseFloat(plus[1].replace(',', '.'));
            const adj = parseFloat(plus[2].replace(',', '.'));
            if (!isNaN(base) && !isNaN(adj)) return Math.round((base + adj) * 10) / 10;
        }
        const plain = s.match(/^(\d+(?:[.,]\d+)?)$/);
        if (plain) {
            let n = parseFloat(plain[1].replace(',', '.'));
            if (isNaN(n)) return null;
            // Eski hata: "56 +1" → parseNum ile 561 birleşmiş kayıtlar
            if (Number.isInteger(n) && n >= 520 && n < 700) {
                const base = Math.floor(n / 10);
                const adj = n % 10;
                if (base >= 48 && base <= 66 && adj <= 4) return base + adj;
            }
            return n;
        }
        const first = s.match(/(\d+(?:[.,]\d+)?)/);
        if (first) {
            const n = parseFloat(first[1].replace(',', '.'));
            return isNaN(n) ? null : n;
        }
        return null;
    },

    sikletMatch(a, b) {
        const na = this.parseSiklet(a);
        const nb = this.parseSiklet(b);
        if (na == null || nb == null) return false;
        return Math.abs(na - nb) < 0.01;
    },

    numMatch(a, b) {
        const na = this.parseNum(a);
        const nb = this.parseNum(b);
        if (na == null || nb == null) return false;
        return Math.abs(na - nb) < 0.01;
    },

    getDim(key) {
        return this.DIMENSIONS[key] || null;
    },

    hasValue(v) {
        if (v == null || v === '' || v === '-' || v === '—') return false;
        return true;
    },

    validRaces(kosular, dimKey) {
        const dim = this.getDim(dimKey);
        if (!dim) return [];
        return (kosular || []).filter(k => this.hasValue(dim.getKosuValue(k)));
    },

    matchedRaces(kosular, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        if (!dim || !this.hasValue(hedef)) return [];
        return this.validRaces(kosular, dimKey).filter(k =>
            dim.match(dim.getKosuValue(k), hedef)
        );
    },

    _computeStatsCore(kosular, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        const empty = {
            hedef: hedef || '—',
            kosuSayisi: 0,
            matchCount: 0,
            matchPct: null,
            max1: null, max12: null, max123: null, max1234: null,
            cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0,
            matchKosuSayisi: 0,
            gecmisMatchStr: '—',
            gecmisValStr: '—',
            missing: 0,
            atSayisiMissing: 0,
            fieldSizeMissingOnMatch: 0
        };
        if (!dim) return empty;

        const all = kosular || [];
        const races = this.validRaces(all, dimKey);
        const matched = this.matchedRaces(all, dimKey, hedef);
        const gecmisMatch = [];
        const gecmisVal = [];
        for (const k of races) {
            const val = dim.getKosuValue(k);
            gecmisMatch.push(dim.match(val, hedef) ? '✓' : '·');
            gecmisVal.push(dim.abbrev(val));
        }
        const matchPct = races.length
            ? Math.round(100 * matched.length / races.length)
            : null;
        const placement = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine._computeStatsCore(matched)
            : {
                kosuSayisi: 0, max1: null, max12: null, max123: null, max1234: null,
                cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0
            };
        const parseSira = typeof FieldSizeStatsEngine !== 'undefined'
            ? k => FieldSizeStatsEngine.parseSira(k.sira)
            : k => {
                const n = parseInt(String(k?.sira || '').replace(/[^\d]/g, ''), 10);
                return isNaN(n) || n < 1 ? null : n;
            };
        const matchedWithSira = matched.filter(k => parseSira(k) != null);
        const matchedWithFs = matched.filter(k => Number(k.at_sayisi) > 0 && parseSira(k) != null);
        const atSayisiMissing = races.filter(k => !(Number(k.at_sayisi) > 0)).length;
        return {
            hedef: hedef || '—',
            hedefAbbrev: dim.abbrev(hedef),
            kosuSayisi: races.length,
            matchCount: matched.length,
            matchPct,
            max1: placement.max1,
            max12: placement.max12,
            max123: placement.max123,
            max1234: placement.max1234,
            cnt1: placement.cnt1,
            cnt12: placement.cnt12,
            cnt123: placement.cnt123,
            cnt1234: placement.cnt1234,
            matchKosuSayisi: placement.kosuSayisi,
            gecmisMatchStr: gecmisMatch.length ? gecmisMatch.join('→') : '—',
            gecmisValStr: gecmisVal.length ? gecmisVal.join('→') : '—',
            missing: all.length - races.length,
            atSayisiMissing,
            fieldSizeMissingOnMatch: Math.max(0, matchedWithSira.length - matchedWithFs.length)
        };
    },

    computeStats(kosular, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        if (!dim) return this._computeStatsCore(kosular, dimKey, hedef);

        const base = this._computeStatsCore(kosular, dimKey, hedef);
        const windows = {};
        const recentWindows = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine.RECENT_WINDOWS
            : [5, 4, 3, 2, 1];
        for (const w of recentWindows) {
            const sliced = typeof FieldSizeStatsEngine !== 'undefined'
                ? FieldSizeStatsEngine.recentSlice(kosular, w)
                : (kosular || []).slice(0, w);
            windows[w] = this._computeStatsCore(sliced, dimKey, hedef);
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

if (typeof globalThis !== 'undefined') globalThis.KosuDimensionStatsEngine = KosuDimensionStatsEngine;
if (typeof module !== 'undefined') module.exports = { KosuDimensionStatsEngine };
