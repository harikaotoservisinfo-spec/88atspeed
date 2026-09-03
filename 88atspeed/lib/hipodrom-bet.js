/**
 * Hipodrom sabit ihtimalli bahis — sunucu tarafı otomasyon.
 */
const hipodromAuth = require('./hipodrom-auth');
const { withPage, DATA_DIR, restoreSession } = require('./hipodrom-browser');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TOKENS_FILE = path.join(DATA_DIR, 'hipodrom-tokens.json');
const FIXED_ODDS_URL = 'https://www.hipodrom.com/at-yarisi/sabit-ihtimalli-bahis';
const HOME_URL = 'https://www.hipodrom.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loginCandidates(username) {
    const u = String(username || '').trim();
    const out = [u];
    if (u.startsWith('0') && u.length > 10) out.push(u.replace(/^0/, ''));
    if (u.startsWith('90') && u.length > 11) out.push(u.slice(2));
    if (u.length === 11 && u.startsWith('05')) out.push(u.slice(1));
    return [...new Set(out.filter(Boolean))];
}

function runChildScript(scriptName, args, timeoutMs) {
    const script = path.join(__dirname, '..', 'scripts', scriptName);
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env },
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

async function profileFromTokens(method) {
    let user = null;
    let balance = null;
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        if (tokens?.accessToken) {
            user = await hipodromAuth.fetchUserDetails(tokens.accessToken);
            balance = await hipodromAuth.fetchUserBalance(tokens.accessToken);
        }
    } catch (_) { /* */ }
    return {
        success: true,
        loggedIn: true,
        displayName: user?.name || user?.firstName || user?.loginName || 'Üye',
        balance: balance?.totalAmount ?? balance?.amount ?? null,
        method: method || 'api'
    };
}

async function saveLoginApi(username, password) {
    const tokens = await hipodromAuth.login(username, password);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null
    }));
    return profileFromTokens('api');
}

async function saveLoginBrowser(username, password) {
    const result = await runChildScript('hipodrom-browser-login.js', [username, password], 120000);
    if (!result.success) {
        const e = new Error(result.error || 'Tarayıcı girişi başarısız');
        e.code = result.code || 'login_failed';
        e.needsCaptcha = !!result.needsCaptcha;
        throw e;
    }
    return profileFromTokens('browser');
}

async function saveLogin(username, password) {
    const candidates = loginCandidates(username);
    let lastErr = null;

    for (const user of candidates) {
        try {
            return await saveLoginApi(user, password);
        } catch (err) {
            lastErr = err;
            const retryable = err.needsCaptcha
                || ['hipodrom.102031', 'hipodrom.102005', 'hipodrom.102036', 'hipodrom.102037'].includes(err.code);
            if (!retryable) throw err;
        }
    }

    for (const user of candidates) {
        try {
            return await saveLoginBrowser(user, password);
        } catch (err) {
            lastErr = err;
        }
    }

    if (lastErr?.code === 'hipodrom.102031' || lastErr?.needsCaptcha) {
        const e = new Error(
            'Sunucudan giriş reddedildi. Üye numaranızı deneyin (83196393) — TC yerine üye no gerekebilir.'
        );
        e.code = lastErr.code;
        e.needsCaptcha = lastErr.needsCaptcha;
        throw e;
    }
    throw lastErr || new Error('Giriş başarısız');
}

async function dismissCookieBanner(page) {
    await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const accept = btns.find((b) => /tümünü kabul|kabul et|accept|anladım|tamam/i.test((b.textContent || '').trim()));
        if (accept) accept.click();
    });
}

async function readSessionState(page) {
    return page.evaluate(() => {
        const body = document.body?.innerText || '';
        const loggedIn = /biletlerim/i.test(body) && /bakiye/i.test(body);
        const balanceMatch = body.match(/Bakiye\s*([\d.,]+)\s*TL/i);
        const nameEl = [...document.querySelectorAll('span, div, a')].find((el) => {
            const t = (el.textContent || '').trim();
            return t.length > 4 && t.length < 40 && /^[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ [A-ZÇĞİÖŞÜ][a-zçğıöşü]+/.test(t);
        });
        return {
            loggedIn,
            balance: balanceMatch ? balanceMatch[1] : null,
            displayName: nameEl ? nameEl.textContent.trim() : null
        };
    });
}

async function ensureLoggedIn(page, username, password) {
    await restoreSession(page);
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await sleep(1500);
    await dismissCookieBanner(page);
    let state = await readSessionState(page);
    if (state.loggedIn) return state;

    if (fs.existsSync(TOKENS_FILE)) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
        await sleep(1500);
        state = await readSessionState(page);
        if (state.loggedIn) return state;
    }

    const err = new Error('Hipodrom oturumu yok. Önce Sunucuda Giriş Yapın (üye no: 83196393).');
    err.code = 'not_logged_in';
    throw err;
}

