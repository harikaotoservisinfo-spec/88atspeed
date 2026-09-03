/**
 * TJK VHS Muhtemeller — https://vhs.tjk.org/muhtemeller/
 * İki aşamalı: önce hızlı özet (hipodrom/koşu listesi), sonra tek koşu lazy yükleme.
 */
const https = require('https');

const CDN = 'https://vhs-medya-cdn.tjk.org/muhtemeller';
const MEDIA = 'https://vhs-medya.tjk.org/muhtemeller';

const cache = new Map();
const overviewCtx = new Map();
const CACHE_MS = 60000;
const RACE_CACHE_MS = 30000;

function isoToRefPath(iso) {
    const p = (iso || '').split('-');
    if (p.length !== 3) return null;
    return `${p[0]}/${p[1]}/${p[2]}`;
}

function trToRefPath(tr) {
    const m = (tr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}/${m[2]}/${m[1]}`;
}

function trToIso(tr) {
    const m = (tr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url, timeoutMs = 35000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
                'Accept': 'application/json'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
            }
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error('HTTP ' + res.statusCode));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('JSON parse hatası'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('Zaman aşımı'));
        });
    });
}

async function fetchJsonRetry(url, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    const timeoutMs = opts.timeoutMs || 35000;
    let lastErr = null;
    for (let i = 1; i <= maxAttempts; i++) {
        try {
            return await fetchJson(url, timeoutMs);
        } catch (err) {
            lastErr = err;
            if (i < maxAttempts) await sleep(1000 * i);
        }
    }
    throw lastErr || new Error('TJK isteği başarısız');
}

function mapHorseNames(atlar) {
    const out = {};
    if (!atlar) return out;
    if (Array.isArray(atlar)) {
        atlar.forEach((name, i) => { out[String(i + 1)] = name; });
    } else {
        Object.assign(out, atlar);
    }
    return out;
}

function getRaceAtlar(yaris, raceNo) {
    if (!yaris?.atlar) return {};
    const block = yaris.atlar[String(raceNo)] || yaris.atlar[raceNo];
    return mapHorseNames(block);
}

function enrichMuhtemeller(muhtemelData, atlar, atlarNext) {
    const m = muhtemelData?.muhtemeller;
    if (!m) return null;
    const bahisler = (m.bahisler || []).map((b) => {
        const items = (b.muhtemeller || []).map((row) => {
            const copy = { ...row };
            if (b.isGanyan || b.B === 'GANYAN') {
                copy.atAdi = atlar[row.S1] || '';
                copy.T = copy.atAdi ? `${row.S1} ${copy.atAdi}` : String(row.S1);
            } else if (b.B === 'ÇİFTE') {
                copy.atAdi1 = atlar[row.S1] || '';
                copy.atAdi2 = atlarNext[row.S2] || '';
                copy.T = `${row.S1} ${copy.atAdi1} - ${row.S2} ${copy.atAdi2}`.trim();
            } else {
                copy.atAdi1 = atlar[row.S1] || '';
                copy.atAdi2 = atlar[row.S2] || '';
                copy.T = `${row.S1} ${copy.atAdi1} - ${row.S2} ${copy.atAdi2}`.trim();
            }
            return copy;
        });
        return { ...b, muhtemeller: items };
    });
    return {
        key: m.KEY,
        no: m.NO,
        pist: m.PIST,
        saat: m.SAAT,
        durum: m.DURUM,
        isOpen: m.DURUM === 'AÇIK',
        bahisler
    };
}

function resolveRefPath(opts) {
    if (opts.refPath) return opts.refPath;
    if (opts.iso) return isoToRefPath(opts.iso);
    if (opts.tarih) return trToRefPath(opts.tarih);
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

async function loadOverviewContext(refPath, tarih) {
    const hit = overviewCtx.get(refPath);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;

    const checksum = await fetchJsonRetry(`${MEDIA}/s/${refPath}/checksum.json`);
    if (!checksum?.day) throw new Error('Bu tarih için muhtemel yayını yok');

    const dayJson = await fetchJsonRetry(`${CDN}/s/${refPath}/day-${checksum.day}.json`);
    const yarislar = dayJson?.data?.yarislar || [];
    const indexYarislar = {};
    for (const y of yarislar) indexYarislar[y.KEY] = y;

    const ctx = {
        at: Date.now(),
        refPath,
        tarih: tarih || checksum.date || '',
        checksum,
        yarislar,
        indexYarislar
    };
    overviewCtx.set(refPath, ctx);
    return ctx;
}

/** Hızlı özet — yalnızca hipodrom ve koşu listesi (~2 istek) */
async function fetchMuhtemelOverview(opts = {}) {
    const refPath = resolveRefPath(opts);
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    const cacheKey = 'overview|' + refPath;
    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }

    const ctx = await loadOverviewContext(refPath, opts.tarih);
    const hipodromlar = ctx.yarislar.map((y) => ({
        key: y.KEY,
        yer: y.YER || y.KEY,
        hipodrom: y.HIPODROM || y.KEY,
        kosular: y.kosular || [],
        selected: y.selected,
        agf: y.agf || null
    }));

    const runs = ctx.checksum.runs || {};
    const allowedKeys = new Set(ctx.yarislar.map((y) => y.KEY));
    const availableRuns = Object.keys(runs).filter((k) => allowedKeys.has(k.split('-')[0]));

    const result = {
        success: true,
        mode: 'overview',
        tarih: ctx.tarih,
        iso: trToIso(ctx.tarih) || opts.iso || refPath.replace(/\//g, '-'),
        refPath,
        hipodromlar,
        availableRuns,
        guncelleme: ctx.checksum.datetime || null
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

/** Tek koşu muhtemeli — lazy yükleme */
async function fetchMuhtemelRace(opts = {}) {
    const raceKey = opts.raceKey || opts.kosu;
    if (!raceKey) throw new Error('kosu parametresi gerekli (örn. ANKARA-1)');

    const refPath = resolveRefPath(opts);
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    const cacheKey = 'race|' + refPath + '|' + raceKey;
    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < RACE_CACHE_MS) return hit.data;
    }

    const ctx = await loadOverviewContext(refPath, opts.tarih);
    const hashes = ctx.checksum.runs?.[raceKey];
    if (!hashes?.length) throw new Error(raceKey + ' için muhtemel yayını yok');

    const url = `${CDN}/s/${refPath}/${raceKey}-${hashes[0]}.json`;
    const json = await fetchJsonRetry(url, { maxAttempts: 4, timeoutMs: 45000 });
    if (!json?.success) throw new Error('Muhtemel verisi alınamadı');

    const parts = raceKey.split('-');
    const hipKey = parts[0];
    const no = parts[1];
    const yaris = ctx.indexYarislar[hipKey];
    const atlarThis = getRaceAtlar(yaris, no);
    const atlarNext = getRaceAtlar(yaris, String(1 * no + 1));
    const muhtemel = enrichMuhtemeller(json.data, atlarThis, atlarNext);
    if (!muhtemel) throw new Error('Muhtemel parse edilemedi');

    const result = {
        success: true,
        mode: 'race',
        raceKey,
        tarih: ctx.tarih,
        iso: trToIso(ctx.tarih) || opts.iso,
        muhtemel
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

/** Geriye uyumluluk — kosu varsa tek koşu, yoksa özet */
async function fetchMuhtemeller(opts = {}) {
    const raceKey = opts.raceKey || opts.kosu;
    if (raceKey) {
        const overview = await fetchMuhtemelOverview(opts);
        const race = await fetchMuhtemelRace({ ...opts, raceKey });
        return {
            ...overview,
            mode: 'race',
            muhtemeller: { [raceKey]: race.muhtemel }
        };
    }
    return fetchMuhtemelOverview(opts);
}

module.exports = {
    fetchMuhtemeller,
    fetchMuhtemelOverview,
    fetchMuhtemelRace,
    isoToRefPath,
    trToRefPath,
    enrichMuhtemeller
};
