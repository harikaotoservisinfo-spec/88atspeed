/**
 * Hazır Kupon — koşu bazlı son oran snapshot (Ganyan / İlk 2 / 3 / 4)
 */
const publicProgram = require('./public-program');

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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
    await dbRun(db, `CREATE TABLE IF NOT EXISTS hazir_kupon_odds_snapshots (
        tarih TEXT NOT NULL,
        hipodrom_id TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        veri TEXT NOT NULL,
        guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tarih, hipodrom_id, race_no)
    )`);
}

function raceOddsKey(hipId, raceNo) {
    return String(hipId) + '|' + String(raceNo);
}

function normalizeByHorse(byHorse) {
    const out = {};
    if (!byHorse || typeof byHorse !== 'object') return out;
    for (const [no, bets] of Object.entries(byHorse)) {
        if (!bets || typeof bets !== 'object') continue;
        const entry = {};
        for (const [k, v] of Object.entries(bets)) {
            if (v != null && String(v).trim() !== '' && String(v) !== '—') {
                entry[k] = String(v);
            }
        }
        if (Object.keys(entry).length) out[String(no)] = entry;
    }
    return out;
}

function mergeByHorse(existing, incoming) {
    const base = normalizeByHorse(existing);
    const add = normalizeByHorse(incoming);
    for (const [no, bets] of Object.entries(add)) {
        if (!base[no]) base[no] = {};
        Object.assign(base[no], bets);
    }
    return base;
}

async function getRaceOddsSnapshot(db, tarih, hipId, raceNo) {
    await ensureTables(db);
    const row = await new Promise((resolve, reject) => {
        db.get(
            'SELECT veri, guncelleme FROM hazir_kupon_odds_snapshots WHERE tarih = ? AND hipodrom_id = ? AND race_no = ?',
            [tarih, String(hipId), Number(raceNo)],
            (err, r) => (err ? reject(err) : resolve(r))
        );
    });
    if (!row?.veri) return null;
    try {
        const parsed = JSON.parse(row.veri);
        return {
            byHorse: normalizeByHorse(parsed.byHorse),
            capturedAt: parsed.capturedAt || row.guncelleme,
            updatedAt: row.guncelleme
        };
    } catch (_) {
        return null;
    }
}

async function saveRaceOddsSnapshot(db, opts = {}) {
    await ensureTables(db);
    const tarih = opts.tarih || publicProgram.isoToTr(opts.iso);
    const hipId = String(opts.hipId || '');
    const raceNo = Number(opts.raceNo);
    if (!tarih || !hipId || !raceNo) throw new Error('Geçersiz oran snapshot');

    const incoming = normalizeByHorse(opts.byHorse);
    if (!Object.keys(incoming).length) return { saved: false, reason: 'empty' };

    const existing = await getRaceOddsSnapshot(db, tarih, hipId, raceNo);
    const merged = mergeByHorse(existing?.byHorse, incoming);
    const payload = {
        byHorse: merged,
        capturedAt: opts.capturedAt || new Date().toISOString(),
        source: opts.source || 'client'
    };

    await dbRun(db,
        `INSERT INTO hazir_kupon_odds_snapshots (tarih, hipodrom_id, race_no, veri, guncelleme)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(tarih, hipodrom_id, race_no)
         DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`,
        [tarih, hipId, raceNo, JSON.stringify(payload)]);

    return { saved: true, byHorse: merged, key: raceOddsKey(hipId, raceNo) };
}

async function saveBulkOddsSnapshots(db, body = {}) {
    const tarih = body.tarih || publicProgram.isoToTr(body.iso);
    if (!tarih) throw new Error('Geçersiz tarih');
    const races = body.races || [];
    const results = [];
    for (const race of races) {
        if (!race?.hipId || !race?.raceNo) continue;
        const res = await saveRaceOddsSnapshot(db, {
            tarih,
            hipId: race.hipId,
            raceNo: race.raceNo,
            byHorse: race.byHorse,
            capturedAt: body.capturedAt,
            source: body.source || 'client'
        });
        if (res.saved) results.push(res);
    }
    return { success: true, saved: results.length, results };
}

async function getOddsMapForDay(db, tarih) {
    await ensureTables(db);
    const rows = await dbAll(db,
        'SELECT hipodrom_id, race_no, veri, guncelleme FROM hazir_kupon_odds_snapshots WHERE tarih = ?',
        [tarih]);
    const map = {};
    for (const row of rows) {
        try {
            const parsed = JSON.parse(row.veri || '{}');
            map[raceOddsKey(row.hipodrom_id, row.race_no)] = {
                byHorse: normalizeByHorse(parsed.byHorse),
                capturedAt: parsed.capturedAt || row.guncelleme,
                updatedAt: row.guncelleme
            };
        } catch (_) { /* atla */ }
    }
    return map;
}

module.exports = {
    ensureTables,
    raceOddsKey,
    getRaceOddsSnapshot,
    saveRaceOddsSnapshot,
    saveBulkOddsSnapshots,
    getOddsMapForDay,
    mergeByHorse,
    normalizeByHorse
};
