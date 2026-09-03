#!/usr/bin/env node
/**
 * Kayıt açma + SON TEST sekmesi — tarayıcıdaki loadSonTestKayit / sonTestGoster akışını
 * terminalde ölçer (kalibrasyon + koşu başına skorlama).
 *
 *   npm run test:son-test-kayit-162
 *   node scripts/test-son-test-kayit-open.js --db atlar.db --kayit 162
 *   node scripts/test-son-test-kayit-open.js --base-url http://188.231.109.27 --kayit 162
 *   node scripts/test-son-test-kayit-open.js --kayit 162 --full-refresh   # tüm sekmeler (yavaş)
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    openDb,
    dbGet,
    dbAll,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);

function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 162,
    baseUrl: argVal('--base-url') ? argVal('--base-url').replace(/\/$/, '') : null,
    fullRefresh: args.includes('--full-refresh'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    skipCalibrate: args.includes('--skip-calibrate')
};

function msSince(t0) {
    return ((Date.now() - t0) / 1000).toFixed(2) + 's';
}

function hr(title) {
    console.log('\n' + '═'.repeat(72));
    console.log('  ' + title);
    console.log('═'.repeat(72));
}

function line(label, value) {
    console.log('  ' + pad(label, 30) + String(value));
}

function atCacheKey(atId) {
    if (atId == null || atId === '') return null;
    const n = Number(atId);
    return Number.isFinite(n) ? n : String(atId);
}

function loadCalibrationEngines() {
    loadGostergeEngines();
    const files = [
        ['basari-pct-scoring-engine.js', 'BasariPctScoringEngine'],
        ['hybrid-tahmin-scoring-engine.js', 'HybridTahminScoringEngine'],
        ['astest-son-renk-tahmin.js', 'AtestSonRenkTahmin'],
        ['astest-son-gosterge1-tahmin.js', 'AtestSonGosterge1Tahmin'],
        ['astest-son-ptest-tahmin.js', 'AtestSonPtestTahmin']
    ];
    for (const [file, g] of files) {
        eval(fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8') + '\n; global.' + g + ' = ' + g + ';');
    }
}

function loadRenderEngines() {
    const files = [
        ['at-meta-fields.js', 'AtMetaFields'],
        ['field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['sehir-stats-engine.js', 'SehirStatsEngine'],
        ['kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['son800-depth-ui.js', 'Son800DepthUi'],
        ['siklet-bas-delta-boost.js', 'SikletBasDeltaBoost'],
        ['dimension-tahmin-boost-engine.js', 'DimensionTahminBoostEngine'],
        ['astest-son800-shared.js', 'AtestSon800Shared'],
        ['astest-son-gosterim-cols.js', 'AtestSonGosterimCols']
    ];
    for (const [file, g] of files) {
        eval(fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8') + '\n; global.' + g + ' = ' + g + ';');
    }
}

function memLine(label) {
    const m = process.memoryUsage();
    line(label, 'heap ' + Math.round(m.heapUsed / 1048576) + 'MB / '
        + Math.round(m.heapTotal / 1048576) + 'MB');
}

function stripPkgFromFlat(flatEntries) {
    for (const entry of flatEntries || []) {
        if (entry && entry._pkg) delete entry._pkg;
    }
}

function installTerminalCalibrationPatches(built) {
    const G = global.GostergeScoringEngine;
    const payload = { flatEntries: built.flatEntries, bitisMap: built.bitisMap };
    const sharedHost = makeGostergeHost(built.flatEntries, built.bitisMap);
    let colorRowsOnce = null;

    G.buildFlatEntriesFromApi = async function () {
        return payload;
    };
    if (G.getCachedFlatBuild) {
        G.getCachedFlatBuild = function () { return payload; };
    }

    const origMakeBitisHost = G.makeBitisHost.bind(G);
    G.makeBitisHost = function (flatEntries, bitisMap, buildBitisStatsFromEntries) {
        const basic = origMakeBitisHost(flatEntries, bitisMap, buildBitisStatsFromEntries);
        return Object.assign({}, sharedHost, basic, {
            buildBitisStatsFromEntries: buildBitisStatsFromEntries || sharedHost.buildBitisStatsFromEntries
        });
    };

    const origCalibrate = G.calibrate.bind(G);
    G.calibrate = async function (flatEntries, host) {
        if (G.isCalibrated?.()) return G.getCalibration?.();
        return origCalibrate(flatEntries, host);
    };

    if (G.collectAllColorGostergeRows) {
        const origCollect = G.collectAllColorGostergeRows.bind(G);
        G.collectAllColorGostergeRows = function (flatEntries, host) {
            if (colorRowsOnce) return colorRowsOnce;
            colorRowsOnce = origCollect(flatEntries, host);
            return colorRowsOnce;
        };
    }

    return sharedHost;
}

async function runTerminalCalibration(built) {
    const G = global.GostergeScoringEngine;
    const host = installTerminalCalibrationPatches(built);
    const flatEntries = built.flatEntries;
    const timings = {};

    const tRenk = Date.now();
    await G.calibrate(flatEntries, host);
    timings.gostergeCalibrate = msSince(tRenk);
    memLine('Kalibrasyon sonrası bellek');

    const tScenario = Date.now();
    if (global.AtestSonRenkTahmin) {
        await global.AtestSonRenkTahmin.ensureCalibration();
    }
    timings.renkScenario = msSince(tScenario);

    const tPtest = Date.now();
    if (global.HybridTahminScoringEngine) {
        await global.HybridTahminScoringEngine.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort, { host: host });
    }
    if (global.AtestSonGosterge1Tahmin) {
        global.AtestSonGosterge1Tahmin.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort);
    }
    timings.hybridG1 = msSince(tPtest);
    timings.total = (parseFloat(timings.gostergeCalibrate)
        + parseFloat(timings.renkScenario) + parseFloat(timings.hybridG1)).toFixed(2) + 's';
    timings.ptestReady = !!G.isCalibrated?.()
        && (!global.HybridTahminScoringEngine || global.HybridTahminScoringEngine.isCalibrated?.())
        && (!global.AtestSonGosterge1Tahmin || global.AtestSonGosterge1Tahmin.isCalibrated?.());
    timings.renkReady = !!G.isCalibrated?.();
    return timings;
}

async function fetchKayitFromApi(kayitId) {
    const res = await fetch(cli.baseUrl + '/api/hesaplama-kayit/' + kayitId);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Kayıt API hatası');
    const kayit = json.kayit;
    return {
        id: kayit.id,
        hipodrom: kayit.hipodrom,
        tarih: kayit.tarih,
        races: kayit.veri || []
    };
}

async function loadKayitFromDb(db, kayitId) {
    const row = await dbGet(db,
        'SELECT id, hipodrom, tarih, veri, race_count, total_horses FROM hesaplama_kayitlari WHERE id = ?',
        [kayitId]);
    if (!row?.veri) return null;
    let races;
    try {
        races = JSON.parse(row.veri);
    } catch (_) {
        throw new Error('Kayıt #' + kayitId + ' veri JSON parse hatası');
    }
    return {
        id: row.id,
        hipodrom: row.hipodrom,
        tarih: row.tarih,
        races: Array.isArray(races) ? races : [],
        raceCount: row.race_count,
        horseCount: row.total_horses
    };
}

function buildVeriCache(races) {
    const veriCache = {};
    for (const race of races || []) {
        for (const horse of race.horses || []) {
            const key = atCacheKey(horse.atId);
            if (key != null && horse.kosular?.length) {
                veriCache[key] = horse.kosular;
            }
        }
    }
    return veriCache;
}

function resolveHorseKosular(veriCache, horse) {
    const key = atCacheKey(horse?.atId);
    const cached = key != null ? veriCache[key] : null;
    if (cached?.length) return cached;
    return horse?.kosular || [];
}

const SON_TEST_BAS_SOURCES = [
    { key: 'fieldSize', label: 'AS+' },
    { key: 'sehir', label: 'SH+' },
    { key: 'kcins_kosu', label: 'KC+' },
    { key: 'taki', label: 'TK+' },
    { key: 'pist', label: 'PS+' },
    { key: 'hp', label: 'HP+' },
    { key: 'siklet', label: 'SK+' }
];

function astestHorseRankKey(h) {
    const k = atCacheKey(h?.atId);
    if (k != null) return String(k);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    if (h?.name) return 'name:' + String(h.name);
    return null;
}

function astestComputeBasForSource(horse, race, meta, sourceKey, sonCtx, veriCache, hedefSehir) {
    const kosular = resolveHorseKosular(veriCache, horse);
    const programTarih = meta?.tarih || null;
    let st;
    if (sourceKey === 'fieldSize') {
        st = global.FieldSizeStatsEngine.computeStats(
            kosular, programTarih, global.FieldSizeStatsEngine.raceFieldSize(race));
    } else if (sourceKey === 'sehir') {
        st = global.SehirStatsEngine.computeStats(kosular, hedefSehir, programTarih);
    } else {
        const dim = global.KosuDimensionStatsEngine.getDim(sourceKey);
        if (!dim) return { basSuccess: { display: '—' } };
        const horseCtx = Object.assign({}, horse, { kosular: kosular });
        const hedef = dim.getTarget(horseCtx, race);
        st = global.KosuDimensionStatsEngine.computeStats(kosular, sourceKey, hedef, programTarih);
    }
    if (global.AtestSon800Shared && sonCtx) {
        st = global.AtestSon800Shared.applyBasDeltaBoost(st, horse, sonCtx);
    }
    return st;
}

async function simulateSonTestGoster(races, meta, veriCache, calTimings) {
    global.veriCache = veriCache;
    const timings = {
        races: [],
        ptestCalibration: calTimings?.total || '0.00s',
        calibrationDetail: calTimings || null
    };

    const renkCalibrated = !!global.GostergeScoringEngine?.isCalibrated?.();
    const ptestCalibrated = !!calTimings?.ptestReady;
    timings.renkCalibrated = renkCalibrated;
    timings.ptestCalibrated = ptestCalibrated;

    const renkScenarioCols = renkCalibrated && global.AtestSonRenkTahmin
        ? global.AtestSonRenkTahmin.getScenarioColumns() : [];
    const ptestCols = ptestCalibrated && global.AtestSonPtestTahmin
        ? global.AtestSonPtestTahmin.getColumns() : [];
    const gosColCount = global.AtestSonGosterimCols
        ? global.AtestSonGosterimCols.getColumnCount() : 0;

    timings.columnSetup = {
        renkCols: renkScenarioCols.length,
        ptestCols: ptestCols.length,
        gosCols: gosColCount
    };

    const programTarih = meta?.tarih || null;
    const hedefSehir = meta?.hipodrom || '';
    const resolveKos = h => resolveHorseKosular(veriCache, h);

    let htmlLen = 0;
    const tAllRaces = Date.now();

    for (let i = 0; i < races.length; i++) {
        const race = races[i];
        const raceTiming = { raceNo: race.raceNo || (i + 1), horses: (race.horses || []).length };
        const tRace = Date.now();

        const horses = [...(race.horses || [])].sort((a, b) => {
            const na = parseInt(a.no, 10);
            const nb = parseInt(b.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
        });

        const tCtx = Date.now();
        const sonCtx = global.AtestSon800Shared
            ? global.AtestSon800Shared.buildRaceContext(race, horses, hedefSehir, programTarih)
            : null;
        raceTiming.buildRaceContext = msSince(tCtx);

        const tRenk = Date.now();
        let renkByKey = new Map();
        if (renkCalibrated && global.AtestSonRenkTahmin) {
            renkByKey = global.AtestSonRenkTahmin.scoreRace(race, meta, resolveKos);
        }
        raceTiming.renkScoreRace = msSince(tRenk);

        const tPtest = Date.now();
        let ptestByCol = {};
        if (ptestCalibrated && global.AtestSonPtestTahmin) {
            ptestByCol = global.AtestSonPtestTahmin.scoreRaceAll(race, meta, resolveKos);
        }
        raceTiming.ptestScoreRaceAll = msSince(tPtest);

        const tGos = Date.now();
        const gosByKey = global.AtestSonGosterimCols
            ? global.AtestSonGosterimCols.buildSiraOneMap(race, meta, resolveKos)
            : new Map();
        raceTiming.buildSiraOneMap = msSince(tGos);

        const tBas = Date.now();
        const horseRows = horses.map(function (h) {
            const basBySource = {};
            for (const src of SON_TEST_BAS_SOURCES) {
                basBySource[src.key] = astestComputeBasForSource(
                    h, race, meta, src.key, sonCtx, veriCache, hedefSehir);
            }
            const pcts = SON_TEST_BAS_SOURCES.map(s => basBySource[s.key]?.basSuccess?.pct)
                .filter(p => p != null);
            const avgPct = pcts.length
                ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
                : null;
            return {
                h,
                basBySource,
                st: { basSuccess: { pct: avgPct } },
                tahmin: null,
                renkTahmin: null,
                ptestTahmin: {}
            };
        });
        if (global.DimensionTahminBoostEngine) {
            global.DimensionTahminBoostEngine.computeDimensionOnlyFromBasBySource(horseRows);
        }
        if (global.AtestSonGosterimCols && gosByKey.size) {
            global.AtestSonGosterimCols.applyTahminBonuses(
                horseRows, gosByKey, race, meta, resolveKos);
        }
        for (const row of horseRows) {
            const rk = astestHorseRankKey(row.h);
            if (!rk) continue;
            if (renkByKey.size) row.renkTahmin = renkByKey.get(rk) || null;
            const pt = {};
            for (const col of ptestCols) {
                pt[col.id] = ptestByCol[col.id]?.get(rk) || null;
            }
            row.ptestTahmin = pt;
        }
        raceTiming.basAndBonuses = msSince(tBas);

        const tHtml = Date.now();
        let raceHtml = '';
        raceHtml += '<tr>'.repeat(horses.length + 1);
        raceHtml += String(renkScenarioCols.length + ptestCols.length + gosColCount);
        htmlLen += raceHtml.length;
        raceTiming.htmlEstimate = msSince(tHtml);

        raceTiming.total = msSince(tRace);
        raceTiming.scoredHorses = horseRows.filter(r => r.tahmin?.pct != null).length;
        raceTiming.renkHits = horseRows.filter(r => r.renkTahmin?.pct != null).length;
        raceTiming.ptestHits = horseRows.filter(r =>
            Object.values(r.ptestTahmin || {}).some(t => t?.pct != null)).length;
        timings.races.push(raceTiming);
    }

    timings.allRaces = msSince(tAllRaces);
    timings.totalHtmlChars = htmlLen;
    timings.ptestCalibrated = ptestCalibrated;
    timings.renkCalibrated = renkCalibrated;
    return timings;
}

async function simulateFullRefresh(races, meta, veriCache) {
    const out = { tabs: [] };
    const t0 = Date.now();
    const son = await simulateSonTestGoster(races, meta, veriCache);
    out.tabs.push({ tab: 'SON TEST', elapsed: son.allRaces, ptestCal: son.ptestCalibration });
    out.total = msSince(t0);
    out.note = 'Sadece SON TEST ölçüldü; diğer sekmeler --full-refresh ile henüz eklenmedi.';
    return out;
}

async function main() {
    console.log('\n🏁 SON TEST kayıt açma ölçümü — ' + new Date().toISOString());
    line('Kayıt ID', cli.kayitId);
    line('DB', cli.dbPath);
    if (cli.baseUrl) line('API', cli.baseUrl);
    memLine('Başlangıç bellek');

    loadCalibrationEngines();

    hr('AŞAMA 1 — Kayıt yükleme (loadSonTestKayit fetch)');
    const tLoad = Date.now();
    let kayit = null;
    let db = null;

    if (cli.baseUrl) {
        try {
            kayit = await fetchKayitFromApi(cli.kayitId);
            line('Kaynak', 'HTTP API');
        } catch (err) {
            console.log('  ❌ API: ' + err.message);
        }
    }
    if (!kayit) {
        db = openDb(cli.dbPath);
        kayit = await loadKayitFromDb(db, cli.kayitId);
        line('Kaynak', kayit ? 'SQLite' : 'bulunamadı');
    }
    const loadElapsed = msSince(tLoad);
    line('Süre', loadElapsed);

    if (!kayit) {
        const ids = db
            ? (await dbAll(db, 'SELECT id FROM hesaplama_kayitlari ORDER BY id DESC LIMIT 8')).map(r => r.id)
            : [];
        console.log('\n  ❌ Kayıt #' + cli.kayitId + ' bulunamadı.');
        if (ids.length) {
            console.log('  Mevcut son kayıtlar: ' + ids.join(', '));
            console.log('  Örnek: node scripts/test-son-test-kayit-open.js --kayit ' + ids[0]);
        }
        if (cli.baseUrl) {
            console.log('  Canlı sunucuda denemek için: --base-url ' + cli.baseUrl + ' --kayit ' + cli.kayitId);
        }
        if (db) db.close();
        process.exit(1);
    }

    line('Hipodrom', kayit.hipodrom || '—');
    line('Tarih', kayit.tarih || '—');
    line('Koşu sayısı', kayit.races.length);
    const horseTotal = kayit.races.reduce((n, r) => n + (r.horses || []).length, 0);
    line('At sayısı', horseTotal);

    const meta = {
        source: 'kayit',
        kayitId: kayit.id,
        tarih: kayit.tarih,
        hipodrom: kayit.hipodrom
    };
    const veriCache = buildVeriCache(kayit.races);
    line('veriCache at', Object.keys(veriCache).length);

    if (!db) {
        db = openDb(cli.dbPath);
    }

    hr('AŞAMA 2 — Flat entry build (kalibrasyon verisi, tüm kayıtlar)');
    const tFlat = Date.now();
    const built = await buildFlatEntriesFromDb(db, {});
    stripPkgFromFlat(built.flatEntries);
    const flatElapsed = msSince(tFlat);
    line('Süre', flatElapsed);
    line('Flat satır', built.flatEntries.length);
    memLine('Flat build sonrası');

    if (cli.skipCalibrate) {
        console.log('\n⏭  --skip-calibrate: kalibrasyon atlandı.');
        if (db) db.close();
        return;
    }

    hr('AŞAMA 3 — Kalibrasyon (bellek-dostu terminal yolu)');
    const tCal = Date.now();
    const calTimings = await runTerminalCalibration(built);
    line('GostergeScoringEngine.calibrate', calTimings.gostergeCalibrate);
    line('Renk senaryo cache', calTimings.renkScenario);
    line('Hybrid + G1', calTimings.hybridG1);
    line('Kalibrasyon toplam', calTimings.total);
    line('Renk hazır', calTimings.renkReady ? 'evet' : 'hayır');
    line('Ptest hazır', calTimings.ptestReady ? 'evet' : 'hayır');
    memLine('Kalibrasyon bitiş');

    loadRenderEngines();
    memLine('Render motorları yüklendi');

    hr('AŞAMA 4 — SON TEST sekmesi (sonTestGoster — skorlama)');
    const tSon = Date.now();
    const sonTimings = await simulateSonTestGoster(kayit.races, meta, veriCache, calTimings);
    line('Tüm koşular render', sonTimings.allRaces);
    line('Toplam (Aşama 4)', msSince(tSon));
    memLine('Render sonrası');

    hr('AŞAMA 5 — Koşu başına kırılım');
    console.log('  ' + pad('KOŞU', 6) + pad('at', 5) + pad('ctx', 8) + pad('renk', 8)
        + pad('ptest', 9) + pad('gos', 8) + pad('BAŞ+', 8) + pad('TOPLAM', 9)
        + 'TAHMİN');
    for (const r of sonTimings.races) {
        console.log('  ' + pad(String(r.raceNo), 6) + pad(String(r.horses), 5)
            + pad(r.buildRaceContext, 8) + pad(r.renkScoreRace, 8)
            + pad(r.ptestScoreRaceAll, 9) + pad(r.buildSiraOneMap, 8)
            + pad(r.basAndBonuses, 8) + pad(r.total, 9)
            + (r.scoredHorses + ' at'));
    }

    const slowest = sonTimings.races.slice().sort((a, b) =>
        parseFloat(b.ptestScoreRaceAll) - parseFloat(a.ptestScoreRaceAll))[0];
    if (slowest) {
        console.log('\n  En yavaş koşu: #' + slowest.raceNo
            + ' (ptest ' + slowest.ptestScoreRaceAll + ', toplam ' + slowest.total + ')');
    }

    hr('ÖZET');
    const grand = (parseFloat(loadElapsed) + parseFloat(flatElapsed)
        + parseFloat(calTimings.total) + parseFloat(sonTimings.allRaces)).toFixed(2) + 's';
    line('Kayıt fetch', loadElapsed);
    line('Flat build', flatElapsed);
    line('Kalibrasyon', calTimings.total);
    line('Koşu skorlama', sonTimings.allRaces);
    line('GENEL TOPLAM (tahmini)', grand);
    console.log('\n  Tarayıcıda loadSonTestKayit aynı kayıt için:');
    console.log('    • Kalibrasyon (ilk sefer): ~' + calTimings.total);
    console.log('    • SON TEST tablosu: ~' + sonTimings.allRaces);
    console.log('    • refreshTestTabs tüm sekmeleri sırayla çalıştırır → ~8× daha uzun sürebilir');
    if (cli.fullRefresh) {
        const fr = await simulateFullRefresh(kayit.races, meta, veriCache);
        line('full-refresh notu', fr.note);
    }

    if (db) db.close();
}

main().catch(function (err) {
    console.error('\n❌ Hata:', err.stack || err.message);
    process.exit(1);
});
