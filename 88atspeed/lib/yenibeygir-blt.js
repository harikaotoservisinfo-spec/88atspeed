/**
 * yenibeygir.com Bülten Ortalama Puanı (Blt) — kamu vitrin @ sütunu
 * https://yenibeygir.com/
 */
const cheerio = require('cheerio');
const https = require('https');

const BASE = 'https://yenibeygir.com';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

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

function isoToYbDate(iso) {
    const p = (iso || '').split('-');
    if (p.length !== 3) return null;
    return `${p[2]}-${p[1]}-${p[0]}`;
}

function trToYbDate(tr) {
    const m = (tr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

function fetchHtml(url, timeoutMs = 35000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'tr-TR,tr;q=0.9'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                return fetchHtml(next, timeoutMs).then(resolve).catch(reject);
            }
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
                else reject(new Error('HTTP ' + res.statusCode));
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('Zaman aşımı'));
        });
    });
}

async function fetchHtmlRetry(url, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    let lastErr = null;
    for (let i = 1; i <= maxAttempts; i++) {
        try {
            return await fetchHtml(url, opts.timeoutMs || 35000);
        } catch (err) {
            lastErr = err;
            if (i < maxAttempts) await sleep(1200 * i);
        }
    }
    throw lastErr || new Error('yenibeygir isteği başarısız');
}

function parseBltPage(html) {
    const $ = cheerio.load(html);
    const races = [];

    $('[id^="kosu_"]').each((_, row) => {
        const raceNo = ($(row).attr('id') || '').match(/kosu_(\d+)/)?.[1];
        if (!raceNo) return;

        const horses = [];
        $(row).find('table.kosanAtlar tbody tr').each((__, tr) => {
            const tds = $(tr).find('td');
            if (tds.length < 3) return;
            const blt = $(tds[0]).text().replace(/\s+/g, ' ').trim();
            const no = $(tds[1]).text().replace(/\s+/g, ' ').trim();
            const name = $(tr).find('a.atisimlink').first().text().replace(/\s+/g, ' ').trim();
            if (!no || !/^\d+$/.test(no)) return;
            horses.push({
                no,
                name,
                blt: blt || '',
                nameKey: normalizeName(name)
            });
        });

        if (horses.length) {
            const byNo = {};
            const byName = {};
            horses.forEach((h) => {
                byNo[h.no] = h.blt;
                if (h.nameKey) byName[h.nameKey] = h.blt;
            });
            races.push({ raceNo, horses, byNo, byName });
        }
    });

    return races;
}

function buildPageUrl(opts = {}) {
    const ybDate = opts.ybDate || isoToYbDate(opts.iso) || trToYbDate(opts.tarih);
    if (!ybDate) throw new Error('Geçersiz tarih');
    const slug = resolveHipSlug(opts.hipodrom);
    if (!slug) throw new Error('Hipodrom eşleşmedi: ' + (opts.hipodrom || ''));
    return `${BASE}/${ybDate}/${slug}`;
}

async function fetchBltForHipodrom(opts = {}) {
    const hipodrom = opts.hipodrom || '';
    const ybDate = opts.ybDate || isoToYbDate(opts.iso) || trToYbDate(opts.tarih);
    const cacheKey = [ybDate, resolveHipSlug(hipodrom)].join('|');
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';

    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }

    const url = buildPageUrl({ ...opts, ybDate });
    const html = await fetchHtmlRetry(url, opts);
    const races = parseBltPage(html);

    const raceMap = {};
    races.forEach((race) => {
        raceMap[race.raceNo] = {
            byNo: race.byNo,
            byName: race.byName
        };
    });

    const lastUpdate = cheerio.load(html)('.lastupdate .green').attr('content')
        || cheerio.load(html)('.lastupdate .green').attr('title')
        || null;

    const result = {
        success: true,
        source: 'yenibeygir.com',
        url,
        hipodrom,
        ybDate,
        raceCount: races.length,
        races: raceMap,
        lastUpdate
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

function lookupBlt(raceData, horse) {
    if (!raceData) return '';
    const byNo = raceData.byNo || {};
    const byName = raceData.byName || {};
    if (horse?.no && byNo[String(horse.no)] != null) return byNo[String(horse.no)];
    const key = normalizeName(horse?.name);
    if (key && byName[key] != null) return byName[key];
    return '';
}

module.exports = {
    fetchBltForHipodrom,
    parseBltPage,
    resolveHipSlug,
    lookupBlt,
    normalizeName
};
