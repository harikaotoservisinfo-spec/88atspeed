/**
 * Kamu vitrini — günlük program koşuları için hibrit tahmin üretimi.
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    openDb,
    dbAll
} = require('../scripts/ptest-terminal-lib');
const { annotateKosular } = require('./t1dr-test1-match');

let enginesLoaded = false;
let calibrationPromise = null;

function loadEngineFile(file, globalName) {
    const src = fs.readFileSync(path.join(ROOT, 'public/js', file), 'utf8');
    eval(src + '\n; global.' + globalName + ' = ' + globalName + ';');
}

function loadScoringEngines() {
    if (enginesLoaded) return;
    if (!global.GostergeScoringEngine) {
        loadGostergeEngines();
    }
    const extra = [
        ['basari-pct-scoring-engine.js', 'BasariPctScoringEngine'],
        ['hybrid-tahmin-scoring-engine.js', 'HybridTahminScoringEngine'],
        ['at-meta-fields.js', 'AtMetaFields'],
        ['son800-depth-ui.js', 'Son800DepthUi'],
        ['siklet-bas-delta-boost.js', 'SikletBasDeltaBoost'],
        ['astest-son800-shared.js', 'AtestSon800Shared'],
        ['field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['sehir-stats-engine.js', 'SehirStatsEngine'],
        ['kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['dimension-tahmin-boost-engine.js', 'DimensionTahminBoostEngine'],
        ['astest-son-ptest-tahmin.js', 'AtestSonPtestTahmin'],
        ['astest-son-renk-tahmin.js', 'AtestSonRenkTahmin'],
        ['astest-son-gosterge1-tahmin.js', 'AtestSonGosterge1Tahmin'],
        ['astest-son-gosterim-cols.js', 'AtestSonGosterimCols']
    ];
    for (const [file, name] of extra) {
        if (!global[name]) loadEngineFile(file, name);
    }
    enginesLoaded = true;
}

async function ensureCalibration(db, dbPath) {
    if (calibrationPromise) return calibrationPromise;
    calibrationPromise = (async () => {
        const { buildCalibrationBundle } = require('./calibration-bundle');
        const built = await buildCalibrationBundle(dbPath || path.join(ROOT, 'atlar.db'));
        loadScoringEngines();
        const b = built.bundle;
        const G = global.GostergeScoringEngine;
        if (!G.importCalibrationBundle?.(b.gosterge)) {
            throw new Error('Gösterge kalibrasyon paketi yüklenemedi');
        }
        if (global.BasariPctScoringEngine && b.basari?.weightsBySize) {
            global.BasariPctScoringEngine.importBundle?.(b.basari);
        }
        if (global.HybridTahminScoringEngine && b.hybrid) {
            global.HybridTahminScoringEngine.importCalibrationBundle?.(b.hybrid);
        }
        if (global.AtestSonGosterge1Tahmin && b.g1) {
            global.AtestSonGosterge1Tahmin.importRates?.(b.g1);
        }
        if (global.AtestSonRenkTahmin) {
            global.AtestSonRenkTahmin.onBundleLoaded?.();
        }
        G.loadSharedCalibrationBundle = async () => true;
        return { flatCount: built.flatCount };
    })();
    return calibrationPromise;
}

function atCacheKey(atId) {
    if (atId == null || atId === '') return null;
    const n = Number(atId);
    return Number.isFinite(n) ? n : String(atId);
}

function parseKayitVeri(raw) {
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(data) ? data : null;
    } catch (_) {
        return null;
    }
}

async function buildAtIdKosularIndex(db) {
    const index = new Map();
    for (const table of ['hesaplama_kayitlari', 'at_verileri']) {
        let rows;
        try {
            rows = await dbAll(db, `SELECT id, hipodrom, tarih, veri FROM ${table} ORDER BY id DESC`);
        } catch (_) {
            continue;
        }
        for (const kayit of rows || []) {
            const races = parseKayitVeri(kayit.veri);
            if (!races) continue;
            for (const race of races) {
                for (const horse of race.horses || []) {
                    const atId = horse.atId != null ? String(horse.atId) : '';
                    const kosular = horse.kosular || [];
                    if (!atId || !kosular.length) continue;
                    const prev = index.get(atId);
                    if (!prev || kosular.length > prev.kosular.length) {
                        index.set(atId, { kosular, source: table + '#' + kayit.id });
                    }
                }
            }
        }
    }
    return index;
}

function veriCacheFromAtIndex(atIndex) {
    const veriCache = {};
    for (const [atId, rec] of atIndex) {
        if (rec?.kosular?.length) veriCache[atId] = rec.kosular;
    }
    return veriCache;
}

function resolveHorseKosular(veriCache, horse) {
    const key = atCacheKey(horse?.atId);
    const cached = key != null ? veriCache[key] : null;
    if (cached?.length) return cached;
    return horse?.kosular || [];
}

function horseKey(h) {
    if (h?.atId != null && h.atId !== '') return String(h.atId);
    if (h?.no != null && h.no !== '') return 'no:' + String(h.no);
    if (h?.name) return 'name:' + String(h.name);
    return null;
}

function hpFallbackTahminler(race) {
    const horses = [...(race.horses || [])].sort((a, b) => {
        const ha = parseInt(String(a.hp || '').replace(/\D/g, ''), 10) || 0;
        const hb = parseInt(String(b.hp || '').replace(/\D/g, ''), 10) || 0;
        return hb - ha;
    });
    return horses.slice(0, 4).map((h, i) => ({
        rank: i + 1,
        horseNo: h.no,
        horseName: h.name,
        pct: null,
        label: horses.some(x => x.atId) ? 'HP (veri yok)' : 'HP'
    }));
}

function mapScoreMapToTahminler(race, scoreMap, label) {
    if (!scoreMap || !scoreMap.size) return null;
    const rows = [];
    for (const h of race.horses || []) {
        const key = horseKey(h);
        const t = scoreMap.get(key)
            || scoreMap.get('no:' + String(h.no))
            || scoreMap.get('name:' + String(h.name));
        if (!t) continue;
        const rawScore = t.score != null ? Number(t.score) : (t.pct != null ? Number(t.pct) : 0);
        rows.push({ horse: h, score: rawScore, tahmin: t, ineligible: !!t.ineligible });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 4).map((r, i) => ({
        rank: i + 1,
        horseNo: r.horse.no,
        horseName: r.horse.name,
        pct: r.tahmin.pct != null && r.tahmin.pct > 0 ? Math.round(Number(r.tahmin.pct)) : null,
        score: r.score > 0 ? Math.round(r.score * 10) / 10 : null,
        label: r.ineligible ? 'Veri yok' : (label || 'Hibrit')
    }));
}

function mergeHybridAndHp(race, hybridList) {
    const out = (hybridList || []).slice();
    const used = new Set(out.map((t) => String(t.horseNo)));
    const hpRows = hpFallbackTahminler(race).filter((t) => !used.has(String(t.horseNo)));
    let rank = out.length;
    for (const t of hpRows) {
        rank++;
        out.push(Object.assign({}, t, { rank, label: 'HP sırası' }));
        if (out.length >= 4) break;
    }
    return out;
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

const PTEST_SCORE_KEYS = ['mtr', 't9v', 'asf', 'g1side', 'g1pair', 'go', 'hyb'];

function serializeScoreCell(t) {
    if (!t || t.rank == null || t.pct == null || Number(t.pct) <= 0) return null;
    return {
        rank: Number(t.rank),
        pct: Math.round(Number(t.pct)),
        score: t.score != null ? Number(t.score) : null
    };
}

function computeBasForSource(horse, race, meta, sourceKey, sonCtx, veriCache, hedefSehir) {
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
        const horseCtx = Object.assign({}, horse, { kosular });
        const hedef = dim.getTarget(horseCtx, race);
        st = global.KosuDimensionStatsEngine.computeStats(kosular, sourceKey, hedef, programTarih);
    }
    if (global.AtestSon800Shared && sonCtx) {
        st = global.AtestSon800Shared.applyBasDeltaBoost(st, horse, sonCtx);
    }
    return st;
}

function lookupHorseScores(map, horse) {
    if (!map || !horse) return null;
    return map[horseKey(horse)]
        || map['no:' + String(horse.no)]
        || map['name:' + String(horse.name)]
        || null;
}

function scoreRaceHorseColumns(race, meta, veriCache) {
    if (!global.GostergeScoringEngine?.isCalibrated?.()) return {};
    const resolveKos = (h) => resolveHorseKosular(veriCache, h);
    const panelRace = programRaceToPanel(race);
    const hedefSehir = meta?.hipodrom || '';
    const programTarih = meta?.tarih || null;
    const horses = race.horses || [];
    if (!horses.length) return {};

    global.veriCache = veriCache;
    const sonCtx = global.AtestSon800Shared
        ? global.AtestSon800Shared.buildRaceContext(panelRace, panelRace.horses, hedefSehir, programTarih)
        : null;

    let renkByKey = new Map();
    if (global.AtestSonRenkTahmin) {
        renkByKey = global.AtestSonRenkTahmin.scoreRace(panelRace, meta, resolveKos) || new Map();
    }

    let ptestByCol = {};
    if (global.AtestSonPtestTahmin) {
        ptestByCol = global.AtestSonPtestTahmin.scoreRaceAll(panelRace, meta, resolveKos) || {};
    }

    let gosByKey = new Map();
    if (global.AtestSonGosterimCols) {
        gosByKey = global.AtestSonGosterimCols.buildSiraOneMap(panelRace, meta, resolveKos) || new Map();
    }

    const horseRows = horses.map((h) => {
        const basBySource = {};
        for (const src of SON_TEST_BAS_SOURCES) {
            basBySource[src.key] = computeBasForSource(
                h, panelRace, meta, src.key, sonCtx, veriCache, hedefSehir);
        }
        return { h, basBySource, tahmin: null, renkTahmin: null, ptestTahmin: {} };
    });

    if (global.DimensionTahminBoostEngine) {
        global.DimensionTahminBoostEngine.computeDimensionOnlyFromBasBySource(horseRows);
    }
    if (global.AtestSonGosterimCols && gosByKey.size) {
        global.AtestSonGosterimCols.applyTahminBonuses(
            horseRows, gosByKey, panelRace, meta, resolveKos);
    }

    const byHorse = {};
    for (const row of horseRows) {
        const rk = horseKey(row.h);
        if (!rk) continue;
        if (renkByKey.size) row.renkTahmin = renkByKey.get(rk) || null;
        const pt = {};
        for (const colId of PTEST_SCORE_KEYS) {
            pt[colId] = ptestByCol[colId]?.get(rk) || null;
        }
        const scores = {
            tahmin: serializeScoreCell(row.tahmin),
            r2: serializeScoreCell(row.renkTahmin),
            mtr: serializeScoreCell(pt.mtr),
            t9v: serializeScoreCell(pt.t9v),
            asf: serializeScoreCell(pt.asf),
            g1side: serializeScoreCell(pt.g1side),
            g1pair: serializeScoreCell(pt.g1pair),
            go: serializeScoreCell(pt.go),
            hyb: serializeScoreCell(pt.hyb)
        };
        byHorse[rk] = scores;
        if (row.h.no != null && row.h.no !== '') byHorse['no:' + String(row.h.no)] = scores;
        if (row.h.name) byHorse['name:' + String(row.h.name)] = scores;
    }
    return byHorse;
}

function scorePublicRace(race, meta, veriCache) {
    const resolveKos = (h) => resolveHorseKosular(veriCache, h);
    const calibrated = global.GostergeScoringEngine?.isCalibrated?.()
        && global.HybridTahminScoringEngine?.isCalibrated?.();
    if (!calibrated) {
        return { tahminler: hpFallbackTahminler(race), engine: 'hp-fallback' };
    }
    const cols = global.AtestSonPtestTahmin.scoreRaceAll(race, meta, resolveKos);
    const hyb = mapScoreMapToTahminler(race, cols.hyb, 'Hibrit');
    if (hyb?.length) {
        return { tahminler: mergeHybridAndHp(race, hyb), engine: 'hybrid' };
    }
    const go = mapScoreMapToTahminler(race, cols.go, 'Gösterge');
    if (go?.length) {
        return { tahminler: mergeHybridAndHp(race, go), engine: 'gosterge' };
    }
    return { tahminler: hpFallbackTahminler(race), engine: 'hp-fallback' };
}

function programHorseToPanel(h) {
    return {
        no: h.no,
        name: h.name,
        atId: h.atId || '',
        siklet: h.siklet,
        hp: h.hp,
        yas: h.yas,
        jokey: h.jokey,
        taki: h.taki
    };
}

function programRaceToPanel(race) {
    return {
        raceNo: race.raceNo,
        saat: race.saat,
        mesafe: race.mesafe,
        pist: race.pist,
        baslik: race.baslik,
        kategori: race.kategori,
        kcins_kosu: race.kcins_kosu,
        horses: (race.horses || []).map(programHorseToPanel)
    };
}

async function buildTahminForHipodrom(db, tarih, hipodromRow, opts = {}) {
    const races = JSON.parse(hipodromRow.program_json || '[]');
    if (!races.length) {
        return { hipodrom: hipodromRow.hipodrom, raceCount: 0, scored: 0, byRace: {} };
    }

    const atIndex = await buildAtIdKosularIndex(db);
    const veriCache = {};
    let dataHits = 0;
    for (const race of races) {
        for (const h of race.horses || []) {
            const key = atCacheKey(h.atId);
            const rec = h.atId ? atIndex.get(String(h.atId)) : null;
            if (key != null && rec?.kosular?.length) {
                veriCache[key] = rec.kosular;
                dataHits++;
            }
        }
    }

    const meta = { tarih, hipodrom: hipodromRow.hipodrom };
    const byRace = {};
    const byHorseByRace = {};
    let scored = 0;

    for (const race of races) {
        const panelRace = programRaceToPanel(race);
        const result = scorePublicRace(panelRace, meta, veriCache);
        const horseScores = scoreRaceHorseColumns(race, meta, veriCache);
        byRace[String(race.raceNo)] = result.tahminler;
        byHorseByRace[String(race.raceNo)] = horseScores;
        race.durum = 'hazir';
        race.tahminler = result.tahminler;
        race.tahminEngine = result.engine;
        for (const h of race.horses || []) {
            const scores = lookupHorseScores(horseScores, h);
            if (scores) h.scores = scores;
        }
        scored++;
    }

    const annotatedRaces = annotateKosular(races, { ...meta, veriCache });

    return {
        hipodrom: hipodromRow.hipodrom,
        hipodromId: hipodromRow.hipodrom_id,
        raceCount: annotatedRaces.length,
        scored,
        dataHits,
        engine: global.HybridTahminScoringEngine?.isCalibrated?.() ? 'hybrid' : 'fallback',
        byRace,
        byHorseByRace,
        races: annotatedRaces,
        tahminPayload: {
            generatedAt: new Date().toISOString(),
            engine: 'hybrid',
            dataHits,
            byRace,
            byHorseByRace
        }
    };
}

function saveHipodromTahmin(db, tarih, hipodromId, tahminPayload, races) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE public_gunluk_program SET
            tahmin_json = ?,
            program_json = ?,
            cekilme_tarihi = CURRENT_TIMESTAMP
            WHERE tarih = ? AND hipodrom_id = ?`;
        db.run(sql, [
            JSON.stringify(tahminPayload),
            JSON.stringify(races),
            tarih,
            hipodromId
        ], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function countProgramHorses(programJson) {
    let races = [];
    try {
        races = typeof programJson === 'string' ? JSON.parse(programJson || '[]') : (programJson || []);
    } catch (_) { /* */ }
    let total = 0;
    for (const race of races) {
        total += (race.horses || []).length;
    }
    return total;
}

