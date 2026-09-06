/**
 * Gün içinde TJK sonuçlarını periyodik çeker; her koşu bittiğinde BİTİŞ kayıtlarına yazar.
 */
const publicProgram = require('./public-program');
const publicSonuclar = require('./public-sonuclar');
const sonucStore = require('./public-sonuc-store');

const DEFAULT_INTERVAL_MS = 90 * 1000;
const QUIET_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_HOUR_START = 10;
const ACTIVE_HOUR_END = 23;

let timer = null;
let running = false;
let lastSnapshot = new Map();

function turkeyHour() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        hour: 'numeric',
        hour12: false
    }).formatToParts(new Date());
    return parseInt(parts.find((p) => p.type === 'hour')?.value || '12', 10);
}

function isActiveWindow() {
    const h = turkeyHour();
    return h >= ACTIVE_HOUR_START && h <= ACTIVE_HOUR_END;
}

function snapshotKey(tarih, sehirId) {
    return tarih + '|' + sehirId;
}

async function listHipodromsForPolling(db, tarih) {
    const seen = new Map();

    const programRows = await new Promise((resolve, reject) => {
        db.all(
            `SELECT hipodrom_id, hipodrom, kosu_sayisi FROM public_gunluk_program
             WHERE tarih = ? AND durum = 'yayinda'`,
            [tarih],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
    });
    for (const row of programRows) {
        if (!row.hipodrom_id) continue;
        seen.set(String(row.hipodrom_id), {
            sehirId: String(row.hipodrom_id),
            hipodrom: row.hipodrom,
            kosuSayisi: row.kosu_sayisi || 0
        });
    }

    const kayitRows = await new Promise((resolve, reject) => {
        db.all(
            `SELECT DISTINCT hipodrom_id, hipodrom, race_count FROM hesaplama_kayitlari WHERE tarih = ?`,
            [tarih],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
    });
    for (const row of kayitRows) {
        const sehirId = row.hipodrom_id
            || publicSonuclar.resolveSehirId(row.hipodrom, null);
        if (!sehirId) continue;
        const key = String(sehirId);
        if (!seen.has(key)) {
            seen.set(key, {
                sehirId: key,
                hipodrom: row.hipodrom,
                kosuSayisi: row.race_count || 0
            });
        }
    }

    return [...seen.values()];
}

async function pollHipodrom(db, tarih, hip) {
    const key = snapshotKey(tarih, hip.sehirId);
    const prev = lastSnapshot.get(key) || { raceCount: 0, raceNos: new Set() };

    const stored = await sonucStore.getStoredSonuclar(db, tarih, hip.sehirId);
    const prevCount = stored?.raceCount || prev.raceCount || 0;
    const prevNos = new Set((stored?.races || []).map((r) => String(r.raceNo)));

    const fetched = await publicSonuclar.fetchSonuclarForHipodrom({
        tarih,
        hipodrom: hip.hipodrom,
        hipodromId: hip.sehirId,
        expectedRaceCount: hip.kosuSayisi || 0,
        refresh: true,
        db
    });

    const raceCount = fetched.raceCount || 0;
    const raceNos = new Set((fetched.races || []).map((r) => String(r.raceNo)));
    const newRaceNos = [...raceNos].filter((no) => !prevNos.has(no));
    const persisted = fetched.persisted || {};

    lastSnapshot.set(key, { raceCount, raceNos });

    if (newRaceNos.length > 0 || raceCount > prevCount) {
        const winner = (fetched.races || []).find((r) => String(r.raceNo) === newRaceNos[0]);
        const winnerName = winner?.horses?.[0]?.name || '';
        console.log(
            'sonuc-poller: ' + hip.hipodrom + ' +' + newRaceNos.length + ' koşu'
            + ' (' + prevCount + '→' + raceCount + ')'
            + (winnerName ? ' · 1.' + winnerName : '')
            + ' · BİTİŞ:' + (persisted.bitisSynced || 0)
        );
    }

    return {
        hipodrom: hip.hipodrom,
        sehirId: hip.sehirId,
        raceCount,
        newRaceNos,
        bitisSynced: persisted.bitisSynced || 0,
        kayitIds: persisted.kayitIds || []
    };
}

async function pollOnce(db) {
    if (running) return { skipped: true, reason: 'busy' };
    running = true;
    const tarih = publicProgram.todayTr();
    const results = [];

    try {
        const hips = await listHipodromsForPolling(db, tarih);
        if (!hips.length) {
            return { tarih, polled: 0, results: [] };
        }

        for (const hip of hips) {
            try {
                results.push(await pollHipodrom(db, tarih, hip));
            } catch (err) {
                console.warn('sonuc-poller ' + hip.hipodrom + ':', err.message);
                results.push({ hipodrom: hip.hipodrom, error: err.message });
            }
        }

        return { tarih, polled: hips.length, results };
    } finally {
        running = false;
    }
}

function scheduleNext(db, intervalMs) {
    if (timer) clearTimeout(timer);
    const delay = isActiveWindow() ? intervalMs : QUIET_INTERVAL_MS;
    timer = setTimeout(async () => {
        try {
            await pollOnce(db);
        } catch (err) {
            console.warn('sonuc-poller:', err.message);
        }
        scheduleNext(db, intervalMs);
    }, delay);
}

function start(db, opts = {}) {
    if (process.env.SONUC_POLLER === '0') {
        console.log('sonuc-poller: kapalı (SONUC_POLLER=0)');
        return;
    }
    const intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
    console.log('sonuc-poller: başlatıldı (her ' + Math.round(intervalMs / 1000) + 'sn, TR '
        + ACTIVE_HOUR_START + ':00-' + ACTIVE_HOUR_END + ':00)');
    setTimeout(() => {
        pollOnce(db).catch((err) => console.warn('sonuc-poller ilk tur:', err.message));
    }, 15000);
    scheduleNext(db, intervalMs);
}

function stop() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}

module.exports = {
    start,
    stop,
    pollOnce,
    listHipodromsForPolling
};
