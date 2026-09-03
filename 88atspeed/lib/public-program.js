/**
 * Kamuya açık günlük program — bir gün önce çekilip SQLite'a yazılır.
 */
const cheerio = require('cheerio');
const tjkScrape = require('./tjk-scrape');

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

function isDomesticHipodrom(name) {
    if (!name) return false;
    if (/\(YD\s*\d*\)/i.test(name)) return false;
    if (/ABD|Krallık|Afrika|Avustralya|Fransa|Almanya/i.test(name)) return false;
    return DOMESTIC_HINT.test(name) || name === 'Karma';
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
        const meta = parseRaceMetaFromText(headerLine ? headerLine[1] : blok.slice(0, 200));
        meta.saat = meta.saat || kosuMatch[2];
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
            results.push({ hipodrom: hip.name, kosuSayisi: prog.kosuSayisi, ok: true });
            console.log('  ✓', hip.name, '—', prog.kosuSayisi, 'koşu');
        } catch (err) {
            results.push({ hipodrom: hip.name, ok: false, error: err.message });
            console.warn('  ✗', hip.name, '—', err.message);
        }
    }

    const okCount = results.filter((r) => r.ok).length;
    return {
        tarih,
        hipodromKaynagi: hipSource,
        hipodromSayisi: selected.length,
        basarili: okCount,
        results
    };
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
                kosular: JSON.parse(r.program_json || '[]'),
                tahminler: r.tahmin_json ? JSON.parse(r.tahmin_json) : null,
                yayinTarihi: r.yayin_tarihi
            }));
            resolve({
                tarih,
                hipodromlar,
                yayinli: hipodromlar.length > 0
            });
        });
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
    queryHipodromlarFromDb
};