function countScoredHorses(tahminJson) {
    let data = null;
    try {
        data = typeof tahminJson === 'string' ? JSON.parse(tahminJson || '{}') : (tahminJson || {});
    } catch (_) { /* */ }
    const byHorseByRace = data?.byHorseByRace || {};
    let scored = 0;
    for (const raceKey of Object.keys(byHorseByRace)) {
        const horses = byHorseByRace[raceKey] || {};
        for (const horseKey of Object.keys(horses)) {
            const scores = horses[horseKey] || {};
            const hyb = scores.hyb ?? scores.HYB;
            const tahmin = scores.tahmin ?? scores.TAHMİN ?? scores.TAHMIN;
            if (hyb != null || tahmin != null) scored++;
        }
    }
    return { scored, dataHits: data?.dataHits || 0 };
}

async function assessTahminReadiness(db, tarih, opts = {}) {
    const minRatio = opts.minRatio ?? 0.35;
    const rows = await getProgramRows(db, tarih, opts.hipodrom || null);
    if (!rows.length) {
        return { ready: false, totalHorses: 0, scoredHorses: 0, ratio: 0, hipodromSayisi: 0 };
    }

    let totalHorses = 0;
    let scoredHorses = 0;
    let dataHits = 0;
    for (const row of rows) {
        totalHorses += countProgramHorses(row.program_json);
        const hit = countScoredHorses(row.tahmin_json);
        scoredHorses += hit.scored;
        dataHits += hit.dataHits;
    }

    const ratio = totalHorses > 0 ? scoredHorses / totalHorses : 0;
    const dataRatio = totalHorses > 0 ? dataHits / totalHorses : 0;
    const ready = totalHorses > 0 && (ratio >= minRatio || dataRatio >= minRatio);

    return {
        ready,
        totalHorses,
        scoredHorses,
        dataHits,
        ratio: Math.round(ratio * 1000) / 1000,
        dataRatio: Math.round(dataRatio * 1000) / 1000,
        hipodromSayisi: rows.length
    };
}

