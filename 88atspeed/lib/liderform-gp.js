/**
 * liderform.com.tr GP puanı — kamu vitrin @2 sütunu
 * https://liderform.com.tr/program/{yyyy-mm-dd}/{hipodrom}/{kosuNo}
 */
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { resolveChromePath } = require('./chrome-path');

puppeteer.use(StealthPlugin());

const BASE = 'https://liderform.com.tr/program';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
let sharedBrowser = null;
let sharedPage = null;

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

async function launchLfBrowser() {
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    const chromePath = resolveChromePath();
    if (chromePath) launchOptions.executablePath = chromePath;
    return puppeteer.launch(launchOptions);
}

async function fetchRaceHtml(url, opts = {}) {
    const browser = await launchLfBrowser();
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );
        await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs || 60000 });
        await sleep(1500);
        const title = await page.title();
        if (/cloudflare|attention required|blocked/i.test(title)) {
            throw new Error('Liderform erişim engeli (Cloudflare)');
        }
        return await page.content();
    } finally {
        await browser.close();
    }
}

async function getLfPage(opts = {}) {
    if (sharedBrowser && sharedPage) return sharedPage;
    sharedBrowser = await launchLfBrowser();
    sharedPage = await sharedBrowser.newPage();
    await sharedPage.setViewport({ width: 1920, height: 1080 });
    await sharedPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    return sharedPage;
}

async function closeLfBrowser() {
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch (_) { /* */ }
    }
    sharedBrowser = null;
    sharedPage = null;
}

async function fetchRaceGpFromPage(page, iso, slug, raceNo, opts = {}) {
    const url = buildRaceUrl(iso, slug, raceNo);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs || 30000 });
    await sleep(500);
    const title = await page.title();
    if (/cloudflare|attention required|blocked/i.test(title)) {
        throw new Error('Liderform erişim engeli (Cloudflare)');
    }
    const html = await page.content();
    const parsed = parseGpFromHtml(html);
    return { url, byNo: parsed.byNo, byName: parsed.byName };
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
    }

    if (!raceNos.length) throw new Error('Koşu listesi boş');

    const raceMap = {};
    const urls = [];
    const ownBrowser = opts.keepBrowser !== true;
    try {
        const page = await getLfPage(opts);
        for (let i = 0; i < raceNos.length; i++) {
            const raceNo = raceNos[i];
            if (i > 0) await sleep(250);
            const parsed = await fetchRaceGpFromPage(page, iso, slug, raceNo, opts);
            urls.push(parsed.url);
            raceMap[raceNo] = { byNo: parsed.byNo, byName: parsed.byName };
            if (typeof opts.onRace === 'function') {
                await opts.onRace(raceNo, raceMap[raceNo], i + 1, raceNos.length);
            }
        }
    } finally {
        if (ownBrowser) await closeLfBrowser();
    }

    const result = {
        success: true,
        source: 'liderform.com.tr',
        hipodrom,
        iso,
        slug,
        raceCount: Object.keys(raceMap).length,
        races: raceMap,
        urls
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

module.exports = {
    fetchGpForHipodrom,
    fetchRaceGpFromPage,
    parseGpFromHtml,
    resolveHipSlug,
    normalizeName,
    buildRaceUrl
};
