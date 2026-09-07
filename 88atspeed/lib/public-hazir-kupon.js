/**
 * Hazır Kupon — TEK/S2/S1/YUV ilk-4 tahminleri + kayıt kalibrasyonu + günlük başarı
 */
const publicProgram = require('./public-program');
const publicKayitDegerlendirme = require('./public-kayit-degerlendirme');
const sonucStore = require('./public-sonuc-store');
const {
    horseRowKey,
    evalRaceColumns,
    topFinishKeys,
    aggregateColumnStats,
    pct
} = require('./gosterge-column-eval');
const {
    COL_KEYS,
    analyzeRacePredictions,
    normalizeRates,
    evaluateRaceResult,
    getActualTop4
} = require('./gosterge-predict');

const CALIB_CACHE_MS = 10 * 60 * 1000;
let calibCache = { at: 0, data: null };

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

async function ensureTables(db) {
    await dbRun(db, `CREATE TABLE IF NOT EXISTS hazir_kupon_snapshots (
        tarih TEXT NOT NULL,
        hipodrom_id TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        veri TEXT NOT NULL,
        guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tarih, hipodrom_id, race_no)
    )`);
}

async function loadBitisMap(db) {
    try {
        const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (!row?.veri) return {};
        return JSON.parse(row.veri).bitis || {};
    } catch (_) {
        return {};
    }
}

/** Kayıtlardan kalibrasyon + havuz başarı istatistikleri */
async function computeCalibration(db, opts = {}) {
    if (!opts.force && calibCache.data && Date.now() - calibCache.at < CALIB_CACHE_MS) {
        return calibCache.data;
    }

    const bitis = await loadBitisMap(db);
    const kayitlar = await dbAll(db,
        'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');

    const raceResults1 = [];
    const raceResults4 = [];
    const poolStats = {
        races: 0,
        racesWithPicks: 0,
        racesWithHit: 0,
        totalPicks: 0,
        pickHits: 0,
        hitDistribution: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
    };
    const horseStats = { withMarkers: 0, top4Hits: 0 };

    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri || '[]'); } catch (_) { continue; }
        if (!Array.isArray(races) || !races.length) continue;

        const annotated = await publicKayitDegerlendirme.buildKayitAnnotatedRaces(db, races, {
            tarih: kayit.tarih,
            hipodrom: kayit.hipodrom
        });

        for (const race of annotated) {
            const raceNo = String(race.raceNo);
            const horses = (race.horses || []).map((h) => {
                const bitisKey = kayit.id + '|' + raceNo + '|' + String(h.no);
                const sira = bitis[bitisKey] != null ? Number(bitis[bitisKey]) : null;
                return Object.assign({}, h, { bitisSira: sira });
            });

            const winner = horses.find((h) => h.bitisSira === 1);
            if (!winner) continue;

            const top4Keys = topFinishKeys(horses, 4);
            if (!top4Keys.size) continue;

            const columns1 = evalRaceColumns(horses, horseRowKey(winner));
            const columns4 = evalRaceColumns(horses, top4Keys);
            raceResults1.push({ columns: columns1 });
            raceResults4.push({ columns: columns4 });

            const rates = normalizeRates(null);
            const pred = analyzeRacePredictions(horses, rates, 4);
            const actualTop4 = horses
                .filter((h) => h.bitisSira >= 1 && h.bitisSira <= 4)
                .sort((a, b) => a.bitisSira - b.bitisSira)
                .map((h) => String(h.no));

            if (pred.picks.length) {
                poolStats.racesWithPicks++;
                const ev = evaluateRaceResult(pred.picks, actualTop4);
                poolStats.races++;
                if (ev.poolHit) poolStats.racesWithHit++;
                poolStats.totalPicks += ev.pickCount;
                poolStats.pickHits += ev.hitCount;
                const bucket = Math.min(4, ev.hitCount);
                poolStats.hitDistribution[bucket] = (poolStats.hitDistribution[bucket] || 0) + 1;
            }

            for (const h of pred.allHorses) {
                if (h.totalMarkers <= 0) continue;
                horseStats.withMarkers++;
                const horse = horses.find((x) => String(x.no) === h.no);
                if (horse?.bitisSira >= 1 && horse.bitisSira <= 4) horseStats.top4Hits++;
            }
        }
    }

    const agg1 = aggregateColumnStats(raceResults1);
    const agg4 = aggregateColumnStats(raceResults4);

    const columns = {};
    for (const key of COL_KEYS) {
        columns[key] = {
            label: key,
            first: {
                markerHitPct: agg1[key].markerHitPct,
                raceHitPct: agg1[key].raceHitPct,
                raceHitAmongMarkedPct: agg1[key].raceHitAmongMarkedPct,
                totalMarkers: agg1[key].totalMarkers,
                hitMarkers: agg1[key].hitMarkers,
                races: agg1[key].races
            },
            top4: {
                markerHitPct: agg4[key].markerHitPct,
                raceHitPct: agg4[key].raceHitPct,
                raceHitAmongMarkedPct: agg4[key].raceHitAmongMarkedPct,
                totalMarkers: agg4[key].totalMarkers,
                hitMarkers: agg4[key].hitMarkers,
                races: agg4[key].races
            }
        };
    }

    const data = {
        kayitRaceCount: raceResults4[0] ? agg4.TEK.races : 0,
        columns,
        pool: {
            races: poolStats.races,
            racesWithPicks: poolStats.racesWithPicks,
            raceHitPct: pct(poolStats.racesWithHit, poolStats.races),
            pickHitPct: pct(poolStats.pickHits, poolStats.totalPicks),
            avgHitsPerRace: poolStats.races
                ? Math.round((poolStats.pickHits / poolStats.races) * 100) / 100
                : null,
            hitDistribution: poolStats.hitDistribution,
            horseTop4Pct: pct(horseStats.top4Hits, horseStats.withMarkers)
        },
        updatedAt: new Date().toISOString()
    };

    calibCache = { at: Date.now(), data };
    return data;
}