function getProgramRows(db, tarih, hipodromFilter) {
    return new Promise((resolve, reject) => {
        let sql = `SELECT tarih, hipodrom_id, hipodrom, program_json, tahmin_json
            FROM public_gunluk_program WHERE tarih = ? AND durum = 'yayinda'`;
        const params = [tarih];
        if (hipodromFilter) {
            sql += ' AND hipodrom LIKE ?';
            params.push('%' + hipodromFilter + '%');
        }
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

async function buildPublicTahmin(db, tarih, opts = {}) {
    await ensureCalibration(db, opts.dbPath);
    const rows = await getProgramRows(db, tarih, opts.hipodrom || null);
    if (!rows.length) {
        return { tarih, hipodromSayisi: 0, results: [], error: 'Program bulunamadı: ' + tarih };
    }

    const results = [];
    for (const row of rows) {
        const built = await buildTahminForHipodrom(db, tarih, row, opts);
        if (opts.save !== false) {
            await saveHipodromTahmin(db, tarih, row.hipodrom_id, built.tahminPayload, built.races);
        }
        results.push({
            hipodrom: built.hipodrom,
            hipodromId: built.hipodromId,
            raceCount: built.raceCount,
            scored: built.scored,
            dataHits: built.dataHits,
            engine: built.engine,
            sample: built.byRace['1'] || built.byRace[Object.keys(built.byRace)[0]] || []
        });
    }
    return { tarih, hipodromSayisi: results.length, results };
}

function mergeTahminIntoKosular(kosular, tahminJson) {
    let tahminData = null;
    try {
        tahminData = typeof tahminJson === 'string' ? JSON.parse(tahminJson) : tahminJson;
    } catch (_) { /* */ }
    const byRace = tahminData?.byRace || {};
    const byHorseByRace = tahminData?.byHorseByRace || {};
    return (kosular || []).map((race) => {
        const key = String(race.raceNo);
        const tahminler = race.tahminler?.length
            ? race.tahminler
            : (byRace[key] || []);
        const horseScores = byHorseByRace[key] || {};
        const horses = (race.horses || []).map((h) => {
            const scores = h.scores || lookupHorseScores(horseScores, h);
            return scores ? Object.assign({}, h, { scores }) : h;
        });
        return Object.assign({}, race, {
            tahminler,
            horses,
            durum: tahminler.length ? 'hazir' : (race.durum || 'hazirlaniyor')
        });
    });
}

module.exports = {
    buildPublicTahmin,
    buildTahminForHipodrom,
    mergeTahminIntoKosular,
    ensureCalibration,
    assessTahminReadiness,
    getProgramRows,
    buildAtIdKosularIndex,
    veriCacheFromAtIndex
};
