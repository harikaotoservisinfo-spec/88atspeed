/**
 * T1×DR=TEST1 eşleşmesi — panel KOŞU AT SAYISI sekmesi ile aynı mantık
 */
const { loadGostergeEngines } = require('../scripts/ptest-terminal-lib');

// Yıldız veri şeması sürümü — değiştikçe artır ki eski kayıtlar yeniden hesaplansın.
const YILDIZ_SURUM = 35;

const T1DR_SON_KOSU_AD = 'Kırmızı (T1×DR son koşu)';
const T1DR_ENIYI_AD = 'Mavi yanıp (T1×DR en iyi 2)';
const TEST46_AD = 'Yeşil (TEST4=TEST6)';
const TEST12_YAKIN_AD = 'Turuncu (TEST1-2 yakın)';
const TEST12_SARI_ESKI_AD = 'Sarı (TEST1-2 yakın)';
const MOR_TEST9_AD = 'Mor yanıp (TEST9)';
const FARK8002_SIFIR_AD = 'Gri çerçeve (8002-8001 sıfır)';
const TEST5_KAHVE_AD = 'Kahve (TEST5 sıfır)';
const TEST_EN_KUCUK_AD = 'Pembe (TEST en küçük)';
const KIRMIZI_KENAR_AD = 'Kırmızı kenar satır';
const MAVI_KENAR_AD = 'Mavi kenar satır';
const SATIR_TAM_SARI_AD = 'Satır tam sarı';
const SATIR_TAM_YESIL_AD = 'Satır tam yeşil';
const YESIL_ESLESME_AD = 'Yeşil eşleşme';
const GUCUL_SEHIR_AD = 'Güçlü şehir eşleşme';
const SON800_1_TOP3_AD = 'SON800-1 top-3';
const SON800_RANK_COLORS = { 1: '#2e7d32', 2: '#f9a825', 3: '#c62828' };

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

function isTestEnKucukPembe(cls) {
    return !!(cls && /\bpembe-test-enkucuk-vurgu\b/.test(cls));
}

/** SIRA=1 satırında TEST1 + TEST2 + TEST3 hücrelerinin üçünün de pembe-test-enkucuk-vurgu olması */
function rowTest123Pembe(G, row) {
    const COL = G.COL;
    const cols = [COL.TEST1, COL.TEST2, COL.TEST3];
    for (let i = 0; i < cols.length; i++) {
        if (!isTestEnKucukPembe(G.getCellClass(cols[i], row.classes))) return false;
    }
    return true;
}

/** SIRA=1 satırında TEST9 hücresinde yanıp sönen renk kuralı (test9-yanip-son-guclu) olması */
function rowTest9Yanip(G, row) {
    const cls = G.getCellClass(G.COL.TEST9, row.classes);
    return !!(cls && /\btest9-yanip-son-guclu\b/.test(cls));
}

/** SIRA=1 satırında TEST5 hücresinde kahve çerçeve kuralı (kahve-test5-sifir-vurgu) olması */
function rowTest5KahveVurgu(G, row) {
    const cls = G.getCellClass(G.COL.TEST5, row.classes);
    return !!(cls && /\bkahve-test5-sifir-vurgu\b/.test(cls));
}

/** SIRA=1 satırında 8002-8001 (FARK8002) hücresinde gri çerçeve kuralı (gri-kenar-fark8002-vurgu) olması */
function rowFark8002SifirVurgu(G, row) {
    const cls = G.getCellClass(G.COL.FARK8002, row.classes);
    return !!(cls && /\bgri-kenar-fark8002-vurgu\b/.test(cls));
}

/** ŞEHİR hücresinde şehir eşleşmesi (eslesme-yesil) olması */
function rowSehirEslesme(G, row) {
    const cls = G.getCellClass(G.COL.SEHIR, row.classes);
    return !!(cls && /\beslesme-yesil\b/.test(cls));
}

function isSehirGostergeStar(s) {
    const sutun = String(s.t || '').split(' · ')[1] || '';
    if (sutun !== 'ŞEHİR') return false;
    return s.ad === YESIL_ESLESME_AD || s.ad === GUCUL_SEHIR_AD;
}

/** T1×DR hücresinde son koşularda en iyi 2 (t1dr-eniyi-yanip-son) olması */
function rowT1drEnIyi(G, row) {
    const cls = G.getCellClass(G.COL.TEST1_ENTEGRE, row.classes);
    return !!(cls && /\bt1dr-eniyi-yanip-son\b/.test(cls));
}

function isT1drEnIyiGostergeStar(s) {
    const sutun = String(s.t || '').split(' · ')[1] || '';
    if (sutun !== 'T1×DR') return false;
    return s.ad === T1DR_ENIYI_AD;
}

/** TEST4 veya TEST6 hücresinde TEST4=TEST6 (fosfor-yesil-hucre) olması */
function rowTest46Equal(G, row) {
    const c4 = G.getCellClass(G.COL.TEST4, row.classes);
    const c6 = G.getCellClass(G.COL.TEST6, row.classes);
    return !!(
        (c4 && /\bfosfor-yesil-hucre\b/.test(c4))
        || (c6 && /\bfosfor-yesil-hucre\b/.test(c6))
    );
}

