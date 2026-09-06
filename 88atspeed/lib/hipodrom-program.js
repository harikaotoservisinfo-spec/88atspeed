/**
 * Hipodrom.com TJK program API — auth gerektirmez.
 * GET /api/web/v1/tjk/race/date/{ts}
 * GET /api/web/v1/tjk/race/{id}
 */
const API_BASE = 'https://api.hipodrom.com/api/web/v1';
const ORIGIN = 'https://www.hipodrom.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** TJK sehir id (public_gunluk_program hipodrom_id) */
const HIP_KEY_TO_TJK_ID = {
    ANKARA: '5',
    IZMIR: '2',
    ISTANBUL: '3',
    BURSA: '4',
    ADANA: '6',
    KOCAELI: '9',
    ELAZIG: '10',
    DIYARBAKIR: '11',
    ANTALYA: '12',
    KARMA: '17',
    SANLIURFA: '13'
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function parseTrDate(str) {
    const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function trDateToApiTimestamp(tarih) {
    const d = parseTrDate(tarih);
    if (!d) return Date.now();
    // Öğlen TR — hipodrom date endpoint günü buna göre seçiyor
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
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

async function fetchRaceListForDate(tarih, opts = {}) {
    const ts = trDateToApiTimestamp(tarih);
    return hipodromApi('/tjk/race/date/' + ts, opts);
}

async function fetchRaceDetail(raceId, opts = {}) {
    return hipodromApi('/tjk/race/' + raceId, opts);
}

function resolveTjkHipodromId(hpd = {}) {
    const key = String(hpd.ky || '').toUpperCase();
    if (HIP_KEY_TO_TJK_ID[key]) return HIP_KEY_TO_TJK_ID[key];
    return String(hpd.id || key || '');
}

function mapHorse(h) {
    const taki = Array.isArray(h.atc) ? h.atc.join(' ') : '';
    return {
        no: String(h.no ?? ''),
        name: h.n || '',
        atId: h.ky ? String(h.ky) : (h.id != null ? String(h.id) : ''),
        yas: h.a || '',
        siklet: h.w != null && h.w !== '' ? String(h.w) : '',
        hp: h.hc || h.tr || '',
        taki,
        jokey: h.jk || '',
        antrenor: h.tn || '',
        sahip: h.ow || '',
        start: h.str != null ? String(h.str) : '',
        kosular: []
    };
}

function mapRun(run) {
    const horses = (run.h || [])
        .filter((h) => h && h.n && h.isr !== false)
        .map(mapHorse);
    return {
        raceNo: String(run.no ?? ''),
        saat: run.t || '',
        mesafe: run.l != null ? String(run.l) : '',
        pist: run.tc || '',
        kcins_kosu: run.gs || '',
        kategori: run.inf || run.gr || '',
        baslik: run.in || run.inf || (run.no + '. Koşu'),
        horses,
        tahminler: [],
        durum: 'hazir'
    };
}

function mapRaceDetailToProgram(detail) {
    const hpd = detail.hpd || {};
    const races = (detail.run || []).map(mapRun).sort((a, b) => Number(a.raceNo) - Number(b.raceNo));
    return {
        hipodromId: resolveTjkHipodromId(hpd),
        hipodrom: hpd.c || hpd.n || hpd.ky || 'Hipodrom',
        hipodromKey: hpd.ky || '',
        raceApiId: detail.id,
        kosuSayisi: races.length,
        races,
        abroad: !!hpd.isf
    };
}

async function fetchHipodromProgramByRaceId(raceId, opts = {}) {
    const detail = await fetchRaceDetail(raceId, opts);
    if (!detail?.run?.length) throw new Error('Koşu listesi boş');
    return mapRaceDetailToProgram(detail);
}

async function fetchProgramsForDate(tarih, opts = {}) {
    const onlyDomestic = opts.onlyDomestic !== false;
    const delayMs = opts.hipDelayMs ?? 400;
    const list = await fetchRaceListForDate(tarih, opts);
    const entries = (list || []).filter((row) => !onlyDomestic || !row.hpd?.isf);

    const programs = [];
    const errors = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (i > 0 && delayMs > 0) await sleep(delayMs);
        try {
            const prog = await fetchHipodromProgramByRaceId(entry.id, opts);
            programs.push({
                ...prog,
                listEntry: entry
            });
        } catch (err) {
            errors.push({
                raceId: entry.id,
                hipodrom: entry.hpd?.c || entry.hpd?.n || '?',
                error: err.message
            });
        }
    }

    return { programs, errors, tarih };
}

module.exports = {
    API_BASE,
    HIP_KEY_TO_TJK_ID,
    trDateToApiTimestamp,
    fetchRaceListForDate,
    fetchRaceDetail,
    fetchHipodromProgramByRaceId,
    fetchProgramsForDate,
    mapRaceDetailToProgram,
    resolveTjkHipodromId
};
