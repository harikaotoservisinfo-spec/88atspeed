/**
 * Bi'Talih sabit ihtimalli bahis — sunucu tarafı otomasyon (arka plan işleri).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bitalihAuth = require('./bitalih-auth');
const {
    withPage,
    DATA_DIR,
    COOKIES_FILE,
    restoreSession
} = require('./bitalih-browser');
const jobs = require('./bitalih-jobs');
const { resolveChromePath } = require('./chrome-path');

const FIXED_ODDS_URL = bitalihAuth.FIXED_ODDS_URL;
const BET_TYPE_HASH = {
    ganyan: '',
    ilk2: '#ilk-2',
    ilk3: '#ilk-3',
    ilk4: '#ilk-4'
};
const BET_TYPE_LABEL = {
    ganyan: 'Ganyan',
    ilk2: 'İlk 2',
    ilk3: 'İlk 3',
    ilk4: 'İlk 4'
};
const QUEUE_DIR = path.join(DATA_DIR, 'bitalih-queue');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'bitalih-worker-heartbeat.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    jobs.pruneOldJobs();
}

function isWorkerAlive() {
    try {
        const hb = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
        return Date.now() - (hb.at || 0) < 120000;
    } catch (_) {
        return false;
    }
}

function enqueueTask(task) {
    ensureDataDir();
    const file = path.join(QUEUE_DIR, task.jobId + '.json');
    fs.writeFileSync(file, JSON.stringify(task), { mode: 0o600 });
    jobs.updateJob(task.jobId, { meta: { queued: true } });
}

function prepareLoginJob(ssn, password) {
    const chromePath = resolveChromePath();
    const job = jobs.createJob('login');
    if (!chromePath) {
        jobs.failJob(
            job.id,
            'Sunucuda Chrome yok. SSH: bash /var/www/88atspeed/deploy/fix-server.sh',
            'no_chrome'
        );
        return { job, chromePath: null, ssn: null, password: null };
    }
// Worker yoksa bile kuyruğa yaz — worker birkaç sn içinde alır
    return { job, chromePath, ssn: String(ssn).trim(), password: String(password) };
}

function runLoginJob(jobId, ssn, password) {
    enqueueTask({ type: 'login', jobId, ssn, password });
}

function prepareBetJob(opts) {
    const chromePath = resolveChromePath();
    const job = jobs.createJob('bet', opts);
    if (!chromePath) {
        jobs.failJob(job.id, 'Sunucuda Chrome yok. fix-server.sh çalıştırın.', 'no_chrome');
        return { job, chromePath: null };
    }
    return { job, chromePath };
}

function runBetJob(jobId, opts) {
    enqueueTask({ type: 'bet', jobId, opts: opts || {} });
}

function startLoginJob(ssn, password) {
    const prep = prepareLoginJob(ssn, password);
    if (prep.ssn && prep.password) {
        runLoginJob(prep.job.id, prep.ssn, prep.password);
    }
    return prep.job;
}

function startBetJob(opts) {
    const prep = prepareBetJob(opts);
    if (prep.chromePath) {
        runBetJob(prep.job.id, opts);
    }
    return prep.job;
}

function childEnv(chromePath, creds) {
    const env = {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: process.env.HOME || '/root',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
        PUPPETEER_SKIP_DOWNLOAD: '1',
        CHROME_PATH: chromePath || '',
        PUPPETEER_EXECUTABLE_PATH: chromePath || ''
    };
    if (creds?.ssn) env.BITALIH_SSN = String(creds.ssn);
    if (creds?.password) env.BITALIH_PASS = String(creds.password);
    return env;
}

function runChildScriptSync(scriptName, args, timeoutMs) {
    const script = path.join(__dirname, '..', 'scripts', scriptName);
    const chromePath = resolveChromePath();
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: path.join(__dirname, '..'),
            env: childEnv(chromePath, { ssn: args[0], password: args[1] }),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let errOut = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            const e = new Error('İşlem zaman aşımına uğradı');
            e.code = 'timeout';
            reject(e);
        }, timeoutMs || 120000);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { errOut += d.toString(); });
        child.on('close', () => {
            clearTimeout(timer);
            const line = out.trim().split('\n').filter(Boolean).pop();
            try {
                resolve(JSON.parse(line || '{}'));
            } catch (_) {
                reject(new Error(errOut || out || 'Alt süreç yanıt vermedi'));
            }
        });
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

async function profileFromSession() {
    const session = await bitalihAuth.fetchSessionRemote();
    if (!session?.authenticated) {
        return { success: false, loggedIn: false };
    }
    return { success: true, loggedIn: true, ...bitalihAuth.publicProfile(session), method: 'browser' };
}

async function saveLogin(ssn, password) {
    const result = await runChildScriptSync('bitalih-browser-login.js', [ssn, password], 120000);
    if (!result.success) {
        const e = new Error(result.error || 'Giriş başarısız');
        e.code = result.code || 'login_failed';
        throw e;
    }
    return profileFromSession();
}

async function dismissCookieBanner(page) {
    await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const accept = btns.find((b) => /kabul|anladım|tamam/i.test((b.textContent || '').trim()));
        if (accept) accept.click();
    });
}

async function readSessionState(page) {
    return page.evaluate(async () => {
        const r = await fetch('/api/auth/session');
        const j = await r.json();
        if (!j.authenticated) return { loggedIn: false };
        const pi = j.playerInfo || {};
        const wallet = pi.wallet || {};
        return {
            loggedIn: true,
            displayName: [pi.firstname, pi.lastname].filter(Boolean).join(' ') || j.user?.username,
            balance: wallet.totalBalance || null
        };
    });
}

async function ensureLoggedIn(page) {
    await restoreSession(page);
    await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2000);
    await dismissCookieBanner(page);
    const state = await readSessionState(page);
    if (state.loggedIn) return state;
    const err = new Error('Bi\'Talih oturumu yok. Önce Sunucuda Giriş Yapın (TC ile).');
    err.code = 'not_logged_in';
    throw err;
}

async function clickByText(page, pattern, exact) {
    return page.evaluate((pat, isExact) => {
        const re = isExact ? new RegExp('^' + pat + '$', 'i') : new RegExp(pat, 'i');
        const nodes = [...document.querySelectorAll('button, a, span, div, li')];
        const el = nodes.find((n) => {
            const t = (n.textContent || '').trim();
            return t && t.length <= 80 && re.test(t);
        });
        if (!el) return false;
        el.click();
        return true;
    }, pattern, !!exact);
}

function normalizeBetType(raw) {
    const s = String(raw || 'ganyan').toLocaleLowerCase('tr-TR')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/\s+/g, '');
    if (s === 'ilk2' || s === 'ilkiki' || s === 'top2') return 'ilk2';
    if (s === 'ilk3' || s === 'ilkuc' || s === 'top3') return 'ilk3';
    if (s === 'ilk4' || s === 'ilkdort' || s === 'top4') return 'ilk4';
    return 'ganyan';
}

function buildFixoRaceUrl(raceNo, betType) {
    const no = Number(raceNo) || 1;
    const hash = '#' + no + '-kosu' + (BET_TYPE_HASH[betType] || '');
    return FIXED_ODDS_URL + hash;
}

async function selectHipodrom(page, city) {
    const ok = await page.evaluate((cityName) => {
        const nodes = [...document.querySelectorAll('div.cursor-pointer, button, a, li, span')];
        const el = nodes.find((n) => {
            const t = (n.textContent || '').trim();
            return t === cityName || t.startsWith(cityName);
        });
        if (!el) return false;
        el.click();
        return true;
    }, city);
    if (!ok) {
        const cityPattern = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return clickByText(page, cityPattern, false);
    }
    return true;
}

async function clickHorseOdds(page, horseName, betType) {
    return page.evaluate((name, type) => {
        const row = [...document.querySelectorAll('tr')].find((r) => new RegExp(name, 'i').test(r.textContent || ''));
        if (!row) return { ok: false, reason: 'row_not_found' };

        const oddsBtns = [...row.querySelectorAll('div, button, span')].filter((el) => {
            const t = (el.textContent || '').replace(/\s+/g, '').trim();
            if (!/^\d+\.\d+$/.test(t)) return false;
            const cls = el.className || '';
            if (el.tagName === 'DIV' && cls.includes('h-8')) return true;
            if (el.tagName === 'SPAN' && el.parentElement?.className?.includes('h-8')) return true;
            if (el.tagName === 'BUTTON') return true;
            return false;
        });

        const uniq = [];
        const seen = new Set();
        for (const el of oddsBtns) {
            const t = (el.textContent || '').replace(/\s+/g, '').trim();
            if (seen.has(t)) continue;
            seen.add(t);
            uniq.push(el);
        }

        const idxMap = { ganyan: 0, ilk2: 0, ilk3: 1, ilk4: 2 };
        const idx = idxMap[type] ?? 0;
        const btn = uniq[idx] || uniq[0];
        if (!btn) return { ok: false, reason: 'odds_not_found', count: uniq.length };
        const clickTarget = btn.tagName === 'SPAN' ? (btn.parentElement || btn) : btn;
        clickTarget.click();
        return { ok: true, odd: (btn.textContent || '').trim(), index: idx, total: uniq.length };
    }, horseName, betType);
}

async function setStakeAmount(page, stake) {
    return page.evaluate((amount) => {
        const inputs = [...document.querySelectorAll('input')];
        const misli = inputs.find((i) => i.type === 'number' || /misli|tutar|miktar|bahis/i.test(i.placeholder || i.name || i.id || ''));
        if (!misli) return false;
        misli.focus();
        misli.value = String(amount);
        misli.dispatchEvent(new Event('input', { bubbles: true }));
        misli.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, stake);
}

async function getAutoStatus() {
    if (fs.existsSync(COOKIES_FILE)) {
        try {
            const session = await bitalihAuth.fetchSessionRemote();
            if (session?.authenticated) {
                return bitalihAuth.publicProfile(session);
            }
        } catch (_) { /* */ }
    }
    return { loggedIn: false };
}

