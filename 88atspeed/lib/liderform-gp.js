/**
 * liderform.com.tr GP puanı — kamu vitrin @2 sütunu
 * https://liderform.com.tr/program/{yyyy-mm-dd}/{hipodrom}/{kosuNo}
 */
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { resolveChromePath } = require('./chrome-path');

puppeteer.use(StealthPlugin());

const BASE = 'https://liderform.com.tr/program';
const CACHE_MS = 5 * 60 * 1000;
const DISK_CACHE_MS = 30 * 60 * 1000;
const BROWSER_IDLE_MS = 2 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '..', 'data', 'liderform-gp');

const cache = new Map();
let sharedBrowser = null;
let sharedPage = null;
let browserIdleTimer = null;
let browserInUse = 0;

const HIP_SLUGS = {
    bursa: 'bursa',
    izmir: 'izmir',
    istanbul: 'istanbul',
    ankara: 'ankara',
    adana: 'adana',
    elazig: 'elazig',
    elazığ: 'elazig',
    diyarbakir: 'diyarbakir',
    diyarbakır: 'diyarbakir',
    kocaeli: 'kocaeli',
    antalya: 'antalya',
    sanliurfa: 'sanliurfa',
    şanlıurfa: 'sanliurfa',
    urfa: 'sanliurfa'
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function normalizeName(s) {
    return String(s || '').toLocaleUpperCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[^A-Z0-9]/g, '');
}

function resolveHipSlug(hipodrom) {
    const key = String(hipodrom || '').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '').trim();
    if (HIP_SLUGS[key]) return HIP_SLUGS[key];
    for (const [name, slug] of Object.entries(HIP_SLUGS)) {
        if (key.includes(name) || name.includes(key)) return slug;
    }
    return null;
}

function isoFromOpts(opts) {
    if (opts.iso) return opts.iso;
    const m = (opts.tarih || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

function buildRaceUrl(iso, slug, raceNo) {
    return `${BASE}/${iso}/${slug}/${raceNo}`;
}

function diskCachePath(iso, slug) {
    return path.join(DATA_DIR, iso, `${slug}.json`);
}

function readDiskCache(iso, slug, maxAgeMs = DISK_CACHE_MS) {
    try {
        const file = diskCachePath(iso, slug);
        if (!fs.existsSync(file)) return null;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw?.races || !raw.fetchedAt) return null;
        if (Date.now() - raw.fetchedAt > maxAgeMs) return null;
        return raw;
    } catch (_) {
        return null;
    }
}

function readDiskCacheStale(iso, slug) {
    try {
        const file = diskCachePath(iso, slug);
        if (!fs.existsSync(file)) return null;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw?.races) return null;
        return raw;
    } catch (_) {
        return null;
    }
}

function writeDiskCache(iso, slug, hipodrom, raceMap) {
    try {
        const dir = path.join(DATA_DIR, iso);
        fs.mkdirSync(dir, { recursive: true });
        const file = diskCachePath(iso, slug);
        let existing = null;
        if (fs.existsSync(file)) {
            try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* */ }
        }
        const mergedRaces = { ...(existing?.races || {}), ...raceMap };
        const payload = {
            iso,
            slug,
            hipodrom,
            fetchedAt: Date.now(),
            races: mergedRaces
        };
        fs.writeFileSync(file, JSON.stringify(payload));
        return payload;
    } catch (err) {
        console.warn('liderform-gp disk cache yazılamadı:', err.message);
        return null;
    }
}

