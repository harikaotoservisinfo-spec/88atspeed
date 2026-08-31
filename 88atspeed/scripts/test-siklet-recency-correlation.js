#!/usr/bin/env node
/**
 * SİKLET — TÜM vs S5→S1 pencere analizi + BİTİŞ korelasyonu (at-at)
 *
 * Genel SK% ile son 5/4/3/2/1 koşu pencereleri karşılaştırılır.
 * Yükselen form (S1 > TÜM) tespiti ve 1. olma korelasyonu raporlanır.
 *
 *   node scripts/test-siklet-recency-correlation.js --kayit 148
 *   node scripts/test-siklet-recency-correlation.js --kayit 148 --race 7
 *   node scripts/test-siklet-recency-correlation.js --kayit 148 --rising-only
 *   node scripts/test-siklet-recency-correlation.js --kayit 148 --horse PATARA -v
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    rowKeyParts,
    openDb,
    dbGet,
    pct,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 148,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseName: argVal('--horse') || '',
    risingOnly: args.includes('--rising-only'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    deltaMin: argVal('--delta-min') ? Number(argVal('--delta-min')) : 5,
    minSkKosu: argVal('--min-sk-kosu') ? Number(argVal('--min-sk-kosu')) : 2
};

const WINDOWS = [null, 5, 4, 3, 2, 1];
const WINDOW_LABELS = { null: 'TÜM', 5: 'S5', 4: 'S4', 3: 'S3', 2: 'S2', 1: 'S1' };
const METRICS = [
    { key: 'matchPct', label: 'SK%', leader: true },
    { key: 'matchCount', label: 'SK-KOŞU', leader: true },
    { key: 'cnt1', label: '1.', leader: true },
    { key: 'cnt123', label: '1-2-3', leader: true }
];

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function loadEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function windowLabel(w) {
    return WINDOW_LABELS[w];
}

function recencyTrendLabel(delta) {
    if (delta == null || isNaN(delta)) return '—';
    if (delta >= 20) return '↑↑ güçlü';
    if (delta >= cli.deltaMin) return '↑ yükseliş';
    if (delta <= -20) return '↓↓ düşüş';
    if (delta <= -cli.deltaMin) return '↓ zayıflama';
    return '≈ sabit';
}

function linearRecencySlope(scoresByWindow) {
    const xMap = { TÜM: 0, S5: 1, S4: 2, S3: 3, S2: 4, S1: 5 };
    const pts = [];
    for (const w of WINDOWS) {
        const lbl = windowLabel(w);
        const y = scoresByWindow[lbl];
        if (y == null) continue;
        pts.push({ x: xMap[lbl], y });
    }
    if (pts.length < 3) return null;
    const n = pts.length;
    const sx = pts.reduce((a, p) => a + p.x, 0);
    const sy = pts.reduce((a, p) => a + p.y, 0);
    const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
    const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    return (n * sxy - sx * sy) / denom;
}

function pickScoredLeader(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || (a.no ?? 0) - (b.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function rankArray(arr) {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let j = 0; j < sorted.length; j++) {
        let tieEnd = j;
        while (tieEnd + 1 < sorted.length && sorted[tieEnd + 1].v === sorted[j].v) tieEnd++;
        const avgRank = (j + tieEnd) / 2 + 1;
        for (let k = j; k <= tieEnd; k++) ranks[sorted[k].i] = avgRank;
        j = tieEnd;
    }
    return ranks;
}

function spearmanFromPairs(pairs) {
    if (pairs.length < 3) return null;
    const xs = pairs.map(p => p.x);
    const ys = pairs.map(p => p.y);
    const rx = rankArray(xs);
    const ry = rankArray(ys);
    const n = pairs.length;
    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
        const d = rx[i] - ry[i];
        sumD2 += d * d;
    }
    return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function fmtPct100(v) {
    return v != null && Number.isFinite(v) ? v.toFixed(1) + '%' : '—';
}

function fmtWinRate(s) {
    if (!s?.n) return '—';
    return s.win1 + '/' + s.n + ' (' + fmtPct100(s.pct1) + ')';
}

/** TÜM'de ≥2 hedef sıklet eşleşmesi — tek SK-KOŞU artefaktını ele */
function isMeaningfulRecency(h) {
    return h.recencyComparable && h.matchCount >= cli.minSkKosu;
}

function isSingleSkArtifact(h) {
    return h.recencyComparable && h.matchCount === 1;
}

function getWindowStats(st, w) {
    if (w == null) return st;
    return st.windows?.[w] || null;
}

