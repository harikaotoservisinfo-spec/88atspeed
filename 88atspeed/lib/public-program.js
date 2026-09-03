/**
 * Kamuya açık günlük program — bir gün önce çekilip SQLite'a yazılır.
 */
const cheerio = require('cheerio');
const tjkScrape = require('./tjk-scrape');
const { mergeTahminIntoKosular } = require('./public-tahmin-build');

const DOMESTIC_HINT = /(ankara|izmir|istanbul|bursa|adana|elaz|diyarbak|kocaeli|antalya|şanlıurfa|urfa|karma)/i;

/** TJK yanıt vermezse denenecek yerli hipodromlar */
const FALLBACK_HIPODROMS = [
    { id: '5', name: 'Ankara' },
    { id: '2', name: 'İzmir' },
    { id: '3', name: 'İstanbul' },
    { id: '4', name: 'Bursa' },
    { id: '6', name: 'Adana' },
    { id: '9', name: 'Kocaeli' },
    { id: '10', name: 'Elazığ' },
    { id: '17', name: 'Karma' }
];

function formatTrDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function parseTrDate(str) {
    if (!str || typeof str !== 'string') return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function isoToTr(iso) {
    if (!iso) return '';
    const p = iso.split('-');
    if (p.length !== 3) return iso;
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function trToIso(tr) {
    const m = (tr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function tomorrowTr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatTrDate(d);
}

function todayTr() {
    return formatTrDate(new Date());
}

function normalizeHipodromName(name) {
    return String(name || '').trim().toLocaleLowerCase('tr-TR');
}

function isDomesticHipodrom(name) {
    if (!name) return false;
    const n = String(name).trim();
    if (/\(YD\s*\d*\)/i.test(n)) return false;
    const lower = normalizeHipodromName(n);
    if (/abd|krallık|afrika|avustralya|fransa|almanya|kanada|guney afrika/.test(lower)) return false;
    return DOMESTIC_HINT.test(lower) || lower === 'karma';
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function racesToHesaplamaVeri(races) {
    return (races || []).map((race) => ({
        raceNo: String(race.raceNo),
        saat: race.saat || '',
        mesafe: race.mesafe || '',
        pist: race.pist || '',
        baslik: race.baslik || '',
        kcins_kosu: race.kcins_kosu || '',
        kategori: race.kategori || '',
        horseCount: (race.horses || []).length,
        horses: (race.horses || []).map((h) => ({
            no: h.no,
            name: h.name,
            atId: h.atId || '',
            yas: h.yas || '',
            siklet: h.siklet || '',
            hp: h.hp || '',
            taki: h.taki || '',
            kosular: Array.isArray(h.kosular) ? h.kosular : []
        }))
    }));
}

function mergeHesaplamaVeri(existingRaces, newRaces) {
    const kosuByHorse = new Map();
    for (const race of existingRaces || []) {
        const raceNo = String(race.raceNo);
        for (const h of race.horses || []) {
            if (!h.kosular?.length) continue;
            if (h.atId) kosuByHorse.set('id:' + h.atId, h.kosular);
            kosuByHorse.set('no:' + raceNo + ':' + h.no, h.kosular);
        }
    }
    return racesToHesaplamaVeri(newRaces).map((race) => ({
        ...race,
        horses: race.horses.map((h) => {
            const kosular = h.kosular.length
                ? h.kosular
                : (h.atId && kosuByHorse.get('id:' + h.atId))
                    || kosuByHorse.get('no:' + race.raceNo + ':' + h.no)
                    || [];
            return Object.assign({}, h, { kosular });
        })
    }));
}

async function syncProgramToHesaplamaKayit(db, row) {
    const { tarih, hipodromId, hipodrom, races } = row;
    let veri = racesToHesaplamaVeri(races);
    const existing = await dbGet(
        db,
        `SELECT id, veri FROM hesaplama_kayitlari WHERE tarih = ? AND hipodrom_id = ?`,
        [tarih, String(hipodromId)]
    );
    if (existing?.veri) {
        let oldVeri = [];
        try {
            oldVeri = JSON.parse(existing.veri);
        } catch (_) { /* */ }
        veri = mergeHesaplamaVeri(oldVeri, races);
        const totalHorses = veri.reduce((n, r) => n + (r.horses?.length || 0), 0);
        await dbRun(
            db,
            `UPDATE hesaplama_kayitlari SET hipodrom = ?, race_count = ?, total_horses = ?, veri = ?,
             kayit_tarihi = CURRENT_TIMESTAMP WHERE id = ?`,
            [hipodrom, veri.length, totalHorses, JSON.stringify(veri), existing.id]
        );
        return { id: existing.id, updated: true, raceCount: veri.length, totalHorses };
    }
    const totalHorses = veri.reduce((n, r) => n + (r.horses?.length || 0), 0);
    const ins = await dbRun(
        db,
        `INSERT INTO hesaplama_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [hipodrom, String(hipodromId), tarih, veri.length, totalHorses, JSON.stringify(veri)]
    );
    return { id: ins.lastID, updated: false, raceCount: veri.length, totalHorses };
}

async function syncAllPublicProgramsToHesaplama(db, opts = {}) {
    const rows = await listPublicProgramKayitlar(db, { tarih: opts.tarih || null });
    const synced = [];
    for (const meta of rows) {
        const full = await getPublicProgramKayit(db, meta.tarih, meta.hipodrom_id);
        if (!full?.races?.length) continue;
        const result = await syncProgramToHesaplamaKayit(db, {
            tarih: full.tarih,
            hipodromId: full.hipodromId,
            hipodrom: full.hipodrom,
            races: full.races
        });
        synced.push({
            tarih: full.tarih,
            hipodrom: full.hipodrom,
            hipodromId: full.hipodromId,
            hesaplamaId: result.id,
            updated: result.updated,
            raceCount: result.raceCount,
            totalHorses: result.totalHorses
        });
    }
    return synced;
}

function parseRaceMetaFromText(text) {
    const line = (text || '').replace(/\s+/g, ' ').trim();
    const mesafeMatch = line.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/i);
    const saatMatch = line.match(/\b(\d{1,2}:\d{2})\b/);
    return {
        baslik: line.slice(0, 120) || '',
        mesafe: mesafeMatch ? mesafeMatch[1] : '',
        pist: mesafeMatch ? mesafeMatch[2] : '',
        saat: saatMatch ? saatMatch[1] : ''
    };
}

function parseRaceProgramFromHtml(html) {
    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    const blocks = bodyText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
    const metaByNo = {};

    for (const blok of blocks) {
        const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+(\d+\.\d+)/);
        if (!kosuMatch) continue;
        const kosuNo = parseInt(kosuMatch[1], 10);
        const headerLine = blok.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+)/);
        const parsed = tjkScrape.parseRaceHeaderLine(headerLine ? headerLine[1] : blok.slice(0, 200));
        const meta = {
            baslik: (headerLine ? headerLine[1] : blok.slice(0, 200)).replace(/\s+/g, ' ').trim().slice(0, 120),
            mesafe: parsed.mesafe || '',
            pist: parsed.pist_kosu || '',
            kcins_kosu: parsed.kcins_kosu || '',
            kategori: parsed.kategori || '',
            saat: kosuMatch[2]
        };
        metaByNo[kosuNo] = meta;
    }

    const races = [];
    $('table.tablesorter').each((_, table) => {
        const horses = [];
        $(table).find('tbody tr').each((__, row) => {
            const cells = $(row).find('td');
            if (cells.length < 5) return;
            const horseNo = $(cells[1]).text().trim();
            if (!/^\d+$/.test(horseNo)) return;
            const nameCell = $(cells[2]);
            const link = nameCell.find('a').first();
            let horseName = (link.text() || nameCell.text()).replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
            if (!horseName || /koşmaz/i.test(horseName)) return;
            let atId = '';
            const href = link.attr('href') || '';
            const idMatch = href.match(/AtId=(\d+)/i);
            if (idMatch) atId = idMatch[1];
            horses.push({
                no: horseNo,
                name: horseName,
                atId,
                yas: $(cells[3]).text().trim(),
                siklet: $(cells[5]).text().trim(),
                hp: $(cells[10]).text().trim() || ''
            });
        });
        if (!horses.length) return;
        const raceNo = races.length + 1;
        const meta = metaByNo[raceNo] || {};
        races.push({
            raceNo,
            saat: meta.saat || '',
            mesafe: meta.mesafe || '',
            pist: meta.pist || '',
            kcins_kosu: meta.kcins_kosu || '',
            kategori: meta.kategori || '',
            baslik: meta.baslik || `${raceNo}. Koşu`,
            horses,
            tahminler: [],
            durum: 'hazirlaniyor'
        });
    });

    return races;
}

async function fetchHtmlRetry(url, opts = {}) {
    const maxAttempts = opts.maxAttempts || 4;
    const timeoutMs = opts.timeoutMs || 60000;
    const headers = tjkScrape.getBrowserHeaders();
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await tjkScrape.fetchHtml(url, headers, 3, timeoutMs);
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) await sleep(1500 * attempt);
        }
    }
    throw lastError || new Error('TJK zaman aşımı');
}

async function fetchHipodromProgram(tarih, hipodrom, opts = {}) {
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisProgrami'
        + `?SehirId=${encodeURIComponent(hipodrom.id)}`
        + `&QueryParameter_Tarih=${encodeURIComponent(tarih)}`
        + `&SehirAdi=${encodeURIComponent(hipodrom.name)}&Era=today`;
    const html = await fetchHtmlRetry(url, opts);
    const races = parseRaceProgramFromHtml(html);
    if (!races.length) throw new Error('Koşu tablosu bulunamadı');
    return { ...hipodrom, races, kosuSayisi: races.length };
}

function queryHipodromlarFromDb(db, tarih) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT DISTINCT hipodrom_id AS id, hipodrom AS name FROM at_verileri
            WHERE tarih = ? AND hipodrom_id IS NOT NULL AND hipodrom_id != ''
            UNION
            SELECT DISTINCT hipodrom_id AS id, hipodrom AS name FROM hesaplama_kayitlari
            WHERE tarih = ? AND hipodrom_id IS NOT NULL AND hipodrom_id != ''
            ORDER BY name`;
        db.all(sql, [tarih, tarih], (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).filter((r) => r.id && r.name));
        });
    });
}

async function resolveHipodromList(db, tarih, opts = {}) {
    const fetchOpts = {
        maxAttempts: opts.maxAttempts || 5,
        timeoutMs: opts.timeoutMs || 60000
    };
    let source = 'tjk';
    let hipodromlar = [];

    try {
        hipodromlar = await tjkScrape.fetchHipodromlarForDate(tarih, fetchOpts);
    } catch (err) {
        console.warn('⚠️ TJK hipodrom listesi:', err.message);
    }

    if (!hipodromlar.length) {
        try {
            hipodromlar = await queryHipodromlarFromDb(db, tarih);
            if (hipodromlar.length) source = 'db';
        } catch (err) {
            console.warn('⚠️ DB hipodrom listesi:', err.message);
        }
    }

    if (!hipodromlar.length) {
        hipodromlar = FALLBACK_HIPODROMS.slice();
        source = 'fallback';
        console.warn('⚠️ Sabit yedek hipodrom listesi kullanılıyor');
    }

    return { hipodromlar, source };
}

function ensureTables(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS public_gunluk_program (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tarih TEXT NOT NULL,
                hipodrom_id TEXT NOT NULL,
                hipodrom TEXT NOT NULL,
                kosu_sayisi INTEGER DEFAULT 0,
                ilk_kosu_saat TEXT,
                program_json TEXT NOT NULL,
                tahmin_json TEXT,
                durum TEXT DEFAULT 'taslak',
                cekilme_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP,
                yayin_tarihi DATETIME,
                UNIQUE(tarih, hipodrom_id)
            )`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function saveProgramRow(db, row) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO public_gunluk_program
            (tarih, hipodrom_id, hipodrom, kosu_sayisi, ilk_kosu_saat, program_json, tahmin_json, durum, yayin_tarihi)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tarih, hipodrom_id) DO UPDATE SET
                hipodrom=excluded.hipodrom,
                kosu_sayisi=excluded.kosu_sayisi,
                ilk_kosu_saat=excluded.ilk_kosu_saat,
                program_json=excluded.program_json,
                tahmin_json=COALESCE(excluded.tahmin_json, public_gunluk_program.tahmin_json),
                durum=excluded.durum,
                cekilme_tarihi=CURRENT_TIMESTAMP,
                yayin_tarihi=excluded.yayin_tarihi`;
        const ilkSaat = row.races?.[0]?.saat || '';
        db.run(sql, [
            row.tarih,
            row.hipodromId,
            row.hipodrom,
            row.kosuSayisi || 0,
            ilkSaat,
            JSON.stringify(row.races || []),
            row.tahminler ? JSON.stringify(row.tahminler) : null,
            row.durum || 'yayinda',
            row.durum === 'yayinda' ? new Date().toISOString() : null
        ], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

async function buildPublicProgram(db, tarih, opts = {}) {
    await ensureTables(db);
    const onlyDomestic = opts.onlyDomestic !== false;
    const publish = opts.publish !== false;
    const hipDelayMs = opts.hipDelayMs ?? 2500;
    const fetchOpts = {
        maxAttempts: opts.maxAttempts || 5,
        timeoutMs: opts.timeoutMs || 60000
    };

    const { hipodromlar, source: hipSource } = await resolveHipodromList(db, tarih, fetchOpts);
    const selected = hipodromlar.filter((h) => !onlyDomestic || isDomesticHipodrom(h.name));

    const results = [];
    for (let i = 0; i < selected.length; i++) {
        const hip = selected[i];
        if (i > 0 && hipDelayMs > 0) await sleep(hipDelayMs);
        try {
            const prog = await fetchHipodromProgram(tarih, hip, fetchOpts);
            const row = {
                tarih,
                hipodromId: hip.id,
                hipodrom: hip.name,
                kosuSayisi: prog.kosuSayisi,
                races: prog.races,
                durum: publish ? 'yayinda' : 'taslak'
            };
            await saveProgramRow(db, row);
            let hesaplamaSync = null;
            if (opts.syncHesaplama !== false) {
                try {
                    hesaplamaSync = await syncProgramToHesaplamaKayit(db, row);
                } catch (syncErr) {
                    console.warn('  ⚠ hesaplama sync:', hip.name, syncErr.message);
                }
            }
            results.push({
                hipodrom: hip.name,
                kosuSayisi: prog.kosuSayisi,
                hesaplamaId: hesaplamaSync?.id || null,
                hesaplamaUpdated: !!hesaplamaSync?.updated,
                ok: true
            });
            console.log('  ✓', hip.name, '—', prog.kosuSayisi, 'koşu'
                + (hesaplamaSync ? ' · hesaplama #' + hesaplamaSync.id : ''));
        } catch (err) {
            results.push({ hipodrom: hip.name, ok: false, error: err.message });
            console.warn('  ✗', hip.name, '—', err.message);
        }
    }

    const okCount = results.filter((r) => r.ok).length;
    const summary = {
        tarih,
        hipodromKaynagi: hipSource,
        hipodromSayisi: selected.length,
        basarili: okCount,
        results
    };

    if (opts.log !== false) {
        try {
            await logFetchRun(db, {
                tarih,
                trigger: opts.trigger || 'api',
                hipodromSayisi: selected.length,
                basarili: okCount,
                results,
                ok: okCount > 0
            });
        } catch (err) {
            console.warn('program fetch log:', err.message);
        }
    }

    return summary;
}

function getPublicVitrin(db, tarih) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT tarih, hipodrom_id, hipodrom, kosu_sayisi, ilk_kosu_saat,
            program_json, tahmin_json, durum, cekilme_tarihi, yayin_tarihi
            FROM public_gunluk_program
            WHERE tarih = ? AND durum = 'yayinda'
            ORDER BY hipodrom`;
        db.all(sql, [tarih], (err, rows) => {
            if (err) return reject(err);
            const hipodromlar = (rows || []).map((r) => ({
                id: r.hipodrom_id,
                name: r.hipodrom,
                kosuSayisi: r.kosu_sayisi,
                ilkKosuSaat: r.ilk_kosu_saat,
                durum: r.durum,
                kosular: mergeTahminIntoKosular(
                    JSON.parse(r.program_json || '[]'),
                    r.tahmin_json
                ),
                tahminler: r.tahmin_json ? JSON.parse(r.tahmin_json) : null,
                yayinTarihi: r.yayin_tarihi,
                cekilmeTarihi: r.cekilme_tarihi
            }));
            resolve({
                tarih,
                hipodromlar,
                yayinli: hipodromlar.length > 0
            });
        });
    });
}

const tjkListCache = new Map();
const TJK_CACHE_MS = 90000;

async function getTjkHipodromlarCached(tarih, fetchOpts = {}) {
    const entry = tjkListCache.get(tarih);
    if (entry && Date.now() - entry.at < TJK_CACHE_MS) {
        return { hipodromlar: entry.hipodromlar, cached: true };
    }
    const hipodromlar = await tjkScrape.fetchHipodromlarForDate(tarih, fetchOpts);
    tjkListCache.set(tarih, { at: Date.now(), hipodromlar });
    return { hipodromlar, cached: false };
}

function ensureFetchLogTable(db) {
    return new Promise((resolve, reject) => {
        db.run(`CREATE TABLE IF NOT EXISTS public_program_fetch_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            finished_at DATETIME,
            tarih TEXT NOT NULL,
            trigger_name TEXT DEFAULT 'cli',
            hipodrom_sayisi INTEGER DEFAULT 0,
            basarili INTEGER DEFAULT 0,
            results_json TEXT,
            ok INTEGER DEFAULT 1
        )`, (err) => err ? reject(err) : resolve());
    });
}

function logFetchRun(db, entry) {
    return new Promise((resolve, reject) => {
        ensureFetchLogTable(db).then(() => {
            const sql = `INSERT INTO public_program_fetch_log
                (started_at, finished_at, tarih, trigger_name, hipodrom_sayisi, basarili, results_json, ok)
                VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)`;
            db.run(sql, [
                entry.startedAt || new Date().toISOString(),
                entry.tarih,
                entry.trigger || 'cli',
                entry.hipodromSayisi || 0,
                entry.basarili || 0,
                JSON.stringify(entry.results || []),
                entry.ok === false ? 0 : 1
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        }).catch(reject);
    });
}

function getLastFetchRuns(db, limit = 10) {
    return new Promise((resolve, reject) => {
        ensureFetchLogTable(db).then(() => {
            db.all(
                `SELECT id, started_at, finished_at, tarih, trigger_name, hipodrom_sayisi, basarili, results_json, ok
                 FROM public_program_fetch_log ORDER BY id DESC LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map((r) => ({
                        id: r.id,
                        startedAt: r.started_at,
                        finishedAt: r.finished_at,
                        tarih: r.tarih,
                        trigger: r.trigger_name,
                        hipodromSayisi: r.hipodrom_sayisi,
                        basarili: r.basarili,
                        ok: !!r.ok,
                        results: r.results_json ? JSON.parse(r.results_json) : []
                    })));
                }
            );
        }).catch(reject);
    });
}

