#!/usr/bin/env node
/**
 * Bugünkü programlarda TEK/S2/S1/YUV işaretlerine göre ilk-4 ihtimali (koşu koşu).
 *
 *   node scripts/predict-today-top4.js --api http://168.231.109.27:3023 --tarih 07/09/2026 --kayit 179,180
 */
const path = require('path');
const {
    horseRowKey,
    COLUMN_DEFS,
    pct
} = require('../lib/gosterge-column-eval');

const COL_KEYS = ['TEK', 'S2', 'S1', 'YUV'];

/** Geçmiş ilk-4 koşu isabet oranları (işaret / koşu / işaretli koşu) */
const HIST_RACE = {
    TEK: { marker: 0.408, race: 0.851, markedRace: 0.949 },
    S2: { marker: 0.408, race: 0.667, markedRace: 0.773 },
    S1: { marker: 0.444, race: 0.598, markedRace: 0.754 },
    YUV: { marker: 0.433, race: 0.701, markedRace: 0.910 }
};

function argVal(flag, def) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : def;
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    const data = await res.json();
    if (data.success === false) throw new Error(data.error || 'API hata');
    return data;
}

function getHorseMarkers(horses) {
    const byHorse = new Map();
    for (const col of COLUMN_DEFS) {
        const map = col.getMarkers(horses);
        for (const [key, list] of map) {
            if (!byHorse.has(key)) byHorse.set(key, { TEK: [], S2: [], S1: [], YUV: [] });
            byHorse.get(key)[col.key] = list;
        }
    }
    return byHorse;
}

/** Tek işaret tipi için P(top4) — marker sayısına göre bağımsızlık varsayımı */
function colProb(colKey, markerCount) {
    if (!markerCount) return 0;
    const p = HIST_RACE[colKey].marker;
    return 1 - Math.pow(1 - p, markerCount);
}

/** Sütunları birleştir: 1 - ∏(1-p_col) */
function combineColProbs(colCounts) {
    let miss = 1;
    for (const key of COL_KEYS) {
        const n = colCounts[key] || 0;
        if (n > 0) miss *= (1 - colProb(key, n));
    }
    return 1 - miss;
}

function markerLabel(y) {
    if (y.s8) return '8';
    if (y.tei) return 'T';
    if (y.t1y || y.t1ym || y.t1yk) return '●T1';
    if (y.t2y || y.t2ym || y.t2yk) return '●T2';
    if (y.t3y || y.t3ym || y.t3yk) return '●T3';
    if (y.t4) return '4';
    if (y.tkl) return 'P';
    if (y.t12) return '2';
    return '★';
}

function formatMarkerSummary(colCounts, colLists) {
    const parts = [];
    for (const key of COL_KEYS) {
        const n = colCounts[key] || 0;
        if (!n) continue;
        const glyphs = (colLists[key] || []).map(markerLabel).join('');
        parts.push(key + '(' + n + ':' + glyphs + ')');
    }
    return parts.length ? parts.join(' ') : '—';
}

function normalizeRaceProbs(horses) {
    const sum = horses.reduce((s, h) => s + h.top4Prob, 0);
    if (sum <= 0) return horses;
    return horses.map((h) => Object.assign({}, h, {
        raceSharePct: Math.round((h.top4Prob / sum) * 1000) / 10
    }));
}

function analyzeRace(race) {
    const horses = race.horses || [];
    const markerMap = getHorseMarkers(horses);
    const results = [];

    for (const h of horses) {
        const key = horseRowKey(h);
        const cols = markerMap.get(key) || { TEK: [], S2: [], S1: [], YUV: [] };
        const colCounts = {
            TEK: cols.TEK.length,
            S2: cols.S2.length,
            S1: cols.S1.length,
            YUV: cols.YUV.length
        };
        const totalMarkers = COL_KEYS.reduce((s, k) => s + colCounts[k], 0);
        const top4Prob = totalMarkers > 0 ? combineColProbs(colCounts) : 0;
        const colProbs = {};
        for (const k of COL_KEYS) colProbs[k] = colCounts[k] > 0 ? Math.round(colProb(k, colCounts[k]) * 1000) / 10 : null;

        results.push({
            no: h.no,
            name: h.name,
            colCounts,
            colProbs,
            colLists: cols,
            totalMarkers,
            top4Prob: Math.round(top4Prob * 1000) / 10,
            markerSummary: formatMarkerSummary(colCounts, cols)
        });
    }

    const withMarkers = results.filter((h) => h.totalMarkers > 0)
        .sort((a, b) => b.top4Prob - a.top4Prob || b.totalMarkers - a.totalMarkers);
    const normalized = normalizeRaceProbs(withMarkers);

    return {
        raceNo: race.raceNo,
        mesafe: race.mesafe || race.distance || '',
        horseCount: horses.length,
        markedCount: withMarkers.length,
        candidates: normalized,
        allHorses: results.sort((a, b) => Number(a.no) - Number(b.no))
    };
}

