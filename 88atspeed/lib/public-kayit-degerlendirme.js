/**
 * Kayıt Test — hesaplama_kayitlari üzerinden yıldız + bitiş değerlendirme
 */
const { annotateKosular, atCacheKey } = require('./t1dr-test1-match');
const {
    buildAtIdKosularIndex,
    veriCacheFromAtIndex,
    ensureCalibration
} = require('./public-tahmin-build');

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

function parseKayitVeri(raw) {
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(data) ? data : null;
    } catch (_) {
        return null;
    }
}

async function loadBitisMap(db) {
    try {
        const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (!row?.veri) return {};
        const data = JSON.parse(row.veri);
        return data.bitis || {};
    } catch (_) {
        return {};
    }
}

async function buildVeriCacheForKayit(db, races) {
    const atIndex = await buildAtIdKosularIndex(db);
    const veriCache = veriCacheFromAtIndex(atIndex);
    for (const race of races || []) {
        for (const h of race.horses || []) {
            const key = atCacheKey(h.atId);
            if (key != null && Array.isArray(h.kosular) && h.kosular.length) {
                const prev = veriCache[key];
                if (!prev || h.kosular.length > prev.length) veriCache[key] = h.kosular;
            }
        }
    }
    return veriCache;
}

async function buildKayitAnnotatedRaces(db, races, meta) {
    await ensureCalibration(db);
    const veriCache = await buildVeriCacheForKayit(db, races);
    return annotateKosular(races, { ...meta, veriCache, force: true });
}

function attachBitisAndStats(kayitId, races, bitis) {
    let withStars = 0;
    let top3 = 0;
    let wins = 0;
    let withBitis = 0;

    const kosular = (races || []).map((race) => {
        const raceNo = String(race.raceNo);
        const horses = (race.horses || []).map((h) => {
            const bitisKey = kayitId + '|' + raceNo + '|' + String(h.no);
            const sira = bitis[bitisKey] != null ? Number(bitis[bitisKey]) : null;
            const hasStars = Array.isArray(h.yildizlar) && h.yildizlar.length > 0;
            if (hasStars) {
                withStars++;
                if (sira != null && !isNaN(sira)) {
                    withBitis++;
                    if (sira <= 3) top3++;
                    if (sira === 1) wins++;
                }
            }
            return Object.assign({}, h, { bitisSira: sira });
        });
        return Object.assign({}, race, { horses });
    });

    return {
        kosular,
        stats: {
            withStars,
            withBitis,
            top3,
            wins,
            top3Pct: withBitis > 0 ? Math.round((top3 / withBitis) * 1000) / 10 : null,
            winPct: withBitis > 0 ? Math.round((wins / withBitis) * 1000) / 10 : null
        }
    };
}

async function listKayitlar(db) {
    return dbAll(db,
        `SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi
         FROM hesaplama_kayitlari ORDER BY id DESC LIMIT 300`);
}

async function getKayitDegerlendirme(db, kayitId) {
    const row = await dbGet(db, 'SELECT * FROM hesaplama_kayitlari WHERE id = ?', [kayitId]);
    if (!row) return null;
    const races = parseKayitVeri(row.veri);
    if (!races) return null;

    const meta = { tarih: row.tarih, hipodrom: row.hipodrom };
    const annotated = await buildKayitAnnotatedRaces(db, races, meta);
    const bitis = await loadBitisMap(db);
    const { kosular, stats } = attachBitisAndStats(kayitId, annotated, bitis);

    return {
        kayitId: row.id,
        hipodrom: row.hipodrom,
        tarih: row.tarih,
        raceCount: row.race_count,
        totalHorses: row.total_horses,
        kosular,
        stats,
        bitisCount: Object.keys(bitis).filter((k) => k.startsWith(String(kayitId) + '|')).length
    };
}

module.exports = {
    listKayitlar,
    getKayitDegerlendirme,
    buildKayitAnnotatedRaces
};