async function clickByText(page, pattern) {
    return page.evaluate((pat) => {
        const re = new RegExp(pat, 'i');
        const nodes = [...document.querySelectorAll('button, a, span, div, li')];
        const el = nodes.find((n) => {
            const t = (n.textContent || '').trim();
            return t && t.length <= 80 && re.test(t);
        });
        if (!el) return false;
        el.click();
        return true;
    }, pattern);
}

async function getAutoStatus() {
    if (fs.existsSync(TOKENS_FILE)) {
        try {
            const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
            if (tokens?.accessToken) {
                const user = await hipodromAuth.fetchUserDetails(tokens.accessToken);
                const balance = await hipodromAuth.fetchUserBalance(tokens.accessToken);
                return {
                    loggedIn: true,
                    displayName: user?.name || user?.firstName || 'Üye',
                    balance: balance?.totalAmount ?? balance?.amount ?? null
                };
            }
        } catch (_) { /* token expired */ }
    }
    return withPage(async (page) => {
        await restoreSession(page);
        await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await sleep(1500);
        await dismissCookieBanner(page);
        return readSessionState(page);
    }, 45000);
}

async function placeFixedOddsBetInternal(opts = {}) {
    const city = String(opts.city || 'İzmir').trim();
    const raceNo = Number(opts.raceNo || opts.kosuNo || 3);
    const horseName = String(opts.horseName || opts.at || '').trim();
    const stake = Number(opts.stake || opts.misli || 20);
    const dryRun = !!opts.dryRun;
    if (!horseName) throw new Error('At adı gerekli');

    return withPage(async (page) => {
        const session = await ensureLoggedIn(page);

        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2500);
        await dismissCookieBanner(page);

        if (await page.evaluate(() => /404|bulunamadı/i.test(document.body?.innerText || ''))) {
            await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
            await sleep(1500);
            await clickByText(page, 'sabit ihtimalli');
            await sleep(2000);
        }

        if (!await clickByText(page, '^' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) {
            const err = new Error('Şehir bulunamadı: ' + city);
            err.code = 'city_not_found';
            throw err;
        }
        await sleep(1200);

        const raceOk = await page.evaluate((no) => {
            const el = [...document.querySelectorAll('button, div, span, a')]
                .find((n) => (n.textContent || '').trim() === String(no));
            if (!el) return false;
            el.click();
            return true;
        }, raceNo);
        if (!raceOk) {
            const err = new Error('Koşu bulunamadı: ' + raceNo);
            err.code = 'race_not_found';
            throw err;
        }
        await sleep(1500);

        const horseOk = await page.evaluate((name) => {
            const row = [...document.querySelectorAll('tr, [class*="horse"], [class*="runner"]')]
                .find((r) => new RegExp(name, 'i').test(r.textContent || ''));
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
        await sleep(1200);

        await page.evaluate((amount) => {
            const misli = [...document.querySelectorAll('input')].find((i) => i.type === 'number' || /misli/i.test(i.placeholder || ''));
            if (misli) {
                misli.value = String(amount);
                misli.dispatchEvent(new Event('input', { bubbles: true }));
                misli.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, stake);
        await sleep(600);

        if (dryRun) {
            return { success: true, dryRun: true, message: 'Kupon hazır (test)', session, city, raceNo, horseName, stake };
        }

        if (!await clickByText(page, 'hemen oyna')) {
            const err = new Error('HEMEN OYNA butonu bulunamadı');
            err.code = 'play_button_not_found';
            throw err;
        }
        await sleep(2500);

        const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
        const ok = /başarı|kabul|biletiniz|oynanmıştır/i.test(pageText);
        return {
            success: true,
            message: ok ? 'Bahis oynandı' : 'İşlem gönderildi — panelden kontrol edin',
            session, city, raceNo, horseName, stake
        };
    }, 150000);
}

async function placeFixedOddsBet(opts) {
    const result = await runChildScript('hipodrom-bet-worker.js', [JSON.stringify(opts || {})], 180000);
    if (!result.success) {
        const e = new Error(result.error || 'Bahis başarısız');
        e.code = result.code;
        e.detail = result.detail;
        throw e;
    }
    return result;
}

module.exports = {
    placeFixedOddsBet,
    placeFixedOddsBetInternal,
    getAutoStatus,
    saveLogin
};
