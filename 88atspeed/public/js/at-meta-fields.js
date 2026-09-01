/**
 * TJK meta alanları — merkezi şema, format ve erişim
 * pist, sıklet, grup, kcins, hp, taki, yaş, kcins_kosu, kategori
 */
const AtMetaFields = {
    HORSE_FIELDS: [
        { key: 'yas', label: 'YAŞ', short: 'Yaş' },
        { key: 'taki', label: 'TAKI', short: 'Taki' },
        { key: 'hp', label: 'HP', short: 'HP' },
        { key: 'siklet', label: 'SIKLET', short: 'Sıklet' }
    ],

    RACE_FIELDS: [
        { key: 'pist', label: 'PİST', short: 'Pist' },
        { key: 'kcins_kosu', label: 'KCİNS', short: 'Koşu cinsi' },
        { key: 'kategori', label: 'KATEGORİ', short: 'Kategori' },
        { key: 'mesafe', label: 'MESAFE', short: 'Mesafe' }
    ],

    KOSU_FIELDS: [
        { key: 'pist', label: 'PİST', short: 'Pist' },
        { key: 'siklet', label: 'SIKLET', short: 'Sıklet' },
        { key: 'grup', label: 'GRUP', short: 'Grup' },
        { key: 'kcins', label: 'KCİNS', short: 'Kcins' },
        { key: 'hp', label: 'HP', short: 'HP' },
        { key: 'taki', label: 'TAKI', short: 'Taki' },
        { key: 'yas', label: 'YAŞ', short: 'Yaş' },
        { key: 'kcins_kosu', label: 'KCİNS-K', short: 'Koşu kcins' },
        { key: 'kategori', label: 'KAT', short: 'Kategori' },
        { key: 'pist_kosu', label: 'PİST-K', short: 'Koşu pist' }
    ],

    normalizePist(raw) {
        if (!raw) return '';
        const s = String(raw);
        if (/^K:|kum/i.test(s)) return 'Kum';
        if (/^Ç:|^C:|^S:|çim/i.test(s)) return 'Çim';
        if (/sentetik/i.test(s)) return 'Sentetik';
        return s.replace(/\s+/g, ' ').trim();
    },

    val(obj, key, fallback) {
        if (!obj) return fallback ?? '—';
        const v = obj[key];
        if (v == null || v === '' || v === '-') return fallback ?? '—';
        return String(v);
    },

    formatRaceHeader(race) {
        const mesafe = this.val(race, 'mesafe', '?');
        const pist = this.normalizePist(race.pist) || this.val(race, 'pist', '');
        const kcins = this.val(race, 'kcins_kosu', '');
        const kat = this.val(race, 'kategori', '');
        let line = mesafe !== '?' ? mesafe + (pist ? ' ' + pist : '') : '?';
        if (kcins !== '—') line += ' · ' + kcins;
        if (kat !== '—') line += ' · ' + kat;
        return line;
    },

    formatRaceHeaderShort(race) {
        const parts = [];
        const pist = this.normalizePist(race?.pist);
        if (race?.mesafe && race.mesafe !== '?') parts.push(race.mesafe + (pist ? ' ' + pist : ''));
        if (race?.kcins_kosu) parts.push(race.kcins_kosu);
        if (race?.kategori) parts.push(race.kategori);
        return parts.join(' · ') || '—';
    },

    extractHorseMeta(horse) {
        const kosular = horse?.kosular || [];
        const son = kosular[0] || {};
        return {
            yas: this.val(horse, 'yas') !== '—' ? horse.yas : this.val(son, 'yas'),
            taki: this.val(horse, 'taki') !== '—' ? horse.taki : this.val(son, 'taki'),
            hp: this.val(horse, 'hp') !== '—' ? horse.hp : this.val(son, 'hp'),
            siklet: this.val(horse, 'siklet') !== '—' ? horse.siklet : this.val(son, 'siklet')
        };
    },

    extractRaceMeta(race) {
        return {
            mesafe: this.val(race, 'mesafe'),
            pist: this.normalizePist(race?.pist) || this.val(race, 'pist'),
            kcins_kosu: this.val(race, 'kcins_kosu'),
            kategori: this.val(race, 'kategori')
        };
    },

    extractKosuMeta(kosu) {
        if (!kosu) return {};
        return {
            pist: this.normalizePist(kosu.pist || kosu.pist_kosu) || this.val(kosu, 'pist'),
            siklet: this.val(kosu, 'siklet'),
            grup: this.val(kosu, 'grup'),
            kcins: this.val(kosu, 'kcins'),
            hp: this.val(kosu, 'hp'),
            taki: this.val(kosu, 'taki'),
            yas: this.val(kosu, 'yas'),
            kcins_kosu: this.val(kosu, 'kcins_kosu'),
            kategori: this.val(kosu, 'kategori'),
            pist_kosu: this.normalizePist(kosu.pist_kosu) || this.val(kosu, 'pist_kosu')
        };
    },

    pistMatch(atPist, hedefPist) {
        const a = this.normalizePist(atPist);
        const b = this.normalizePist(hedefPist);
        if (!a || !b || a === '—' || b === '—') return false;
        return a === b;
    },

    /** Geçmiş koşularda hedef pistle eşleşen oran */
    computePistDeneyimi(kosular, hedefPist) {
        if (!kosular?.length || !hedefPist) {
            return { count: 0, total: 0, pct: null, label: '—' };
        }
        let count = 0;
        for (const k of kosular) {
            if (this.pistMatch(k.pist || k.pist_kosu, hedefPist)) count++;
        }
        const total = kosular.length;
        const pct = total ? Math.round(100 * count / total) : null;
        return { count, total, pct, label: count + '/' + total + (pct != null ? ' (%' + pct + ')' : '') };
    },

    /** Son koşu meta özeti (gösterge için) */
    sonKosuMeta(kosular) {
        const sorted = [...(kosular || [])].sort((a, b) => {
            const da = (a.tarih || '').split('.').reverse().join('');
            const db = (b.tarih || '').split('.').reverse().join('');
            return db.localeCompare(da);
        });
        return this.extractKosuMeta(sorted[0]);
    },

    attachToIstatistikRow(row, horse, race) {
        const hm = this.extractHorseMeta(horse);
        const rm = this.extractRaceMeta(race);
        const pistExp = this.computePistDeneyimi(horse?.kosular, rm.pist);
        const son = this.sonKosuMeta(horse?.kosular);
        row.yas = hm.yas;
        row.taki = hm.taki;
        row.hp = hm.hp;
        row.siklet = hm.siklet;
        row.raceMeta = rm;
        row.pistDeneyimi = pistExp;
        row.sonKosuPist = son.pist;
        row.sonKosuKcins = son.kcins;
        return row;
    },

    kosuMetaCells(kosu) {
        const m = this.extractKosuMeta(kosu);
        return this.KOSU_FIELDS.map(f => m[f.key] || '—');
    },

    horseMetaCells(horse) {
        const m = this.extractHorseMeta(horse);
        return this.HORSE_FIELDS.map(f => m[f.key] || '—');
    },

    raceMetaCells(race) {
        const m = this.extractRaceMeta(race);
        return this.RACE_FIELDS.map(f => m[f.key] || '—');
    },

    /** PUANLAMA TEST sabit TJK sütunları */
    PUANLAMA_COLUMNS: [
        { key: 'yas', label: 'YAŞ' },
        { key: 'taki', label: 'TAKI' },
        { key: 'hp', label: 'HP' },
        { key: 'siklet', label: 'SIKLET' },
        { key: 'racePist', label: 'PİST' },
        { key: 'pistDeneyimi', label: 'PİST-D%' },
        { key: 'sonKosuPist', label: 'SON-P' },
        { key: 'raceKcins', label: 'KCİNS' },
        { key: 'raceKat', label: 'KAT' }
    ],

    puanlamaRowCells(row) {
        const rm = row.raceMeta || {};
        const pd = row.pistDeneyimi || {};
        return [
            row.yas || '—',
            row.taki || '—',
            row.hp || '—',
            row.siklet || '—',
            rm.pist || '—',
            pd.pct != null ? '%' + pd.pct : (pd.label || '—'),
            row.sonKosuPist || '—',
            rm.kcins_kosu || '—',
            rm.kategori || '—'
        ];
    },

    /** HESAPLAMA önizleme: koşu başına sütun sayısı (zaman + meta) */
    kosuPreviewColCount() {
        return 8 + this.KOSU_FIELDS.length;
    }
};

if (typeof globalThis !== 'undefined') globalThis.AtMetaFields = AtMetaFields;
if (typeof module !== 'undefined') module.exports = { AtMetaFields };