/** Pencerede en az 1 geçerli sıklet koşusu var mı */
function windowFilled(h, w) {
    const ws = getWindowStats(h.st, w);
    return ws != null && ws.kosuSayisi > 0;
}

/** SİKLET sekmesi dolu — geçmiş koşu + hedef sıklet */
function isSkFilled(h) {
    return h.kosuSayisi > 0 && h.hedef && h.hedef !== '—';
}

/** TÜM ve S1 pencereleri dolu — yükseliş kıyası için */
function isRecencyComparable(h) {
    return isSkFilled(h)
        && windowFilled(h, null)
        && windowFilled(h, 1)
        && h.skByWindow.TÜM != null
        && h.skByWindow.S1 != null;
}

function metricValue(h, w, key) {
    if (!windowFilled(h, w)) return null;
    const ws = getWindowStats(h.st, w);
    const v = ws?.[key];
    return v != null && v !== '' ? Number(v) : null;
}

function buildRaceGroups(horses, predicate) {
    const map = new Map();
    for (const h of horses.filter(predicate)) {
        const rk = String(h.raceNo);
        if (!map.has(rk)) map.set(rk, []);
        map.get(rk).push(h);
    }
    return [...map.values()];
}

function parseSira(s) {
    return FieldSizeStatsEngine.parseSira(s);
}

function resolveBitis(kayitId, raceNo, horse, bitisLookup) {
    const key = rowKeyParts(kayitId, raceNo, horse.no);
    if (bitisLookup.has(key)) {
        const b = bitisLookup.get(key);
        if (b != null && b >= 1) return b;
    }
    const fromName = global.AtSpeedUtils.extractBitisFromHorseName(horse.name);
    return fromName != null && fromName >= 1 ? fromName : null;
}

function buildHorseRow(ctx, bitisLookup) {
    const { horse, race, kayitId, hipodrom, tarih, programTarih } = ctx;
    const dim = KosuDimensionStatsEngine.DIMENSIONS.siklet;
    const kosular = horse.kosular || [];
    const horseCtx = Object.assign({}, horse, { kosular });
    const hedef = dim.getTarget(horseCtx, race);
    const prog = programTarih || tarih;
    const st = KosuDimensionStatsEngine.computeStats(kosular, 'siklet', hedef, prog);

    const hedefAbbrev = dim.abbrev(hedef);

    const skByWindow = {};
    const cnt1ByWindow = {};
    for (const w of WINDOWS) {
        const ws = getWindowStats(st, w);
        skByWindow[windowLabel(w)] = windowFilled({ st }, w) ? (ws?.matchPct ?? null) : null;
        cnt1ByWindow[windowLabel(w)] = windowFilled({ st }, w) ? (ws?.cnt1 ?? null) : null;
    }

    const rowDraft = {
        st,
        skByWindow,
        kosuSayisi: st.kosuSayisi,
        hedef: hedefAbbrev
    };
    const deltaSk = isRecencyComparable(rowDraft)
        ? skByWindow.S1 - skByWindow.TÜM : null;
    const slope = linearRecencySlope(skByWindow);
    const matchCount = st.matchCount;
    const recencyComparable = isRecencyComparable(rowDraft);
    const meaningful = isMeaningfulRecency({ recencyComparable, matchCount });
    const singleSkArtifact = isSingleSkArtifact({ recencyComparable, matchCount });
    const trend = singleSkArtifact ? '⚠ tek SK' : recencyTrendLabel(deltaSk);

    const bitis = resolveBitis(kayitId, race.raceNo, horse, bitisLookup);

    const sorted = FieldSizeStatsEngine.sortKosularNewest(kosular);
    const sonKosu = sorted[0] || null;
    const sonSira = sonKosu ? parseSira(sonKosu.sira) : null;
    const sonMatch = sonKosu ? dim.match(sonKosu.siklet, hedef) : false;
    const s1 = st.windows?.[1];

    return {
        kayitId,
        raceNo: race.raceNo,
        no: horse.no,
        name: horse.name,
        atId: horse.atId,
        hedef: hedefAbbrev,
        bitis,
        st,
        skByWindow,
        cnt1ByWindow,
        deltaSk,
        slope,
        trend,
        rising: meaningful && deltaSk != null && deltaSk >= cli.deltaMin,
        skFilled: isSkFilled(rowDraft),
        recencyComparable,
        meaningfulRecency: meaningful,
        singleSkArtifact,
        sonKosu,
        sonSira,
        sonMatch,
        s1Sk: s1?.matchPct ?? null,
        s1Cnt1: s1?.cnt1 ?? null,
        s1Cnt123: s1?.cnt123 ?? null,
        s1MatchStr: s1?.gecmisMatchStr ?? '—',
        tumSk: skByWindow.TÜM,
        tumCnt1: st.cnt1,
        kosuSayisi: st.kosuSayisi,
        matchCount: st.matchCount,
        hipodrom,
        tarih
    };
}

