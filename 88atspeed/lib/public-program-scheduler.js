/**
 * Her gün 18:30 (TR) yarının TJK programını çeker ve kamu vitrinine yazar.
 * PM2 sürekli çalıştığı için bilgisayar kapalı olsa bile sunucuda otomatik işler.
 */
const fs = require('fs');
const path = require('path');
const publicProgram = require('./public-program');
const { buildPublicTahmin } = require('./public-tahmin-build');

const SCHEDULE_HOUR = 18;
const SCHEDULE_MINUTE = 30;
const CHECK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
const STATE_FILE = path.join(__dirname, '..', 'data', 'yarin-fetch-state.json');

let timer = null;
let running = false;

function turkeyNowParts() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).formatToParts(new Date());
    return {
        hour: parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10),
        minute: parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    };
}

function isScheduleDue() {
    const { hour, minute } = turkeyNowParts();
    return hour > SCHEDULE_HOUR || (hour === SCHEDULE_HOUR && minute >= SCHEDULE_MINUTE);
}

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (_) {
        return { lastRunDate: null };
    }
}

function saveState(patch) {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const prev = loadState();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...prev, ...patch }, null, 2));
}

function markTodayFetchDone(meta = {}) {
    saveState({
        lastRunDate: publicProgram.todayTr(),
        lastRunAt: new Date().toISOString(),
        ...meta
    });
}

async function fetchTomorrowProgram(db) {
    const tarih = publicProgram.tomorrowTr();
    console.log('program-scheduler: yarın programı çekiliyor —', tarih);

    const result = await publicProgram.buildPublicProgram(db, tarih, {
        onlyDomestic: true,
        publish: true,
        source: 'tjk',
        syncHesaplama: true,
        trigger: 'scheduler',
        timeoutMs: 90000,
        maxAttempts: 5,
        hipDelayMs: 3000
    });

    console.log(
        'program-scheduler: program tamam —',
        result.basarili + '/' + result.hipodromSayisi,
        'hipodrom'
    );

    const failed = (result.results || []).filter((r) => !r.ok);
    if (failed.length) {
        console.warn(
            'program-scheduler: başarısız hipodromlar:',
            failed.map((f) => f.hipodrom + ' (' + f.error + ')').join(', ')
        );
    }

    let tahminSummary = null;
    if (result.basarili > 0) {
        try {
            tahminSummary = await buildPublicTahmin(db, tarih, {
                save: true,
                dbPath: path.join(__dirname, '..', 'atlar.db')
            });
            console.log(
                'program-scheduler: tahmin tamam —',
                tahminSummary.hipodromSayisi,
                'hipodrom'
            );
        } catch (err) {
            console.warn('program-scheduler: tahmin hatası:', err.message);
        }
    }

    return { tarih, result, tahminSummary };
}

async function runIfDue(db, opts = {}) {
    if (running) return null;
    if (!opts.force && !isScheduleDue()) return null;

    const today = publicProgram.todayTr();
    const state = loadState();
    if (!opts.force && state.lastRunDate === today) return null;

    running = true;
    const startedAt = Date.now();
    try {
        const out = await fetchTomorrowProgram(db);
        saveState({
            lastRunDate: today,
            lastRunAt: new Date().toISOString(),
            yarinTarih: out.tarih,
            hipodromSayisi: out.result.hipodromSayisi,
            basarili: out.result.basarili,
            elapsedSec: Math.round((Date.now() - startedAt) / 1000),
            source: 'scheduler'
        });
        console.log(
            'program-scheduler: işlem bitti —',
            out.tarih,
            '(' + Math.round((Date.now() - startedAt) / 1000) + ' sn)'
        );
        return out;
    } catch (err) {
        console.error('program-scheduler: hata:', err.message);
        throw err;
    } finally {
        running = false;
    }
}

function wasTodayFetchDone() {
    const state = loadState();
    return state.lastRunDate === publicProgram.todayTr();
}

function start(db, opts = {}) {
    if (process.env.PROGRAM_SCHEDULER === '0') {
        console.log('program-scheduler: kapalı (PROGRAM_SCHEDULER=0)');
        return;
    }
    if (timer) return;

    console.log(
        'program-scheduler: başlatıldı (her gün TR '
        + String(SCHEDULE_HOUR).padStart(2, '0') + ':'
        + String(SCHEDULE_MINUTE).padStart(2, '0')
        + ' — yarının programı + tahmin)'
    );

    setTimeout(() => {
        runIfDue(db).catch((err) => console.warn('program-scheduler ilk kontrol:', err.message));
    }, opts.startupDelayMs ?? STARTUP_DELAY_MS);

    timer = setInterval(() => {
        runIfDue(db).catch((err) => console.warn('program-scheduler:', err.message));
    }, CHECK_MS);
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = {
    start,
    stop,
    runIfDue,
    fetchTomorrowProgram,
    isScheduleDue,
    wasTodayFetchDone,
    loadState,
    markTodayFetchDone,
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE
};
