/**
 * TJK VHS Muhtemeller — https://vhs.tjk.org/muhtemeller/
 * Veri kaynağı: vhs-medya-cdn.tjk.org/muhtemeller/s/{YYYY/MM/DD}/
 */
const https = require('https');

const CDN = 'https://vhs-medya-cdn.tjk.org/muhtemeller';
const MEDIA = 'https://vhs-medya.tjk.org/muhtemeller';

const cache = new Map();
const CACHE_MS = 45000;

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

function fetchJson(url, timeoutMs = 25000) {
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
                    return reject(new Error('HTTP ' + res.statusCode + ' — ' + url));
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

/** atlar yapısı: { "1": { "1": "AT ADI", ... }, "2": { ... } } */
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

async function fetchRaceMuhtemel(refPath, runKey, hash) {
    const url = `${CDN}/s/${refPath}/${runKey}-${hash}.json`;
    const json = await fetchJson(url);
    if (!json?.success) throw new Error('Muhtemel verisi alınamadı');
    return json;
}

async function fetchMuhtemeller(opts = {}) {
    let refPath = opts.refPath;
    let tarih = opts.tarih || '';

    if (!refPath && opts.iso) refPath = isoToRefPath(opts.iso);
    if (!refPath && tarih) refPath = trToRefPath(tarih);
    if (!refPath) {
        const d = new Date();
        refPath = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    const cacheKey = refPath + '|' + (opts.raceKey || 'all');
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const checksum = await fetchJson(`${MEDIA}/s/${refPath}/checksum.json`);
    if (!checksum?.day) throw new Error('Bu tarih için muhtemel yayını yok');

    tarih = tarih || checksum.date || '';

    const dayJson = await fetchJson(`${CDN}/s/${refPath}/day-${checksum.day}.json`);
    const yarislar = dayJson?.data?.yarislar || [];

    const hipodromlar = yarislar.map((y) => ({
        key: y.KEY,
        yer: y.YER || y.KEY,
        hipodrom: y.HIPODROM || y.KEY,
        kosular: y.kosular || [],
        selected: y.selected,
        agf: y.agf || null
    }));

    const indexYarislar = {};
    for (const y of yarislar) indexYarislar[y.KEY] = y;

    const runs = checksum.runs || {};
    const raceKeys = opts.raceKey
        ? [opts.raceKey]
        : Object.keys(runs);

    const muhtemeller = {};
    const errors = [];

    await Promise.all(raceKeys.map(async (runKey) => {
        const hashes = runs[runKey];
        if (!hashes?.length) return;
        try {
            const json = await fetchRaceMuhtemel(refPath, runKey, hashes[0]);
            const parts = runKey.split('-');
            const hipKey = parts[0];
            const no = parts[1];
            const yaris = indexYarislar[hipKey];
            const atlarThis = getRaceAtlar(yaris, no);
            const atlarNext = getRaceAtlar(yaris, String(1 * no + 1));
            const enriched = enrichMuhtemeller(json.data, atlarThis, atlarNext);
            if (enriched) muhtemeller[runKey] = enriched;
        } catch (err) {
            errors.push({ runKey, error: err.message });
        }
    }));

    const result = {
        success: true,
        tarih,
        iso: trToIso(tarih) || opts.iso || refPath.replace(/\//g, '-'),
        refPath,
        hipodromlar,
        runs,
        muhtemeller,
        errors: errors.length ? errors : undefined,
        guncelleme: checksum.datetime || null
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

module.exports = {
    fetchMuhtemeller,
    isoToRefPath,
    trToRefPath,
    enrichMuhtemeller
};
