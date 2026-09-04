/**
 * TJK Puppeteer ile at geçmişi (kosular[]) zenginleştirme — panel GETİR akışının sunucu tarafı.
 */
const tjkScrape = require('./tjk-scrape');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function collectHorsesNeedingHistory(races) {
    const byId = new Map();
    for (const race of races || []) {
        for (const h of race.horses || []) {
            if (!h.atId || (h.kosular || []).length) continue;
            if (!byId.has(h.atId)) {
                byId.set(h.atId, { atId: h.atId, name: h.name || '' });
            }
        }
    }
    return [...byId.values()];
}

function attachKosularToRaces(races, cache) {
    for (const race of races || []) {
        for (const h of race.horses || []) {
            if (h.atId && !h.kosular?.length && cache.has(h.atId)) {
                h.kosular = cache.get(h.atId);
            }
        }
    }
    return races;
}

async function enrichRacesWithHorseHistory(races, opts = {}) {
    const toFetch = collectHorsesNeedingHistory(races);
    if (!toFetch.length) return { races, fetched: 0, withKosular: 0 };

    const maxKosu = opts.maxKosu || 7;
    const delayMs = opts.horseDelayMs ?? 600;
    const cache = new Map();
    let page = opts.page || null;
    let browser = null;
    let ownBrowser = false;

    if (!page) {
        browser = await tjkScrape.launchBrowser();
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        ownBrowser = true;
    }

    try {
        for (let i = 0; i < toFetch.length; i++) {
            const { atId, name } = toFetch[i];
            if (i > 0 && delayMs > 0) await sleep(delayMs);
            try {
                const result = await tjkScrape.fetchAtKosularFromPage(page, atId, name, {
                    maxKosu,
                    maxRetry: opts.maxRetry ?? 1
                });
                cache.set(atId, result.success && result.kosular?.length ? result.kosular : []);
            } catch (err) {
                console.warn('    ⚠ at', atId, name || '', '—', err.message);
                cache.set(atId, []);
            }
            if (opts.onProgress) {
                opts.onProgress(i + 1, toFetch.length, atId, name);
            } else if ((i + 1) % 10 === 0 || i === toFetch.length - 1) {
                console.log('    at geçmişi:', i + 1, '/', toFetch.length);
            }
        }
        attachKosularToRaces(races, cache);
        const withKosular = [...cache.values()].filter((k) => k.length > 0).length;
        return { races, fetched: toFetch.length, withKosular };
    } finally {
        if (ownBrowser && browser) {
            try { await browser.close(); } catch (_) { /* */ }
        }
    }
}

function countKosularStats(races) {
    let total = 0;
    let withData = 0;
    for (const race of races || []) {
        for (const h of race.horses || []) {
            total++;
            if ((h.kosular || []).length) withData++;
        }
    }
    return { total, withData, missing: total - withData };
}

module.exports = {
    enrichRacesWithHorseHistory,
    collectHorsesNeedingHistory,
    countKosularStats
};