async function saveRaceSnapshot(db, tarih, hipId, raceNo, veri) {
    await dbRun(db,
        `INSERT INTO hazir_kupon_snapshots (tarih, hipodrom_id, race_no, veri, guncelleme)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(tarih, hipodrom_id, race_no)
         DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`,
        [tarih, String(hipId), Number(raceNo), JSON.stringify(veri)]);
}

async function buildHazirKupon(db, opts = {}) {
    await ensureTables(db);
    const tarih = opts.tarih || publicProgram.isoToTr(opts.iso) || publicProgram.todayTr();
    const iso = opts.iso || publicProgram.trToIso(tarih);
    if (!tarih) throw new Error('Geçersiz tarih');

    const calibration = await computeCalibration(db, opts);
    const rates = normalizeRates(calibration);

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

    const gunluk = {
        races: 0,
        finished: 0,
        poolHits: 0,
        pickHits: 0,
        totalPicks: 0
    };

    const hipResults = [];

    for (const hip of hipodromlar) {
        const stored = sonucByHip[hip.id];
        const resultByNo = new Map();
        for (const race of stored?.races || []) {
            if ((race.horses || []).length) resultByNo.set(String(race.raceNo), race);
        }

        const races = [];
        for (const progRace of hip.kosular || []) {
            const raceNo = String(progRace.raceNo);
            const pred = analyzeRacePredictions(progRace.horses || [], rates, 4);
            const resultRace = resultByNo.get(raceNo);
            const actualTop4 = resultRace ? getActualTop4(resultRace) : [];
            const finished = actualTop4.length > 0;

            let evaluation = null;
            if (finished && pred.picks.length) {
                evaluation = evaluateRaceResult(pred.picks, actualTop4);
                gunluk.finished++;
                gunluk.races++;
                gunluk.totalPicks += evaluation.pickCount;
                gunluk.pickHits += evaluation.hitCount;
                if (evaluation.poolHit) gunluk.poolHits++;
            } else if (pred.picks.length) {
                gunluk.races++;
                gunluk.totalPicks += pred.picks.length;
            }

            const raceData = {
                raceNo: progRace.raceNo,
                mesafe: progRace.mesafe || progRace.distance || '',
                saat: progRace.saat || progRace.time || '',
                horseCount: pred.horseCount,
                markedCount: pred.markedCount,
                picks: evaluation ? evaluation.picks : pred.picks,
                status: finished ? 'finished' : (pred.picks.length ? 'pending' : 'empty'),
                actualTop4: finished ? actualTop4 : [],
                hitCount: evaluation?.hitCount ?? null,
                hitPct: evaluation?.hitPct ?? null,
                poolHit: evaluation?.poolHit ?? null
            };

            races.push(raceData);
            await saveRaceSnapshot(db, tarih, hip.id, raceNo, raceData);
        }

        hipResults.push({
            id: hip.id,
            name: hip.name,
            kosuSayisi: hip.kosuSayisi,
            ilkKosuSaat: hip.ilkKosuSaat,
            finishedCount: races.filter((r) => r.status === 'finished').length,
            races
        });
    }

    return {
        success: true,
        tarih,
        iso: publicProgram.trToIso(tarih),
        yayinli: vitrin.yayinli,
        calibration,
        gunlukBasari: {
            races: gunluk.races,
            finished: gunluk.finished,
            pending: gunluk.races - gunluk.finished,
            poolHitPct: pct(gunluk.poolHits, gunluk.finished),
            pickHitPct: pct(gunluk.pickHits, gunluk.totalPicks),
            avgHitsPerRace: gunluk.finished
                ? Math.round((gunluk.pickHits / gunluk.finished) * 100) / 100
                : null
        },
        hipodromlar: hipResults
    };
}

module.exports = {
    ensureTables,
    computeCalibration,
    buildHazirKupon
};