function pad(s, n) {
    return String(s).padEnd(n);
}

function printHipodromReport(data) {
    console.log('\n' + '='.repeat(72));
    console.log('  ' + data.hipodrom + ' — ' + data.tarih + '  (Kayıt #' + data.kayitId + ')');
    console.log('='.repeat(72));

    for (const race of data.races) {
        console.log('\n--- KOŞU ' + race.raceNo + (race.mesafe ? ' (' + race.mesafe + ')' : '') + ' — ' + race.horseCount + ' at ---');

        if (!race.candidates.length) {
            console.log('  İşaretli at yok (TEK/S2/S1/YUV boş)');
            continue;
        }

        console.log(pad('No', 5) + pad('At', 22) + pad('İşaretler', 28)
            + pad('İlk4%', 8) + pad('Koşu payı', 10) + 'Sütun ihtimalleri');
        for (const h of race.candidates) {
            const colDetail = COL_KEYS
                .filter((k) => h.colProbs[k] != null)
                .map((k) => k + ':' + h.colProbs[k] + '%')
                .join(' ');
            const name = (h.name || '').slice(0, 20);
            console.log(
                pad(h.no, 5)
                + pad(name, 22)
                + pad(h.markerSummary.slice(0, 26), 28)
                + pad(h.top4Prob + '%', 8)
                + pad((h.raceSharePct || 0) + '%', 10)
                + colDetail
            );
        }

        const top4Pick = race.candidates.slice(0, 4);
        if (top4Pick.length) {
            console.log('  → Önerilen ilk-4 havuzu: ' + top4Pick.map((h) => h.no + '(' + h.top4Prob + '%)').join(', '));
        }
    }
}

async function main() {
    const apiBase = (argVal('--api', 'http://168.231.109.27:3023')).replace(/\/$/, '');
    const tarih = argVal('--tarih', '07/09/2026');
    const kayitFilter = (argVal('--kayit', '179,180') || '').split(',').map((s) => Number(s.trim())).filter(Boolean);

    const listRes = await fetchJson(apiBase + '/api/public/kayit-degerlendirme/kayitlar');
    const kayitlar = (listRes.kayitlar || []).filter((k) => {
        if (k.tarih !== tarih) return false;
        if (kayitFilter.length && !kayitFilter.includes(k.id)) return false;
        return true;
    });

    if (!kayitlar.length) {
        console.log('Kayıt bulunamadı: ' + tarih);
        process.exit(1);
    }

    console.log('\n=== BUGÜN İLK-4 TAHMİN — TEK / S2 / S1 / YUV ===');
    console.log('Tarih: ' + tarih);
    console.log('Hipodromlar: ' + kayitlar.map((k) => k.hipodrom + ' #' + k.id).join(', '));
    console.log('\nModel: geçmiş 87 koşu ilk-4 isabet oranları');
    console.log('  TEK işaret→ilk4: 40.8%  |  S2: 40.8%  |  S1: 44.4%  |  YUV: 43.3%');
    console.log('  At ihtimali = 1 - ∏(1-p_sütun^işaret_sayısı); koşu payı = normalize');

    for (const meta of kayitlar) {
        const data = await fetchJson(apiBase + '/api/public/kayit-degerlendirme/' + meta.id);
        const races = (data.kosular || []).map(analyzeRace).sort((a, b) => Number(a.raceNo) - Number(b.raceNo));
        printHipodromReport({
            kayitId: data.kayitId,
            hipodrom: data.hipodrom,
            tarih: data.tarih,
            races
        });
    }
}

main().catch((e) => { console.error('HATA:', e.message || e); process.exit(1); });
