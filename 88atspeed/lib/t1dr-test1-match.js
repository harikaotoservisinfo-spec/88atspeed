/**
 * T1×DR=TEST1 eşleşmesi — panel KOŞU AT SAYISI sekmesi ile aynı mantık
 */
const { loadGostergeEngines } = require('../scripts/ptest-terminal-lib');

// Yıldız veri şeması sürümü — değiştikçe artır ki eski kayıtlar yeniden hesaplansın.
const YILDIZ_SURUM = 3;

let enginesReady = false;

function ensureGosterimEngine() {
    if (enginesReady && global.GosterimEngine) return;
    loadGostergeEngines();
    enginesReady = true;
}

function atCacheKey(atId) {
    return atId != null && atId !== '' ? String(atId) : '';
}

function resolveHorseKosular(veriCache, horse) {
    const key = atCacheKey(horse?.atId);
    const cached = key && veriCache ? veriCache[key] : null;
    if (cached?.length) return cached;
    return horse?.kosular || [];
}

function horseHasHistory(horse, veriCache) {
    return resolveHorseKosular(veriCache, horse).length > 0;
}

function horseKey(h) {
    if (h?.atId != null && h.atId !== '') return String(h.atId);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    if (h?.name) return 'name:' + String(h.name);
    return null;
}

function cellVal(v) {
    if (v == null || v === '' || v === '-') return null;
    return String(v).trim();
}

function t1drEqualsTest1(t1dr, test1) {
    const a = cellVal(t1dr);
    const b = cellVal(test1);
    if (!a || !b) return false;
    if (a === b) return true;
    if (global.AtSpeedUtils) {
        const sa = global.AtSpeedUtils.dereceToSalise(a);
        const sb = global.AtSpeedUtils.dereceToSalise(b);
        if (sa != null && sb != null) return sa === sb;
    }
    return false;
}

function isKirmiziYazi(cls) {
    return !!(cls && /\bkirmizi-yazi\b/.test(cls));
}

/** SIRA=1 (en yeni koşu) satırında TEST1 + TEST2 + TEST3 üçünün de kırmızı-yazı olması */
function rowTest123Kirmizi(G, row) {
    const COL = G.COL;
    const cols = [COL.TEST1, COL.TEST2, COL.TEST3];
    for (let i = 0; i < cols.length; i++) {
        if (!isKirmiziYazi(G.getCellClass(cols[i], row.classes))) return false;
    }
    return true;
}

/** SIRA=1 satırında TEST9 hücresinde yanıp sönen renk kuralı (test9-yanip-son-guclu) olması */
function rowTest9Yanip(G, row) {
    const cls = G.getCellClass(G.COL.TEST9, row.classes);
    return !!(cls && /\btest9-yanip-son-guclu\b/.test(cls));
}

/** SIRA=1 satırında 8002-8001 (FARK8002) hücresinde yanıp sönen kural (mavi-yanip-son) olması */
function rowFark8002Yanip(G, row) {
    const cls = G.getCellClass(G.COL.FARK8002, row.classes);
    return !!(cls && /\bmavi-yanip-son\b/.test(cls));
}

/** Herhangi bir satırda TEST1 hücresi yeşil eşleşme (eslesme-yesil) olması */
function rowTest1Green(G, row) {
    const cls = G.getCellClass(G.COL.TEST1, row.classes);
    return !!(cls && /\beslesme-yesil\b/.test(cls));
}

/** Satırın tam yeşil olması: satirClass içinde fosfor-yesil-satir (TEST4===TEST6) */
function rowSatirTamYesil(row) {
    const sc = row?.classes?.satirClass;
    return !!(sc && /\bfosfor-yesil-satir\b/.test(sc));
}

/**
 * Anlamlı renk kuralları kataloğu (GÖSTERGE sütunundaki yıldızlar).
 * Sadece "kendi satırını" işaretleyen yapısal vurgular (AT İSMİ/AT ID/TARİH/
 * SIRA/AT SIRA vurgusu, koyu-mavi kenar, TEST9 koyu-mavi kenar) hariç tutulur;
 * bunlar her atta bulunur, ayırt edici değildir.
 */
