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

function collectMatchingHorseKeys(race, meta) {
    ensureGosterimEngine();
    const G = global.GosterimEngine;
    if (!G) return new Set();

    const horses = (race.horses || []).map((h) => Object.assign({}, h, {
        kosular: h.kosular || []
    }));
    const calcRace = Object.assign({}, race, { horses });
    const rows = G.buildRaceRows(calcRace, {
        programTarih: meta?.tarih || null,
        hipodromSehir: meta?.hipodrom || '',
        raceIndex: 0
    });
    const COL = G.COL;
    const matched = new Set();

    for (const row of rows || []) {
        const t1dr = row.values[COL.TEST1_ENTEGRE];
        const test1 = row.values[COL.TEST1];
        if (!t1drEqualsTest1(t1dr, test1)) continue;
        const hi = row.meta?.horseIndex;
        const horse = hi != null ? calcRace.horses[hi] : null;
        const key = horse ? horseKey(horse) : null;
        if (key) matched.add(key);
    }
    return matched;
}

function annotateRaceHorses(race, meta) {
    if (!race?.horses?.length) return race;
    const hasHistory = race.horses.some((h) => (h.kosular || []).length > 0);
    if (!hasHistory) return race;

    let matched;
    try {
        matched = collectMatchingHorseKeys(race, meta);
    } catch (_) {
        return race;
    }

    const horses = race.horses.map((h) => {
        const key = horseKey(h);
        const flag = key && matched.has(key);
        if (!flag && !h.t1drTest1) return h;
        return Object.assign({}, h, { t1drTest1: !!flag });
    });
    return Object.assign({}, race, { horses });
}

function annotateKosular(kosular, meta) {
    return (kosular || []).map((race) => annotateRaceHorses(race, meta));
}

module.exports = {
    horseKey,
    t1drEqualsTest1,
    collectMatchingHorseKeys,
    annotateRaceHorses,
    annotateKosular
};
