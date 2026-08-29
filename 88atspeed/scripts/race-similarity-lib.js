/**
 * Koşu benzerlik / sınıflandırma — özellik çıkarımı, kümeleme, sonuç karşılaştırması
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    pct,
    pad,
    dbGet,
    dbAll,
    parsePuanlamaStore,
    rowKeyParts
} = require('./ptest-terminal-lib');

const KEY_METRICS = [
    { id: 'son8001', depthsKey: 'son8001Depths', label: 'SON800-1' },
    { id: 'son8002', depthsKey: 'son8002Depths', label: 'SON800-2' },
    { id: 'test1', depthsKey: 'test1Depths', label: 'TEST1' },
    { id: 'test2', depthsKey: 'test2Depths', label: 'TEST2' },
    { id: 'test3', depthsKey: 'test3Depths', label: 'TEST3' },
    { id: 't1dr', depthsKey: 't1drDepths', label: 'T1×DR' },
    { id: 'oran1', depthsKey: 'oran1Depths', label: '800-1 ORAN' },
    { id: 'ff', depthsKey: 'ffDepths', label: 'FFΔ' },
    { id: 'testsira', depthsKey: 'test123SiraliDepths', label: 'TEST·SIRA' }
];

const GAP_BUCKET_LABELS = [
    { id: 'g0', label: 'Δ0', test: g => g === 0 },
    { id: 'g5', label: 'Δ≤5', test: g => g > 0 && g <= 5 },
    { id: 'g10', label: 'Δ≤10', test: g => g > 5 && g <= 10 },
    { id: 'g15', label: 'Δ≤15', test: g => g > 10 && g <= 15 },
    { id: 'g20', label: 'Δ≤20', test: g => g > 15 && g <= 20 },
    { id: 'g25', label: 'Δ≤25', test: g => g > 20 && g <= 25 },
    { id: 'g25p', label: 'Δ25+', test: g => g > 25 }
];

const BS_BUCKET_LABELS = [
    { id: 'bs100', label: 'BS100', test: v => v === 100 },
    { id: 'bs95', label: 'BS95-99', test: v => v >= 95 && v <= 99 },
    { id: 'bs90', label: 'BS90-94', test: v => v >= 90 && v <= 94 },
    { id: 'bs80', label: 'BS80-89', test: v => v >= 80 && v <= 89 },
    { id: 'bs70', label: 'BS70-79', test: v => v >= 70 && v <= 79 },
    { id: 'bslo', label: 'BS<70', test: v => v != null && v < 70 }
];

const PCT_TIER_LABELS = [
    { id: 'p0', label: '%0', test: v => v === 0 },
    { id: 'p33', label: '%1-33', test: v => v > 0 && v <= 33 },
    { id: 'p66', label: '%34-66', test: v => v >= 34 && v <= 66 },
    { id: 'p100', label: '%67+', test: v => v >= 67 }
];

function loadSimilarityEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-gosterim-flags.js'), 'utf8'));
}

function gapBucket(gap) {
    if (gap == null || !Number.isFinite(gap)) return null;
    for (const b of GAP_BUCKET_LABELS) {
        if (b.test(gap)) return b;
    }
    return null;
}

function bsBucket(bs) {
    if (bs == null || !Number.isFinite(bs)) return null;
    for (const b of BS_BUCKET_LABELS) {
        if (b.test(bs)) return b;
    }
    return null;
}

function pctTier(p) {
    if (p == null || !Number.isFinite(p)) return null;
    for (const b of PCT_TIER_LABELS) {
        if (b.test(p)) return b;
    }
    return null;
}

function twinZeroTuruncu(cell, crossCell) {
    return cell?.gapPct === 0 && crossCell?.gapPct === 0;
}

function neonYesil(cell, crossCell) {
    if (cell?.gapPct == null || crossCell?.gapPct == null) return false;
    return cell.gapPct < 25 && crossCell.gapPct < 25 && !twinZeroTuruncu(cell, crossCell);
}

function extractCellSignature(cell, metricId, IE) {
    if (!cell) return null;
    const sig = {
        metricId,
        pct: cell.pct,
        gapPct: cell.gapPct,
        successPct: cell.successPct,
        visual: IE.classifyCellVisual(cell),
        toneBorder: IE.classifyRenderedToneBorder(cell),
        gapBucket: gapBucket(cell.gapPct),
        bsBucket: bsBucket(cell.successPct),
        pctTier: pctTier(cell.pct),
        flags: []
    };
    const g = cell.gosterim || {};
    for (const [k, v] of Object.entries(g)) {
        if (v) sig.flags.push(k);
    }
    return sig;
}

function extractHorseSignature(entry, IE) {
    const row = entry.row;
    const pkg = entry._pkg;
    const cells = {};
    const flagSet = new Set();
    const visualSet = new Set();
    const tokenSet = new Set();

    const depthKeys = pkg ? IE._pkgDepthKeys(pkg) : KEY_METRICS.map(m => m.depthsKey);

    for (const depthsKey of depthKeys) {
        const metricId = depthsKey.replace(/Depths$/, '');
        const cell = row[depthsKey]?.[0];
        if (!cell) continue;
        const sig = extractCellSignature(cell, metricId, IE);
        cells[metricId] = sig;
        if (sig.visual) {
            visualSet.add(metricId + ':' + sig.visual);
            tokenSet.add('V|' + metricId + '|' + sig.visual);
        }
        if (sig.gapBucket) tokenSet.add('G|' + metricId + '|' + sig.gapBucket.id);
        if (sig.bsBucket) tokenSet.add('B|' + metricId + '|' + sig.bsBucket.id);
        if (sig.pctTier) tokenSet.add('P|' + metricId + '|' + sig.pctTier.id);
        const tb = sig.toneBorder;
        if (tb.tone !== 'yok' || tb.border !== 'yok') {
            tokenSet.add('T|' + metricId + '|' + tb.tone + '_' + tb.border);
        }
        for (const f of sig.flags) {
            flagSet.add(metricId + ':' + f);
            tokenSet.add('F|' + metricId + '|' + f);
        }
        const trends = IE.computeDepthTrendHits(row[depthsKey], 3);
        for (const t of trends) {
            tokenSet.add('R|' + metricId + '|' + t.id);
        }
    }

    for (const m of KEY_METRICS) {
        const cell = row[m.depthsKey]?.[0];
        const cross = row.t1drDepths?.[0];
        if (cell && cross) {
            if (twinZeroTuruncu(cell, cross)) tokenSet.add('Δ|' + m.id + '|turuncuTwin0');
            if (neonYesil(cell, cross)) tokenSet.add('Δ|' + m.id + '|neonYesil');
        }
    }

    const rowCell = row.test1Depths?.[0] || row.son8001Depths?.[0];
    if (rowCell?.gosterim) {
        for (const [k, v] of Object.entries(rowCell.gosterim)) {
            if (v) {
                flagSet.add('row:' + k);
                tokenSet.add('ROW|' + k);
            }
        }
    }

    return {
        horseNo: row.no,
        horseName: row.name,
        cells,
        flagSet,
        visualSet,
        tokenSet,
        scalars: {
            sehir: row.sehir?.pct,
            genIlk1_3ay: row.genelIlk1?.ay3?.pct,
            smIlk1_15: row.smIlk1?.gun15?.pct
        }
    };
}

function countTokens(entries, pickSet) {
    const counts = {};
    for (const h of entries) {
        for (const t of pickSet(h)) {
            counts[t] = (counts[t] || 0) + 1;
        }
    }
    return counts;
}

function topCounts(counts, limit) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit || 8)
        .map(([k, n]) => ({ key: k, count: n }));
}

function isKeyToken(tok) {
    if (tok.startsWith('ROW|') || tok.startsWith('Δ|')) return true;
    const parts = tok.split('|');
    if (parts.length < 2) return false;
    return KEY_METRICS.some(m => m.id === parts[1]);
}

function filterKeyTokens(counts) {
    const out = {};
    for (const [k, v] of Object.entries(counts || {})) {
        if (isKeyToken(k)) out[k] = v;
    }
    return out;
}

function buildRaceProfile(raceKey, entries, host, IE) {
    const horses = entries.map(e => extractHorseSignature(e, IE));
    const fieldSize = entries.length;
    const visualCounts = countTokens(horses, h => {
        const s = new Set();
        for (const v of h.visualSet) {
            const metric = v.split(':')[0];
            if (KEY_METRICS.some(m => m.id === metric)) s.add(v);
        }
        return s;
    });
    const flagCounts = countTokens(horses, h => h.flagSet);
    const allTokenCounts = countTokens(horses, h => h.tokenSet);
    const tokenCounts = filterKeyTokens(allTokenCounts);

    const withBitis = entries.filter(e => {
        const b = host.bitisValueForSort(e);
        return b != null && b >= 1;
    });
    const winnerEntry = entries.find(e => host.bitisValueForSort(e) === 1);
    const winnerSig = winnerEntry ? extractHorseSignature(winnerEntry, IE) : null;

    let leaderBySon8001 = null;
    let bestSon = -1;
    for (const e of entries) {
        const p = e.row.son8001Depths?.[0]?.pct;
        if (p != null && p > bestSon) {
            bestSon = p;
            leaderBySon8001 = e;
        }
    }
    const leaderSonSig = leaderBySon8001 ? extractHorseSignature(leaderBySon8001, IE) : null;
    const leaderSonWon = leaderBySon8001 && winnerEntry
        && leaderBySon8001.row.no === winnerEntry.row.no;

    const topVisuals = topCounts(visualCounts, 6);
    const topTokens = topCounts(tokenCounts, 12);
    const topFlags = topCounts(flagCounts, 8);

    const archetypeParts = [
        fieldSize + 'at',
        topVisuals.slice(0, 3).map(v => v.key.replace(':', '×')).join('+') || 'renksiz',
        topTokens.slice(0, 4).map(t => t.key.split('|').slice(1).join('·')).join('+') || '—'
    ];
    const archetypeId = archetypeParts.join('|');
    const archetypeShort = fieldSize + 'at · ' + (topVisuals[0]?.key || '—')
        + (topTokens[0] ? ' · ' + topTokens[0].key : '');

    return {
        raceKey,
        kayitId: entries[0]?.kayitId,
        raceNo: entries[0]?.raceNo,
        hipodrom: entries[0]?.hipodrom,
        tarih: entries[0]?.tarih,
        fieldSize,
        horses,
        visualCounts,
        flagCounts,
        tokenCounts,
        topVisuals,
        topTokens,
        topFlags,
        archetypeId,
        archetypeShort,
        bitisCount: withBitis.length,
        hasWinner: !!winnerEntry,
        winnerSig,
        leaderSonSig,
        leaderSonWon,
        featureSet: new Set(Object.keys(allTokenCounts))
    };
}

async function buildFlatEntriesWithFlagsFromDb(db, filters) {
    filters = filters || {};
    const IE = global.IstatistikEngine;
    let bitisMap = {};
    try {
        const bitisRow = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (bitisRow?.veri) {
            bitisMap = parsePuanlamaStore(JSON.parse(bitisRow.veri)).bitis;
        }
    } catch (_) { /* ignore */ }

    let kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
    if (filters.filterKayit) kayitlar = kayitlar.filter(k => Number(k.id) === filters.filterKayit);

    const flat = [];
    for (const kayit of kayitlar) {
        let races;
        try {
            races = JSON.parse(kayit.veri);
        } catch (_) {
            continue;
        }
        if (!Array.isArray(races)) continue;

        const raceEntries = races.map((race, i) => {
            const raceNo = race.raceNo || (i + 1);
            const pkg = IE.buildRaceIstatistikPackage(race, kayit.hipodrom, kayit.tarih);
            IE.attachGosterimFlagsToPackage(pkg, race, kayit.hipodrom, kayit.tarih);
            return { race, raceNo, pkg };
        });
        if (raceEntries.length) IE.applyProgramGlobalPctScales(raceEntries.map(e => e.pkg));

        for (const { raceNo, pkg } of raceEntries) {
            if (filters.filterRace && Number(raceNo) !== filters.filterRace) continue;
            for (const row of pkg.rows) {
                const key = rowKeyParts(kayit.id, raceNo, row.no);
                const bitisRaw = bitisMap[key];
                const fromName = global.AtSpeedUtils.extractBitisFromHorseName(row.name);
                const bitisPos = bitisRaw != null && bitisRaw >= 1 ? bitisRaw : fromName;
                flat.push({
                    row,
                    tarih: kayit.tarih,
                    raceNo,
                    hipodrom: kayit.hipodrom,
                    kayitId: kayit.id,
                    _bitisPos: bitisPos != null && bitisPos >= 1 ? bitisPos : null,
                    _pkg: pkg
                });
            }
        }
    }
    return { flatEntries: flat, bitisMap };
}

