#!/usr/bin/env node
/**
 * SON TEST kalibrasyon donması — terminal tanı scripti
 *
 * Tarayıcıda "PUANLAMA TEST kalibrasyonu yükleniyor…" takılmasının
 * kaynağını ölçer: kayıt sayısı, flat-entry build, Renk/Ptest kalibrasyonu.
 *
 * Kullanım:
 *   npm run test:son-test-calib
 *   node scripts/test-son-test-calibration-diagnose.js --db atlar.db
 *   node scripts/test-son-test-calibration-diagnose.js --kayit 161 --verbose
 *   node scripts/test-son-test-calibration-diagnose.js --simulate-parallel   # eski hatalı davranış
 *   node scripts/test-son-test-calibration-diagnose.js --base-url http://168.231.109.27  # canlı API
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    parseCliArgs,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    buildBitisStatsFromEntries,
    dbGet,
    dbAll,
    openDb,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);

function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    kayit: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    simulateParallel: args.includes('--simulate-parallel'),
    baseUrl: argVal('--base-url') || null,
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
    console.log('  ' + pad(label, 28) + String(value));
}

function loadSonTestEngines() {
    loadGostergeEngines();
    const files = [
        'basari-pct-scoring-engine.js',
        'hybrid-tahmin-scoring-engine.js',
        'astest-son-renk-tahmin.js',
        'astest-son-gosterge1-tahmin.js',
        'astest-son-ptest-tahmin.js'
    ];
    const globals = {
        'basari-pct-scoring-engine.js': 'BasariPctScoringEngine',
        'hybrid-tahmin-scoring-engine.js': 'HybridTahminScoringEngine',
        'astest-son-renk-tahmin.js': 'AtestSonRenkTahmin',
        'astest-son-gosterge1-tahmin.js': 'AtestSonGosterge1Tahmin',
        'astest-son-ptest-tahmin.js': 'AtestSonPtestTahmin'
    };
    for (const f of files) {
        const g = globals[f];
        eval(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8') + '\n; global.' + g + ' = ' + g + ';');
    }
}

async function countKayitlar(db) {
    const row = await dbGet(db, 'SELECT COUNT(*) AS n FROM hesaplama_kayitlari');
    const races = await dbGet(db, 'SELECT SUM(race_count) AS n FROM hesaplama_kayitlari');
    const horses = await dbGet(db, 'SELECT SUM(total_horses) AS n FROM hesaplama_kayitlari');
    return {
        kayitCount: row?.n || 0,
        raceCount: races?.n || 0,
        horseCount: horses?.n || 0
    };
}

/** Tarayıcı buildFlatEntriesFromApi ile aynı N+1 HTTP deseni (DB üzerinden simüle) */
async function simulateHttpFetchPattern(db) {
    const t0 = Date.now();
    let apiCalls = 2; // bitis + list
    const list = await dbAll(db, 'SELECT id FROM hesaplama_kayitlari ORDER BY id');
    apiCalls += list.length;
    let totalRaces = 0;
    let totalPkgMs = 0;
    const IE = global.IstatistikEngine;
    for (const row of list) {
        const kayit = await dbGet(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [row.id]);
        let races;
        try {
            races = JSON.parse(kayit.veri);
        } catch (_) {
            continue;
        }
        if (!Array.isArray(races)) continue;
        totalRaces += races.length;
        for (const race of races) {
            const tPkg = Date.now();
            IE.buildRaceIstatistikPackage(race, kayit.hipodrom, kayit.tarih);
            totalPkgMs += Date.now() - tPkg;
        }
    }
    return {
        elapsed: msSince(t0),
        apiCalls,
        kayitCount: list.length,
        raceCount: totalRaces,
        pkgCpuMs: totalPkgMs
    };
}

async function buildFlatOnce(db, filters) {
    const t0 = Date.now();
    const built = await buildFlatEntriesFromDb(db, filters || {});
    return {
        elapsed: msSince(t0),
        flatCount: built.flatEntries.length,
        built
    };
}

