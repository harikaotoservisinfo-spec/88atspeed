/**
 * Hipodrom.com sabit ihtimalli (FOB) oranları — Ganyan, İlk 2, İlk 3
 * GET /api/web/v1/tjk/race/fob/{raceApiId}
 */
const hipodromProgram = require('./hipodrom-program');

const API_BASE = hipodromProgram.API_BASE;
const ORIGIN = 'https://www.hipodrom.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_MS = 60 * 1000;

const BET_TYPES = {
    GANYAN: { key: 'ganyan', label: 'Ganyan', short: 'SI-G' },
    ILK_IKI: { key: 'ilk2', label: 'İlk 2', short: 'İlk 2' },
    ILK_UC: { key: 'ilk3', label: 'İlk 3', short: 'İlk 3' }
};

const cache = new Map();

function isoToTr(iso) {
    const p = (iso || '').split('-');
    if (p.length !== 3) return iso;
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function normalizeHipName(s) {
    return String(s || '').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]/g, '');
}

async function hipodromApi(path, opts = {}) {
    const url = API_BASE + path;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Origin: ORIGIN,
                Referer: ORIGIN + '/',
                'User-Agent': BROWSER_UA
            },
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
            const msg = data?.error?.[0] || data?.message || ('HTTP ' + res.status);
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return data.data;
    } finally {
        clearTimeout(tid);
    }
}

async function resolveRaceApiId(tarih, hipodrom) {
    const list = await hipodromProgram.fetchRaceListForDate(tarih);
    const target = normalizeHipName(hipodrom);
    const hit = (list || []).find((row) => {
        const hpd = row.hpd || {};
        const names = [hpd.c, hpd.n, hpd.ky].filter(Boolean).map(normalizeHipName);
        return names.some((n) => n === target || n.includes(target) || target.includes(n));
    });
    if (!hit?.id) throw new Error('Hipodrom bulunamadı: ' + hipodrom);
    return hit.id;
}

function formatOdd(val) {
    if (val == null || val === '') return '';
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, (m) => (m === '.' ? '' : m));
}

function mapBetOdds(hfbdl) {
    const byNo = {};
    (hfbdl || []).forEach((entry) => {
        const nos = entry.nl || [];
        if (nos.length !== 1) return;
        const no = String(nos[0]);
        byNo[no] = formatOdd(entry.odd);
    });
    return byNo;
}

function mapFobRace(run) {
    const out = { raceNo: String(run.no), open: !!run.op, bets: {} };
    (run.rfbdl || []).forEach((bet) => {
        const meta = BET_TYPES[bet.gt];
        if (!meta) return;
        out.bets[meta.key] = {
            type: bet.gt,
            label: bet.btn || meta.label,
            byNo: mapBetOdds(bet.hfbdl)
        };
    });
    return out;
}

function mapFobPayload(data) {
    const races = {};
    (data.rn || []).forEach((run) => {
        const mapped = mapFobRace(run);
        races[mapped.raceNo] = mapped;
    });
    return {
        success: true,
        source: 'hipodrom.com',
        raceApiId: data.i,
        hipodrom: data.hpd?.c || data.hpd?.n || '',
        hipodromKey: data.hpd?.ky || '',
        open: !!data.op,
        raceCount: Object.keys(races).length,
        races,
        betTypes: Object.values(BET_TYPES)
    };
}

async function fetchFobByRaceApiId(raceApiId, opts = {}) {
    const data = await hipodromApi('/tjk/race/fob/' + raceApiId, opts);
    return mapFobPayload(data);
}

async function fetchFobForHipodrom(opts = {}) {
    const tarih = opts.tarih || (opts.iso ? isoToTr(opts.iso) : null);
    const hipodrom = opts.hipodrom || '';
    if (!tarih) throw new Error('Geçersiz tarih');
    if (!hipodrom) throw new Error('hipodrom parametresi gerekli');

    const cacheKey = [tarih, normalizeHipName(hipodrom)].join('|');
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }

    const raceApiId = opts.raceApiId || await resolveRaceApiId(tarih, hipodrom);
    const result = await fetchFobByRaceApiId(raceApiId, opts);
    result.tarih = tarih;
    result.hipodrom = hipodrom;
    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

module.exports = {
    BET_TYPES,
    fetchFobForHipodrom,
    fetchFobByRaceApiId,
    resolveRaceApiId,
    mapFobPayload
};