function parseGpFromHtml(html) {
    const $ = cheerio.load(html);
    const horses = [];

    $('table').each((_, table) => {
        const headers = [];
        $(table).find('thead th, thead td').each((__, th) => {
            headers.push($(th).text().replace(/\s+/g, ' ').trim().toUpperCase());
        });
        const noIdx = headers.findIndex((h) => h === 'NO');
        const gpIdx = headers.findIndex((h) => h === 'GP');
        const adiIdx = headers.findIndex((h) => h.startsWith('ADI') || h === 'AT İSMİ' || h === 'AT');
        if (noIdx < 0 || gpIdx < 0) return;

        $(table).find('tbody tr').each((__, tr) => {
            const tds = $(tr).find('td');
            if (!tds.length) return;
            const no = $(tds[noIdx]).text().replace(/\s+/g, ' ').trim();
            if (!/^\d+$/.test(no)) return;
            const gp = $(tds[gpIdx]).text().replace(/\s+/g, ' ').trim();
            let name = '';
            if (adiIdx >= 0) {
                name = $(tds[adiIdx]).find('a').first().text().replace(/\s+/g, ' ').trim()
                    || $(tds[adiIdx]).text().replace(/\s+/g, ' ').trim();
            }
            if (!name) {
                name = $(tr).find('a[href*="/at/"]').first().text().replace(/\s+/g, ' ').trim();
            }
            horses.push({ no, name, gp: gp || '' });
        });
    });

    if (!horses.length) {
        $('a[href*="/at/"]').each((_, a) => {
            const name = $(a).text().replace(/\s+/g, ' ').trim();
            if (!name || name.length < 2) return;
            const row = $(a).closest('tr');
            if (!row.length) return;
            const tds = row.find('td');
            if (!tds.length) return;
            const no = $(tds[0]).text().trim();
            if (!/^\d+$/.test(no)) return;
            const gp = $(tds[1]).text().trim();
            if (horses.some((h) => h.no === no)) return;
            horses.push({ no, name, gp: gp || '' });
        });
    }

    const byNo = {};
    const byName = {};
    horses.forEach((h) => {
        if (h.gp !== '') byNo[h.no] = h.gp;
        const key = normalizeName(h.name);
        if (key && h.gp !== '') byName[key] = h.gp;
    });
    return { horses, byNo, byName };
}

function isCloudflareBlock(title, html) {
    return /cloudflare|attention required|blocked/i.test(title || '')
        || /cf-browser-verification|challenge-platform/i.test(html || '');
}

async function launchLfBrowser() {
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    const chromePath = resolveChromePath();
    if (chromePath) launchOptions.executablePath = chromePath;
    return puppeteer.launch(launchOptions);
}

function scheduleBrowserIdleClose() {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(async () => {
        if (browserInUse > 0) {
            scheduleBrowserIdleClose();
            return;
        }
        await closeLfBrowser();
    }, BROWSER_IDLE_MS);
}

async function getLfPage() {
    if (sharedBrowser && sharedPage) {
        try {
            if (sharedBrowser.isConnected()) {
                scheduleBrowserIdleClose();
                return sharedPage;
            }
        } catch (_) { /* reconnect */ }
        await closeLfBrowser();
    }
    sharedBrowser = await launchLfBrowser();
    sharedPage = await sharedBrowser.newPage();
    await sharedPage.setViewport({ width: 1920, height: 1080 });
    await sharedPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    scheduleBrowserIdleClose();
    return sharedPage;
}

async function closeLfBrowser() {
    if (browserIdleTimer) {
        clearTimeout(browserIdleTimer);
        browserIdleTimer = null;
    }
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch (_) { /* */ }
    }
    sharedBrowser = null;
    sharedPage = null;
}

async function fetchRaceGpFromPage(page, iso, slug, raceNo, opts = {}) {
    const url = buildRaceUrl(iso, slug, raceNo);
    const maxAttempts = opts.maxAttempts || 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const resp = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: opts.timeoutMs || 30000
            });
            await sleep(attempt === 1 ? 800 : 1500);
            const title = await page.title();
            const html = await page.content();
            const status = resp ? resp.status() : 0;

            if (status === 403 || isCloudflareBlock(title, html)) {
                throw new Error('Liderform erişim engeli (Cloudflare)');
            }
            const parsed = parseGpFromHtml(html);
            if (!Object.keys(parsed.byNo).length && !Object.keys(parsed.byName).length) {
                throw new Error('GP tablosu bulunamadı');
            }
            return { url, byNo: parsed.byNo, byName: parsed.byName };
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
                await sleep(1500 * attempt);
            }
        }
    }
    throw lastErr || new Error('Liderform GP alınamadı');
}