async function placeFixedOddsBetInternal(opts = {}) {
    const city = String(opts.city || opts.hipodrom || 'Bursa').trim();
    const raceNo = Number(opts.raceNo || opts.kosuNo || 1);
    const horseName = String(opts.horseName || opts.at || '').trim();
    const stake = Number(opts.stake || opts.misli || 20);
    const betType = normalizeBetType(opts.betType || opts.bahis || opts.bet);
    const dryRun = !!opts.dryRun;
    if (!horseName) throw new Error('At adı gerekli');

    return withPage(async (page) => {
        const session = await ensureLoggedIn(page);
        await page.setViewport({ width: 1920, height: 1080 });

        const raceUrl = buildFixoRaceUrl(raceNo, betType);
        await page.goto(raceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(3000);
        await dismissCookieBanner(page);

        if (!await selectHipodrom(page, city)) {
            const err = new Error('Hipodrom bulunamadı: ' + city);
            err.code = 'city_not_found';
            throw err;
        }
        await sleep(2000);

        await page.goto(raceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2500);

        const horsePick = await clickHorseOdds(page, horseName, betType);
        if (!horsePick?.ok) {
            const err = new Error('At veya oran bulunamadı: ' + horseName
                + (horsePick?.reason ? ' (' + horsePick.reason + ')' : ''));
            err.code = 'horse_not_found';
            err.detail = horsePick;
            throw err;
        }
        await sleep(1500);

        const stakeOk = await setStakeAmount(page, stake);
        if (!stakeOk) {
            const err = new Error('Misli alanı bulunamadı');
            err.code = 'stake_input_not_found';
            throw err;
        }
        await sleep(800);

        const betLabel = BET_TYPE_LABEL[betType] || betType;
        if (dryRun) {
            return {
                success: true,
                dryRun: true,
                message: 'Kupon hazır (test) — ' + betLabel + ' @ ' + horsePick.odd,
                session,
                city,
                raceNo,
                horseName,
                stake,
                betType,
                odd: horsePick.odd
            };
        }

        const playPatterns = ['hemen oyna', 'oyna', 'kuponu oyna', 'bahis yap', 'onayla'];
        let played = false;
        for (const pat of playPatterns) {
            if (await clickByText(page, pat, false)) {
                played = true;
                break;
            }
        }
        if (!played) {
            const err = new Error('Oyna butonu bulunamadı');
            err.code = 'play_button_not_found';
            throw err;
        }
        await sleep(3500);

        const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2500) || '');
        const ok = /başarı|kabul|biletiniz|oynanmış|kuponunuz/i.test(pageText);
        return {
            success: true,
            message: ok ? ('Bahis oynandı — ' + betLabel + ' @ ' + horsePick.odd) : 'İşlem gönderildi — panelden kontrol edin',
            session,
            city,
            raceNo,
            horseName,
            stake,
            betType,
            odd: horsePick.odd
        };
    }, 180000);
}

async function placeFixedOddsBet(opts) {
    const result = await runChildScriptSync('bitalih-bet-worker.js', [JSON.stringify(opts || {})], 200000);
    if (!result.success) {
        const e = new Error(result.error || 'Bahis başarısız');
        e.code = result.code;
        e.detail = result.detail;
        throw e;
    }
    return result;
}

function getJob(jobId) {
    return jobs.readJob(jobId);
}

module.exports = {
    placeFixedOddsBet,
    placeFixedOddsBetInternal,
    getAutoStatus,
    saveLogin,
    prepareLoginJob,
    runLoginJob,
    prepareBetJob,
    runBetJob,
    startLoginJob,
    startBetJob,
    getJob,
    isWorkerAlive
};