function summarizeDayStatus(tarih, dbRows, tjkRows) {
    const domesticTjk = (tjkRows || []).filter((h) => isDomesticHipodrom(h.name));
    const dbById = new Map((dbRows || []).map((r) => [String(r.id), r]));
    const tjkById = new Map(domesticTjk.map((h) => [String(h.id), h]));

    const kayitli = (dbRows || []).map((r) => ({
        id: r.id,
        name: r.name,
        kosuSayisi: r.kosuSayisi,
        ilkKosuSaat: r.ilkKosuSaat || '',
        cekilmeTarihi: r.cekilmeTarihi || null
    }));

    const eksik = domesticTjk
        .filter((h) => !dbById.has(String(h.id)))
        .map((h) => ({ id: h.id, name: h.name }));

    const fazla = (dbRows || [])
        .filter((r) => !tjkById.has(String(r.id)))
        .map((r) => ({ id: r.id, name: r.name }));

    let lastFetch = null;
    for (const r of dbRows || []) {
        if (r.cekilmeTarihi && (!lastFetch || r.cekilmeTarihi > lastFetch)) {
            lastFetch = r.cekilmeTarihi;
        }
    }

    let durum = 'bos';
    if (kayitli.length && !eksik.length && !fazla.length && domesticTjk.length) durum = 'tam';
    else if (kayitli.length && eksik.length) durum = 'eksik';
    else if (kayitli.length && !eksik.length && fazla.length) durum = 'kayitli';
    else if (kayitli.length && !domesticTjk.length) durum = 'kayitli';
    else if (!kayitli.length && domesticTjk.length) durum = 'bos';

    return {
        tarih,
        iso: trToIso(tarih),
        yayinli: kayitli.length > 0,
        dbCount: kayitli.length,
        tjkDomesticCount: domesticTjk.length,
        kayitli,
        eksik,
        fazla,
        lastFetch,
        durum
    };
}

