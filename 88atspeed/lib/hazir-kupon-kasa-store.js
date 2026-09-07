/**
 * Hazır Kupon Kasa — kullanıcı bahisleri (clientId + gün)
 */
const publicProgram = require('./public-program');

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
    await dbRun(db, `CREATE TABLE IF NOT EXISTS hazir_kupon_kasa_kayitlari (
        client_id TEXT NOT NULL,
        tarih TEXT NOT NULL,
        iso TEXT NOT NULL,
        veri TEXT NOT NULL,
        guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client_id, tarih)
    )`);
}

function resolveTarihIso(opts = {}) {
    let iso = opts.iso || '';
    let tarih = opts.tarih || '';
    if (!tarih && iso) tarih = publicProgram.isoToTr(iso);
    if (!iso && tarih) iso = publicProgram.trToIso(tarih);
    return { tarih, iso };
}

function normalizeKasaPayload(body = {}) {
    const clientId = String(body.clientId || '').trim();
    if (!clientId) throw new Error('clientId gerekli');
    const kasa = body.kasa;
    if (!kasa || typeof kasa !== 'object') throw new Error('Kasa verisi gerekli');
    const { tarih, iso } = resolveTarihIso({
        iso: body.iso || kasa.iso,
        tarih: body.tarih || kasa.tarih
    });
    if (!tarih || !iso) throw new Error('Geçersiz tarih');
    const out = {
        iso,
        tarih,
        startBank: kasa.startBank ?? 1000,
        stake: kasa.stake ?? 20,
        bets: kasa.bets && typeof kasa.bets === 'object' ? kasa.bets : {},
        updatedAt: kasa.updatedAt || new Date().toISOString()
    };
    return { clientId, tarih, iso, kasa: out };
}

async function saveKasaKayit(db, body = {}) {
    await ensureTables(db);
    const { clientId, tarih, iso, kasa } = normalizeKasaPayload(body);
    await dbRun(db,
        `INSERT INTO hazir_kupon_kasa_kayitlari (client_id, tarih, iso, veri, guncelleme)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(client_id, tarih) DO UPDATE SET
            iso = excluded.iso,
            veri = excluded.veri,
            guncelleme = CURRENT_TIMESTAMP`,
        [clientId, tarih, iso, JSON.stringify(kasa)]);
    return { success: true, kasa };
}

async function getKasaKayit(db, opts = {}) {
    await ensureTables(db);
    const clientId = String(opts.clientId || '').trim();
    if (!clientId) return null;
    const { tarih, iso } = resolveTarihIso(opts);
    const row = tarih
        ? await dbGet(db,
            'SELECT * FROM hazir_kupon_kasa_kayitlari WHERE client_id = ? AND tarih = ?',
            [clientId, tarih])
        : await dbGet(db,
            'SELECT * FROM hazir_kupon_kasa_kayitlari WHERE client_id = ? AND iso = ?',
            [clientId, iso]);
    if (!row) return null;
    let kasa;
    try { kasa = JSON.parse(row.veri || '{}'); } catch (_) { kasa = {}; }
    return {
        clientId: row.client_id,
        tarih: row.tarih,
        iso: row.iso,
        guncelleme: row.guncelleme,
        kasa
    };
}

module.exports = {
    ensureTables,
    saveKasaKayit,
    getKasaKayit
};
