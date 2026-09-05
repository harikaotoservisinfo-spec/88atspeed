/**
 * T1×DR=TEST1 eşleşmesi — panel KOŞU AT SAYISI sekmesi ile aynı mantık
 */
const { loadGostergeEngines } = require('../scripts/ptest-terminal-lib');

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
    if (!G) return { matched, kirmizi, mor, mavi, yesil };

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

    for (const row of rows || []) {
        const hi = row.meta?.horseIndex;
        const horse = hi != null ? calcRace.horses[hi] : null;
        const key = horse ? horseKey(horse) : null;
        if (!key) continue;
        const t1dr = row.values[COL.TEST1_ENTEGRE];
        const test1 = row.values[COL.TEST1];
        if (t1drEqualsTest1(t1dr, test1)) matched.add(key);
        if (row.values[0] === '1' && rowTest123Kirmizi(G, row)) kirmizi.add(key);
        if (row.values[0] === '1' && rowTest9Yanip(G, row)) mor.add(key);
        if (row.values[0] === '1' && rowFark8002Yanip(G, row)) mavi.add(key);
        // Son 7 yarışın (sira 1..7) HERHANGİ birinde TEST1 hücresi yeşilse
        const sira = parseInt(row.values[0], 10);
        if (!isNaN(sira) && sira >= 1 && sira <= 7 && rowTest1Green(G, row)) yesil.add(key);
    }
    return { matched, kirmizi, mor, mavi, yesil };
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
    try {
        const analysis = analyzeRace(race, meta);
        matched = analysis.matched;
        kirmizi = analysis.kirmizi;
        mor = analysis.mor;
        mavi = analysis.mavi;
        yesil = analysis.yesil;
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
        if (!flag && !kirmiziFlag && !morFlag && !maviFlag && !yesilFlag
            && !h.t1drTest1 && !h.test123Kirmizi && !h.test9Yanip && !h.fark8002Yanip && !h.test1Yesil) return h;
        return Object.assign({}, h, {
            t1drTest1: !!flag,
            test123Kirmizi: !!kirmiziFlag,
            test9Yanip: !!morFlag,
            fark8002Yanip: !!maviFlag,
            test1Yesil: !!yesilFlag
        });
    });
    return Object.assign({}, race, { horses });
}

function raceNeedsAnnotation(race, meta) {
    const horses = race?.horses || [];
    if (!horses.length) return false;
    if (!meta?.force && horses.every((h) => typeof h.t1drTest1 === 'boolean' && typeof h.test123Kirmizi === 'boolean' && typeof h.test9Yanip === 'boolean' && typeof h.fark8002Yanip === 'boolean' && typeof h.test1Yesil === 'boolean')) return false;
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