const YILDIZ_KURALLARI = [
    { token: 'kirmizi-yazi',               renk: '#e53935', ad: 'Kırmızı (TEST en küçük)' },
    { token: 'fosfor-kirmizi-yazi',        renk: '#b71c1c', ad: 'Kırmızı (T1×DR son koşu)' },
    { token: 'fosfor-kirmizi-kenar-satir', renk: '#c62828', ad: 'Kırmızı kenar satır', satir: true },
    { token: 'guclu-uyari-satir',          renk: '#d84315', ad: 'Güçlü uyarı satır', satir: true },
    { token: 'eslesme-yesil',              renk: '#2e7d32', ad: 'Yeşil eşleşme' },
    { token: 'guclu-sehir-eslesme',        renk: '#1b5e20', ad: 'Güçlü şehir eşleşme' },
    { token: 'fosfor-yesil-hucre',         renk: '#43a047', ad: 'Yeşil (TEST4=TEST6)' },
    { token: 'fosfor-yesil-satir',         renk: '#00bfa5', ad: 'Satır tam yeşil', satir: true },
    { token: 'fosfor-yesil-koyu-yazi',     renk: '#1b5e20', ad: 'Koyu yeşil (en negatif)' },
    { token: 'yesil-yazi',                 renk: '#66bb6a', ad: 'Yeşil yazı (TEST5)' },
    { token: 'fosfor-sari-yazi',           renk: '#f9a825', ad: 'Sarı (TEST1-2 yakın)' },
    { token: 'mavi-yanip-son',             renk: '#1565c0', ad: 'Mavi yanıp (8002-8001)' },
    { token: 'test23-yanip-son',           renk: '#ef6c00', ad: 'Turuncu yanıp (TEST2-3)' },
    { token: 'test9-yanip-son-guclu',      renk: '#8e24aa', ad: 'Mor yanıp (TEST9)' },
    { token: 't1dr-eniyi-yanip-son',       renk: '#0288d1', ad: 'Mavi yanıp (T1×DR en iyi 2)' },
    { token: 'fosfor-mavi-yazi',           renk: '#1976d2', ad: 'Mavi fosfor' },
    { token: 'fosfor-mavi-satir',          renk: '#1976d2', ad: 'Mavi fosfor satır', satir: true },
    { token: 'pembe-hucre',                renk: '#d81b60', ad: 'Pembe (boş fark)' }
];

const YILDIZ_SATIR_KURALLARI = YILDIZ_KURALLARI.filter((r) => r.satir);
const YILDIZ_HUCRE_KURALLARI = YILDIZ_KURALLARI.filter((r) => !r.satir);
const YILDIZ_SIRA = new Map(YILDIZ_KURALLARI.map((r, i) => [r.token, i]));
const YILDIZ_REGEX = new Map(YILDIZ_KURALLARI.map((r) => [r.token, new RegExp('\\b' + r.token + '\\b')]));

/** COL indeksi -> kullanıcı dostu sütun etiketi */
function buildColEtiket(G) {
    const COL = G.COL;
    const inv = {};
    Object.keys(COL).forEach((k) => { inv[COL[k]] = k; });
    const override = {
        [COL.TEST1_ENTEGRE]: 'T1×DR',
        [COL.TEST3_ENTEGRE]: 'T3×DR',
        [COL.TEST2_MINUS_TEST3]: 'T2-T3',
        [COL.FARK8002]: '8002-8001',
        [COL.SEHIR]: 'ŞEHİR',
        [COL.SON800_1]: 'SON800-1',
        [COL.SON800_2]: 'SON800-2'
    };
    return (c) => override[c] || inv[c] || ('c' + c);
}

/**
 * Bir atın SIRA 1..maxSira satırlarından, kural×sütun bazında yıldız listesi üretir.
 * Aynı kural farklı sütunlarda ateşlenirse ayrı yıldız olur (kullanıcı isteği).
 * T1×DR=TEST1 eşleşmesi bu pencerede varsa başa altın yıldız eklenir.
 * Dönüş: [{ c: renk, t: başlık }] — katalog sırasına göre.
 */