function isTest46GostergeStar(s) {
    if (s.ad !== TEST46_AD) return false;
    const sutun = String(s.t || '').split(' · ')[1] || '';
    return sutun === 'TEST4' || sutun === 'TEST6';
}

function isTest12SariHucreStar(s) {
    if (s.ad !== TEST12_SARI_ESKI_AD) return false;
    const sutun = String(s.t || '').split(' · ')[1] || '';
    return sutun === 'TEST1' || sutun === 'TEST2';
}

function isTest12YakinGostergeStar(s) {
    return s.ad === TEST12_YAKIN_AD || !!s.t12;
}

function isSon800GostergeStar(s) {
    return s.ad === SON800_1_TOP3_AD || !!s.s8;
}

/** Herhangi bir satırda TEST1 hücresi yeşil eşleşme (eslesme-yesil) olması */
function rowTest1Green(G, row) {
    const cls = G.getCellClass(G.COL.TEST1, row.classes);
    return !!(cls && /\beslesme-yesil\b/.test(cls));
}

/** Herhangi bir satırda TEST2 hücresi yeşil eşleşme (eslesme-yesil) olması */
function rowTest2Green(G, row) {
    const cls = G.getCellClass(G.COL.TEST2, row.classes);
    return !!(cls && /\beslesme-yesil\b/.test(cls));
}

/** Herhangi bir satırda TEST3 hücresi yeşil eşleşme (eslesme-yesil) olması */
function rowTest3Green(G, row) {
    const cls = G.getCellClass(G.COL.TEST3, row.classes);
    return !!(cls && /\beslesme-yesil\b/.test(cls));
}

/** Satırın tam sarı olması: satirClass içinde fosfor-yesil-satir (TEST4===TEST6) */
function rowSatirTamYesil(row) {
    const sc = row?.classes?.satirClass;
    return !!(sc && /\bfosfor-yesil-satir\b/.test(sc));
}

/** Satırın tamamen yeşil olması: satirClass içinde guclu-uyari-satir */
function rowSatirTamYesilKoyu(row) {
    const sc = row?.classes?.satirClass;
    return !!(sc && /\bguclu-uyari-satir\b/.test(sc));
}

/** Satırda fosforlu kırmızı kenar kuralı (fosfor-kirmizi-kenar-satir) olması */
function rowKirmiziKenarSatir(row) {
    const sc = row?.classes?.satirClass;
    return !!(sc && /\bfosfor-kirmizi-kenar-satir\b/.test(sc));
}

/** Satırda koyu mavi kenar kuralı (koyu-mavi-kenar-satir) olması */
function rowMaviKenarSatir(row) {
    const sc = row?.classes?.satirClass;
    return !!(sc && /\bkoyu-mavi-kenar-satir\b/.test(sc));
}

/**
 * Anlamlı renk kuralları kataloğu (GÖSTERGE sütunundaki yıldızlar).
 * Sadece "kendi satırını" işaretleyen yapısal vurgular (AT İSMİ/AT ID/TARİH/
 * SIRA/AT SIRA vurgusu, TEST9 koyu-mavi kenar) hariç tutulur;
 * bunlar her atta bulunur, ayırt edici değildir.
 */
