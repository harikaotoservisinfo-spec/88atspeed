/**
 * Kamu vitrin — TJK günlük koşu sonuçları (Sonuçlar sekmesi)
 */
const tjkScrape = require('./tjk-scrape');
const publicProgram = require('./public-program');

const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();

const HIP_ID_BY_NAME = {
    ankara: '5',
    izmir: '2',
    istanbul: '3',
    bursa: '4',
    adana: '6',
    kocaeli: '9',
    elazig: '10',
    elazığ: '10',
    diyarbakir: '11',
    diyarbakır: '11',
    antalya: '12',
    sanliurfa: '13',
    şanlıurfa: '13',
    urfa: '13',
    karma: '17'
};

function normalizeHipKey(name) {
    return String(name || '').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/\s*\(.*?\)\s*/g, ' ')
        .trim();
}

function cleanHipName(name) {
    return String(name || '').replace(/\s*\(\d+\.\s*Y\.G\.\)\s*/i, '').trim();
}

function resolveSehirId(hipodrom, hipodromId) {
    if (hipodromId) return String(hipodromId);
    const key = normalizeHipKey(hipodrom);
    if (HIP_ID_BY_NAME[key]) return HIP_ID_BY_NAME[key];
    for (const [name, id] of Object.entries(HIP_ID_BY_NAME)) {
        if (key.includes(name) || name.includes(key)) return id;
    }
    const hit = publicProgram.FALLBACK_HIPODROMS?.find((h) => {
        const n = normalizeHipKey(h.name);
        return n === key || key.includes(n) || n.includes(key);
    });
    return hit ? String(hit.id) : null;
}

async function fetchSonuclarForHipodrom(opts = {}) {
    const tarih = opts.tarih || publicProgram.isoToTr(opts.iso);
    const hipodrom = cleanHipName(opts.hipodrom || opts.hip || opts.sehirAdi || '');
    const sehirId = resolveSehirId(hipodrom, opts.hipodromId || opts.sehirId);
    if (!tarih) throw new Error('Geçersiz tarih');
    if (!hipodrom) throw new Error('hipodrom parametresi gerekli');
    if (!sehirId) throw new Error('Hipodrom eşleşmedi: ' + hipodrom);

    const cacheKey = [tarih, sehirId, hipodrom].join('|');
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }

    const browser = await tjkScrape.launchBrowser();
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        const parsed = await tjkScrape.fetchHipodromSonuclari(page, sehirId, hipodrom, tarih, opts);
        await page.close();

        const result = {
            success: true,
            source: 'tjk.org',
            tarih,
            iso: publicProgram.trToIso(tarih),
            hipodrom,
            sehirId,
            hasResults: parsed.hasResults,
            raceCount: parsed.raceCount,
            races: parsed.races,
            url: parsed.url,
            fetchedAt: new Date().toISOString(),
            message: parsed.hasResults
                ? null
                : 'Henüz sonuç yok — koşular tamamlandıkça güncellenecek.'
        };
        cache.set(cacheKey, { at: Date.now(), data: result });
        return result;
    } finally {
        try { await browser.close(); } catch (_) { /* */ }
    }
}

module.exports = {
    fetchSonuclarForHipodrom,
    resolveSehirId,
    cleanHipName,
    normalizeHipKey
};
