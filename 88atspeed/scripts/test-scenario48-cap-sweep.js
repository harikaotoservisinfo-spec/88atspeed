#!/usr/bin/env node
/**
 * 48 senaryo TAHMİN bonus tavanı taraması — maxCap +9…+38 taban, +1 adımla +55'e kadar
 *
 *   npm run test:scenario48-cap
 *   node scripts/test-scenario48-cap-sweep.js --kayit 148,154
 *   node scripts/test-scenario48-cap-sweep.js --kayit 148 --cap-min 38 --cap-max 55
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    openDb,
    dbAll,
    rowKeyParts,
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
    kayitIds: (argVal('--kayit') || '148,154').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)),
    capMin: argVal('--cap-min') != null ? Number(argVal('--cap-min')) : 38,
    capMax: argVal('--cap-max') != null ? Number(argVal('--cap-max')) : 55,
    capStep: argVal('--cap-step') != null ? Number(argVal('--cap-step')) : 1,
    baseMax: argVal('--base-max') != null ? Number(argVal('--base-max')) : 38
};

const BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };
const BAS_SOURCES = ['fieldSize', 'sehir', 'kcins_kosu', 'taki', 'pist', 'hp', 'siklet'];

function hr(title) {
    console.log('\n' + '='.repeat(78));
    console.log(title);
    console.log('='.repeat(78));
}

function loadEngines() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    const files = [
        ['public/js/formula-engine.js', 'GosterimEngine'],
        ['public/js/gosterim-headers.js', 'GosterimHeaders'],
        ['public/js/scenario48-scoring-engine.js', 'Scenario48ScoringEngine'],
        ['public/js/astest-son-gosterim-cols.js', 'AtestSonGosterimCols'],
        ['public/js/field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['public/js/sehir-stats-engine.js', 'SehirStatsEngine'],
        ['public/js/kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['public/js/astest-son800-shared.js', 'AtestSon800Shared'],
        ['public/js/dimension-tahmin-boost-engine.js', 'DimensionTahminBoostEngine']
    ];
    for (const [file, name] of files) {
        eval(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n; global.' + name + ' = ' + name + ';');
    }
}

async function loadBitisMap(db) {
    const sqlite3 = require('sqlite3').verbose();
    return new Promise((resolve) => {
        const db2 = new sqlite3.Database(cli.dbPath);
        db2.get('SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1', [], (err, row) => {
            db2.close();
            if (err || !row?.veri) return resolve({});
            try {
                const parsed = JSON.parse(row.veri);
                return resolve(parsed.bitis || parsed);
            } catch (_) {
                return resolve({});
            }
        });
    });
}

function resolveBitis(horse, kayitId, raceNo, bitisMap) {
    const key = rowKeyParts(kayitId, raceNo, horse.no);
    let b = bitisMap[key];
    if (b == null || b < 1) b = global.AtSpeedUtils.extractBitisFromHorseName(horse.name);
    return b != null && b >= 1 ? b : null;
}

function computeBasForSource(horse, race, meta, sourceKey, sonCtx) {
    const kosular = horse.kosular || [];
    const programTarih = meta?.tarih || null;
    const hedefSehir = meta?.hipodrom || '';
    let st;
    if (sourceKey === 'fieldSize') {
        st = FieldSizeStatsEngine.computeStats(
            kosular, programTarih, FieldSizeStatsEngine.raceFieldSize(race));
    } else if (sourceKey === 'sehir') {
        st = SehirStatsEngine.computeStats(kosular, hedefSehir, programTarih);
    } else {
        const dim = KosuDimensionStatsEngine.getDim(sourceKey);
        if (!dim) return { basSuccess: { display: '—' } };
        const horseCtx = Object.assign({}, horse, { kosular: kosular });
        const hedef = dim.getTarget(horseCtx, race);
        st = KosuDimensionStatsEngine.computeStats(kosular, sourceKey, hedef, programTarih);
    }
    if (typeof AtestSon800Shared !== 'undefined' && sonCtx) {
        st = AtestSon800Shared.applyBasDeltaBoost(st, horse, sonCtx);
    }
    return st;
}

function scoreRaceTahmin(race, meta, resolveKosular) {
    const horses = [...(race.horses || [])].sort((a, b) => {
        const na = parseInt(a.no, 10);
        const nb = parseInt(b.no, 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
    });
    const sonCtx = AtestSon800Shared.buildRaceContext(
        race, horses, meta.hipodrom, meta.tarih);
    const horseRows = horses.map(function (h) {
        const basBySource = {};
        for (let i = 0; i < BAS_SOURCES.length; i++) {
            basBySource[BAS_SOURCES[i]] = computeBasForSource(
                h, race, meta, BAS_SOURCES[i], sonCtx);
        }
        return { h: h, basBySource: basBySource, tahmin: null };
    });
    DimensionTahminBoostEngine.computeDimensionOnlyFromBasBySource(horseRows);
    const gosByKey = AtestSonGosterimCols.buildSiraOneMap(race, meta, resolveKosular);
    if (gosByKey.size) {
        AtestSonGosterimCols.applyTahminBonuses(
            horseRows, gosByKey, race, meta, resolveKosular);
    }
    return horseRows;
}

function evaluateRace(horseRows, kayitId, raceNo, bitisMap) {
    const ranked = horseRows
        .filter(r => r.tahmin?.rank != null)
        .sort((a, b) => a.tahmin.rank - b.tahmin.rank);
    if (ranked.length < 2) return null;

    function bitisFor(h) {
        return resolveBitis(h, kayitId, raceNo, bitisMap);
    }

    const pick = (rank) => {
        const row = ranked.find(r => r.tahmin.rank === rank);
        return row ? bitisFor(row.h) : null;
    };

    const b1 = pick(1);
    const b2 = pick(2);
    const b3 = pick(3);
    if (b1 == null) return null;

    const top3Bitis = new Set([1, 2, 3]);
    const predTop3 = ranked.slice(0, 3).map(r => bitisFor(r.h)).filter(b => b != null);
    let top3SetHits = 0;
    for (const b of predTop3) {
        if (top3Bitis.has(b)) top3SetHits++;
    }

    return {
        star1: b1 === 1,
        rank2Exact: b2 === 2,
        rank3Exact: b3 === 3,
        top3Leader: b1 <= 3,
        top3AllExact: b1 === 1 && b2 === 2 && b3 === 3,
        top3SetHits: top3SetHits,
        blend: b1 === 1 ? BLEND.b1 : b1 <= 2 ? BLEND.b12 : b1 <= 3 ? BLEND.b123 : 0
    };
}

async function loadKayitRaces(db, kayitId) {
    const rows = await dbAll(db,
        'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [kayitId]);
    if (!rows.length) return null;
    const kayit = rows[0];
    let races;
    try {
        races = JSON.parse(kayit.veri);
    } catch (_) {
        return null;
    }
    if (!Array.isArray(races)) return null;
    return {
        kayitId: kayit.id,
        meta: { tarih: kayit.tarih, hipodrom: kayit.hipodrom },
        races: races.map((race, i) => Object.assign({}, race, {
            raceNo: race.raceNo || (i + 1),
            horses: (race.horses || []).map(h => Object.assign({}, h, {
                kosular: h.kosular || []
            }))
        }))
    };
}

function evaluateCap(allRaces, bitisMap, maxCap) {
    Scenario48ScoringEngine.setScenarioBonusCap(maxCap, cli.baseMax);
    const agg = {
        races: 0,
        star1: 0,
        rank2Exact: 0,
        rank3Exact: 0,
        top3Leader: 0,
        top3AllExact: 0,
        top3SetHits: 0,
        top3SetTotal: 0,
        blendSum: 0
    };

    for (const bundle of allRaces) {
        const resolveKosular = (h) => h.kosular || [];
        for (const race of bundle.races) {
            const horseRows = scoreRaceTahmin(race, bundle.meta, resolveKosular);
            const ev = evaluateRace(horseRows, bundle.kayitId, race.raceNo, bitisMap);
            if (!ev) continue;
            agg.races++;
            if (ev.star1) agg.star1++;
            if (ev.rank2Exact) agg.rank2Exact++;
            if (ev.rank3Exact) agg.rank3Exact++;
            if (ev.top3Leader) agg.top3Leader++;
            if (ev.top3AllExact) agg.top3AllExact++;
            agg.top3SetHits += ev.top3SetHits;
            agg.top3SetTotal += Math.min(3, horseRows.filter(r => r.tahmin?.rank != null).length);
            agg.blendSum += ev.blend;
        }
    }
    return agg;
}

function printSweepRow(maxCap, agg, best) {
    const n = Math.max(1, agg.races);
    const mark = (maxCap === best.star1Cap || maxCap === best.top3Cap || maxCap === best.blendCap)
        ? ' ◀' : '';
    console.log(pad(String(maxCap), 6)
        + pad(pct(agg.star1 / n) + ' (' + agg.star1 + '/' + n + ')', 16)
        + pad(pct(agg.top3Leader / n) + ' (' + agg.top3Leader + '/' + n + ')', 16)
        + pad(pct(agg.rank2Exact / n) + ' (' + agg.rank2Exact + '/' + n + ')', 16)
        + pad(pct(agg.rank3Exact / n) + ' (' + agg.rank3Exact + '/' + n + ')', 16)
        + pad(pct(agg.top3SetHits / Math.max(1, agg.top3SetTotal)), 10)
        + pad((agg.blendSum / n * 100).toFixed(1) + '%', 10)
        + mark);
}

async function main() {
    loadEngines();
    const db = openDb(cli.dbPath);
    const bitisMap = await loadBitisMap(db);

    hr('48 SENARYO TAHMİN BONUS TAVAN TARAMASI');
    console.log('DB: ' + cli.dbPath);
    console.log('Kayıtlar: ' + cli.kayitIds.join(', '));
    console.log('Senaryo bonus: min +9 · taban max +' + cli.baseMax
        + ' → sweep maxCap +' + cli.capMin + '…+' + cli.capMax + ' (adım +' + cli.capStep + ')');
    console.log('Formül: round(maxFinal×10×maxCap/' + cli.baseMax + ') · min 9 · cap maxCap');
    console.log('Diğer GÖSTERİM bonusları sabit (mavi, TEST1, SON800…)\n');

    const allRaces = [];
    for (const kid of cli.kayitIds) {
        const bundle = await loadKayitRaces(db, kid);
        if (!bundle) {
            console.log('⚠ Kayıt #' + kid + ' bulunamadı.');
            continue;
        }
        allRaces.push(bundle);
    }
    db.close();

    if (!allRaces.length) {
        console.error('Hiç kayıt işlenemedi.');
        process.exit(1);
    }

    const totalRaces = allRaces.reduce((s, b) => s + b.races.length, 0);
    console.log('Toplam koşu: ' + totalRaces);

    console.log('\n' + pad('maxCap', 6)
        + pad('★1 (TAH#1)', 16)
        + pad('◆1-3 (#1)', 16)
        + pad('2.lik (#2)', 16)
        + pad('3.lük (#3)', 16)
        + pad('Top3∩', 10)
        + pad('Blend', 10));
    console.log('-'.repeat(78));

    const results = [];
    let best = { star1Cap: cli.capMin, top3Cap: cli.capMin, blendCap: cli.capMin, star1: -1, top3: -1, blend: -1 };

    for (let cap = cli.capMin; cap <= cli.capMax; cap += cli.capStep) {
        const agg = evaluateCap(allRaces, bitisMap, cap);
        results.push({ cap: cap, agg: agg });
        const n = Math.max(1, agg.races);
        const star1Rate = agg.star1 / n;
        const top3Rate = agg.top3Leader / n;
        const blendRate = agg.blendSum / n;
        if (star1Rate > best.star1 || (star1Rate === best.star1 && blendRate > best.blend)) {
            best.star1 = star1Rate;
            best.star1Cap = cap;
        }
        if (top3Rate > best.top3 || (top3Rate === best.top3 && blendRate > best.blend)) {
            best.top3 = top3Rate;
            best.top3Cap = cap;
        }
        if (blendRate > best.blend) {
            best.blend = blendRate;
            best.blendCap = cap;
        }
        printSweepRow(cap, agg, best);
    }

    hr('EN İYİ maxCap ÖZETİ');
    console.log('★1 en iyi:     maxCap +' + best.star1Cap + ' → '
        + pct(best.star1) + ' (TAHMİN 1. sıra = birinci)');
    console.log('◆1-3 en iyi:   maxCap +' + best.top3Cap + ' → '
        + pct(best.top3) + ' (TAHMİN 1. sıra = ilk 3)');
    console.log('Blend en iyi:  maxCap +' + best.blendCap + ' → '
        + (best.blend * 100).toFixed(1) + '%');
    console.log('\nNot: maxCap=' + cli.baseMax + ' = mevcut üretim (+9…+' + cli.baseMax + ' senaryo bonusu).');
    console.log('TAH#2/#3 = TAHMİN 2./3. sıradaki atın gerçek 2./3. olması.');
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