async function calibrateRenkFromDb(built) {
    const G = global.GostergeScoringEngine;
    const flatEntries = built.flatEntries;
    const bitisMap = built.bitisMap;
    const host = makeGostergeHost(flatEntries, bitisMap);
    const t0 = Date.now();
    await G.calibrate(flatEntries, host);
    let scenarioCount = 0;
    if (G.isCalibrated?.() && global.AtestSonRenkTahmin) {
        try {
            const colorRows = G.collectAllColorGostergeRows?.(flatEntries, host) || [];
            const configs = G.generateColorBenchmarkConfigs?.() || [];
            scenarioCount = configs.length;
        } catch (_) { /* */ }
    }
    return {
        elapsed: msSince(t0),
        calibrated: G.isCalibrated?.(),
        scenarioCount
    };
}

async function calibratePtestFromDb(built) {
    const G = global.GostergeScoringEngine;
    const flatEntries = built.flatEntries;
    const bitisMap = built.bitisMap;
    const host = makeGostergeHost(flatEntries, bitisMap);
    const t0 = Date.now();
    if (typeof global.HybridTahminScoringEngine !== 'undefined') {
        await global.HybridTahminScoringEngine.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort, { host: host });
    } else {
        await G.calibrate(flatEntries, host);
    }
    if (typeof global.AtestSonGosterge1Tahmin !== 'undefined') {
        global.AtestSonGosterge1Tahmin.calibrateFromFlatEntries(
            flatEntries, host.bitisValueForSort);
    }
    const hybridOk = typeof global.HybridTahminScoringEngine === 'undefined'
        || global.HybridTahminScoringEngine.isCalibrated?.();
    const g1Ok = typeof global.AtestSonGosterge1Tahmin === 'undefined'
        || global.AtestSonGosterge1Tahmin.isCalibrated?.();
    return {
        elapsed: msSince(t0),
        calibrated: G.isCalibrated?.() && hybridOk && g1Ok,
        cols: global.AtestSonPtestTahmin ? global.AtestSonPtestTahmin.getColumns().length : 0
    };
}

async function testHttpApi(baseUrl) {
    hr('CANLI API — HTTP N+1 ölçümü (' + baseUrl + ')');
    const t0 = Date.now();
    let calls = 0;
    try {
        calls++;
        const bitisRes = await fetch(baseUrl + '/api/puanlama-bitis-sonuclari');
        if (!bitisRes.ok) throw new Error('bitis HTTP ' + bitisRes.status);
        calls++;
        const listRes = await fetch(baseUrl + '/api/hesaplama-kayitlar');
        const listJson = await listRes.json();
        if (!listJson.success) throw new Error(listJson.error || 'liste hatası');
        const kayitlar = listJson.kayitlar || [];
        calls += kayitlar.length;
        line('HTTP çağrı sayısı (tahmini)', calls + ' (2 + ' + kayitlar.length + ' kayıt)');
        line('Kayıt sayısı', kayitlar.length);
        line('Liste fetch süresi', msSince(t0));
        if (cli.kayit) {
            const t1 = Date.now();
            const one = await fetch(baseUrl + '/api/hesaplama-kayit/' + cli.kayit);
            const oneJson = await one.json();
            line('Tek kayıt #' + cli.kayit + ' fetch', msSince(t1));
            if (oneJson.success && oneJson.kayit) {
                line('  koşu', (oneJson.kayit.veri || []).length);
                line('  hipodrom', oneJson.kayit.hipodrom);
            }
        }
    } catch (err) {
        console.log('  ❌ API erişilemedi: ' + err.message);
    }
}