const YILDIZ_KURALLARI = [
    { token: 'pembe-test-enkucuk-vurgu', renk: '#d81b60', ad: 'Pembe (TEST en küçük)' },
    { token: 'fosfor-kirmizi-yazi',        renk: '#b71c1c', ad: 'Kırmızı (T1×DR son koşu)' },
    { token: 'fosfor-kirmizi-kenar-satir', renk: '#5d4037', ad: KIRMIZI_KENAR_AD, satir: true },
    { token: 'koyu-mavi-kenar-satir',      renk: '#5d4037', ad: MAVI_KENAR_AD, satir: true },
    { token: 'guclu-uyari-satir',          renk: '#1b5e20', ad: SATIR_TAM_YESIL_AD, satir: true },
    { token: 'eslesme-yesil',              renk: '#2e7d32', ad: YESIL_ESLESME_AD },
    { token: 'guclu-sehir-eslesme',        renk: '#1b5e20', ad: 'Güçlü şehir eşleşme' },
    { token: 'fosfor-yesil-hucre',         renk: '#43a047', ad: 'Yeşil (TEST4=TEST6)' },
    { token: 'fosfor-yesil-satir',         renk: '#f9a825', ad: SATIR_TAM_SARI_AD, satir: true },
    { token: 'fosfor-yesil-koyu-yazi',     renk: '#1b5e20', ad: 'Koyu yeşil (en negatif)' },
    { token: 'kahve-test5-sifir-vurgu',    renk: '#5d4037', ad: 'Kahve (TEST5 sıfır)' },
    { token: 'gri-kenar-fark8002-vurgu',   renk: '#757575', ad: 'Gri çerçeve (8002-8001 sıfır)' },
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
 * Dönüş: [{ c: renk, t: başlık }] — katalog sırasına göre.
 */
function computeHorseYildizlar(G, rows, colEtiket, maxSira) {
    const limit = maxSira || 7;
    const pencereEtiket = 'son ' + limit + '\'de';
    const maxCol = Math.max(...Object.values(G.COL));
    const seen = new Map(); // token|sutun -> {renk, ad, sutun, sayi, sira}
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
    return list;
}

/**
 * KRONOLOJİK yıldız listesi (SON 7 satırı için).
 * Koşular en eski (sira=limit) → en yeni (sira=1) sırasıyla dizilir; her koşunun
 * yıldızları kendi içinde katalog renk sırasına göre. Her yıldıza k=sira eklenir
 * ki UI koşular arasına ayraç koyabilsin.
 */
function computeHorseYildizlarKronolojik(G, rows, colEtiket, maxSira) {
    const limit = maxSira || 7;
    const maxCol = Math.max(...Object.values(G.COL));
    const perSira = new Map(); // sira -> [{renk, ad, sutun, sira(ruleidx)}]
    const pushStar = (sira, renk, ad, sutun, ruleIdx) => {
        if (!perSira.has(sira)) perSira.set(sira, []);
        perSira.get(sira).push({ renk, ad, sutun, ruleIdx });
    };
    for (const row of rows) {
        const sira = parseInt(row.values[0], 10);
        if (isNaN(sira) || sira < 1 || sira > limit) continue;
        const sc = row.classes?.satirClass || '';
        if (sc) {
            for (const rule of YILDIZ_SATIR_KURALLARI) {
                if (YILDIZ_REGEX.get(rule.token).test(sc)) pushStar(sira, rule.renk, rule.ad, 'SATIR', YILDIZ_SIRA.get(rule.token));
            }
        }
        for (let c = 0; c <= maxCol; c++) {
            const cls = G.getCellClass(c, row.classes);
            if (!cls) continue;
            const label = colEtiket(c);
            for (const rule of YILDIZ_HUCRE_KURALLARI) {
                if (YILDIZ_REGEX.get(rule.token).test(cls)) pushStar(sira, rule.renk, rule.ad, label, YILDIZ_SIRA.get(rule.token));
            }
        }
    }
    const out = [];
    for (let s = limit; s >= 1; s--) {
        const arr = perSira.get(s);
        if (!arr) continue;
        arr.sort((a, b) => (a.ruleIdx - b.ruleIdx) || String(a.sutun).localeCompare(String(b.sutun)));
        for (const st of arr) {
            out.push({ c: st.renk, t: st.ad + ' · ' + st.sutun + ' · ' + s + '. koşu', ad: st.ad, k: s });
        }
    }
    return out;
}

/**
 * Bir koşuyu tek geçişte analiz eder:
 *  - matched: T1×DR = TEST1 eşleşmesi olan atlar (t1drTest1 bayrağı)
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
    const raceCounts = new Map(); // key -> {s7, s2, s1} koşu sayıları

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
        if (row.values[0] === '1' && rowTest123Pembe(G, row)) kirmizi.add(key);
        if (row.values[0] === '1' && rowTest9Yanip(G, row)) mor.add(key);
        if (row.values[0] === '1' && rowFark8002SifirVurgu(G, row)) mavi.add(key);
        // Son 7 yarışın (sira 1..7) HERHANGİ birinde TEST1 hücresi yeşilse
        const sira = parseInt(row.values[0], 10);
        if (!isNaN(sira) && sira >= 1 && sira <= 7) {
            if (rowTest1Green(G, row)) yesil.add(key);
            if (rowSatirTamYesil(row)) yesilSatir.add(key);
            let rc = raceCounts.get(key);
            if (!rc) { rc = { s7: 0, s2: 0, s1: 0 }; raceCounts.set(key, rc); }
            rc.s7++; if (sira <= 2) rc.s2++; if (sira <= 1) rc.s1++;
        }
    }

    for (const [key, horseRows] of rowsByKey) {
        const son7agg = computeHorseYildizlar(G, horseRows, colEtiket, 7);
        yildizlar.set(key, {
            son7: computeHorseYildizlarKronolojik(G, horseRows, colEtiket, 7),
            son2: computeHorseYildizlar(G, horseRows, colEtiket, 2),
            son1: computeHorseYildizlar(G, horseRows, colEtiket, 1),
            n7: son7agg.length
        });
    }
    markAyirtedici(yildizlar, 'son1');
    markAyirtedici(yildizlar, 'son2');
    markTest1EnIyiYesilGosterge(yildizlar, rowsByKey, G);
    markTest2EnIyiYesilGosterge(yildizlar, rowsByKey, G);
    markTest3EnIyiGriGosterge(yildizlar, rowsByKey, G);
    markSehirEslesmeGosterge(yildizlar, rowsByKey, G);
    markT1drEnIyiGosterge(yildizlar, rowsByKey, G);
    markTest46Gosterge(yildizlar, rowsByKey, G);
    markTest12YakinGosterge(yildizlar, rowsByKey, calcRace, G, meta);
    markSon800Top3Gosterge(yildizlar, rowsByKey, calcRace, G);
    markTest9MorYildizlari(yildizlar, rowsByKey, G);
    markFark8002GriYildizlari(yildizlar, rowsByKey, G);
    markTest5KahveYildizlari(yildizlar, rowsByKey, G);
    markTestEnKucukPembeYildizlari(yildizlar, rowsByKey, G);
    markKirmiziKenarYildizlari(yildizlar, rowsByKey);
    markMaviKenarYildizlari(yildizlar, rowsByKey);
    markSatirTamSariYildizlari(yildizlar, rowsByKey);
    markSatirTamYesilYildizlari(yildizlar, rowsByKey);
    markT1drSonKosuVurgu(yildizlar, rowsByKey, calcRace, G, meta);
    const ivmeMap = computeIvme(yildizlar, raceCounts);
    return { matched, kirmizi, mor, mavi, yesil, yesilSatir, yildizlar, ivme: ivmeMap };
}

/** base yoğunluğundan target yoğunluğuna % değişim. base=0 & target>0 → 'yeni'. */
function ivmeYuzde(base, target) {
    if (base == null || target == null) return { v: null, yeni: false };
    if (base === 0) return { v: null, yeni: target > 0 };
    return { v: Math.round((target / base - 1) * 100), yeni: false };
}

/**
 * MODEL B — ayrık pencere ivmesi. Yıldız yoğunluğu = ayrık yıldız / ayrık koşu.
 *   taban = 3-7. koşu · orta = 2. koşu · güncel = 1. koşu
 *   t2 = taban→orta % · t1 = orta→güncel %
 */
function computeIvme(yildizlar, raceCounts) {
    const out = new Map();
    for (const [key, w] of yildizlar) {
        const rc = raceCounts.get(key) || { s7: 0, s2: 0, s1: 0 };
        // Kronolojik SON 7 listesindeki koşu-başı gerçek yıldız sayıları (k = sira)
        let baseN = 0, midN = 0, curN = 0;
        for (const s of w.son7 || []) {
            if (s.k === 1) curN++;
            else if (s.k === 2) midN++;
            else if (s.k >= 3 && s.k <= 7) baseN++;
        }
        const baseR = rc.s7 - rc.s2, midR = rc.s2 - rc.s1, curR = rc.s1;
        const dBase = baseR > 0 ? baseN / baseR : null;
        const dMid = midR > 0 ? midN / midR : null;
        const dCur = curR > 0 ? curN / curR : null;
        const a = ivmeYuzde(dBase, dMid);
        const b = ivmeYuzde(dMid, dCur);
        out.set(key, {
            t2: a.v, t2y: a.yeni,
            t1: b.v, t1y: b.yeni,
            d: [dBase == null ? null : Math.round(dBase * 10) / 10,
                dMid == null ? null : Math.round(dMid * 10) / 10,
                dCur == null ? null : Math.round(dCur * 10) / 10]
        });
    }
    return out;
}

/**
 * TEST1 en iyi 3: yeşil yuvarlak — çizgi yoksa koyu yeşil, mavi/kırmızı kenarda ilgili vurgu.
 */
function markTest1EnIyiYesilGosterge(yildizlar, rowsByKey, G) {
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest1Green(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let variant = 'yesil';
            if (rowKirmiziKenarSatir(row)) variant = 'kirmizi';
            else if (rowMaviKenarSatir(row)) variant = 'mavi';
            ok.set(key + '|' + sira, variant);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== YESIL_ESLESME_AD) return true;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST1') return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad !== YESIL_ESLESME_AD) continue;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST1') continue;
                const variant = ok.get(key + '|' + s.k);
                if (!variant) continue;
                s.c = '#2e7d32';
                delete s.v;
                if (variant === 'kirmizi') s.t1yk = true;
                else if (variant === 'mavi') s.t1ym = true;
                else s.t1y = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * TEST2 en iyi 3: açık yeşil yuvarlak — çizgi yoksa yeşil, mavi/kırmızı kenarda ilgili vurgu.
 */
function markTest2EnIyiYesilGosterge(yildizlar, rowsByKey, G) {
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest2Green(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let variant = 'yesil';
            if (rowKirmiziKenarSatir(row)) variant = 'kirmizi';
            else if (rowMaviKenarSatir(row)) variant = 'mavi';
            ok.set(key + '|' + sira, variant);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== YESIL_ESLESME_AD) return true;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST2') return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad !== YESIL_ESLESME_AD) continue;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST2') continue;
                const variant = ok.get(key + '|' + s.k);
                if (!variant) continue;
                s.c = '#81c784';
                delete s.v;
                if (variant === 'kirmizi') s.t2yk = true;
                else if (variant === 'mavi') s.t2ym = true;
                else s.t2y = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * TEST3 en iyi 3: gri yuvarlak — çizgi yoksa yeşil, mavi/kırmızı kenarda ilgili vurgu.
 */
function markTest3EnIyiGriGosterge(yildizlar, rowsByKey, G) {
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest3Green(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let variant = 'yesil';
            if (rowKirmiziKenarSatir(row)) variant = 'kirmizi';
            else if (rowMaviKenarSatir(row)) variant = 'mavi';
            ok.set(key + '|' + sira, variant);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== YESIL_ESLESME_AD) return true;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST3') return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad !== YESIL_ESLESME_AD) continue;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (sutun !== 'TEST3') continue;
                const variant = ok.get(key + '|' + s.k);
                if (!variant) continue;
                s.c = '#9e9e9e';
                delete s.v;
                if (variant === 'kirmizi') s.t3yk = true;
                else if (variant === 'mavi') s.t3ym = true;
                else s.t3y = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Şehir eşleşmesi: mavi Ş harfi + daire — satır rengine ve kenar çizgisine göre vurgu.
 */
function markSehirEslesmeGosterge(yildizlar, rowsByKey, G) {
    const ok = new Map();
    const LETTER = { mavi: '#1565c0', yesil: '#1b5e20', sari: '#f9a825' };
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowSehirEslesme(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let border = 'mavi';
            if (rowKirmiziKenarSatir(row)) border = 'kirmizi';
            else if (rowMaviKenarSatir(row)) border = 'mavi';
            let letter = 'mavi';
            if (rowSatirTamYesilKoyu(row)) letter = 'yesil';
            else if (rowSatirTamYesil(row)) letter = 'sari';
            ok.set(key + '|' + sira, { border, letter });
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            const sehirKept = new Set();
            w[win] = w[win].filter((s) => {
                if (!isSehirGostergeStar(s)) return true;
                if (!ok.has(key + '|' + s.k)) return false;
                const dk = key + '|' + s.k;
                if (sehirKept.has(dk)) return false;
                sehirKept.add(dk);
                return true;
            });
            for (const s of w[win]) {
                if (!isSehirGostergeStar(s)) continue;
                const info = ok.get(key + '|' + s.k);
                if (!info) continue;
                s.shs = true;
                s.c = LETTER[info.letter] || LETTER.mavi;
                delete s.v;
                if (info.border === 'kirmizi') s.shk = true;
                else s.shm = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * T1×DR en iyi 2: mavi T harfi + kare çerçeve — satır rengine ve kenar çizgisine göre vurgu.
 */
function markT1drEnIyiGosterge(yildizlar, rowsByKey, G) {
    const ok = new Map();
    const LETTER = { mavi: '#0288d1', yesil: '#1b5e20', sari: '#f9a825' };
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowT1drEnIyi(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let letter = 'mavi';
            if (rowSatirTamYesilKoyu(row)) letter = 'yesil';
            else if (rowSatirTamYesil(row)) letter = 'sari';
            let frame = 'mavi';
            if (rowSatirTamYesilKoyu(row)) frame = 'yesil';
            else if (rowSatirTamYesil(row)) frame = 'sari';
            else if (rowKirmiziKenarSatir(row)) frame = 'kirmizi';
            else if (rowMaviKenarSatir(row)) frame = 'mavi';
            ok.set(key + '|' + sira, { letter, frame });
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            const kept = new Set();
            w[win] = w[win].filter((s) => {
                if (!isT1drEnIyiGostergeStar(s)) return true;
                if (!ok.has(key + '|' + s.k)) return false;
                const dk = key + '|' + s.k;
                if (kept.has(dk)) return false;
                kept.add(dk);
                return true;
            });
            for (const s of w[win]) {
                if (!isT1drEnIyiGostergeStar(s)) continue;
                const info = ok.get(key + '|' + s.k);
                if (!info) continue;
                s.tei = true;
                s.c = LETTER[info.letter] || LETTER.mavi;
                delete s.v;
                if (info.frame === 'kirmizi') s.teik = true;
                else if (info.frame === 'yesil') s.teiy = true;
                else if (info.frame === 'sari') s.teis = true;
                else s.teim = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * TEST4=TEST6: açık mavi 4 rakamı + açık mavi fosforlu kare çerçeve (koşu başı tek).
 */
function markTest46Gosterge(yildizlar, rowsByKey, G) {
    const ok = new Set();
    const LETTER = '#4fc3f7';
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest46Equal(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            const kept = new Set();
            w[win] = w[win].filter((s) => {
                if (!isTest46GostergeStar(s)) return true;
                if (!ok.has(key + '|' + s.k)) return false;
                const dk = key + '|' + s.k;
                if (kept.has(dk)) return false;
                kept.add(dk);
                return true;
            });
            for (const s of w[win]) {
                if (!isTest46GostergeStar(s)) continue;
                if (!ok.has(key + '|' + s.k)) continue;
                s.t46 = true;
                s.c = LETTER;
                delete s.v;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * TEST1-TEST2 yakın: turuncu/kırmızı 2 rakamı + kare çerçeve — sahada en yakın 4 (en yakın kırmızı).
 */
function buildTest12ClosestTop4(calcRace, G, meta) {
    const hedefMesafe = G._hedefMesafe(calcRace);
    const calc = G._raceForCalc(calcRace, meta?.tarih || null);
    const pairs = [];
    for (let j = 0; j < calc.horses.length; j++) {
        const horse = calc.horses[j];
        const key = horseKey(horse);
        if (!key) continue;
        const kosularSorted = G._sortKosularNewest(horse.kosular || []);
        for (let idx = 0; idx < kosularSorted.length; idx++) {
            const atKosu = kosularSorted[idx];
            const sira = idx + 1;
            const { test1, test2 } = G._computeTestSalise(atKosu, hedefMesafe);
            if (test1 === null || test2 === null) continue;
            pairs.push({
                key,
                sira,
                fark: Math.abs(test1 - test2),
                test1,
                test2
            });
        }
    }
    pairs.sort((a, b) => {
        if (a.fark !== b.fark) return a.fark - b.fark;
        if (a.test1 !== b.test1) return a.test1 - b.test1;
        return a.test2 - b.test2;
    });
    const out = new Map();
    for (let t = 0; t < Math.min(4, pairs.length); t++) {
        const p = pairs[t];
        out.set(p.key + '|' + p.sira, t === 0 ? 'kirmizi' : 'turuncu');
    }
    return out;
}

function buildSon800Top3RankByKosuKey(calcRace, G) {
    const son800_1 = [];
    for (let j = 0; j < calcRace.horses.length; j++) {
        for (const atKosu of calcRace.horses[j].kosular || []) {
            const s1 = global.AtSpeedUtils?.dereceToSalise(atKosu.son800_bir);
            if (s1 !== null) son800_1.push({ j, atKosu, val: s1 });
        }
    }
    son800_1.sort((a, b) => (a.val !== b.val ? a.val - b.val : a.j - b.j));
    const rankByKosuKey = new Map();
    for (let t = 0; t < Math.min(3, son800_1.length); t++) {
        rankByKosuKey.set(G._kosuKey(son800_1[t].j, son800_1[t].atKosu), t + 1);
    }
    return rankByKosuKey;
}

function makeSon800GostergeStar(sira, rank, border) {
    const star = {
        c: SON800_RANK_COLORS[rank] || SON800_RANK_COLORS[3],
        t: SON800_1_TOP3_AD + ' · SON800-1 · ' + sira + '. koşu · #' + rank,
        ad: SON800_1_TOP3_AD,
        k: sira,
        s8: true,
        s8r: rank
    };
    if (border === 'kirmizi') star.s8k = true;
    else if (border === 'mavi') star.s8m = true;
    return star;
}

/**
 * SON800-1 koşu top-3: kare içinde 8 — 1. yeşil, 2. sarı, 3. kırmızı çerçeve;
 * mavi/kırmızı kenar satırda ilgili vurgu.
 */
function markSon800Top3Gosterge(yildizlar, rowsByKey, calcRace, G) {
    const rankByKosuKey = buildSon800Top3RankByKosuKey(calcRace, G);
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            const hi = row.meta?.horseIndex;
            if (hi == null) continue;
            const horse = calcRace.horses[hi];
            const kosularSorted = G._sortKosularNewest(horse?.kosular || []);
            const atKosu = kosularSorted[sira - 1];
            if (!atKosu) continue;
            const rank = rankByKosuKey.get(G._kosuKey(hi, atKosu));
            if (!rank) continue;
            let border = null;
            if (rowKirmiziKenarSatir(row)) border = 'kirmizi';
            else if (rowMaviKenarSatir(row)) border = 'mavi';
            ok.set(key + '|' + sira, { rank, border });
        }
    }
    const maxSiraForWin = { son7: 7, son2: 2, son1: 1 };
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            const limit = maxSiraForWin[win];
            w[win] = w[win].filter((s) => {
                if (!isSon800GostergeStar(s)) return true;
                return ok.has(key + '|' + s.k) && s.k <= limit;
            });
            const kept = new Set();
            w[win] = w[win].filter((s) => {
                if (!isSon800GostergeStar(s)) return true;
                const dk = key + '|' + s.k;
                if (kept.has(dk)) return false;
                kept.add(dk);
                return true;
            });
            for (const s of w[win]) {
                if (!isSon800GostergeStar(s)) continue;
                const info = ok.get(key + '|' + s.k);
                if (!info) continue;
                s.s8 = true;
                s.s8r = info.rank;
                s.c = SON800_RANK_COLORS[info.rank];
                delete s.v;
                delete s.s8k;
                delete s.s8m;
                if (info.border === 'kirmizi') s.s8k = true;
                else if (info.border === 'mavi') s.s8m = true;
            }
            for (const [mapKey, info] of ok) {
                const sep = mapKey.lastIndexOf('|');
                if (sep < 0) continue;
                const kKey = mapKey.slice(0, sep);
                const sira = parseInt(mapKey.slice(sep + 1), 10);
                if (kKey !== key) continue;
                if (isNaN(sira) || sira < 1 || sira > limit) continue;
                if (w[win].some((s) => isSon800GostergeStar(s) && s.k === sira)) continue;
                w[win].push(makeSon800GostergeStar(sira, info.rank, info.border));
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

function makeTest12YakinStar(sira, variant) {
    const COLORS = { kirmizi: '#d32f2f', turuncu: '#ff9800' };
    const star = {
        c: COLORS[variant] || COLORS.turuncu,
        t: TEST12_YAKIN_AD + ' · TEST1-2 · ' + sira + '. koşu',
        ad: TEST12_YAKIN_AD,
        k: sira,
        t12: true
    };
    if (variant === 'kirmizi') star.t12k = true;
    else star.t12o = true;
    return star;
}

function markTest12YakinGosterge(yildizlar, rowsByKey, calcRace, G, meta) {
    const top4 = buildTest12ClosestTop4(calcRace, G, meta);
    const maxSiraForWin = { son7: 7, son2: 2, son1: 1 };
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            const limit = maxSiraForWin[win];
            w[win] = w[win].filter((s) => {
                if (isTest12SariHucreStar(s)) return false;
                if (!isTest12YakinGostergeStar(s)) return true;
                if (win === 'son7') {
                    if (!top4.has(key + '|' + s.k)) return false;
                    return true;
                }
                return false;
            });
            if (win !== 'son7') continue;
            const kept = new Set();
            w[win] = w[win].filter((s) => {
                if (!isTest12YakinGostergeStar(s)) return true;
                const dk = key + '|' + s.k;
                if (kept.has(dk)) return false;
                kept.add(dk);
                return true;
            });
            for (const s of w[win]) {
                if (!isTest12YakinGostergeStar(s)) continue;
                const variant = top4.get(key + '|' + s.k);
                if (!variant) continue;
                s.t12 = true;
                s.c = variant === 'kirmizi' ? '#d32f2f' : '#ff9800';
                delete s.v;
                if (variant === 'kirmizi') {
                    s.t12k = true;
                    delete s.t12o;
                } else {
                    s.t12o = true;
                    delete s.t12k;
                }
            }
            for (const [mapKey, variant] of top4) {
                const sep = mapKey.lastIndexOf('|');
                if (sep < 0) continue;
                const kKey = mapKey.slice(0, sep);
                const sira = parseInt(mapKey.slice(sep + 1), 10);
                if (kKey !== key) continue;
                if (isNaN(sira) || sira < 1 || sira > limit) continue;
                if (w[win].some((s) => isTest12YakinGostergeStar(s) && s.k === sira)) continue;
                w[win].push(makeTest12YakinStar(sira, variant));
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Mor (TEST9) yıldızı: yalnızca TEST9 hücresinde test9-yanip-son-guclu olan koşular.
 */
function markTest9MorYildizlari(yildizlar, rowsByKey, G) {
    const ok = new Set();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest9Yanip(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (!isNaN(sira) && sira >= 1) ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== MOR_TEST9_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad === MOR_TEST9_AD && ok.has(key + '|' + s.k)) s.t9m = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Gri (8002-8001 sıfır) yıldızı: yalnızca FARK8002 hücresinde gri-kenar-fark8002-vurgu olan koşular.
 */
function markFark8002GriYildizlari(yildizlar, rowsByKey, G) {
    const ok = new Set();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowFark8002SifirVurgu(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (!isNaN(sira) && sira >= 1) ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== FARK8002_SIFIR_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad === FARK8002_SIFIR_AD && ok.has(key + '|' + s.k)) s.f8g = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Kahve (TEST5 sıfır) yıldızı: yalnızca TEST5 hücresinde kahve-test5-sifir-vurgu olan koşular.
 */
function markTest5KahveYildizlari(yildizlar, rowsByKey, G) {
    const ok = new Set();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowTest5KahveVurgu(G, row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (!isNaN(sira) && sira >= 1) ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== TEST5_KAHVE_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad === TEST5_KAHVE_AD && ok.has(key + '|' + s.k)) s.t5k = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Pembe (TEST en küçük) yıldızı: yalnızca TEST1/2/3 hücresinde pembe-test-enkucuk-vurgu olan koşular.
 */
function markTestEnKucukPembeYildizlari(yildizlar, rowsByKey, G) {
    const ok = new Set();
    const COL = G.COL;
    const cols = [COL.TEST1, COL.TEST2, COL.TEST3];
    const colAd = { [COL.TEST1]: 'TEST1', [COL.TEST2]: 'TEST2', [COL.TEST3]: 'TEST3' };
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            for (const c of cols) {
                const cls = G.getCellClass(c, row.classes);
                if (!isTestEnKucukPembe(cls)) continue;
                ok.add(key + '|' + sira + '|' + colAd[c]);
            }
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== TEST_EN_KUCUK_AD) return true;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                return ok.has(key + '|' + s.k + '|' + sutun);
            });
            for (const s of w[win]) {
                if (s.ad !== TEST_EN_KUCUK_AD) continue;
                const sutun = String(s.t || '').split(' · ')[1] || '';
                if (ok.has(key + '|' + s.k + '|' + sutun)) s.tkl = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Kırmızı kenar satır yıldızı: koşuda ne kadar varsa hepsi (tkr=true → koyu kahve yıldız + fosforlu kırmızı çerçeve).
 */
function markKirmiziKenarYildizlari(yildizlar, rowsByKey) {
    const ok = new Set();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowKirmiziKenarSatir(row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (!isNaN(sira) && sira >= 1) ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== KIRMIZI_KENAR_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad === KIRMIZI_KENAR_AD && ok.has(key + '|' + s.k)) s.tkr = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Mavi kenar satır yıldızı: koşuda ne kadar varsa hepsi (tmk=true → koyu kahve yıldız + fosforlu mavi çerçeve).
 */
function markMaviKenarYildizlari(yildizlar, rowsByKey) {
    const ok = new Set();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowMaviKenarSatir(row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (!isNaN(sira) && sira >= 1) ok.add(key + '|' + sira);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== MAVI_KENAR_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad === MAVI_KENAR_AD && ok.has(key + '|' + s.k)) s.tmk = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Satır tam sarı yıldızı: koşuda ne kadar varsa hepsi.
 * Yalnız sarı → tts · sarı+mavi kenar → ttsm · sarı+kırmızı kenar → ttsk
 */
function markSatirTamSariYildizlari(yildizlar, rowsByKey) {
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowSatirTamYesil(row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let variant = 'sari';
            if (rowKirmiziKenarSatir(row)) variant = 'kirmizi';
            else if (rowMaviKenarSatir(row)) variant = 'mavi';
            ok.set(key + '|' + sira, variant);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== SATIR_TAM_SARI_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad !== SATIR_TAM_SARI_AD) continue;
                const variant = ok.get(key + '|' + s.k);
                if (variant === 'kirmizi') s.ttsk = true;
                else if (variant === 'mavi') s.ttsm = true;
                else if (variant === 'sari') s.tts = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Satır tam yeşil yıldızı: koşuda ne kadar varsa hepsi.
 * Yalnız yeşil → tty · yeşil+mavi kenar → ttym · yeşil+kırmızı kenar → ttyk
 */
function markSatirTamYesilYildizlari(yildizlar, rowsByKey) {
    const ok = new Map();
    for (const [key, horseRows] of rowsByKey) {
        for (const row of horseRows) {
            if (!rowSatirTamYesilKoyu(row)) continue;
            const sira = parseInt(row.values[0], 10);
            if (isNaN(sira) || sira < 1) continue;
            let variant = 'yesil';
            if (rowKirmiziKenarSatir(row)) variant = 'kirmizi';
            else if (rowMaviKenarSatir(row)) variant = 'mavi';
            ok.set(key + '|' + sira, variant);
        }
    }
    for (const [key, w] of yildizlar) {
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== SATIR_TAM_YESIL_AD) return true;
                return ok.has(key + '|' + s.k);
            });
            for (const s of w[win]) {
                if (s.ad !== SATIR_TAM_YESIL_AD) continue;
                const variant = ok.get(key + '|' + s.k);
                if (variant === 'kirmizi') s.ttyk = true;
                else if (variant === 'mavi') s.ttym = true;
                else if (variant === 'yesil') s.tty = true;
            }
        }
        w.n7 = (w.son7 || []).length;
    }
}

/**
 * Son koşu T1×DR kırmızı yıldızı: yalnızca sahada en iyi 4 at (t4=true → mavi çerçeve + yanıp sönen vurgu).
 */
function markT1drSonKosuVurgu(yildizlar, rowsByKey, calcRace, G, meta) {
    const hedefMesafe = G._hedefMesafe(calcRace);
    const calc = G._raceForCalc(calcRace, meta?.tarih || null);
    const { enIyilerSonKosuT1drTop4 } = G.collectSonKosuT1drTop4(calc, hedefMesafe);
    const top4Keys = new Set();

    for (let j = 0; j < calc.horses.length; j++) {
        const horse = calc.horses[j];
        const key = horseKey(horse);
        if (!key) continue;
        const sonKosu = G._sortKosularNewest(horse.kosular || [])[0];
        if (!sonKosu) continue;
        const kosuKey = G._kosuKey(j, sonKosu);
        if (enIyilerSonKosuT1drTop4?.has(kosuKey)) top4Keys.add(key);
    }

    for (const [key, w] of yildizlar) {
        const inTop4 = top4Keys.has(key);
        for (const win of ['son7', 'son2', 'son1']) {
            if (!Array.isArray(w[win])) continue;
            w[win] = w[win].filter((s) => {
                if (s.ad !== T1DR_SON_KOSU_AD || s.k !== 1) return true;
                return inTop4;
            });
            if (inTop4) {
                for (const s of w[win]) {
                    if (s.ad === T1DR_SON_KOSU_AD && s.k === 1) s.t4 = true;
                }
            }
        }
        w.n7 = (w.son7 || []).length;
    }
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
    let ivme;
    try {
        const analysis = analyzeRace(race, meta);
        matched = analysis.matched;
        kirmizi = analysis.kirmizi;
        mor = analysis.mor;
        mavi = analysis.mavi;
        yesil = analysis.yesil;
        yesilSatir = analysis.yesilSatir;
        yildizlar = analysis.yildizlar;
        ivme = analysis.ivme;
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
        const ivmeSet = (key && ivme && ivme.get(key)) || null;
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
            yildizIvme: ivmeSet,
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