function evaluateWindowLeader(raceGroups, getScore, minScored = 2) {
    let total = 0, b1 = 0, b12 = 0, b123 = 0, tie = 0, skipped = 0;
    for (const horses of raceGroups) {
        const scored = horses.map(h => ({
            horse: h,
            score: getScore(h),
            no: h.no
        })).filter(s => s.score != null);
        if (scored.length < minScored) {
            skipped++;
            continue;
        }
        const leader = pickScoredLeader(scored);
        if (!leader) { tie++; continue; }
        const bit = leader.horse.bitis;
        if (bit == null || bit < 1) continue;
        total++;
        if (bit === 1) b1++;
        if (bit <= 2) b12++;
        if (bit <= 3) b123++;
    }
    const blended = total ? (0.80 * b1 + 0.12 * (b12 - b1) + 0.08 * (b123 - b12)) / total : 0;
    return { total, tie, skipped, b1, b12, b123, leaderBlended: blended, exactRate: total ? b1 / total : 0 };
}

function evaluateSpearman(raceGroups, getScore, minPairs = 3) {
    const rhos = [];
    for (const horses of raceGroups) {
        const pairs = [];
        for (const h of horses) {
            const m = getScore(h);
            const b = h.bitis;
            if (m != null && b != null && b >= 1) pairs.push({ x: m, y: b });
        }
        if (pairs.length < minPairs) continue;
        const rho = spearmanFromPairs(pairs);
        if (rho != null && !isNaN(rho)) rhos.push(rho);
    }
    if (!rhos.length) return { avg: null, n: 0 };
    return { avg: rhos.reduce((a, b) => a + b, 0) / rhos.length, n: rhos.length };
}

function bucketStats(horses, pred) {
    const yes = horses.filter(pred);
    const no = horses.filter(h => !pred(h));
    function summarize(list) {
        const withBit = list.filter(h => h.bitis != null && h.bitis >= 1);
        const w1 = withBit.filter(h => h.bitis === 1).length;
        const w123 = withBit.filter(h => h.bitis <= 3).length;
        return {
            n: withBit.length,
            win1: w1,
            win123: w123,
            pct1: withBit.length ? Math.round(1000 * w1 / withBit.length) / 10 : null,
            pct123: withBit.length ? Math.round(1000 * w123 / withBit.length) / 10 : null
        };
    }
    return { yes: summarize(yes), no: summarize(no) };
}

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }

function printHorseLine(h, compact) {
    const name = String(h.name || '').replace(/\(\d+\)/, '').trim().slice(0, 18);
    const skLadder = ['TÜM', 'S5', 'S4', 'S3', 'S2', 'S1']
        .map(w => w + ':' + (h.skByWindow[w] != null ? h.skByWindow[w] : '—')).join(' ');
    const bitMark = h.bitis === 1 ? '★' : h.bitis != null && h.bitis <= 3 ? '◆' : '·';
    if (compact) {
        console.log('  ' + bitMark + ' K' + h.raceNo + ' #' + pad(h.no, 2)
            + ' ' + pad(name, 18) + ' hedef=' + pad(h.hedef, 3)
            + ' BİT=' + pad(h.bitis ?? '—', 3)
            + ' Δ=' + pad(h.deltaSk != null ? (h.deltaSk >= 0 ? '+' : '') + h.deltaSk : '—', 5)
            + ' ' + pad(h.trend, 12)
            + ' SK=' + h.matchCount + '/' + h.kosuSayisi
            + ' ' + skLadder);
        return;
    }
    console.log('  ' + bitMark + ' K' + h.raceNo + ' #' + h.no + ' ' + name
        + ' · hedef ' + h.hedef + ' · BİTİŞ ' + (h.bitis ?? '—')
        + ' · SK-KOŞU ' + h.matchCount + '/' + h.kosuSayisi);
    console.log('    SK%  : ' + skLadder);
    console.log('    1.   : ' + ['TÜM', 'S5', 'S4', 'S3', 'S2', 'S1']
        .map(w => w + ':' + (h.cnt1ByWindow[w] ?? '—')).join(' '));
    console.log('    Δ(S1-TÜM)=' + (h.deltaSk != null ? h.deltaSk : '—')
        + ' · eğim=' + (h.slope != null ? h.slope.toFixed(2) : '—')
        + ' · ' + h.trend);
    const sonInfo = h.sonKosu
        ? (h.sonKosu.tarih || '?') + ' S' + (h.sonSira ?? '?')
            + ' sk=' + (h.sonKosu.siklet || '?') + (h.sonMatch ? ' ✓eşleş' : ' ·eşleşmez')
        : 'son koşu yok';
    console.log('    Son koşu: ' + sonInfo
        + ' · S1 pencere: ' + h.s1MatchStr
        + (h.s1Sk != null ? ' SK%=' + h.s1Sk : ''));
}

