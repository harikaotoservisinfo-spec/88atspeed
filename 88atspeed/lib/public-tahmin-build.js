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
        ['field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['sehir-stats-engine.js', 'SehirStatsEngine'],
        ['kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['astest-son-ptest-tahmin.js', 'AtestSonPtestTahmin'],
        ['astest-son-renk-tahmin.js', 'AtestSonRenkTahmin'],
        ['astest-son-gosterge1-tahmin.js', 'AtestSonGosterge1Tahmin']
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
        rows.push({
            horse: h,
            score: t.score != null ? Number(t.score) : (t.pct != null ? Number(t.pct) : 0),
            tahmin: t
        });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 4).map((r, i) => ({
        rank: i + 1,
        horseNo: r.horse.no,
        horseName: r.horse.name,
        pct: r.tahmin.pct != null ? Math.round(Number(r.tahmin.pct)) : null,
        score: r.tahmin.score != null ? Math.round(Number(r.tahmin.score) * 10) / 10 : null,
        label: label || 'Hibrit'
    }));
}

function scorePublicRace(race, meta, veriCache) {
    const resolveKos = (h) => resolveHorseKosular(veriCache, h);
    if (!global.AtestSonPtestTahmin?.isCalibrated?.()) {
        return { tahminler: hpFallbackTahminler(race), engine: 'hp-fallback' };
    }
    const cols = global.AtestSonPtestTahmin.scoreRaceAll(race, meta, resolveKos);
    const hyb = mapScoreMapToTahminler(race, cols.hyb, 'Hibrit');
    if (hyb?.length) return { tahminler: hyb, engine: 'hybrid' };
    const go = mapScoreMapToTahminler(race, cols.go, 'Gösterge');
    if (go?.length) return { tahminler: go, engine: 'gosterge' };
    return { tahminler: hpFallbackTahminler(race), engine: 'hp-fallback' };
}

function programHorseToPanel(h) {
    return {
        no: h.no,
        name: h.name,
        atId: h.atId || '',
        siklet: h.siklet,
        hp: h.hp,
        yas: h.yas
    };
}

function programRaceToPanel(race) {
    return {
        raceNo: race.raceNo,
        saat: race.saat,
        mesafe: race.mesafe,
        pist: race.pist,
        baslik: race.baslik,
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
    const raceFilter = opts.raceNo ? Number(opts.raceNo) : null;
    let scored = 0;

    for (const race of races) {
        if (raceFilter && Number(race.raceNo) !== raceFilter) continue;
        const panelRace = programRaceToPanel(race);
        const result = scorePublicRace(panelRace, meta, veriCache);
        byRace[String(race.raceNo)] = result.tahminler;
        race.durum = 'hazir';
        race.tahminler = result.tahminler;
        race.tahminEngine = result.engine;
        scored++;
    }

    return {
        hipodrom: hipodromRow.hipodrom,
        hipodromId: hipodromRow.hipodrom_id,
        raceCount: races.length,
        scored,
        dataHits,
        engine: global.HybridTahminScoringEngine?.isCalibrated?.() ? 'hybrid' : 'fallback',
        byRace,
        races,
        tahminPayload: {
            generatedAt: new Date().toISOString(),
            engine: 'hybrid',
            dataHits,
            byRace
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
    return (kosular || []).map((race) => {
        const key = String(race.raceNo);
        const tahminler = race.tahminler?.length
            ? race.tahminler
            : (byRace[key] || []);
        return Object.assign({}, race, {
            tahminler,
            durum: tahminler.length ? 'hazir' : (race.durum || 'hazirlaniyor')
        });
    });
}

module.exports = {
    buildPublicTahmin,
    buildTahminForHipodrom,
    mergeTahminIntoKosular,
    ensureCalibration
};
