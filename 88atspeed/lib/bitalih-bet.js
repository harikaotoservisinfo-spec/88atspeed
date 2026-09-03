/**
 * Bi'Talih sabit ihtimalli bahis — sunucu tarafı otomasyon (arka plan işleri).
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    jobs.pruneOldJobs();
}

function childEnv(jobId, chromePath, creds) {
    const env = {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: process.env.HOME || '/root',
        BITALIH_JOB_ID: jobId,
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
        PUPPETEER_SKIP_DOWNLOAD: '1',
        CHROME_PATH: chromePath || '',
        PUPPETEER_EXECUTABLE_PATH: chromePath || ''
    };
    if (creds?.ssn) env.BITALIH_SSN = String(creds.ssn);
    if (creds?.password) env.BITALIH_PASS = String(creds.password);
    return env;
}

function startBackgroundScript(scriptName, args, jobId, chromePath, creds) {
    ensureDataDir();
    const script = path.join(__dirname, '..', 'scripts', scriptName);
    const child = fork(script, args, {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: 'ignore',
        env: childEnv(jobId, chromePath, creds)
    });
    child.on('error', (err) => {
        jobs.failJob(jobId, 'Alt süreç başlatılamadı: ' + err.message, 'spawn_failed');
    });
    child.unref();
    jobs.updateJob(jobId, { meta: { pid: child.pid || null, chromePath: chromePath || null } });
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
    return { job, chromePath, ssn: String(ssn).trim(), password: String(password) };
}

function runLoginJob(jobId, ssn, password, chromePath) {
    const creds = { ssn, password };
    startBackgroundScript(
        'bitalih-browser-login.js',
        [ssn, password],
        jobId,
        chromePath,
        creds
    );
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

function runBetJob(jobId, opts, chromePath) {
    startBackgroundScript('bitalih-bet-worker.js', [JSON.stringify(opts || {})], jobId, chromePath, null);
}

function startLoginJob(ssn, password) {
    const prep = prepareLoginJob(ssn, password);
    if (prep.ssn && prep.password) {
        runLoginJob(prep.job.id, prep.ssn, prep.password, prep.chromePath);
    }
    return prep.job;
}

function startBetJob(opts) {
    const prep = prepareBetJob(opts);
    if (prep.chromePath) {
        runBetJob(prep.job.id, opts, prep.chromePath);
    }
    return prep.job;
}

function runChildScriptSync(scriptName, args, timeoutMs) {
    const script = path.join(__dirname, '..', 'scripts', scriptName);
    const chromePath = resolveChromePath();
    return new Promise((resolve, reject) => {
        const child = fork(script, args, {
            cwd: path.join(__dirname, '..'),
            env: childEnv('sync', chromePath),
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
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
    const city = String(opts.city || 'İzmir').trim();
    const raceNo = Number(opts.raceNo || opts.kosuNo || 4);
    const horseName = String(opts.horseName || opts.at || '').trim();
    const stake = Number(opts.stake || opts.misli || 3);
    const dryRun = !!opts.dryRun;
    if (!horseName) throw new Error('At adı gerekli');

    return withPage(async (page) => {
        const session = await ensureLoggedIn(page);

        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2500);
        await dismissCookieBanner(page);

        const cityPattern = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!await clickByText(page, cityPattern, true)) {
            if (!await clickByText(page, cityPattern, false)) {
                const err = new Error('Şehir bulunamadı: ' + city);
                err.code = 'city_not_found';
                throw err;
            }
        }
        await sleep(1500);

        const raceOk = await page.evaluate((no) => {
            const re = new RegExp('^' + no + '\\.?\\s*Koşu$', 'i');
            const el = [...document.querySelectorAll('button, div, span, a')]
                .find((n) => re.test((n.textContent || '').trim()));
            if (!el) return false;
            el.click();
            return true;
        }, raceNo);
        if (!raceOk) {
            const err = new Error('Koşu bulunamadı veya bitmiş olabilir: ' + raceNo);
            err.code = 'race_not_found';
            throw err;
        }
        await sleep(2000);

        const horseOk = await page.evaluate((name) => {
            const rows = [...document.querySelectorAll('tr, [class*="runner"], [class*="horse"], div')];
            const row = rows.find((r) => {
                const t = (r.textContent || '').replace(/\s+/g, ' ');
                return new RegExp(name, 'i').test(t) && t.length < 200;
            });
            if (!row) return false;
            const odds = [...row.querySelectorAll('button, div, span')]
                .find((el) => /^\d+\.\d+$/.test((el.textContent || '').trim()));
            (odds || row).click();
            return true;
        }, horseName);
        if (!horseOk) {
            const err = new Error('At bulunamadı: ' + horseName);
            err.code = 'horse_not_found';
            throw err;
        }
        await sleep(1500);

        await page.evaluate((amount) => {
            const inputs = [...document.querySelectorAll('input')];
            const misli = inputs.find((i) => i.type === 'number' || /misli|tutar|miktar/i.test(i.placeholder || i.name || ''));
            if (misli) {
                misli.value = String(amount);
                misli.dispatchEvent(new Event('input', { bubbles: true }));
                misli.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, stake);
        await sleep(800);

        if (dryRun) {
            return {
                success: true,
                dryRun: true,
                message: 'Kupon hazır (test)',
                session,
                city,
                raceNo,
                horseName,
                stake
            };
        }

        const playPatterns = ['oyna', 'kuponu oyna', 'bahis yap', 'onayla'];
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
        await sleep(3000);

        const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2500) || '');
        const ok = /başarı|kabul|biletiniz|oynanmış|kuponunuz/i.test(pageText);
        return {
            success: true,
            message: ok ? 'Bahis oynandı' : 'İşlem gönderildi — panelden kontrol edin',
            session,
            city,
            raceNo,
            horseName,
            stake
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
    getJob
};