function computeHorseYildizlar(G, rows, colEtiket, maxSira) {
    const limit = maxSira || 7;
    const pencereEtiket = 'son ' + limit + '\'de';
    const maxCol = Math.max(...Object.values(G.COL));
    const COL = G.COL;
    const seen = new Map(); // token|sutun -> {renk, ad, sutun, sayi, sira}
    let matched = false;
    const bump = (rule, sutun) => {
        const key = rule.token + '|' + sutun;
        let e = seen.get(key);
        if (!e) {
            e = { renk: rule.renk, ad: rule.ad, sutun, sayi: 0, sira: YILDIZ_SIRA.get(rule.token) };
            seen.set(key, e);
        }
        e.sayi++;
    };
    for (const row of rows) {
        const sira = parseInt(row.values[0], 10);
        if (isNaN(sira) || sira < 1 || sira > limit) continue;
        if (t1drEqualsTest1(row.values[COL.TEST1_ENTEGRE], row.values[COL.TEST1])) matched = true;
        const sc = row.classes?.satirClass || '';
        if (sc) {
            for (const rule of YILDIZ_SATIR_KURALLARI) {
                if (YILDIZ_REGEX.get(rule.token).test(sc)) bump(rule, 'SATIR');
            }
        }
        for (let c = 0; c <= maxCol; c++) {
            const cls = G.getCellClass(c, row.classes);
            if (!cls) continue;
            const label = colEtiket(c);
            for (const rule of YILDIZ_HUCRE_KURALLARI) {
                if (YILDIZ_REGEX.get(rule.token).test(cls)) bump(rule, label);
            }
        }
    }
    const list = [...seen.values()]
        .sort((a, b) => (a.sira - b.sira) || String(a.sutun).localeCompare(String(b.sutun)))
        .map((e) => ({ c: e.renk, t: e.ad + ' · ' + e.sutun + ' · ' + pencereEtiket + ' ' + e.sayi + ' kez', ad: e.ad }));
    if (matched) list.unshift({ c: '#f5a623', t: 'T1×DR = TEST1 eşleşme', ad: 'T1×DR eşleşme' });
    return list;
}

/**
 * Bir koşuyu tek geçişte analiz eder:
 *  - matched: T1×DR = TEST1 eşleşmesi olan atlar (sarı yıldız)
 *  - kirmizi: en yeni koşu satırında TEST1/TEST2/TEST3 üçü de kırmızı olan atlar (kırmızı yıldız)
 */
function analyzeRace(race, meta) {
    ensureGosterimEngine();
    const G = global.GosterimEngine;
    const matched = new Set();
    const kirmizi = new Set();
    const mor = new Set();
    const mavi = new Set();
    const yesil = new Set();
    const yesilSatir = new Set();
    const yildizlar = new Map();
    if (!G) return { matched, kirmizi, mor, mavi, yesil, yesilSatir, yildizlar };

    const veriCache = meta?.veriCache || null;
    const horses = (race.horses || []).map((h) => Object.assign({}, h, {
        kosular: resolveHorseKosular(veriCache, h)
    }));
    const calcRace = Object.assign({}, race, { horses });
    const rows = G.buildRaceRows(calcRace, {
        programTarih: meta?.tarih || null,
        hipodromSehir: meta?.hipodrom || '',
        raceIndex: 0
    });
    const COL = G.COL;
    const colEtiket = buildColEtiket(G);
    const rowsByKey = new Map();

    for (const row of rows || []) {
        const hi = row.meta?.horseIndex;
        const horse = hi != null ? calcRace.horses[hi] : null;
        const key = horse ? horseKey(horse) : null;
        if (!key) continue;
        if (!rowsByKey.has(key)) rowsByKey.set(key, []);
        rowsByKey.get(key).push(row);
        const t1dr = row.values[COL.TEST1_ENTEGRE];
        const test1 = row.values[COL.TEST1];
        if (t1drEqualsTest1(t1dr, test1)) matched.add(key);
        if (row.values[0] === '1' && rowTest123Kirmizi(G, row)) kirmizi.add(key);
        if (row.values[0] === '1' && rowTest9Yanip(G, row)) mor.add(key);
        if (row.values[0] === '1' && rowFark8002Yanip(G, row)) mavi.add(key);
        // Son 7 yarışın (sira 1..7) HERHANGİ birinde TEST1 hücresi yeşilse
        const sira = parseInt(row.values[0], 10);
        if (!isNaN(sira) && sira >= 1 && sira <= 7) {
            if (rowTest1Green(G, row)) yesil.add(key);
            if (rowSatirTamYesil(row)) yesilSatir.add(key);
        }
    }

    for (const [key, horseRows] of rowsByKey) {
        yildizlar.set(key, {
            son7: computeHorseYildizlar(G, horseRows, colEtiket, 7),
            son2: computeHorseYildizlar(G, horseRows, colEtiket, 2),
            son1: computeHorseYildizlar(G, horseRows, colEtiket, 1)
        });
    }
    markAyirtedici(yildizlar, 'son1');
    markAyirtedici(yildizlar, 'son2');
    return { matched, kirmizi, mor, mavi, yesil, yesilSatir, yildizlar };
}

