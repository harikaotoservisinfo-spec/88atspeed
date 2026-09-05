/**
 * Kamu Rehber — günlük tahmin sütunu liderlik tablosu (DB sonuçları, hızlı)
 */
const publicProgram = require('./public-program');
const sonucStore = require('./public-sonuc-store');
const yenibeygirBlt = require('./yenibeygir-blt');

const REHBER_COLS = [
    { id: 'r2', label: 'R2', type: 'score', scoreKey: 'r2' },
    { id: 'mtr', label: 'MTR', type: 'score', scoreKey: 'mtr' },
    { id: 't9v', label: 'T9V', type: 'score', scoreKey: 't9v' },
    { id: 'asf', label: 'ASF', type: 'score', scoreKey: 'asf' },
    { id: 'g1side', label: 'G1↕', type: 'score', scoreKey: 'g1side' },
    { id: 'g1pair', label: 'G1⇄', type: 'score', scoreKey: 'g1pair' },
    { id: 'go', label: 'GÖ', type: 'score', scoreKey: 'go' },
    { id: 'hyb', label: 'HYB', type: 'score', scoreKey: 'hyb' },
    { id: 'tahmin', label: 'TAHMİN', type: 'score', scoreKey: 'tahmin' },
    { id: 'blt', label: '@', type: 'blt' }
];

function initStats() {
    const stats = {};
    for (const col of REHBER_COLS) {
        stats[col.id] = {
            col,
            top1: { hits: 0, total: 0 },
            top2: { hits: 0, total: 0 },
            top3: { hits: 0, total: 0 }
        };
    }
    return stats;
}

function getActualFinishOrder(resultRace) {
    return (resultRace?.horses || [])
        .filter((h) => !h.kosmaz && h.sira != null && Number(h.sira) > 0)
        .sort((a, b) => Number(a.sira) - Number(b.sira))
        .map((h) => String(h.no));
}

function getScoreTopPicks(race, scoreKey, n) {
    const ranked = (race.horses || [])
        .map((h) => ({
            no: String(h.no),
            rank: h.scores?.[scoreKey]?.rank,
            pct: h.scores?.[scoreKey]?.pct
        }))
        .filter((x) => x.rank != null && x.rank > 0 && x.pct != null && x.pct > 0)
        .sort((a, b) => a.rank - b.rank || Number(a.no) - Number(b.no));
    return ranked.slice(0, n).map((x) => x.no);
}

function getBltTopPicks(raceNo, bltData, n) {
    const race = bltData?.races?.[String(raceNo)];
    if (!race) return [];
    const entries = Object.entries(race.byNo || {})
        .map(([no, val]) => ({
            no: String(no),
            v: parseFloat(String(val).replace(',', '.'))
        }))
        .filter((x) => !Number.isNaN(x.v))
        .sort((a, b) => b.v - a.v || Number(a.no) - Number(b.no));
    return entries.slice(0, n).map((x) => x.no);
}

function getColumnTopPicks(race, col, bltData) {
    if (col.type === 'blt') return getBltTopPicks(race.raceNo, bltData, 3);
    return getScoreTopPicks(race, col.scoreKey, 3);
}

function exactTopNMatch(picks, actual, n) {
    if (!picks.length || actual.length < n || picks.length < n) return false;
    for (let i = 0; i < n; i++) {
        if (picks[i] !== actual[i]) return false;
    }
    return true;
}

function computeLeaderboard(hipodromlar, sonucByHip, bltByHip) {
    const stats = initStats();
    let raceCount = 0;

    for (const hip of hipodromlar || []) {
        const stored = sonucByHip[hip.id];
        const blt = bltByHip[hip.id] || null;
        const resultByNo = new Map();
        for (const race of stored?.races || []) {
            if ((race.horses || []).length) resultByNo.set(String(race.raceNo), race);
        }

        for (const progRace of hip.kosular || []) {
            const resultRace = resultByNo.get(String(progRace.raceNo));
            if (!resultRace) continue;
            const actual = getActualFinishOrder(resultRace);
            if (!actual.length) continue;
            raceCount++;

            for (const col of REHBER_COLS) {
                const picks = getColumnTopPicks(progRace, col, blt);
                if (!picks.length) continue;
                const row = stats[col.id];

                if (actual.length >= 1 && picks.length >= 1) {
                    row.top1.total++;
                    if (exactTopNMatch(picks, actual, 1)) row.top1.hits++;
                }
                if (actual.length >= 2 && picks.length >= 2) {
                    row.top2.total++;
                    if (exactTopNMatch(picks, actual, 2)) row.top2.hits++;
                }
                if (actual.length >= 3 && picks.length >= 3) {
                    row.top3.total++;
                    if (exactTopNMatch(picks, actual, 3)) row.top3.hits++;
                }
            }
        }
    }

    return { stats, raceCount, columns: REHBER_COLS };
}

function sortTierRows(stats, tierKey) {
    return Object.values(stats)
        .filter((row) => row[tierKey].total > 0)
        .sort((a, b) => {
            const ah = a[tierKey].hits;
            const bh = b[tierKey].hits;
            if (bh !== ah) return bh - ah;
            const ap = ah / a[tierKey].total;
            const bp = bh / b[tierKey].total;
            if (bp !== ap) return bp - ap;
            return a.col.label.localeCompare(b.col.label, 'tr');
        })
        .map((row) => ({
            id: row.col.id,
            label: row.col.label,
            hits: row[tierKey].hits,
            total: row[tierKey].total,
            pct: row[tierKey].total
                ? Math.round((row[tierKey].hits / row[tierKey].total) * 100)
                : 0
        }));
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

async function buildRehberLeaderboard(db, opts = {}) {
    const iso = opts.iso || publicProgram.trToIso(opts.tarih);
    const tarih = opts.tarih || publicProgram.isoToTr(iso);
    if (!tarih) throw new Error('Geçersiz tarih');

    const vitrin = await publicProgram.getPublicVitrin(db, tarih, {
        tjkValidate: false,
        pruneDb: false,
        cacheOnlyTjk: true
    });
    const hipodromlar = vitrin.hipodromlar || [];

    const sonucByHip = {};
    for (const hip of hipodromlar) {
        const stored = await sonucStore.getStoredSonuclar(db, tarih, hip.id);
        if (stored?.races?.length) sonucByHip[hip.id] = stored;
    }

    const bltByHip = {};
    if (opts.includeBlt !== false) {
        await Promise.all(hipodromlar.map(async (hip) => {
            try {
                const blt = await withTimeout(
                    yenibeygirBlt.fetchBltForHipodrom({ iso, tarih, hipodrom: hip.name }),
                    opts.bltTimeoutMs || 6000
                );
                if (blt?.races) bltByHip[hip.id] = blt;
            } catch (_) {
                /* @ sütunu o hipodromda atlanır */
            }
        }));
    }

    const { stats, raceCount } = computeLeaderboard(hipodromlar, sonucByHip, bltByHip);
    const finishedHipCount = Object.keys(sonucByHip).length;

    return {
        success: true,
        tarih,
        iso: publicProgram.trToIso(tarih),
        hipodromCount: hipodromlar.length,
        finishedHipCount,
        raceCount,
        top1: sortTierRows(stats, 'top1'),
        top2: sortTierRows(stats, 'top2'),
        top3: sortTierRows(stats, 'top3'),
        updatedAt: new Date().toISOString()
    };
}

module.exports = {
    REHBER_COLS,
    buildRehberLeaderboard,
    computeLeaderboard
};
