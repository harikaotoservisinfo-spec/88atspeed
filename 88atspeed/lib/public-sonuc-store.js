/**
 * TJK sonuçlarını bitiş sırasına göre kayıtlara yazar (public_gunluk_program + puanlama_bitis_sonuclari).
 */
const publicProgram = require('./public-program');
const { clearCalibrationFlatCache } = require('./calibration-flat-build');

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

function parseSira(val) {
    const n = parseInt(String(val || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function extractHorseNoFromName(name) {
    if (!name) return '';
    const m = String(name).trim().match(/\((\d+)\)\s*$/);
    return m ? m[1] : '';
}

function cleanHorseName(name) {
    return String(name || '')
        .replace(/\(\d+\)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeName(name) {
    return cleanHorseName(name)
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9ğüşıöç]/gi, '');
}

function rowKeyParts(kayitId, raceNo, horseNo) {
    return String(kayitId) + '|' + raceNo + '|' + String(horseNo ?? '');
}

function parsePuanlamaStore(raw) {
    if (!raw || typeof raw !== 'object') return { bitis: {}, cikan: {} };
    const isLegacy = !raw.bitis && !raw.cikan
        && Object.values(raw).some((v) => typeof v === 'number');
    if (isLegacy) return { bitis: raw, cikan: {} };
    return { bitis: raw.bitis || {}, cikan: raw.cikan || {} };
}

function normalizeHorseRow(h) {
    const siraNum = parseSira(h.sira);
    let no = String(h.no || '').trim();
    if (!no || no === '—' || no === '-') {
        no = extractHorseNoFromName(h.name);
    }
    return Object.assign({}, h, {
        sira: siraNum != null ? String(siraNum) : String(h.sira || ''),
        siraNum,
        no: no || '',
        name: cleanHorseName(h.name)
    });
}

function normalizeRaceResults(races) {
    return (races || [])
        .map((race) => {
            const horses = (race.horses || [])
                .map(normalizeHorseRow)
                .filter((h) => h.siraNum != null && !h.kosmaz)
                .sort((a, b) => a.siraNum - b.siraNum);
            return {
                raceNo: String(race.raceNo),
                raceHeaderLine: race.raceHeaderLine || '',
                horseCount: horses.length,
                finishOrder: horses.map((h) => h.no).filter(Boolean),
                horses
            };
        })
        .filter((r) => r.horses.length > 0);
}

async function ensureSonucColumns(db) {
    await publicProgram.ensureTables(db);
    const colNames = await new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(public_gunluk_program)`, [], (err, rows) => (
            err ? reject(err) : resolve((rows || []).map((r) => r.name))
        ));
    });
    if (!colNames.includes('sonuc_json')) {
        await dbRun(db, `ALTER TABLE public_gunluk_program ADD COLUMN sonuc_json TEXT`);
    }
    if (!colNames.includes('sonuc_guncelleme')) {
        await dbRun(db, `ALTER TABLE public_gunluk_program ADD COLUMN sonuc_guncelleme DATETIME`);
    }
}

function findHorseMatch(programHorses, resultHorse) {
    const list = programHorses || [];
    if (resultHorse.atId) {
        const byId = list.find((h) => String(h.atId || '') === String(resultHorse.atId));
        if (byId) return byId;
    }
    if (resultHorse.no) {
        const byNo = list.find((h) => String(h.no) === String(resultHorse.no));
        if (byNo) return byNo;
    }
    const target = normalizeName(resultHorse.name);
    if (!target) return null;
    let hit = list.find((h) => normalizeName(h.name) === target);
    if (hit) return hit;
    return list.find((h) => {
        const progName = normalizeName(cleanHorseName(h.name));
        return progName === target || progName.includes(target) || target.includes(progName);
    }) || null;
}

async function loadPuanlamaStore(db) {
    try {
        const row = await dbGet(db, `SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1`);
        if (row?.veri) return parsePuanlamaStore(JSON.parse(row.veri));
    } catch (_) { /* tablo yok */ }
    return { bitis: {}, cikan: {} };
}

async function savePuanlamaStore(db, store) {
    const veri = JSON.stringify({
        bitis: store.bitis || {},
        cikan: store.cikan || {}
    });
    await dbRun(
        db,
        `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`,
        [veri]
    );
}

async function syncBitisForKayit(db, kayit, normalizedRaces) {
    if (!kayit || !normalizedRaces?.length) {
        return { synced: 0, kayitId: kayit?.id || null };
    }

    let veri = [];
    try {
        veri = JSON.parse(kayit.veri || '[]');
    } catch (_) {
        return { synced: 0, kayitId: kayit.id };
    }
    if (!Array.isArray(veri) || !veri.length) {
        return { synced: 0, kayitId: kayit.id };
    }

    const store = await loadPuanlamaStore(db);
    let synced = 0;

    for (const race of normalizedRaces) {
        const raceNo = String(race.raceNo);
        const progRace = veri.find((r) => String(r.raceNo) === raceNo);
        if (!progRace) continue;

        for (const h of race.horses) {
            if (!h.siraNum) continue;
            const match = findHorseMatch(progRace.horses, h);
            if (!match) continue;
            const key = rowKeyParts(kayit.id, raceNo, match.no);
            store.bitis[key] = h.siraNum;
            synced++;
        }
    }

    if (synced > 0) {
        await savePuanlamaStore(db, store);
        clearCalibrationFlatCache();
    }

    return { synced, kayitId: kayit.id };
}

async function syncBitisFromSonuclar(db, tarih, hipodrom, normalizedRaces) {
    let kayit;
    try {
        kayit = await publicProgram.findHesaplamaKayit(db, { tarih, hipodrom });
    } catch (err) {
        console.warn('sonuc bitis sync atlandı:', err.message);
        return { synced: 0, kayitId: null };
    }
    if (!kayit) return { synced: 0, kayitId: null };
    return syncBitisForKayit(db, kayit, normalizedRaces);
}

async function importSonuclarToKayit(db, opts = {}) {
    const kayit = await publicProgram.findHesaplamaKayit(db, opts);
    if (!kayit) throw new Error('Hesaplama kaydı bulunamadı');

    let veri = [];
    try {
        veri = JSON.parse(kayit.veri || '[]');
    } catch (_) {
        throw new Error('Kayıt verisi okunamadı #' + kayit.id);
    }

    const sehirId = kayit.hipodrom_id
        || publicProgram.FALLBACK_HIPODROMS?.find((h) => {
            const n = String(kayit.hipodrom || '').toLocaleLowerCase('tr-TR');
            return h.name.toLocaleLowerCase('tr-TR') === n || n.includes(h.name.toLocaleLowerCase('tr-TR'));
        })?.id;

    let normalized = [];
    if (!opts.refresh) {
        const stored = sehirId
            ? await getStoredSonuclar(db, kayit.tarih, sehirId)
            : null;
        if (stored?.races?.length) normalized = stored.races;
    }

    if (!normalized.length) {
        const publicSonuclar = require('./public-sonuclar');
        const fetched = await publicSonuclar.fetchSonuclarForHipodrom({
            tarih: kayit.tarih,
            hipodrom: kayit.hipodrom,
            hipodromId: sehirId,
            refresh: opts.refresh !== false,
            expectedRaceCount: veri.length,
            db
        });
        normalized = fetched.races || [];
    }

    if (!normalized.length) {
        return {
            success: true,
            kayitId: kayit.id,
            tarih: kayit.tarih,
            hipodrom: kayit.hipodrom,
            raceCount: 0,
            bitisSynced: 0,
            message: 'Henüz TJK sonucu yok'
        };
    }

    const bitisSync = await syncBitisForKayit(db, kayit, normalized);
    return {
        success: true,
        kayitId: kayit.id,
        tarih: kayit.tarih,
        hipodrom: kayit.hipodrom,
        raceCount: normalized.length,
        bitisSynced: bitisSync.synced,
        message: bitisSync.synced > 0
            ? null
            : 'Sonuçlar alındı ancak at eşleşmesi yapılamadı'
    };
}

async function persistPublicSonuclar(db, meta, normalizedRaces) {
    if (!db || !normalizedRaces.length) {
        return { saved: false, raceCount: 0 };
    }

    await ensureSonucColumns(db);
    const payload = {
        version: 1,
        fetchedAt: new Date().toISOString(),
        source: meta.source || 'tjk.org',
        tarih: meta.tarih,
        hipodrom: meta.hipodrom,
        sehirId: meta.sehirId,
        raceCount: normalizedRaces.length,
        races: normalizedRaces
    };

    const result = await dbRun(
        db,
        `UPDATE public_gunluk_program
         SET sonuc_json = ?, sonuc_guncelleme = CURRENT_TIMESTAMP
         WHERE tarih = ? AND hipodrom_id = ? AND durum = 'yayinda'`,
        [JSON.stringify(payload), meta.tarih, String(meta.sehirId)]
    );

    let bitisSync = { synced: 0, kayitId: null };
    bitisSync = await syncBitisFromSonuclar(db, meta.tarih, meta.hipodrom, normalizedRaces);

    return {
        saved: result.changes > 0,
        raceCount: normalizedRaces.length,
        bitisSynced: bitisSync.synced,
        kayitId: bitisSync.kayitId
    };
}

async function getStoredSonuclar(db, tarih, hipodromId) {
    await ensureSonucColumns(db);
    const row = await dbGet(
        db,
        `SELECT sonuc_json, sonuc_guncelleme FROM public_gunluk_program
         WHERE tarih = ? AND hipodrom_id = ? AND durum = 'yayinda'`,
        [tarih, String(hipodromId)]
    );
    if (!row?.sonuc_json) return null;
    try {
        const parsed = JSON.parse(row.sonuc_json);
        return {
            races: parsed.races || [],
            raceCount: parsed.raceCount || (parsed.races || []).length,
            fetchedAt: parsed.fetchedAt || row.sonuc_guncelleme,
            storedAt: row.sonuc_guncelleme
        };
    } catch (_) {
        return null;
    }
}

function applyNormalizedToApiResult(result, normalizedRaces, persistInfo) {
    const out = Object.assign({}, result, {
        races: normalizedRaces,
        raceCount: normalizedRaces.length,
        hasResults: normalizedRaces.length > 0,
        persisted: persistInfo || null
    });
    if (!out.hasResults) {
        out.message = 'Henüz sonuç yok — koşular tamamlandıkça güncellenecek.';
    } else {
        out.message = null;
    }
    return out;
}

module.exports = {
    normalizeRaceResults,
    persistPublicSonuclar,
    getStoredSonuclar,
    applyNormalizedToApiResult,
    ensureSonucColumns,
    importSonuclarToKayit,
    syncBitisForKayit,
    parseSira,
    extractHorseNoFromName,
    cleanHorseName
};