/**
 * Verilen pencerede (son1 / son2) sahada AYIRT EDİCİ yıldızları işaretler:
 * bir kural (ad) yarışta yalnızca 1 veya 2 atta varsa, o atların ilgili
 * yıldızları vurgulanır (s.v = true). Diğerlerinde olmayan → belirleyici.
 */
function markAyirtedici(yildizlar, win) {
    const freq = new Map(); // ad -> kaç atta var
    for (const [, w] of yildizlar) {
        const seenAd = new Set();
        for (const s of w[win] || []) {
            if (s.ad && !seenAd.has(s.ad)) {
                seenAd.add(s.ad);
                freq.set(s.ad, (freq.get(s.ad) || 0) + 1);
            }
        }
    }
    for (const [, w] of yildizlar) {
        for (const s of w[win] || []) {
            if (s.ad && freq.get(s.ad) <= 2) s.v = true;
        }
    }
}

function collectMatchingHorseKeys(race, meta) {
    return analyzeRace(race, meta).matched;
}

function annotateRaceHorses(race, meta) {
    if (!race?.horses?.length) return race;
    const veriCache = meta?.veriCache || null;
    const hasHistory = race.horses.some((h) => horseHasHistory(h, veriCache));
    if (!hasHistory) return race;

    let matched;
    let kirmizi;
    let mor;
    let mavi;
    let yesil;
    let yesilSatir;
    let yildizlar;
    try {
        const analysis = analyzeRace(race, meta);
        matched = analysis.matched;
        kirmizi = analysis.kirmizi;
        mor = analysis.mor;
        mavi = analysis.mavi;
        yesil = analysis.yesil;
        yesilSatir = analysis.yesilSatir;
        yildizlar = analysis.yildizlar;
    } catch (_) {
        return race;
    }

    const horses = race.horses.map((h) => {
        const key = horseKey(h);
        const flag = key && matched.has(key);
        const kirmiziFlag = key && kirmizi.has(key);
        const morFlag = key && mor.has(key);
        const maviFlag = key && mavi.has(key);
        const yesilFlag = key && yesil.has(key);
        const yesilSatirFlag = key && yesilSatir.has(key);
        const yildizSet = (key && yildizlar.get(key)) || {};
        return Object.assign({}, h, {
            t1drTest1: !!flag,
            test123Kirmizi: !!kirmiziFlag,
            test9Yanip: !!morFlag,
            fark8002Yanip: !!maviFlag,
            test1Yesil: !!yesilFlag,
            satirTamYesil: !!yesilSatirFlag,
            yildizlar: yildizSet.son7 || [],
            yildizlarSon2: yildizSet.son2 || [],
            yildizlarSon1: yildizSet.son1 || [],
            _yv: YILDIZ_SURUM
        });
    });
    return Object.assign({}, race, { horses });
}

function raceNeedsAnnotation(race, meta) {
    const horses = race?.horses || [];
    if (!horses.length) return false;
    const sekilTamam = (h) => h._yv === YILDIZ_SURUM
        && Array.isArray(h.yildizlar) && Array.isArray(h.yildizlarSon2) && Array.isArray(h.yildizlarSon1);
    if (!meta?.force && horses.every(sekilTamam)) return false;
    const veriCache = meta?.veriCache || null;
    return horses.some((h) => horseHasHistory(h, veriCache));
}

function annotateKosular(kosular, meta) {
    return (kosular || []).map((race) => {
        if (!raceNeedsAnnotation(race, meta)) return race;
        return annotateRaceHorses(race, meta);
    });
}

module.exports = {
    atCacheKey,
    resolveHorseKosular,
    horseKey,
    t1drEqualsTest1,
    analyzeRace,
    collectMatchingHorseKeys,
    annotateRaceHorses,
    annotateKosular
};
