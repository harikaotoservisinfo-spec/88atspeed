#!/usr/bin/env node
/**
 * Kayıtlı yarışlarda TEK / S2 / S1 / YUV sütunlarının 1. ve ilk-4 eşleşme oranı.
 *
 *   node scripts/eval-tek-s2-s1-yuv-winners.js --db atlar.db
 *   node scripts/eval-tek-s2-s1-yuv-winners.js --api http://168.231.109.27:3023
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { buildKayitAnnotatedRaces } = require('../lib/public-kayit-degerlendirme');
const {
    horseRowKey, evalRaceColumns, topFinishKeys, aggregateColumnStats, pct
} = require('../lib/gosterge-column-eval');

const COL_KEYS = ['TEK', 'S2', 'S1', 'YUV'];

function argVal(flag, def) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : def;
}

function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
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

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    const data = await res.json();
    if (data.success === false) throw new Error(data.error || 'API hata');
    return data;
}

function attachBitisFromMap(horses, kayitId, raceNo, bitis) {
    return (horses || []).map((h) => {
        const bitisKey = kayitId + '|' + raceNo + '|' + String(h.no);
        const sira = bitis[bitisKey] != null ? Number(bitis[bitisKey]) : null;
        return Object.assign({}, h, { bitisSira: sira });
    });
}

function processRace(horses, meta) {
    if (horses.length < 2) return null;
    const winner = horses.find((h) => h.bitisSira === 1);
    if (!winner) return null;

    const top4Keys = topFinishKeys(horses, 4);
    if (!top4Keys.size) return null;

    const columns1 = evalRaceColumns(horses, horseRowKey(winner));
    const columns4 = evalRaceColumns(horses, top4Keys);

    return Object.assign({}, meta, {
        winnerNo: winner.no,
        top4Count: top4Keys.size,
        columns1,
        columns4
    });
}

function initMarkerTotals() {
    const o = {};
    for (const k of COL_KEYS) o[k] = 0;
    return o;
}

function addRaceToSummary(summary, race) {
    for (const key of COL_KEYS) {
        summary.markers1[key] += race.columns1[key].totalMarkers;
        summary.hitMarkers1[key] += race.columns1[key].hitMarkers;
        summary.markers4[key] += race.columns4[key].totalMarkers;
        summary.hitMarkers4[key] += race.columns4[key].hitMarkers;
    }
}

async function loadFromApi(apiBase) {
    const base = apiBase.replace(/\/$/, '');
    const listRes = await fetchJson(base + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = listRes.kayitlar || [];
    const raceResults = [];
    const kayitSummary = [];
    let skippedNoWinner = 0;

    for (const meta of kayitlar) {
        const data = await fetchJson(base + '/api/public/kayit-degerlendirme/' + meta.id);
        if (!data.bitisCount) { skippedNoWinner += data.kosular?.length || 0; continue; }

        let kayitRaces = 0;
        const summary = {
            id: data.kayitId,
            tarih: data.tarih,
            hipodrom: data.hipodrom,
            races: 0,
            markers1: initMarkerTotals(),
            hitMarkers1: initMarkerTotals(),
            markers4: initMarkerTotals(),
            hitMarkers4: initMarkerTotals()
        };

        for (const race of data.kosular || []) {
            const horses = race.horses || [];
            const result = processRace(horses, {
                kayitId: data.kayitId,
                tarih: data.tarih,
                hipodrom: data.hipodrom,
                raceNo: String(race.raceNo)
            });
            if (!result) { skippedNoWinner++; continue; }

            raceResults.push(result);
            kayitRaces++;
            addRaceToSummary(summary, result);
        }

        if (kayitRaces > 0) {
            summary.races = kayitRaces;
            kayitSummary.push(summary);
        }
    }

    return { raceResults, kayitSummary, skippedNoWinner, kayitCount: kayitlar.length, source: 'api:' + base };
}

async function loadFromDb(db) {
    const bitis = await loadBitisMap(db);
    const kayitlar = await dbAll(db,
        'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');

    const raceResults = [];
    const kayitSummary = [];
    let skippedNoWinner = 0;

    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri || '[]'); } catch (_) { continue; }
        if (!Array.isArray(races) || !races.length) continue;

        const annotated = await buildKayitAnnotatedRaces(db, races, {
            tarih: kayit.tarih,
            hipodrom: kayit.hipodrom
        });

        let kayitRaces = 0;
        const summary = {
            id: kayit.id,
            tarih: kayit.tarih,
            hipodrom: kayit.hipodrom,
            races: 0,
            markers1: initMarkerTotals(),
            hitMarkers1: initMarkerTotals(),
            markers4: initMarkerTotals(),
            hitMarkers4: initMarkerTotals()
        };

        for (const race of annotated) {
            const raceNo = String(race.raceNo);
            const horses = attachBitisFromMap(race.horses || [], kayit.id, raceNo, bitis);
            const result = processRace(horses, {
                kayitId: kayit.id,
                tarih: kayit.tarih,
                hipodrom: kayit.hipodrom,
                raceNo
            });
            if (!result) { skippedNoWinner++; continue; }

            raceResults.push(result);
            kayitRaces++;
            addRaceToSummary(summary, result);
        }

        if (kayitRaces > 0) {
            summary.races = kayitRaces;
            kayitSummary.push(summary);
        }
    }

    return { raceResults, kayitSummary, skippedNoWinner, kayitCount: kayitlar.length, source: 'db' };
}

function pad(s, n) {
    return String(s).padEnd(n);
}

function printAggSection(title, agg, hitLabel) {
    console.log('--- ' + title + ' ---');
    console.log(pad('Sütun', 8) + pad('Toplam işaret', 16) + pad(hitLabel + ' işaret', 14)
        + pad('İşaret %', 12) + pad('Koşu %var', 14) + pad('İşaretli koşu %', 18));
    for (const key of COL_KEYS) {
        const a = agg[key];
        console.log(
            pad(key, 8)
            + pad(a.totalMarkers, 16)
            + pad(a.hitMarkers, 14)
            + pad(a.markerHitPct != null ? a.markerHitPct + '%' : '—', 12)
            + pad(a.raceHitPct != null ? a.raceHitPct + '%' : '—', 14)
            + pad(a.raceHitAmongMarkedPct != null ? a.raceHitAmongMarkedPct + '%' : '—', 18)
        );
    }
    console.log('');
}

function printKayitSection(kayitSummary, fieldPrefix) {
    const pctCols = fieldPrefix === '1'
        ? ['hitMarkers1', 'markers1']
        : ['hitMarkers4', 'markers4'];
    console.log(pad('ID', 6) + pad('Tarih', 12) + pad('Hipodrom', 14) + pad('Koşu', 6)
        + pad('TEK%', 8) + pad('S2%', 8) + pad('S1%', 8) + pad('YUV%', 8));
    for (const k of kayitSummary) {
        const hitM = k[pctCols[0]];
        const totalM = k[pctCols[1]];
        const cols = COL_KEYS.map((c) => {
            const p = pct(hitM[c], totalM[c]);
            return p != null ? p + '%' : '—';
        });
        console.log(
            pad(k.id, 6)
            + pad(k.tarih, 12)
            + pad((k.hipodrom || '').slice(0, 12), 14)
            + pad(k.races, 6)
            + pad(cols[0], 8)
            + pad(cols[1], 8)
            + pad(cols[2], 8)
            + pad(cols[3], 8)
        );
    }
}

function printReport({ raceResults, kayitSummary, skippedNoWinner, kayitCount, source }) {
    const agg1 = aggregateColumnStats(raceResults, 'columns1');
    const agg4 = aggregateColumnStats(raceResults, 'columns4');
    const avgTop4 = raceResults.length
        ? Math.round((raceResults.reduce((s, r) => s + r.top4Count, 0) / raceResults.length) * 10) / 10
        : 0;

    console.log('\n=== TEK / S2 / S1 / YUV — 1. ve İLK-4 İŞARET ANALİZİ ===');
    console.log('Kaynak: ' + source);
    console.log('Kayıt sayısı: ' + kayitCount);
    console.log('Analiz edilen koşu (1. bilinen): ' + raceResults.length);
    console.log('Ortalama bilinen ilk-4 at/koşu: ' + avgTop4);
    console.log('Atlanan koşu (1. bilinmiyor): ' + skippedNoWinner + '\n');

    printAggSection('1. ÇIKAN', agg1, '1.de');
    printAggSection('İLK 4 (bitisSira 1–4)', agg4, 'ilk4de');

    console.log('Açıklama:');
    console.log('  İşaret %     = koşulardaki tüm sütun işaretlerinin kaçı hedef grubun (1. veya ilk-4) üzerinde');
    console.log('  Koşu %var    = hedef grubun bu sütunda ≥1 işaret taşıdığı koşu oranı');
    console.log('  İşaretli koşu % = sütunda işaret varken hedef grubun işaret taşıdığı koşu oranı\n');

    console.log('--- KAYIT BAZLI (1. çıkan — işaret %) ---');
    printKayitSection(kayitSummary, '1');
    console.log('\n--- KAYIT BAZLI (ilk 4 — işaret %) ---');
    printKayitSection(kayitSummary, '4');
}

async function main() {
    const apiBase = argVal('--api', null);
    if (apiBase) {
        printReport(await loadFromApi(apiBase));
        return;
    }

    const dbPath = argVal('--db', path.join(__dirname, '..', 'atlar.db'));
    const db = await openDb(dbPath);
    const result = await loadFromDb(db);
    db.close();
    printReport(Object.assign(result, { source: 'db:' + dbPath }));
}

main().catch((e) => { console.error('HATA:', e.message || e); process.exit(1); });
