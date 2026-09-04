/**
 * Her gün 18:30 (TR) yarının TJK programını tam veriyle çeker (at geçmişi + tahmin).
 */
const fs = require('fs');
const path = require('path');
const publicProgram = require('./public-program');
const { buildPublicTahmin, assessTahminReadiness } = require('./public-tahmin-build');

const SCHEDULE_HOUR = 18;
const SCHEDULE_MINUTE = 30;
const CHECK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
const STATE_FILE = path.join(__dirname, '..', 'data', 'yarin-fetch-state.json');
const DB_PATH = path.join(__dirname, '..', 'atlar.db');
const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

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

function markRunning(meta = {}) {
    saveState({
        status: 'running',
        startedAt: new Date().toISOString(),
        error: null,
        tahminReady: false,
        ...meta
    });
}

function markError(err, meta = {}) {
    saveState({
        status: 'error',
        error: String(err?.message || err || 'Bilinmeyen hata'),
        finishedAt: new Date().toISOString(),
        tahminReady: false,
        ...meta
    });
}

function isRunningFromState(state) {
    if (running) return true;
    if (state.status !== 'running' || !state.startedAt) return false;
    const age = Date.now() - new Date(state.startedAt).getTime();
    return age < STALE_RUNNING_MS;
}

function phaseMessage(state) {
    const phase = state.phase || 'program';
    if (phase === 'program') return 'TJK programı çekiliyor…';
    if (phase === 'enrich') {
        const done = state.enrichDone || 0;
        const total = state.enrichTotal || 0;
        const hip = state.enrichHipodrom ? (' · ' + state.enrichHipodrom) : '';
        return total > 0
            ? ('At geçmişi çekiliyor… ' + done + '/' + total + hip)
            : ('At geçmişi çekiliyor…' + hip);
    }
    if (phase === 'tahmin') return 'Tahminler hesaplanıyor…';
    if (phase === 'incomplete') return 'Veriler eksik — yeniden tamamlanıyor…';
    return 'Yeni günün koşuları yükleniyor…';
}

async function getStatus(db) {
    const state = loadState();
    const yarinTarih = publicProgram.tomorrowTr();
    const yarinIso = publicProgram.trToIso(yarinTarih);

    let vitrinCount = 0;
    let tahminQuality = { ready: false, totalHorses: 0, scoredHorses: 0, ratio: 0, hipodromSayisi: 0 };
    if (db) {
        try {
            const vitrin = await publicProgram.getPublicVitrin(db, yarinTarih, { pruneDb: false });
            vitrinCount = (vitrin.hipodromlar || []).length;
            tahminQuality = await assessTahminReadiness(db, yarinTarih);
        } catch (_) { /* */ }
    }

    const tahminReady = !!tahminQuality.ready;
    let status = 'idle';
    let message = '';

    if (isRunningFromState(state)) {
        status = 'running';
        message = phaseMessage(state);
    } else if (tahminReady) {
        status = 'done';
        message = tahminQuality.hipodromSayisi + ' hipodrom · '
            + tahminQuality.scoredHorses + '/' + tahminQuality.totalHorses + ' at skorlu';
    } else if (vitrinCount > 0 && state.lastRunDate === publicProgram.todayTr()) {
        status = 'running';
        message = phaseMessage({ phase: 'incomplete' });
    } else if (state.status === 'error' && state.lastRunDate === publicProgram.todayTr()) {
        status = 'error';
        message = state.error || 'Yükleme başarısız';
    } else if (isScheduleDue() && state.lastRunDate !== publicProgram.todayTr()) {
        status = 'pending';
        message = 'Yarının programı hazırlanıyor…';
    }

    return {
        status,
        message,
        phase: state.phase || null,
        yarinTarih,
        yarinIso,
        ready: tahminReady,
        tahminReady,
        hipodromSayisi: vitrinCount,
        totalHorses: tahminQuality.totalHorses,
        scoredHorses: tahminQuality.scoredHorses,
        tahminRatio: tahminQuality.ratio,
        enrichDone: state.enrichDone || 0,
        enrichTotal: state.enrichTotal || 0,
        enrichHipodrom: state.enrichHipodrom || null,
        startedAt: state.startedAt || null,
        finishedAt: state.finishedAt || state.lastRunAt || null,
        lastRunDate: state.lastRunDate || null,
        basarili: state.basarili || 0,
        scheduleDue: isScheduleDue(),
        running: status === 'running' || status === 'pending'
    };
}

