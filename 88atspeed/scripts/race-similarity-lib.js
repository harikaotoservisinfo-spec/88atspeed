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

/** attachGosterimFlagsToPackage aynı bayrak nesnesini tüm hücrelere kopyalar — F|metrik| bayrağı gürültü */
const ROW_PROPAGATED_FLAGS = new Set([
    'kirmiziKenar', 'maviKenar', 'maviKenarSira', 'maviKenarSon800',
    'yesilSatir', 'gucluUyari', 'maviFosfor', 'pembeSatir', 'kirmiziTest',
    'sariTest12', 'test1EnIyi', 'test2EnIyi', 'test3EnIyi', 'sehirEslesme',
    'mesafeEslesme', 'test23Yanip', 't1drKirmizi', 't1drEnIyi2'
]);

const METRIC_TOKEN_PREFIXES = new Set(['V', 'G', 'B', 'P', 'T', 'R', 'Δ']);

const DEEP_TEN_METRICS = [
    { id: 'son8001', label: 'SON800-1' },
    { id: 'test1', label: 'TEST1' },
    { id: 't1dr', label: 'T1×DR' }
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
            if (ROW_PROPAGATED_FLAGS.has(f)) continue;
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
        rowFlagSet: new Set([...tokenSet].filter(t => t.startsWith('ROW|'))),
        metricTokenSet: new Set([...tokenSet].filter(t => isMetricSpecificToken(t))),
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

function isMetricSpecificToken(tok) {
    if (!tok || tok.startsWith('ROW|')) return false;
    const kind = tok.split('|')[0];
    return METRIC_TOKEN_PREFIXES.has(kind);
}

function isRowFlagToken(tok) {
    return tok.startsWith('ROW|');
}

function isCorrelationToken(tok) {
    return isMetricSpecificToken(tok) || isRowFlagToken(tok);
}

function isKeyToken(tok) {
    if (isRowFlagToken(tok)) return true;
    if (!isMetricSpecificToken(tok)) return false;
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

function filterMetricOnlyTokens(counts) {
    const out = {};
    for (const [k, v] of Object.entries(counts || {})) {
        if (isMetricSpecificToken(k) && isKeyToken(k)) out[k] = v;
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
    const metricTokenCounts = filterMetricOnlyTokens(allTokenCounts);
    const rowFlagCounts = countTokens(horses, h => h.rowFlagSet || new Set());

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
    const topTokens = topCounts(metricTokenCounts, 12);
    const topRowFlags = topCounts(rowFlagCounts, 6);
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
        metricTokenCounts,
        rowFlagCounts,
        topVisuals,
        topTokens,
        topRowFlags,
        topFlags,
        archetypeId,
        archetypeShort,
        bitisCount: withBitis.length,
        hasWinner: !!winnerEntry,
        winnerSig,
        leaderSonSig,
        leaderSonWon,
        featureSet: new Set(Object.keys(tokenCounts).filter(isCorrelationToken))
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

function featureOutcomeCorrelation(profiles, minSample, opts) {
    opts = opts || {};
    const metricOnly = opts.metricOnly !== false;
    minSample = minSample || 5;
    const tokenTotals = {};
    const tokenWins = {};

    for (const p of profiles) {
        if (!p.hasWinner) continue;
        const winnerTokens = p.winnerSig?.tokenSet || new Set();
        const counts = metricOnly ? p.metricTokenCounts : p.tokenCounts;
        for (const [tok, cnt] of Object.entries(counts)) {
            if (!isCorrelationToken(tok)) continue;
            if (metricOnly && !isMetricSpecificToken(tok)) continue;
            if (!tokenTotals[tok]) tokenTotals[tok] = 0;
            tokenTotals[tok] += cnt;
        }
        for (const tok of winnerTokens) {
            if (!isCorrelationToken(tok)) continue;
            if (metricOnly && !isMetricSpecificToken(tok)) continue;
            if (!tokenWins[tok]) tokenWins[tok] = 0;
            tokenWins[tok]++;
        }
    }

    const racesWithToken = {};
    for (const p of profiles) {
        if (!p.hasWinner) continue;
        const counts = metricOnly ? p.metricTokenCounts : p.tokenCounts;
        for (const tok of Object.keys(counts)) {
            if (!isCorrelationToken(tok)) continue;
            if (metricOnly && !isMetricSpecificToken(tok)) continue;
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

function rowFlagOutcomeCorrelation(profiles, minSample) {
    return featureOutcomeCorrelation(profiles, minSample, { metricOnly: false })
        .filter(r => isRowFlagToken(r.token));
}

function metricCellSlice(sig, metricId) {
    const cell = sig?.cells?.[metricId];
    if (!cell) return null;
    return {
        visual: cell.visual || '—',
        gap: cell.gapBucket?.label || '—',
        bs: cell.bsBucket?.label || '—',
        pct: cell.pctTier?.label || '—',
        tone: cell.toneBorder?.tone !== 'yok' ? cell.toneBorder.tone : '—',
        border: cell.toneBorder?.border !== 'yok' ? cell.toneBorder.border : '—'
    };
}

function deltaTagsForMetric(tokenSet, metricId) {
    const tags = [];
    if (tokenSet.has('Δ|' + metricId + '|turuncuTwin0')) tags.push('turuncuTwin0');
    if (tokenSet.has('Δ|' + metricId + '|neonYesil')) tags.push('neonYesil');
    return tags.length ? tags.join('+') : '—';
}

function buildDeepTenComboKey(winnerSig) {
    const parts = [];
    for (const m of DEEP_TEN_METRICS) {
        const slice = metricCellSlice(winnerSig, m.id);
        parts.push(m.label + ':' + (slice ? slice.visual + '/' + slice.gap + '/' + slice.bs : '—/—/—'));
        parts.push('Δ' + m.label + ':' + deltaTagsForMetric(winnerSig.tokenSet, m.id));
    }
    return parts.join(' · ');
}

function buildDeepTenFieldDominant(profile) {
    const dom = {};
    for (const m of DEEP_TEN_METRICS) {
        const visualCounts = {};
        for (const h of profile.horses) {
            const v = h.cells[m.id]?.visual;
            if (v) visualCounts[v] = (visualCounts[v] || 0) + 1;
        }
        const top = topCounts(visualCounts, 1)[0];
        dom[m.id] = top ? top.key + '×' + top.count : '—';
    }
    return dom;
}

function winnerVsFieldAnalysis(profiles, minSample) {
    minSample = minSample || 5;
    const stats = {};

    for (const p of profiles) {
        if (!p.hasWinner || !p.winnerSig) continue;
        const winnerTokens = p.winnerSig.tokenSet;
        const fieldSize = p.fieldSize;

        for (const [tok] of Object.entries(p.metricTokenCounts)) {
            if (!isMetricSpecificToken(tok)) continue;
            if (!stats[tok]) {
                stats[tok] = {
                    token: tok,
                    racesInField: 0,
                    winnerHas: 0,
                    winnerLacks: 0,
                    fieldHorseTotal: 0,
                    winnerRankSum: 0,
                    winnerRankCount: 0,
                    leaderHas: 0,
                    leaderLacks: 0
                };
            }
            const st = stats[tok];
            st.racesInField++;
            st.fieldHorseTotal += p.metricTokenCounts[tok] || 0;

            const horsesWith = p.horses.filter(h => h.tokenSet.has(tok)).length;
            const winnerHas = winnerTokens.has(tok);
            if (winnerHas) st.winnerHas++;
            else st.winnerLacks++;

            if (horsesWith > 0) {
                const sorted = p.horses
                    .map(h => ({ h, has: h.tokenSet.has(tok) }))
                    .filter(x => x.has);
                const winnerIdx = sorted.findIndex(x => x.h.horseNo === p.winnerSig.horseNo);
                if (winnerIdx >= 0) {
                    st.winnerRankSum += (winnerIdx + 1) / sorted.length;
                    st.winnerRankCount++;
                }
            }

            if (p.leaderSonSig) {
                if (p.leaderSonSig.tokenSet.has(tok)) st.leaderHas++;
                else st.leaderLacks++;
            }
        }

        for (const [tok] of Object.entries(p.rowFlagCounts || {})) {
            if (!isRowFlagToken(tok)) continue;
            if (!stats[tok]) {
                stats[tok] = {
                    token: tok,
                    racesInField: 0,
                    winnerHas: 0,
                    winnerLacks: 0,
                    fieldHorseTotal: 0,
                    winnerRankSum: 0,
                    winnerRankCount: 0,
                    leaderHas: 0,
                    leaderLacks: 0
                };
            }
            const st = stats[tok];
            st.racesInField++;
            st.fieldHorseTotal += p.rowFlagCounts[tok] || 0;

            if (winnerTokens.has(tok)) st.winnerHas++;
            else st.winnerLacks++;

            const horsesWith = p.horses.filter(h => h.tokenSet.has(tok)).length;
            if (horsesWith > 0 && winnerTokens.has(tok)) {
                const sorted = p.horses.filter(h => h.tokenSet.has(tok));
                const winnerIdx = sorted.findIndex(h => h.horseNo === p.winnerSig.horseNo);
                if (winnerIdx >= 0) {
                    st.winnerRankSum += (winnerIdx + 1) / sorted.length;
                    st.winnerRankCount++;
                }
            }

            if (p.leaderSonSig) {
                if (p.leaderSonSig.tokenSet.has(tok)) st.leaderHas++;
                else st.leaderLacks++;
            }
        }
    }

    const rows = [];
    for (const st of Object.values(stats)) {
        if (st.racesInField < minSample) continue;
        const winnerHasRate = st.winnerHas / st.racesInField;
        const winnerLacksRate = st.winnerLacks / st.racesInField;
        const avgFieldCount = st.fieldHorseTotal / st.racesInField;
        const avgWinnerRank = st.winnerRankCount ? st.winnerRankSum / st.winnerRankCount : null;
        const leaderMatchRate = (st.leaderHas + st.leaderLacks)
            ? st.leaderHas / (st.leaderHas + st.leaderLacks) : null;

        rows.push({
            token: st.token,
            races: st.racesInField,
            winnerHas: st.winnerHas,
            winnerLacks: st.winnerLacks,
            winnerHasRate,
            winnerLacksRate,
            avgFieldCount,
            avgWinnerRank,
            leaderMatchRate,
            divergence: winnerLacksRate - winnerHasRate
        });
    }

    return {
        differentProfile: rows.slice().sort((a, b) => b.divergence - a.divergence || b.races - a.races),
        winnerAligned: rows.slice().sort((a, b) => b.winnerHasRate - a.winnerHasRate || b.races - a.races),
        leaderAligned: rows.slice().sort((a, b) => (b.leaderMatchRate || 0) - (a.leaderMatchRate || 0) || b.races - a.races)
    };
}

function deepTenHorseReport(profiles, minSample) {
    minSample = minSample || 2;
    const tenAt = profiles.filter(p => p.fieldSize === 10 && p.hasWinner);
    const comboStats = {};
    const crossTabs = {
        son8001_to_test1: {},
        son8001_to_t1dr: {},
        fieldSon_to_winnerTest: {}
    };

    for (const p of tenAt) {
        const w = p.winnerSig;
        const comboKey = buildDeepTenComboKey(w);
        if (!comboStats[comboKey]) {
            comboStats[comboKey] = { combo: comboKey, races: 0, wins: 0, examples: [] };
        }
        comboStats[comboKey].races++;
        comboStats[comboKey].wins++;
        if (comboStats[comboKey].examples.length < 3) {
            comboStats[comboKey].examples.push(
                p.hipodrom + ' ' + p.tarih + ' K' + p.raceNo + ' #' + w.horseNo
            );
        }

        const wSon = metricCellSlice(w, 'son8001');
        const wTest = metricCellSlice(w, 'test1');
        const wDr = metricCellSlice(w, 't1dr');
        const dom = buildDeepTenFieldDominant(p);

        if (wSon && wTest) {
            const k = wSon.visual + ' → ' + wTest.visual;
            crossTabs.son8001_to_test1[k] = (crossTabs.son8001_to_test1[k] || 0) + 1;
        }
        if (wSon && wDr) {
            const k = wSon.visual + ' → ' + wDr.visual;
            crossTabs.son8001_to_t1dr[k] = (crossTabs.son8001_to_t1dr[k] || 0) + 1;
        }
        const fieldSon = dom.son8001?.split('×')[0] || '—';
        const k2 = 'Saha:' + fieldSon + ' → Kazanan TEST1:' + (wTest?.visual || '—');
        crossTabs.fieldSon_to_winnerTest[k2] = (crossTabs.fieldSon_to_winnerTest[k2] || 0) + 1;
    }

    const metricBreakdown = {};
    for (const m of DEEP_TEN_METRICS) {
        const visualWins = {};
        const gapWins = {};
        const bsWins = {};
        const deltaWins = {};
        for (const p of tenAt) {
            const slice = metricCellSlice(p.winnerSig, m.id);
            if (slice) {
                visualWins[slice.visual] = (visualWins[slice.visual] || 0) + 1;
                gapWins[slice.gap] = (gapWins[slice.gap] || 0) + 1;
                bsWins[slice.bs] = (bsWins[slice.bs] || 0) + 1;
            }
            const dTag = deltaTagsForMetric(p.winnerSig.tokenSet, m.id);
            deltaWins[dTag] = (deltaWins[dTag] || 0) + 1;
        }
        metricBreakdown[m.id] = {
            label: m.label,
            n: tenAt.length,
            visuals: topCounts(visualWins, 8),
            gaps: topCounts(gapWins, 8),
            bs: topCounts(bsWins, 8),
            deltas: topCounts(deltaWins, 6)
        };
    }

    const comboRows = Object.values(comboStats)
        .filter(c => c.races >= minSample)
        .sort((a, b) => b.races - a.races || b.wins - a.wins);

    const leaderSonWins = tenAt.filter(p => p.leaderSonWon).length;

    return {
        raceCount: tenAt.length,
        leaderSonWinRate: tenAt.length ? leaderSonWins / tenAt.length : null,
        comboRows,
        metricBreakdown,
        crossTabs: {
            son8001_to_test1: topCounts(crossTabs.son8001_to_test1, 10),
            son8001_to_t1dr: topCounts(crossTabs.son8001_to_t1dr, 10),
            fieldSon_to_winnerTest: topCounts(crossTabs.fieldSon_to_winnerTest, 10)
        },
        allCombos: Object.values(comboStats).sort((a, b) => b.races - a.races)
    };
}

function noiseFilterReport(profiles) {
    let wouldBeDuplicates = 0;
    const removedExamples = {};

    for (const p of profiles) {
        for (const h of p.horses) {
            const keyMetricCells = KEY_METRICS.filter(m => h.cells[m.id]).length;
            for (const t of h.rowFlagSet || []) {
                const flag = t.split('|')[1];
                wouldBeDuplicates += keyMetricCells;
                removedExamples[flag] = (removedExamples[flag] || 0) + keyMetricCells;
            }
        }
    }

    return {
        rowPropagatedFlags: [...ROW_PROPAGATED_FLAGS],
        suppressedDuplicateTokens: wouldBeDuplicates,
        removedFlagExamples: topCounts(removedExamples, 8),
        note: 'Korelasyon artık yalnızca V|G|B|P|T|R|Δ metrik tokenları + ROW| satır bayrakları kullanır; F|metrik|satırBayrağı gürültüsü çıkarıldı'
    };
}

function formatToken(tok) {
    const parts = tok.split('|');
    if (parts.length < 2) return tok;
    const kind = parts[0];
    const map = {
        V: 'Renk', G: 'Δ', B: 'BS', P: '%', F: 'Bayrak', T: 'Ton',
        R: 'Trend', 'Δ': 'SON·Δ', ROW: 'Satır'
    };
    const flagLabels = {
        t1drKirmizi: 'T1×DR kırmızı', sehirEslesme: 'şehir eşleşme',
        test1EnIyi: 'TEST1 en iyi', maviKenar: 'mavi kenar',
        kirmiziKenar: 'kırmızı kenar', yesilSatir: 'yeşil satır'
    };
    if (kind === 'ROW' && flagLabels[parts[1]]) {
        return 'Satır·' + flagLabels[parts[1]];
    }
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
    rowFlagOutcomeCorrelation,
    winnerVsFieldAnalysis,
    deepTenHorseReport,
    noiseFilterReport,
    isMetricSpecificToken,
    isRowFlagToken,
    isCorrelationToken,
    jaccard,
    formatToken,
    KEY_METRICS,
    DEEP_TEN_METRICS,
    ROW_PROPAGATED_FLAGS,
    pct,
    pad
};
