/**
 * TJK Puppeteer ile at geçmişi (kosular[]) zenginleştirme — panel GETİR akışının sunucu tarafı.
 */
const tjkScrape = require('./tjk-scrape');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function formatEta(sec) {
    if (!sec || sec < 0) return '—';
    if (sec < 60) return sec + ' sn';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ' dk ' + s + ' sn';
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

    const write = (line) => {
        if (opts.onLog) opts.onLog(line);
        else console.log(line);
    };

    if (!page) {
        write('    🌐 Puppeteer tarayıcı açılıyor…');
        browser = await tjkScrape.launchBrowser();
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        ownBrowser = true;
        write('    ✓ Tarayıcı hazır');
    }

    try {
        const startedAt = Date.now();
        for (let i = 0; i < toFetch.length; i++) {
            const { atId, name } = toFetch[i];
            if (i > 0 && delayMs > 0) await sleep(delayMs);
            const label = (name || atId || '').toString().slice(0, 28);
            write('    → [' + (i + 1) + '/' + toFetch.length + '] ' + label + ' başlıyor…');
            try {
                const result = await tjkScrape.fetchAtKosularFromPage(page, atId, name, {
                    maxKosu,
                    maxRetry: opts.maxRetry ?? 1,
                    onProgress: (msg) => write('      · ' + msg)
                });
                const kosuCount = result.kosular?.length || 0;
                if (!result.success) {
                    write('      ⚠ veri alınamadı: ' + (result.error || 'bilinmeyen'));
                } else if (kosuCount === 0) {
                    write('      ⚠ 0 koşu — bu at için TJK geçmişi yok veya okunamadı');
                } else {
                    write('      ✓ ' + kosuCount + ' koşu kaydedildi');
                }
                cache.set(atId, result.success && kosuCount ? result.kosular : []);
            } catch (err) {
                write('      ⚠ hata: ' + err.message);
                cache.set(atId, []);
            }
            const done = i + 1;
            const pct = Math.round((done / toFetch.length) * 100);
            const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
            const etaSec = done > 0 ? Math.round((elapsedSec / done) * (toFetch.length - done)) : 0;
            if (opts.onProgress) {
                opts.onProgress(done, toFetch.length, atId, name, { pct, elapsedSec, etaSec });
            } else {
                const label = (name || atId || '').toString().slice(0, 28);
                console.log(
                    '    [' + done + '/' + toFetch.length + '] %' + pct
                    + ' · ' + label
                    + ' · geçen ' + formatEta(elapsedSec)
                    + ' · kalan ~' + formatEta(etaSec)
                );
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