async function fetchTomorrowProgram(db, opts = {}) {
    const tarih = publicProgram.tomorrowTr();
    const enrichKosular = opts.enrichKosular !== false;

    markRunning({
        yarinTarih: tarih,
        source: opts.source || 'scheduler',
        phase: 'program',
        enrichDone: 0,
        enrichTotal: 0
    });
    console.log('program-scheduler: yarın TAM veri çekimi —', tarih);

    const result = await publicProgram.buildPublicProgram(db, tarih, {
        onlyDomestic: true,
        publish: true,
        source: 'tjk',
        syncHesaplama: true,
        enrichKosular,
        trigger: opts.trigger || 'scheduler-full',
        timeoutMs: 120000,
        maxAttempts: 5,
        hipDelayMs: 3000,
        horseDelayMs: opts.horseDelayMs ?? 600,
        maxKosu: opts.maxKosu ?? 7,
        onEnrichProgress: (progress) => {
            saveState({
                phase: 'enrich',
                enrichDone: progress.done,
                enrichTotal: progress.total,
                enrichHipodrom: progress.hipodrom,
                enrichPct: progress.pct,
                enrichEtaSec: progress.etaSec
            });
        }
    });

    console.log(
        'program-scheduler: program tamam —',
        result.basarili + '/' + result.hipodromSayisi,
        'hipodrom'
    );
    if (result.kosularStats) {
        console.log(
            'program-scheduler: at geçmişi —',
            result.kosularStats.withData + '/' + result.kosularStats.total
        );
    }

    let tahminSummary = null;
    if (result.basarili > 0) {
        saveState({ phase: 'tahmin' });
        try {
            tahminSummary = await buildPublicTahmin(db, tarih, {
                save: true,
                dbPath: DB_PATH
            });
            console.log(
                'program-scheduler: tahmin tamam —',
                tahminSummary.hipodromSayisi,
                'hipodrom'
            );
        } catch (err) {
            console.warn('program-scheduler: tahmin hatası:', err.message);
            throw err;
        }
    }

    const quality = await assessTahminReadiness(db, tarih);
    if (!quality.ready) {
        throw new Error(
            'Tahmin verisi yetersiz: ' + quality.scoredHorses + '/' + quality.totalHorses
            + ' at skorlu (min %35 gerekli)'
        );
    }

    return { tarih, result, tahminSummary, quality };
}

async function runIfDue(db, opts = {}) {
    if (running) return null;
    if (!opts.force && !isScheduleDue()) return null;

    const today = publicProgram.todayTr();
    const state = loadState();

    if (!opts.force) {
        if (isRunningFromState(state)) return null;
        const quality = await assessTahminReadiness(db, publicProgram.tomorrowTr());
        if (state.lastRunDate === today && quality.ready) return null;
    }

    running = true;
    const startedAt = Date.now();
    try {
        const out = await fetchTomorrowProgram(db, { source: opts.source || 'scheduler' });
        markTodayFetchDone({
            status: 'done',
            phase: 'done',
            finishedAt: new Date().toISOString(),
            yarinTarih: out.tarih,
            hipodromSayisi: out.result.hipodromSayisi,
            basarili: out.result.basarili,
            tahminReady: true,
            scoredHorses: out.quality.scoredHorses,
            totalHorses: out.quality.totalHorses,
            tahminRatio: out.quality.ratio,
            elapsedSec: Math.round((Date.now() - startedAt) / 1000),
            source: opts.source || 'scheduler'
        });
        console.log(
            'program-scheduler: TAM veri bitti —',
            out.tarih,
            '(' + Math.round((Date.now() - startedAt) / 1000) + ' sn)'
        );
        return out;
    } catch (err) {
        markError(err, { lastRunDate: today, source: opts.source || 'scheduler', phase: 'error' });
        console.error('program-scheduler: hata:', err.message);
        throw err;
    } finally {
        running = false;
    }
}

async function wasTodayFetchDone(db) {
    const state = loadState();
    if (state.lastRunDate !== publicProgram.todayTr()) return false;
    if (!db) return !!(state.tahminReady && state.status === 'done');
    const quality = await assessTahminReadiness(db, publicProgram.tomorrowTr());
    return quality.ready;
}

function start(db, opts = {}) {
    if (process.env.PROGRAM_SCHEDULER === '0') {
        console.log('program-scheduler: kapalı (PROGRAM_SCHEDULER=0)');
        return;
    }
    if (timer) return;

    console.log(
        'program-scheduler: başlatıldı (TR '
        + String(SCHEDULE_HOUR).padStart(2, '0') + ':'
        + String(SCHEDULE_MINUTE).padStart(2, '0')
        + ' — tam veri: program + at geçmişi + tahmin)'
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
    getStatus,
    isScheduleDue,
    wasTodayFetchDone,
    loadState,
    markRunning,
    markError,
    markTodayFetchDone,
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE
};
