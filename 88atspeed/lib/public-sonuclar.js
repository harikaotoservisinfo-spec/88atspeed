/**
 * Kamu vitrin — TJK günlük koşu sonuçları (Sonuçlar sekmesi)
 */
const tjkScrape = require('./tjk-scrape');
const publicProgram = require('./public-program');

const CACHE_MS = 2 * 60 * 1000;
const EMPTY_CACHE_MS = 30 * 1000;
const STALE_SERVE_MS = 90 * 1000;
const BROWSER_IDLE_MS = 3 * 60 * 1000;

const cache = new Map();
const inFlight = new Map();

let browserFactory = null;
let sharedBrowser = null;
let browserIdleTimer = null;

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

function setBrowserFactory(fn) {
    browserFactory = typeof fn === 'function' ? fn : null;
}

function scheduleBrowserIdleClose() {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(async () => {
        if (sharedBrowser) {
            try { await sharedBrowser.close(); } catch (_) { /* */ }
            sharedBrowser = null;
        }
    }, BROWSER_IDLE_MS);
}

async function acquireBrowser() {
    if (browserFactory) return browserFactory();
    if (sharedBrowser) {
        try {
            if (sharedBrowser.isConnected()) {
                scheduleBrowserIdleClose();
                return sharedBrowser;
            }
        } catch (_) { /* reconnect */ }
        sharedBrowser = null;
    }
    sharedBrowser = await tjkScrape.launchBrowser();
    scheduleBrowserIdleClose();
    return sharedBrowser;
}

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

function cacheTtlFor(data) {
    if (!data?.hasResults) return EMPTY_CACHE_MS;
    return CACHE_MS;
}

function buildResult(parsed, meta) {
    return {
        success: true,
        source: 'tjk.org',
        tarih: meta.tarih,
        iso: publicProgram.trToIso(meta.tarih),
        hipodrom: meta.hipodrom,
        sehirId: meta.sehirId,
        hasResults: parsed.hasResults,
        raceCount: parsed.raceCount,
        tabCount: parsed.tabCount || parsed.raceCount,
        races: parsed.races,
        url: parsed.url,
        fetchedAt: new Date().toISOString(),
        stale: !!meta.stale,
        message: parsed.hasResults
            ? null
            : 'Henüz sonuç yok — koşular tamamlandıkça güncellenecek.'
    };
}

async function scrapeSonuclar(meta) {
    const browser = await acquireBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 1920, height: 1080 });
        const parsed = await tjkScrape.fetchHipodromSonuclari(
            page,
            meta.sehirId,
            meta.hipodrom,
            meta.tarih,
            {
                expectedRaceCount: meta.expectedRaceCount || 0,
                waitMs: meta.waitMs || 25000
            }
        );
        return buildResult(parsed, meta);
    } finally {
        try { await page.close(); } catch (_) { /* */ }
    }
}

function queueBackgroundRefresh(cacheKey, meta) {
    if (inFlight.has(cacheKey + ':bg')) return;
    const bg = scrapeSonuclar(meta)
        .then((result) => {
            cache.set(cacheKey, { at: Date.now(), data: result });
            return result;
        })
        .catch((err) => {
            console.warn('sonuclar arka plan yenileme:', err.message);
        })
        .finally(() => {
            inFlight.delete(cacheKey + ':bg');
        });
    inFlight.set(cacheKey + ':bg', bg);
}

async function fetchSonuclarForHipodrom(opts = {}) {
    const tarih = opts.tarih || publicProgram.isoToTr(opts.iso);
    const hipodrom = cleanHipName(opts.hipodrom || opts.hip || opts.sehirAdi || '');
    const sehirId = resolveSehirId(hipodrom, opts.hipodromId || opts.sehirId);
    const expectedRaceCount = parseInt(opts.expectedRaceCount || opts.kosuSayisi || '0', 10) || 0;
    if (!tarih) throw new Error('Geçersiz tarih');
    if (!hipodrom) throw new Error('hipodrom parametresi gerekli');
    if (!sehirId) throw new Error('Hipodrom eşleşmedi: ' + hipodrom);

    const cacheKey = [tarih, sehirId, hipodrom].join('|');
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    const hit = cache.get(cacheKey);
    const age = hit ? Date.now() - hit.at : Infinity;
    const ttl = hit ? cacheTtlFor(hit.data) : 0;

    if (!skipCache && hit && age < ttl) {
        return hit.data;
    }

    if (!skipCache && hit && age < STALE_SERVE_MS) {
        queueBackgroundRefresh(cacheKey, { tarih, hipodrom, sehirId, expectedRaceCount });
        return Object.assign({}, hit.data, { stale: true });
    }

    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const meta = { tarih, hipodrom, sehirId, expectedRaceCount };
    const promise = scrapeSonuclar(meta)
        .then((result) => {
            cache.set(cacheKey, { at: Date.now(), data: result });
            return result;
        })
        .finally(() => {
            inFlight.delete(cacheKey);
        });
    inFlight.set(cacheKey, promise);
    return promise;
}

module.exports = {
    fetchSonuclarForHipodrom,
    resolveSehirId,
    cleanHipName,
    normalizeHipKey,
    setBrowserFactory
};