function buildAllRaceProfiles(flatEntries, host) {
    const IE = global.IstatistikEngine;
    const groups = host.buildRaceEntryGroups();
    const profiles = [];
    for (const [raceKey, entries] of groups) {
        profiles.push(buildRaceProfile(raceKey, entries, host, IE));
    }
    return profiles;
}

function jaccard(setA, setB) {
    if (!setA.size && !setB.size) return 1;
    let inter = 0;
    for (const x of setA) {
        if (setB.has(x)) inter++;
    }
    const union = setA.size + setB.size - inter;
    return union ? inter / union : 0;
}

function clusterByArchetype(profiles) {
    const map = new Map();
    for (const p of profiles) {
        if (!map.has(p.archetypeId)) map.set(p.archetypeId, []);
        map.get(p.archetypeId).push(p);
    }
    return map;
}

function clusterByTokenOverlap(profiles, minJaccard) {
    minJaccard = minJaccard || 0.45;
    const clusters = [];
    const used = new Set();

    const sorted = profiles.slice().sort((a, b) => b.featureSet.size - a.featureSet.size);

    for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].raceKey)) continue;
        const seed = sorted[i];
        const cluster = [seed];
        used.add(seed.raceKey);

        for (let j = i + 1; j < sorted.length; j++) {
            const other = sorted[j];
            if (used.has(other.raceKey)) continue;
            if (Math.abs(other.fieldSize - seed.fieldSize) > 2) continue;
            const sim = jaccard(seed.featureSet, other.featureSet);
            if (sim >= minJaccard) {
                cluster.push(other);
                used.add(other.raceKey);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

function outcomeStats(cluster) {
    const withWinner = cluster.filter(p => p.hasWinner);
    const n = cluster.length;
    const nw = withWinner.length;
    if (!nw) {
        return { n, nw, leaderSonWinRate: null, winnerVisuals: [], winnerTokens: [] };
    }

    let leaderSonWins = 0;
    const winnerVisualCounts = {};
    const winnerTokenCounts = {};

    for (const p of withWinner) {
        if (p.leaderSonWon) leaderSonWins++;
        if (p.winnerSig) {
            for (const v of p.winnerSig.visualSet) {
                winnerVisualCounts[v] = (winnerVisualCounts[v] || 0) + 1;
            }
            for (const t of p.winnerSig.tokenSet) {
                winnerTokenCounts[t] = (winnerTokenCounts[t] || 0) + 1;
            }
        }
    }

    return {
        n,
        nw,
        leaderSonWinRate: leaderSonWins / nw,
        winnerVisuals: topCounts(winnerVisualCounts, 6),
        winnerTokens: topCounts(winnerTokenCounts, 8)
    };
}

function computeSimilarityValidation(profiles, sampleSize) {
    const byArchetype = clusterByArchetype(profiles);
    const multi = [...byArchetype.values()].filter(c => c.length >= 2);

    let withinSum = 0;
    let withinPairs = 0;
    for (const cluster of multi) {
        for (let i = 0; i < cluster.length; i++) {
            for (let j = i + 1; j < cluster.length; j++) {
                withinSum += jaccard(cluster[i].featureSet, cluster[j].featureSet);
                withinPairs++;
            }
        }
    }

    const all = profiles.filter(p => p.featureSet.size > 0);
    sampleSize = sampleSize || Math.min(800, all.length * 4);
    let betweenSum = 0;
    let betweenPairs = 0;
    for (let k = 0; k < sampleSize; k++) {
        const a = all[Math.floor(Math.random() * all.length)];
        const b = all[Math.floor(Math.random() * all.length)];
        if (a.raceKey === b.raceKey) continue;
        if (a.archetypeId === b.archetypeId) continue;
        betweenSum += jaccard(a.featureSet, b.featureSet);
        betweenPairs++;
    }

    return {
        withinAvg: withinPairs ? withinSum / withinPairs : null,
        betweenAvg: betweenPairs ? betweenSum / betweenPairs : null,
        withinPairs,
        betweenPairs,
        archetypeClusters: byArchetype.size,
        multiArchetypeClusters: multi.length
    };
}

function featureOutcomeCorrelation(profiles, minSample) {
    minSample = minSample || 5;
    const tokenTotals = {};
    const tokenWins = {};

    for (const p of profiles) {
        if (!p.hasWinner) continue;
        const winnerTokens = p.winnerSig?.tokenSet || new Set();
        for (const [tok, cnt] of Object.entries(p.tokenCounts)) {
            if (!isKeyToken(tok)) continue;
            if (!tokenTotals[tok]) tokenTotals[tok] = 0;
            tokenTotals[tok] += cnt;
        }
        for (const tok of winnerTokens) {
            if (!isKeyToken(tok)) continue;
            if (!tokenWins[tok]) tokenWins[tok] = 0;
            tokenWins[tok]++;
        }
    }

    const racesWithToken = {};
    for (const p of profiles) {
        if (!p.hasWinner) continue;
        for (const tok of Object.keys(p.tokenCounts)) {
            if (!isKeyToken(tok)) continue;
            if (!racesWithToken[tok]) racesWithToken[tok] = { races: 0, wins: 0 };
            racesWithToken[tok].races++;
            if (p.winnerSig?.tokenSet.has(tok)) racesWithToken[tok].wins++;
        }
    }

    const rows = [];
    for (const [tok, st] of Object.entries(racesWithToken)) {
        if (st.races < minSample) continue;
        rows.push({
            token: tok,
            races: st.races,
            wins: st.wins,
            winRate: st.wins / st.races,
            horses: tokenTotals[tok] || 0
        });
    }
    rows.sort((a, b) => b.winRate - a.winRate || b.races - a.races);
    return rows;
}

function formatToken(tok) {
    const parts = tok.split('|');
    if (parts.length < 2) return tok;
    const kind = parts[0];
    const map = { V: 'Renk', G: 'Δ', B: 'BS', P: '%', F: 'Bayrak', T: 'Ton', R: 'Trend', 'Δ': 'SON·Δ', ROW: 'Satır' };
    return (map[kind] || kind) + '·' + parts.slice(1).join('·');
}

module.exports = {
    loadSimilarityEngines,
    buildFlatEntriesWithFlagsFromDb,
    buildAllRaceProfiles,
    clusterByArchetype,
    clusterByTokenOverlap,
    outcomeStats,
    computeSimilarityValidation,
    featureOutcomeCorrelation,
    jaccard,
    formatToken,
    KEY_METRICS,
    pct,
    pad
};
