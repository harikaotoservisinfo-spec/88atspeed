/**
 * Hazır Kupon sermaye simülasyonu — günlük kayıt + istatistik
 */
const publicProgram = require('./public-program');
const { STAGES, DEFAULT_START_BANK, DEFAULT_STAKE } = require('./hazir-kupon-simulator');

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
    await dbRun(db, `CREATE TABLE IF NOT EXISTS hazir_kupon_sim_kayitlari (
        tarih TEXT PRIMARY KEY,
        iso TEXT NOT NULL,
        veri TEXT NOT NULL,
        durum TEXT NOT NULL DEFAULT 'partial',
        kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP,
        guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

function resolveTarihIso(opts = {}) {
    let iso = opts.iso || '';
    let tarih = opts.tarih || '';
    if (!tarih && iso) tarih = publicProgram.isoToTr(iso);
    if (!iso && tarih) iso = publicProgram.trToIso(tarih);
    return { tarih, iso };
}

function summarizeStages(stages) {
    return (stages || []).map((s) => ({
        id: s.id,
        label: s.label,
        endBank: s.endBank,
        pnl: s.pnl,
        wins: s.wins,
        losses: s.losses,
        totalBets: s.totalBets,
        winPct: s.totalBets ? Math.round((s.wins / s.totalBets) * 1000) / 10 : null
    }));
}

function buildKayitPayload(body = {}) {
    const { tarih, iso } = resolveTarihIso(body);
    if (!tarih || !iso) throw new Error('Geçersiz tarih');

    const simulation = body.simulation;
    if (!simulation?.stages?.length) throw new Error('Simülasyon verisi eksik');

    const finished = Number(simulation.finishedRaceCount) || 0;
    const pending = Number(simulation.pendingRaceCount) || 0;
    const totalRaceCount = finished + pending;
    const status = body.status
        || (pending === 0 && finished > 0 ? 'complete' : 'partial');

    return {
        tarih,
        iso,
        startBank: simulation.startBank ?? DEFAULT_START_BANK,
        stake: simulation.stake ?? DEFAULT_STAKE,
        status,
        finishedRaceCount: finished,
        pendingRaceCount: pending,
        totalRaceCount,
        hipodromlar: body.hipodromlar || [],
        gunlukBasari: body.gunlukBasari || null,
        stages: simulation.stages,
        stageSummary: summarizeStages(simulation.stages),
        savedAt: new Date().toISOString()
    };
}

function rowToSummary(row) {
    let veri;
    try { veri = JSON.parse(row.veri || '{}'); } catch (_) { veri = {}; }
    const stage4 = veri.stageSummary?.find((s) => s.id === 4) || veri.stages?.find((s) => s.id === 4);
    return {
        tarih: row.tarih,
        iso: row.iso || veri.iso,
        durum: row.durum || veri.status,
        kayitTarihi: row.kayit_tarihi || row.guncelleme,
        guncelleme: row.guncelleme,
        finishedRaceCount: veri.finishedRaceCount ?? 0,
        totalRaceCount: veri.totalRaceCount ?? 0,
        stageSummary: veri.stageSummary || summarizeStages(veri.stages),
        stage4Pnl: stage4?.pnl ?? null,
        stage4EndBank: stage4?.endBank ?? null
    };
}

async function saveSimKayit(db, body = {}) {
    await ensureTables(db);
    const payload = buildKayitPayload(body);
    await dbRun(db,
        `INSERT INTO hazir_kupon_sim_kayitlari (tarih, iso, veri, durum, kayit_tarihi, guncelleme)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tarih) DO UPDATE SET
            iso = excluded.iso,
            veri = excluded.veri,
            durum = excluded.durum,
            guncelleme = CURRENT_TIMESTAMP`,
        [payload.tarih, payload.iso, JSON.stringify(payload), payload.status]);
    return { success: true, kayit: payload };
}

async function getSimKayit(db, opts = {}) {
    await ensureTables(db);
    const { tarih, iso } = resolveTarihIso(opts);
    const row = tarih
        ? await dbGet(db, 'SELECT * FROM hazir_kupon_sim_kayitlari WHERE tarih = ?', [tarih])
        : await dbGet(db, 'SELECT * FROM hazir_kupon_sim_kayitlari WHERE iso = ?', [iso]);
    if (!row) return null;
    let kayit;
    try { kayit = JSON.parse(row.veri || '{}'); } catch (_) { kayit = {}; }
    return {
        tarih: row.tarih,
        iso: row.iso,
        durum: row.durum,
        kayitTarihi: row.kayit_tarihi,
        guncelleme: row.guncelleme,
        kayit
    };
}

async function listSimKayitlari(db, opts = {}) {
    await ensureTables(db);
    const limit = Math.min(Math.max(Number(opts.limit) || 60, 1), 365);
    const rows = await dbAll(db,
        `SELECT tarih, iso, veri, durum, kayit_tarihi, guncelleme
         FROM hazir_kupon_sim_kayitlari
         ORDER BY iso DESC, tarih DESC
         LIMIT ?`,
        [limit]);
    return rows.map(rowToSummary);
}

function computeAggregateStats(summaries) {
    const days = summaries.length;
    if (!days) {
        return {
            days: 0,
            stages: STAGES.map((s) => ({
                id: s.id,
                label: s.label,
                avgPnl: null,
                totalPnl: null,
                avgWinPct: null,
                bestPnl: null,
                worstPnl: null
            }))
        };
    }

    const stages = STAGES.map((stage) => {
        const pnls = [];
        const winPcts = [];
        for (const row of summaries) {
            const s = (row.stageSummary || []).find((x) => x.id === stage.id);
            if (!s) continue;
            if (s.pnl != null) pnls.push(s.pnl);
            if (s.winPct != null) winPcts.push(s.winPct);
        }
        const totalPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null;
        const avgPnl = pnls.length ? Math.round((totalPnl / pnls.length) * 100) / 100 : null;
        const avgWinPct = winPcts.length
            ? Math.round((winPcts.reduce((a, b) => a + b, 0) / winPcts.length) * 10) / 10
            : null;
        return {
            id: stage.id,
            label: stage.label,
            days: pnls.length,
            avgPnl,
            totalPnl: totalPnl != null ? Math.round(totalPnl * 100) / 100 : null,
            avgWinPct,
            bestPnl: pnls.length ? Math.max(...pnls) : null,
            worstPnl: pnls.length ? Math.min(...pnls) : null
        };
    });

    const completeDays = summaries.filter((r) => r.durum === 'complete').length;

    return {
        days,
        completeDays,
        partialDays: days - completeDays,
        stages
    };
}

async function getSimStats(db) {
    const list = await listSimKayitlari(db, { limit: 365 });
    return {
        list,
        aggregate: computeAggregateStats(list)
    };
}

module.exports = {
    ensureTables,
    saveSimKayit,
    getSimKayit,
    listSimKayitlari,
    getSimStats,
    computeAggregateStats,
    buildKayitPayload
};
