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

async function fetchOneHorseHistory(page, atId, name, opts, write) {
    const result = await tjkScrape.fetchAtKosularFromPage(page, atId, name, {
        maxKosu: opts.maxKosu,
        maxRetry: opts.maxRetry ?? 2,
        pageRetries: opts.pageRetries ?? 3,
        tableWaitMs: opts.tableWaitMs,
        onProgress: (msg) => write('      · ' + msg)
    });
    const kosuCount = result.kosular?.length || 0;
    if (result.error === 'gecmis_yok') {
        write('      ○ ilk koşu — TJK geçmişi yok');
    } else if (!result.success) {
        write('      ⚠ veri alınamadı: ' + (result.error || 'bilinmeyen'));
    } else if (kosuCount === 0) {
        write('      ⚠ 0 koşu — okunamadı');
    } else {
        write('      ✓ ' + kosuCount + ' koşu kaydedildi');
    }
    return result;
}

async function enrichRacesWithHorseHistory(races, opts = {}) {
    const toFetch = collectHorsesNeedingHistory(races);
    if (!toFetch.length) {
        return { races, fetched: 0, withKosular: 0, noHistory: 0, retried: 0, stillMissing: 0 };
    }

    const maxKosu = opts.maxKosu || 7;
    const delayMs = opts.horseDelayMs ?? 600;
    const pageRecycleEvery = opts.pageRecycleEvery ?? 40;
    const cache = new Map();
    let page = opts.page || null;
    let browser = opts.browser || null;
    let ownBrowser = false;
    let ownPage = false;

    const write = (line) => {
        if (opts.onLog) opts.onLog(line);
        else console.log(line);
    };

    async function ensurePage() {
        if (page) return page;
        write('    🌐 Puppeteer tarayıcı açılıyor…');
        browser = await tjkScrape.launchBrowser();
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        ownBrowser = true;
        ownPage = true;
        write('    ✓ Tarayıcı hazır');
        return page;
    }

    async function recyclePage(reason) {
        if (!page) return;
        const canRecycle = ownBrowser || browser;
        if (!canRecycle) return;
        write('    ♻ sayfa yenileniyor' + (reason ? ' (' + reason + ')' : '') + '…');
        try { await page.close(); } catch (_) { /* */ }
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        if (opts.onPageRecycle) opts.onPageRecycle(page);
    }

    if (!page) {
        await ensurePage();
    }

    const runBatch = async (batch, batchOpts = {}) => {
        const startedAt = Date.now();
        const failed = [];
        let batchNoHistory = 0;
        for (let i = 0; i < batch.length; i++) {
            const { atId, name } = batch[i];
            if (i > 0 && delayMs > 0) await sleep(delayMs);
            if (pageRecycleEvery > 0 && i > 0 && i % pageRecycleEvery === 0) {
                await recyclePage((i + 1) + '. at');
            }
            const label = (name || atId || '').toString().slice(0, 28);
            const prefix = batchOpts.retryPass ? '    ↻ [' : '    → [';
            write(prefix + (i + 1) + '/' + batch.length + '] ' + label + (batchOpts.retryPass ? ' yeniden…' : ' başlıyor…'));
            try {
                const result = await fetchOneHorseHistory(page, atId, name, {
                    maxKosu,
                    maxRetry: batchOpts.maxRetry ?? opts.maxRetry ?? 2,
                    pageRetries: batchOpts.pageRetries ?? opts.pageRetries ?? 3,
                    tableWaitMs: opts.tableWaitMs
                }, write);
                const kosuCount = result.kosular?.length || 0;
                if (kosuCount > 0) {
                    cache.set(atId, result.kosular);
                } else if (result.error === 'gecmis_yok') {
                    cache.set(atId, []);
                    batchNoHistory++;
                } else if (!cache.has(atId) || !(cache.get(atId) || []).length) {
                    cache.set(atId, []);
                    if (result.retryable !== false) {
                        failed.push({ atId, name });
                    }
                }
            } catch (err) {
                write('      ⚠ hata: ' + err.message);
                if (!cache.has(atId) || !(cache.get(atId) || []).length) {
                    cache.set(atId, []);
                    failed.push({ atId, name });
                }
            }
            const done = i + 1;
            const pct = Math.round((done / batch.length) * 100);
            const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
            const etaSec = done > 0 ? Math.round((elapsedSec / done) * (batch.length - done)) : 0;
            if (opts.onProgress && !batchOpts.retryPass) {
                opts.onProgress(done, batch.length, atId, name, { pct, elapsedSec, etaSec });
            } else if (!batchOpts.retryPass) {
                const progressLabel = (name || atId || '').toString().slice(0, 28);
                console.log(
                    '    [' + done + '/' + batch.length + '] %' + pct
                    + ' · ' + progressLabel
                    + ' · geçen ' + formatEta(elapsedSec)
                    + ' · kalan ~' + formatEta(etaSec)
                );
            }
        }
        return { failed, noHistory: batchNoHistory };
    };

    try {
        let totalNoHistory = 0;
        let batchResult = await runBatch(toFetch);
        let failed = batchResult.failed;
        totalNoHistory += batchResult.noHistory;
        let retried = 0;
        const retryPasses = opts.retryEmptyPasses ?? 2;
        for (let pass = 0; pass < retryPasses && failed.length; pass++) {
            await recyclePage('eksik at tur ' + (pass + 1));
            write('    ↻ ' + failed.length + ' at için eksik geçmiş yeniden deneniyor (tur ' + (pass + 1) + ')…');
            const retryBatch = failed;
            batchResult = await runBatch(retryBatch, {
                retryPass: true,
                maxRetry: (opts.maxRetry ?? 2) + 1,
                pageRetries: (opts.pageRetries ?? 3) + 1
            });
            failed = batchResult.failed;
            totalNoHistory += batchResult.noHistory;
            retried += retryBatch.length;
        }
        if (failed.length) {
            const names = failed.slice(0, 8).map((f) => (f.name || f.atId)).join(', ');
            write('    ⚠ ' + failed.length + ' at geçmişi hâlâ eksik: ' + names + (failed.length > 8 ? '…' : ''));
        }
        attachKosularToRaces(races, cache);
        const withKosular = [...cache.values()].filter((k) => k.length > 0).length;
        return {
            races,
            fetched: toFetch.length,
            withKosular,
            noHistory: totalNoHistory,
            retried,
            stillMissing: failed.length,
            failedHorses: failed
        };
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