async function getProgramSyncForDate(db, tarih, opts = {}) {
    const vitrin = await getPublicVitrin(db, tarih);
    let tjkRows = [];
    let tjkError = null;
    let tjkCached = false;

    if (opts.live !== false) {
        try {
            const tjk = await getTjkHipodromlarCached(tarih, {
                maxAttempts: opts.maxAttempts || 3,
                timeoutMs: opts.timeoutMs || 25000
            });
            tjkRows = tjk.hipodromlar;
            tjkCached = tjk.cached;
        } catch (err) {
            tjkError = err.message;
        }
    }

    return {
        ...summarizeDayStatus(tarih, vitrin.hipodromlar, tjkRows),
        tjkError,
        tjkCached
    };
}

async function getProgramSyncOverview(db, opts = {}) {
    const today = todayTr();
    const tomorrow = tomorrowTr();
    const [todayStatus, tomorrowStatus, lastRuns] = await Promise.all([
        getProgramSyncForDate(db, today, opts),
        getProgramSyncForDate(db, tomorrow, opts),
        getLastFetchRuns(db, opts.logLimit || 8)
    ]);
    return {
        generatedAt: new Date().toISOString(),
        today: { ...todayStatus, label: 'bugün' },
        tomorrow: { ...tomorrowStatus, label: 'yarın' },
        lastRuns
    };
}