async function main() {
    loadEngines();
    const db = openDb(cli.dbPath);

    try {
        const row = await dbGet(db,
            'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?',
            [cli.kayitId]
        );
        if (!row?.veri) {
            console.error('Kayıt #' + cli.kayitId + ' bulunamadı');
            process.exit(1);
        }

        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId,
            filterRace: cli.raceNo
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        const bitisLookup = new Map();
        for (const e of flatEntries) {
            bitisLookup.set(
                rowKeyParts(e.kayitId, e.raceNo, e.row?.no),
                host.bitisValueForSort(e)
            );
        }

        const races = JSON.parse(row.veri);
        const horses = [];
        for (const race of races) {
            if (cli.raceNo && Number(race.raceNo) !== cli.raceNo) continue;
            for (const horse of race.horses || []) {
                if (cli.horseName) {
                    const target = normName(cli.horseName);
                    if (!normName(horse.name).includes(target)) continue;
                }
                horses.push(buildHorseRow({
                    horse,
                    race,
                    kayitId: row.id,
                    hipodrom: row.hipodrom,
                    tarih: row.tarih,
                    programTarih: row.tarih
                }, bitisLookup));
            }
        }

        if (!horses.length) {
            console.error('At bulunamadı');
            process.exit(1);
        }

        const withBitis = horses.filter(h => h.bitis != null && h.bitis >= 1);
        const withSkData = horses.filter(h => h.skFilled);
        const skEmpty = horses.length - withSkData.length;
        const comparableRecency = withSkData.filter(h => h.recencyComparable);
        const meaningfulPool = withSkData.filter(h => h.meaningfulRecency);
        const singleSkArtifacts = withSkData.filter(h => h.singleSkArtifact);
        const comparableWithBitis = meaningfulPool.filter(h => h.bitis != null && h.bitis >= 1);
        const raceGroups = buildRaceGroups(withSkData, h => h.bitis != null && h.bitis >= 1);
        const fromNameOnly = withBitis.filter(h => {
            const key = rowKeyParts(h.kayitId, h.raceNo, h.no);
            const stored = bitisLookup.get(key);
            return stored == null && global.AtSpeedUtils.extractBitisFromHorseName(h.name) != null;
        }).length;

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  SİKLET pencere korelasyonu — TÜM vs S5→S1 · at-at analiz       ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt #' + cli.kayitId + ' · ' + (row.hipodrom || '') + ' · ' + (row.tarih || ''));
        console.log('Toplam: ' + horses.length + ' at · SİKLET dolu: ' + withSkData.length
            + ' · boş (kıyas dışı): ' + skEmpty
            + ' · anlamlı yükseliş (SK-KOŞU≥' + cli.minSkKosu + '): ' + meaningfulPool.length
            + ' · tek SK artefakt: ' + singleSkArtifacts.length
            + ' · BİTİŞ+dolu: ' + comparableWithBitis.length
            + ' · koşu: ' + raceGroups.length);
        console.log('Kural: boş → kıyas dışı · SK-KOŞU=1 → Δ artefakt (14→100%) · lider için koşuda ≥2 dolu at');
        if (withBitis.length && fromNameOnly) {
            console.log('BİTİŞ kaynağı: puanlama + isim (' + fromNameOnly + ' at isimden)');
        } else if (withBitis.length && !Object.keys(bitisMap).length) {
            console.log('BİTİŞ kaynağı: at ismi (puanlama_bitis_sonuclari boş)');
        }
        console.log('Yükseliş eşiği: Δ(S1-TÜM) ≥ ' + cli.deltaMin + ' puan\n');

        if (!withBitis.length) {
            console.log('⚠ BİTİŞ yok — korelasyon bölümleri atlanır. puanlama_bitis_sonuclari veya at ismi (N) gerekli.\n');
        }

        hr('1. PENCERE LİDER KORELASYONU — SK% / cnt metrikleri → BİTİŞ');
        if (withBitis.length && raceGroups.length) {
            console.log('  Her koşuda yalnızca SİKLET dolu atlar · ≥2 dolu at olan koşular sayılır · Karışık = 80/12/8\n');
            console.log('  ' + pad('Metrik', 14) + WINDOWS.map(w => pad(windowLabel(w), 10)).join('')
                + pad('En iyi', 10));
            console.log('  ' + '-'.repeat(14 + WINDOWS.length * 10 + 10));

            let bestWindow = null;
            let bestScore = -1;
            for (const m of METRICS) {
                const cells = [];
                for (const w of WINDOWS) {
                    const r = evaluateWindowLeader(raceGroups, h => metricValue(h, w, m.key));
                    const cell = r.total
                        ? pct(r.leaderBlended) + '(' + r.total + ')'
                        : (r.skipped ? '—' : 'tie');
                    cells.push(pad(cell, 10));
                    if (r.total && r.leaderBlended > bestScore) {
                        bestScore = r.leaderBlended;
                        bestWindow = { metric: m.label, window: windowLabel(w), ...r };
                    }
                }
                console.log('  ' + pad(m.label, 14) + cells.join(''));
            }
            if (bestWindow) {
                console.log('\n  En iyi: ' + bestWindow.metric + ' · ' + bestWindow.window
                    + ' → karışık ' + pct(bestWindow.leaderBlended)
                    + ' · ★ ' + pct(bestWindow.exactRate) + ' · n=' + bestWindow.total);
            }
        } else {
            console.log('  (BİTİŞ verisi yok — atlanıyor)\n');
        }

        hr('2. SK% SPEARMAN — metrik sırası ↔ BİTİŞ sırası (negatif = yüksek SK% daha iyi)');
        if (withBitis.length && raceGroups.length) {
            console.log('  ' + pad('Pencere', 10) + pad('ρ ort', 10) + pad('koşu', 8));
            for (const w of WINDOWS) {
                const { avg, n } = evaluateSpearman(raceGroups, h => metricValue(h, w, 'matchPct'));
                console.log('  ' + pad(windowLabel(w), 10)
                    + pad(avg != null ? avg.toFixed(3) : '—', 10)
                    + pad(String(n), 8));
            }
        } else {
            console.log('  (BİTİŞ verisi yok — atlanıyor)\n');
        }

        hr('3. YÜKSELİŞ vs BİTİŞ — Δ(S1−TÜM) [SK-KOŞU≥' + cli.minSkKosu + ', artefakt hariç]');
        const risingPool = comparableWithBitis.length ? comparableWithBitis : meaningfulPool;
        const rising = risingPool.filter(h => h.rising).sort((a, b) => (b.deltaSk || 0) - (a.deltaSk || 0));
        if (comparableWithBitis.length) {
            const rise = bucketStats(comparableWithBitis, h => h.rising);
            const slopeUp = bucketStats(
                comparableWithBitis.filter(h => h.slope != null),
                h => h.slope > 0.5
            );
            const s1MatchSon = bucketStats(
                comparableWithBitis.filter(h => h.sonKosu),
                h => h.sonMatch
            );
            console.log('  Yükselen (Δ≥' + cli.deltaMin + '): n=' + rise.yes.n
                + ' · 1.= ' + fmtWinRate(rise.yes)
                + ' · 1-3= ' + rise.yes.win123 + '/' + rise.yes.n
                + ' (' + fmtPct100(rise.yes.pct123) + ')');
            console.log('  Sabit/düşen       : n=' + rise.no.n
                + ' · 1.= ' + fmtWinRate(rise.no)
                + ' · 1-3= ' + rise.no.win123 + '/' + rise.no.n
                + ' (' + fmtPct100(rise.no.pct123) + ')');
            if (rise.yes.n && rise.no.n) {
                const d1 = (rise.yes.pct1 || 0) - (rise.no.pct1 || 0);
                console.log('  Δ kazanma         : ' + (d1 >= 0 ? '+' : '') + d1.toFixed(1) + ' puan (yükselen − diğer)');
            }
            console.log('');
            console.log('  Pozitif eğim      : n=' + slopeUp.yes.n + ' · 1.= ' + fmtWinRate(slopeUp.yes));
            console.log('  Son koşu ✓ eşleş  : n=' + s1MatchSon.yes.n + ' · 1.= ' + fmtWinRate(s1MatchSon.yes));
            console.log('  Son koşu · eşleş  : n=' + s1MatchSon.no.n + ' · 1.= ' + fmtWinRate(s1MatchSon.no));
        } else if (meaningfulPool.length) {
            console.log('  BİTİŞ yok — anlamlı yükselen: ' + rising.length + ' at\n');
        } else {
            console.log('  Anlamlı yükseliş yok (SK-KOŞU≥' + cli.minSkKosu + ' gerekli)\n');
        }

        if (singleSkArtifacts.length) {
            sub('Tek SK-KOŞU artefakt — Δ kıyas dışı (' + singleSkArtifacts.length + ' at)');
            console.log('  TÜM\'de 1 eşleşme → S1=%100 → yapay Δ+86; gerçek trend değil');
            for (const h of singleSkArtifacts.slice(0, 8)) {
                printHorseLine(h, true);
            }
            if (singleSkArtifacts.length > 8) {
                console.log('  … +' + (singleSkArtifacts.length - 8) + ' at');
            }
        }

        hr('4. SON KOŞU (S1) BAŞARI — hedef sıklette en son koşu [SİKLET dolu]');
        const sonPool = comparableWithBitis.length ? comparableWithBitis : withSkData;
        if (sonPool.length) {
            const s1Win = sonPool.filter(h => h.sonMatch && h.sonSira === 1);
            const s1Top3 = sonPool.filter(h => h.sonMatch && h.sonSira != null && h.sonSira <= 3);
            console.log('  Son koşuda hedef sıklet eşleşen: '
                + sonPool.filter(h => h.sonMatch).length + ' at');
            console.log('  Son koşuda 1. olan (eşleşen)  : ' + s1Win.length);
            console.log('  Son koşuda 1-3 (eşleşen)     : ' + s1Top3.length);
            if (comparableWithBitis.length) {
                const s1WinActual = s1Win.filter(h => h.bitis === 1);
                console.log('  Bunların bugünkü BİTİŞ 1.      : ' + s1WinActual.length
                    + '/' + s1Win.length
                    + (s1Win.length ? ' (' + pct(s1WinActual.length / s1Win.length) + ')' : ''));
            }
        } else {
            console.log('  (SİKLET dolu at yok)');
        }

        if (skEmpty) {
            sub('Boş SİKLET — kıyas dışı (' + skEmpty + ' at)');
            for (const h of horses.filter(x => !x.skFilled).slice(0, 12)) {
                const name = String(h.name || '').replace(/\(\d+\)/, '').trim().slice(0, 22);
                console.log('  K' + h.raceNo + ' #' + h.no + ' ' + name
                    + ' · kosular=' + (h.st?.kosuSayisi ?? 0)
                    + ' · hedef=' + (h.hedef || '—'));
            }
            if (skEmpty > 12) console.log('  … +' + (skEmpty - 12) + ' at daha');
        }

        sub('Yükselen form (' + rising.length + ' at — Δ≥' + cli.deltaMin + ', SK-KOŞU≥' + cli.minSkKosu + ')');
        if (!rising.length) {
            console.log('  (yok)');
        } else {
            for (const h of rising.slice(0, cli.risingOnly ? 999 : 15)) {
                printHorseLine(h, !cli.verbose);
            }
            if (!cli.risingOnly && rising.length > 15) {
                console.log('  … +' + (rising.length - 15) + ' at (--rising-only ile hepsini gör)');
            }
        }

        hr('5. AT-AT DETAY — SİKLET pencere merdiveni');
        const display = cli.risingOnly ? rising : withSkData.sort((a, b) => {
            if (a.raceNo !== b.raceNo) return a.raceNo - b.raceNo;
            return (a.bitis ?? 99) - (b.bitis ?? 99);
        });
        if (!display.length) {
            console.log('  (SİKLET verisi olan at yok — kosular[] repair gerekebilir)');
        }
        for (const h of display) {
            printHorseLine(h, !cli.verbose && !cli.horseName);
        }

        console.log('\nOK · ' + horses.length + ' at · ' + skEmpty + ' boş · '
            + withSkData.length + ' dolu · ' + raceGroups.length + ' koşu · '
            + 'anlamlı=' + meaningfulPool.length + ' · yükselen=' + rising.length
            + ' · artefakt=' + singleSkArtifacts.length);
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
