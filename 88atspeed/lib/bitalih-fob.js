/**
 * Bi'Talih sabit ihtimalli (FİXO) oranları — Ganyan, İlk 2, İlk 3, İlk 4
 * POST /api/tjk/fixo-bulletin/{raceId}/detail
 */
const ORIGIN = 'https://www.bitalih.com';
const FIXED_ODDS_PAGE = ORIGIN + '/at-yarisi/tjk-sabit-ihtimalli-bahis';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_MS = 60 * 1000;

const BET_COLS = [
    { key: 'ganyan', betId: '101', label: 'Ganyan', short: 'BiG', title: "Bi'Talih Ganyan" },
    { key: 'ilk2', betId: '502', label: 'İlk 2', short: 'Bi2', title: "Bi'Talih İlk 2" },
    { key: 'ilk3', betId: '503', label: 'İlk 3', short: 'Bi3', title: "Bi'Talih İlk 3" },
    { key: 'ilk4', betId: '504', label: 'İlk 4', short: 'Bi4', title: "Bi'Talih İlk 4" }
];

const cache = new Map();
let bulletinListCache = { at: 0, list: [] };

function normalizeHipName(s) {
    return String(s || '').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]/g, '');
}

function formatOdd(val) {
    if (val == null || val === '') return '';
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val);
    return n >= 100 ? String(Math.round(n)) : (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, (m) => (m === '.' ? '' : m)));
}

async function bitalihFetch(path, opts = {}) {
    const url = ORIGIN + path;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
    try {
        const res = await fetch(url, {
            method: opts.method || 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Origin: ORIGIN,
                Referer: FIXED_ODDS_PAGE,
                'User-Agent': BROWSER_UA,
                ...(opts.headers || {})
            },
            body: opts.body != null ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
            const msg = data?.message || data?.error?.message || ('HTTP ' + res.status);
            throw new Error(msg);
        }
        return data;
    } finally {
        clearTimeout(tid);
    }
}

function parseBulletinList(html) {
    const idx = html.indexOf('bulletinList');
    if (idx < 0) return [];
    const arrStart = html.indexOf('[', idx);
    if (arrStart < 0) return [];
    let depth = 0;
    for (let i = arrStart; i < html.length; i++) {
        const ch = html[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                const json = html.slice(arrStart, i + 1).replace(/\\"/g, '"');
                return JSON.parse(json);
            }
        }
    }
    return [];
}

async function fetchBulletinList(opts = {}) {
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    if (!skipCache && bulletinListCache.list.length && Date.now() - bulletinListCache.at < CACHE_MS) {
        return bulletinListCache.list;
    }
    const html = await fetch(FIXED_ODDS_PAGE, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }
    }).then((r) => r.text());
    const list = parseBulletinList(html);
    bulletinListCache = { at: Date.now(), list };
    return list;
}

function resolveRaceEntry(list, hipodrom) {
    const target = normalizeHipName(hipodrom);
    return (list || []).find((row) => {
        const h = row.hippodrome || {};
        const names = [h.key, h.location, h.name, h.slug].filter(Boolean).map(normalizeHipName);
        return names.some((n) => n === target || n.includes(target) || target.includes(n));
    }) || null;
}

function mapRun(run) {
    const bets = {};
    BET_COLS.forEach((col) => { bets[col.key] = { byNo: {}, byName: {} }; });

    (run.horses || []).forEach((h) => {
        if (h.doesRun) return;
        const no = String(h.no);
        const nameKey = normalizeHipName(h.name);
        BET_COLS.forEach((col) => {
            let odd = h.odds?.[col.betId]?.odd;
            if (odd == null && col.key === 'ganyan') odd = h.fixedOdd;
            if (odd == null && col.key === 'ilk2') odd = h.fixedOddPlase;
            const formatted = formatOdd(odd);
            if (formatted) {
                bets[col.key].byNo[no] = formatted;
                if (nameKey) bets[col.key].byName[nameKey] = formatted;
            }
        });
    });

    return {
        raceNo: String(run.number),
        runId: run.id,
        time: run.time,
        bets
    };
}

async function fetchFobDetail(raceId, opts = {}) {
    const data = await bitalihFetch('/api/tjk/fixo-bulletin/' + raceId + '/detail', {
        method: 'POST',
        body: {},
        timeoutMs: opts.timeoutMs
    });
    return data.data;
}

async function fetchFobForHipodrom(opts = {}) {
    const hipodrom = opts.hipodrom || '';
    if (!hipodrom) throw new Error('hipodrom parametresi gerekli');

    const cacheKey = normalizeHipName(hipodrom);
    const skipCache = opts.refresh === true || opts.refresh === '1' || opts.refresh === 'true';
    if (!skipCache) {
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }

    const list = await fetchBulletinList(opts);
    const entry = resolveRaceEntry(list, hipodrom);
    if (!entry?.id) throw new Error('Bi\'Talih hipodrom bulunamadı: ' + hipodrom);

    const detail = await fetchFobDetail(entry.id, opts);
    const races = {};
    (detail.runs || []).forEach((run) => {
        const mapped = mapRun(run);
        races[mapped.raceNo] = mapped;
    });

    const result = {
        success: true,
        source: 'bitalih.com',
        hipodrom: entry.hippodrome?.location || entry.hippodrome?.name || hipodrom,
        hipodromKey: entry.hippodrome?.key || '',
        raceId: entry.id,
        raceDate: entry.raceDate || null,
        raceCount: Object.keys(races).length,
        betTypes: BET_COLS.map((c) => ({ key: c.key, label: c.label, short: c.short, betId: c.betId })),
        races
    };

    cache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

module.exports = {
    BET_COLS,
    fetchFobForHipodrom,
    fetchFobDetail,
    fetchBulletinList,
    resolveRaceEntry,
    normalizeHipName
};