function listPublicProgramKayitlar(db, opts = {}) {
    return new Promise((resolve, reject) => {
        let sql = `SELECT tarih, hipodrom_id, hipodrom, kosu_sayisi, ilk_kosu_saat, cekilme_tarihi, durum
            FROM public_gunluk_program WHERE durum = 'yayinda'`;
        const params = [];
        if (opts.tarih) {
            sql += ' AND tarih = ?';
            params.push(opts.tarih);
        }
        sql += ' ORDER BY tarih DESC, hipodrom';
        if (opts.limit) {
            sql += ' LIMIT ?';
            params.push(opts.limit);
        }
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function getPublicProgramKayit(db, tarih, hipodromId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT tarih, hipodrom_id, hipodrom, kosu_sayisi, program_json, tahmin_json, cekilme_tarihi
             FROM public_gunluk_program WHERE tarih = ? AND hipodrom_id = ? AND durum = 'yayinda'`,
            [tarih, String(hipodromId)],
            (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                let races = [];
                try {
                    races = JSON.parse(row.program_json || '[]');
                } catch (_) { /* */ }
                resolve({
                    tarih: row.tarih,
                    hipodromId: row.hipodrom_id,
                    hipodrom: row.hipodrom,
                    raceCount: row.kosu_sayisi || races.length,
                    races,
                    cekilmeTarihi: row.cekilme_tarihi
                });
            }
        );
    });
}

module.exports = {
    formatTrDate,
    parseTrDate,
    isoToTr,
    trToIso,
    tomorrowTr,
    todayTr,
    isDomesticHipodrom,
    FALLBACK_HIPODROMS,
    ensureTables,
    buildPublicProgram,
    getPublicVitrin,
    fetchHipodromProgram,
    resolveHipodromList,
    queryHipodromlarFromDb,
    logFetchRun,
    getLastFetchRuns,
    getProgramSyncForDate,
    getProgramSyncOverview,
    listPublicProgramKayitlar,
    getPublicProgramKayit,
    syncProgramToHesaplamaKayit,
    syncAllPublicProgramsToHesaplama
};