function buildResult(iso, slug, hipodrom, raceMap, urls, extra = {}) {
    return {
        success: true,
        source: 'liderform.com.tr',
        hipodrom,
        iso,
        slug,
        raceCount: Object.keys(raceMap).length,
        races: raceMap,
        urls: urls || [],
        ...extra
    };
}

function pickRacesFromStore(store, raceNos) {
    const raceMap = {};
    const urls = [];
    raceNos.forEach((raceNo) => {
        const hit = store?.races?.[raceNo];
        if (hit) {
            raceMap[raceNo] = { byNo: hit.byNo, byName: hit.byName };
            if (hit.url) urls.push(hit.url);
        }
    });
    return { raceMap, urls };
}

async function fetchGpForHipodrom(opts = {}) {
    const hipodrom = opts.hipodrom || '';
    const iso = isoFromOpts(opts);
    const slug = resolveHipSlug(hipodrom);
    if (!iso) throw new Error('Geçersiz tarih');
    if (!slug) throw new Error('Hipodrom eşleşmedi: ' + hipodrom);

    const raceNos = (opts.raceNos || []).map(String);
    const cacheKey = [iso, slug, raceNos.join(',')].join('|');
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';

    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

        const diskFresh = readDiskCache(iso, slug);
        if (diskFresh) {
            const { raceMap, urls } = pickRacesFromStore(diskFresh, raceNos);
            if (Object.keys(raceMap).length === raceNos.length) {
                const result = buildResult(iso, slug, hipodrom, raceMap, urls, {
                    fromCache: 'disk',
                    cacheAgeSec: Math.round((Date.now() - diskFresh.fetchedAt) / 1000)
                });
                cache.set(cacheKey, { at: Date.now(), data: result });
                return result;
            }
        }
    }

    if (!raceNos.length) throw new Error('Koşu listesi boş');

    const raceMap = {};
    const urls = [];
    const errors = [];
    let usedStaleDisk = false;

    browserInUse += 1;
    try {
        const page = await getLfPage();
        for (let i = 0; i < raceNos.length; i++) {
            const raceNo = raceNos[i];
            if (i > 0) await sleep(200);
            try {
                const parsed = await fetchRaceGpFromPage(page, iso, slug, raceNo, opts);
                urls.push(parsed.url);
                raceMap[raceNo] = { byNo: parsed.byNo, byName: parsed.byName, url: parsed.url };
                if (typeof opts.onRace === 'function') {
                    await opts.onRace(raceNo, raceMap[raceNo], i + 1, raceNos.length);
                }
            } catch (err) {
                errors.push({ raceNo, error: err.message });
                const stale = readDiskCacheStale(iso, slug);
                const staleRace = stale?.races?.[raceNo];
                if (staleRace) {
                    raceMap[raceNo] = {
                        byNo: staleRace.byNo || {},
                        byName: staleRace.byName || {},
                        url: staleRace.url || buildRaceUrl(iso, slug, raceNo),
                        stale: true
                    };
                    usedStaleDisk = true;
                }
            }
        }
    } finally {
        browserInUse -= 1;
        scheduleBrowserIdleClose();
    }

    if (Object.keys(raceMap).length) {
        writeDiskCache(iso, slug, hipodrom, raceMap);
    }

    if (!Object.keys(raceMap).length) {
        const msg = errors[0]?.error || 'Liderform GP alınamadı';
        throw new Error(msg);
    }

    const result = buildResult(iso, slug, hipodrom, raceMap, urls, {
        partial: errors.length > 0,
        errors: errors.length ? errors : undefined,
        stale: usedStaleDisk || undefined
    });

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

module.exports = {
    fetchGpForHipodrom,
    fetchRaceGpFromPage,
    parseGpFromHtml,
    resolveHipSlug,
    normalizeName,
    buildRaceUrl,
    readDiskCache,
    closeLfBrowser
};