async function main() {
    console.log('\n🔬 SON TEST kalibrasyon tanı — ' + new Date().toISOString());
    line('DB', cli.dbPath);
    if (cli.kayit) line('Filtre kayıt', cli.kayit);

    if (cli.baseUrl) {
        await testHttpApi(cli.baseUrl.replace(/\/$/, ''));
    }

    const db = openDb(cli.dbPath);

    try {
        loadSonTestEngines();

        hr('VERİTABANI ÖZET');
        const counts = await countKayitlar(db);
        line('Hesaplama kayıt sayısı', counts.kayitCount);
        line('Toplam koşu', counts.raceCount);
        line('Toplam at', counts.horseCount);
        if (counts.kayitCount > 50) {
            console.log('\n  ⚠️  ' + counts.kayitCount + ' kayıt → tarayıcıda her kalibrasyon '
                + counts.kayitCount + ' ayrı /api/hesaplama-kayit/{id} isteği yapar.');
        }

        hr('AŞAMA 1 — HTTP N+1 deseni simülasyonu (DB)');
        const httpSim = await simulateHttpFetchPattern(db);
        line('Süre', httpSim.elapsed);
        line('API çağrısı (tarayıcıda)', httpSim.apiCalls);
        line('buildRaceIstatistikPackage CPU', httpSim.pkgCpuMs + 'ms');
        line('Paralel ×2 tahmini', '~' + (parseFloat(httpSim.elapsed) * 2).toFixed(1) + 's (eski Promise.all hatası)');

        hr('AŞAMA 2 — buildFlatEntries (tek sefer, DB)');
        const once = await buildFlatOnce(db, cli.kayit ? { filterKayit: cli.kayit } : {});
        line('Süre', once.elapsed);
        line('Flat entry satır', once.flatCount);

        if (cli.simulateParallel) {
            hr('AŞAMA 2b — PARALEL çift build (ESKİ HATALI DAVRANIŞ)');
            const tPar = Date.now();
            await Promise.all([
                buildFlatOnce(db, cli.kayit ? { filterKayit: cli.kayit } : {}),
                buildFlatOnce(db, cli.kayit ? { filterKayit: cli.kayit } : {})
            ]);
            line('Paralel 2× buildFlatEntries süresi', msSince(tPar));
            console.log('  → Tarayıcıda Renk + Ptest Promise.all bu yükü 2 katına çıkarırdı.');
        }

        if (cli.skipCalibrate) {
            console.log('\n⏭  --skip-calibrate: kalibrasyon atlandı.');
            return;
        }

        hr('AŞAMA 3 — Renk kalibrasyonu (GostergeScoringEngine.calibrate)');
        const renk = await calibrateRenkFromDb(once.built);
        line('Süre', renk.elapsed);
        line('Kalibre', renk.calibrated ? 'evet' : 'hayır');
        line('Renk senaryo sayısı', renk.scenarioCount);

        hr('AŞAMA 4 — Ptest kalibrasyonu (Hybrid + G1, DB yolu)');
        const ptest = await calibratePtestFromDb(once.built);
        line('Süre', ptest.elapsed);
        line('Kalibre', ptest.calibrated ? 'evet' : 'hayır');
        line('Ptest sütun', ptest.cols);

        hr('AŞAMA 5 — Toplam kalibrasyon (Aşama 3+4 birleşik tahmini)');
        const totalCal = (parseFloat(renk.elapsed) + parseFloat(ptest.elapsed)).toFixed(2) + 's';
        line('CPU toplam (DB)', totalCal);
        line('Tarayıcıda + HTTP', '~' + httpSim.elapsed + ' fetch + ' + totalCal + ' calibrate');
        if (cli.simulateParallel) {
            line('Eski paralel ×2 fetch', '~' + (parseFloat(httpSim.elapsed) * 2).toFixed(1) + 's ek');
        }

        hr('SONUÇ / ÖNERİ');
        const kayitN = counts.kayitCount;
        if (kayitN > 80) {
            console.log('  🔴 Kök neden: ' + kayitN + ' kayıt × N+1 HTTP + ağır istatistik paketi.');
            console.log('     İlk kalibrasyon ' + httpSim.elapsed + '+ sürebilir; paralel çift çağrı ~2× yapar.');
        } else if (parseFloat(once.elapsed) > 30) {
            console.log('  🟡 buildFlatEntries yavaş (' + once.elapsed + ') — kayıt başına paket hesabı ağır.');
        } else {
            console.log('  🟢 DB tarafı makul sürede (' + once.elapsed + ' flat build).');
            console.log('     Takılma canlı sunucuda API gecikmesi veya eski JS (cache) olabilir.');
        }
        console.log('\n  Düzeltme kontrol listesi:');
        console.log('    • buildFlatEntriesFromApi tek uçuş önbelleği (gosterge-scoring-engine.js)');
        console.log('    • sonTestGoster: tek Ptest.ensureCalibration (paralel Renk+Ptest yok)');
        console.log('    • Ctrl+F5 ile tarayıcı önbelleğini temizle');
        console.log('    • Bu script: npm run test:son-test-calib');

    } finally {
        db.close();
    }
}

main().catch(function (err) {
    console.error('\n❌ Hata:', err.stack || err.message);
    process.exit(1);
});
