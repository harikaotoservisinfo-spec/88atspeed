/**
 * Yarın programı çekimi — ayrı child process (web sunucusunu bloklamaz).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const publicProgram = require('./public-program');
const { assessTahminReadiness } = require('./public-tahmin-build');

const SCHEDULE_HOUR = 18;
const SCHEDULE_MINUTE = 30;
const CHECK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
const STATE_FILE = path.join(__dirname, '..', 'data', 'yarin-fetch-state.json');
const LOG_FILE = '/var/log/88atspeed-program.log';
const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;
const STALE_NO_PID_MS = 20 * 60 * 1000;
const APP_ROOT = path.join(__dirname, '..');

let timer = null;
let spawnInFlight = false;

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
        childPid: null,
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
        childPid: null,
        ...meta
    });
}

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function isBackgroundFetchActive() {
    const state = loadState();
    if (state.status !== 'running') return false;
    if (isPidAlive(state.childPid)) return true;
    if (!state.startedAt) return false;
    const age = Date.now() - new Date(state.startedAt).getTime();
    return age < STALE_NO_PID_MS;
}

function isStaleRunningState() {
    const state = loadState();
    if (state.status !== 'running') return false;
    if (isPidAlive(state.childPid)) return false;
    if (!state.startedAt) return true;
    const age = Date.now() - new Date(state.startedAt).getTime();
    return age >= STALE_NO_PID_MS;
}

function isRunningFromState(state) {
    return isBackgroundFetchActive() || (state?.status === 'running' && isPidAlive(state?.childPid));
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

function countYarinHipodroms(db, tarih) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) AS c FROM public_gunluk_program WHERE tarih = ? AND durum = 'yayinda'`,
            [tarih],
            (err, row) => (err ? reject(err) : resolve(row?.c || 0))
        );
    });
}

async function getStatus(db) {
    const state = loadState();
    const yarinTarih = publicProgram.tomorrowTr();
    const yarinIso = publicProgram.trToIso(yarinTarih);

    let vitrinCount = 0;
    let tahminQuality = { ready: false, totalHorses: 0, scoredHorses: 0, ratio: 0, hipodromSayisi: 0 };
    if (db) {
        try {
            vitrinCount = await countYarinHipodroms(db, yarinTarih);
            tahminQuality = await assessTahminReadiness(db, yarinTarih);
        } catch (_) { /* */ }
    }

    const tahminReady = !!tahminQuality.ready;
    const bgActive = isBackgroundFetchActive();
    const staleRunning = isStaleRunningState();
    let status = 'idle';
    let message = '';

    if (bgActive) {
        status = 'running';
        message = phaseMessage(state);
    } else if (staleRunning) {
        status = 'error';
        message = 'Çekim takıldı veya yarıda kaldı — yeniden başlatılıyor…';
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
        hipodromSayisi: vitrinCount || tahminQuality.hipodromSayisi,
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
        running: status === 'running' || status === 'pending',
        backgroundActive: bgActive,
        staleRunning,
        childPid: state.childPid || null,
        childAlive: isPidAlive(state.childPid),
        elapsedMs: state.startedAt
            ? Date.now() - new Date(state.startedAt).getTime()
            : null
    };
}

function spawnTomorrowFetch(opts = {}) {
    if (isBackgroundFetchActive()) {
        console.log('program-scheduler: çekim zaten çalışıyor (pid ' + (loadState().childPid || '?') + ')');
        return false;
    }
    try {
        const { execSync } = require('child_process');
        const out = execSync("pgrep -f 'fetch-public-program.js.*--yarin' || true", { encoding: 'utf8' }).trim();
        if (out) {
            console.log('program-scheduler: fetch-public-program-yarin zaten çalışıyor (pgrep)');
            return false;
        }
    } catch (_) { /* */ }
    if (spawnInFlight) return false;
    spawnInFlight = true;

    const tarih = publicProgram.tomorrowTr();
    markRunning({
        yarinTarih: tarih,
        source: opts.source || 'scheduler',
        phase: 'program',
        enrichDone: 0,
        enrichTotal: 0,
        childPid: null
    });

    try {
        if (!fs.existsSync(path.dirname(LOG_FILE))) {
            fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, '\n--- spawn ' + new Date().toISOString() + ' ---\n');
    } catch (_) { /* */ }

    const npmArgs = ['run', 'fetch:public-program-yarin'];
    if (opts.force) npmArgs.push('--', '--force');

    const logFd = fs.openSync(LOG_FILE, 'a');
    const child = spawn('npm', npmArgs, {
        cwd: APP_ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PROGRAM_SCHEDULER_CHILD: '1' }
    });
    child.unref();
    saveState({ childPid: child.pid, spawnAt: new Date().toISOString() });
    console.log('program-scheduler: child process başlatıldı pid', child.pid, '→', npmArgs.join(' '));
    spawnInFlight = false;
    return true;
}

async function runIfDue(db, opts = {}) {
    if (!opts.force && !isScheduleDue()) return null;

    const today = publicProgram.todayTr();
    const state = loadState();

    if (!opts.force) {
        if (isBackgroundFetchActive()) return null;
        if (db) {
            const quality = await assessTahminReadiness(db, publicProgram.tomorrowTr());
            if (state.lastRunDate === today && quality.ready) return null;
        } else if (state.lastRunDate === today && state.tahminReady) {
            return null;
        }
    }

    const spawned = spawnTomorrowFetch({ force: !!opts.force, source: opts.source || 'scheduler' });
    return spawned ? { spawned: true } : null;
}

async function wasTodayFetchDone(db) {
    const state = loadState();
    if (state.lastRunDate !== publicProgram.todayTr()) return false;
    if (isBackgroundFetchActive()) return false;
    if (!db) return !!(state.tahminReady && state.status === 'done');
    const quality = await assessTahminReadiness(db, publicProgram.tomorrowTr());
    return quality.ready;
}

function start(db, opts = {}) {
    if (process.env.PROGRAM_SCHEDULER === '0') {
        console.log('program-scheduler: kapalı (PROGRAM_SCHEDULER=0)');
        return;
    }
    if (process.env.PROGRAM_SCHEDULER_CHILD === '1') {
        return;
    }
    if (timer) return;

    console.log(
        'program-scheduler: başlatıldı (TR '
        + String(SCHEDULE_HOUR).padStart(2, '0') + ':'
        + String(SCHEDULE_MINUTE).padStart(2, '0')
        + ' — child process, web sunucusu bloklanmaz)'
    );

    setTimeout(() => {
        runIfDue(db).catch((err) => console.warn('program-scheduler ilk kontrol:', err.message));
    }, opts.startupDelayMs ?? STARTUP_DELAY_MS);

    timer = setInterval(() => {
        runIfDue(db).catch((err) => console.warn('program-scheduler:', err.message));
        if (isStaleRunningState() && !isBackgroundFetchActive()) {
            console.warn('program-scheduler: stale running state — yeniden spawn');
            spawnTomorrowFetch({ force: true, source: 'stale-recovery' });
        }
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
    spawnTomorrowFetch,
    getStatus,
    isScheduleDue,
    isBackgroundFetchActive,
    wasTodayFetchDone,
    loadState,
    markRunning,
    markError,
    markTodayFetchDone,
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE
};
