/**
 * Hipodrom.com oturum yönetimi — API proxy + tarayıcı girişi yedek (şifre saklanmaz).
 */
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const API_BASE = 'https://api.hipodrom.com/api/web/v1';
const HIPODROM_ORIGIN = 'https://www.hipodrom.com/';
const COOKIE_NAME = '88atspeed_hipodrom';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RECAPTCHA_SITE_KEY = '6LcbHRcpAAAAAB8y4h6w4rlK06g2JaPuxKBWkaCB';
const sessions = new Map();
let browserFactory = null;

function setBrowserFactory(fn) {
    browserFactory = fn;
}

function getSecret() {
    return process.env.HIPODROM_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || '88atspeed-hipodrom-dev-secret';
}

function parseCookies(req) {
    const out = {};
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    }
    return out;
}

function signSid(sid) {
    const sig = crypto.createHmac('sha256', getSecret()).update(sid).digest('base64url');
    return sid + '.' + sig;
}

function verifySid(token) {
    if (!token || !token.includes('.')) return null;
    const dot = token.indexOf('.');
    const sid = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', getSecret()).update(sid).digest('base64url');
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    } catch (_) {
        return null;
    }
    return sid;
}

function setSessionCookie(req, res, sid) {
    const signed = signSid(sid);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const parts = [
        COOKIE_NAME + '=' + encodeURIComponent(signed),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=' + Math.floor(SESSION_MAX_AGE_MS / 1000)
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const parts = [COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function getSession(req) {
    const cookies = parseCookies(req);
    const sid = verifySid(cookies[COOKIE_NAME]);
    if (!sid) return null;
    const entry = sessions.get(sid);
    if (!entry || entry.expiresAt < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    return { sid, ...entry };
}

function createSession(tokens, user) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        user: user || null,
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
        createdAt: Date.now()
    });
    return sid;
}

function destroySession(sid) {
    if (sid) sessions.delete(sid);
}

async function hipodromApi(path, opts = {}) {
    const url = API_BASE + path;
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://www.hipodrom.com',
        Referer: 'https://www.hipodrom.com/',
        'User-Agent': BROWSER_UA,
        ...(opts.headers || {})
    };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), opts.timeoutMs || 25000);
    try {
        const res = await fetch(url, {
            method: opts.method || 'GET',
            headers,
            body: opts.body != null ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } finally {
        clearTimeout(tid);
    }
}

function extractError(data) {
    const err = data?.error;
    if (!err) return 'İşlem başarısız';
    if (Array.isArray(err)) {
        const first = err[0];
        const code = first?.code || '';
        const map = {
            'hipodrom.102031': 'Kullanıcı adı veya şifre hatalı.',
            'hipodrom.102036': 'Güvenlik doğrulaması gerekli.',
            'hipodrom.102037': 'Güvenlik doğrulaması gerekli.',
            'hipodrom.exception.0002': 'Oturum gerekli. Lütfen tekrar giriş yapın.'
        };
        if (code && map[code]) return map[code];
        if (typeof first === 'string') return first;
        if (first?.message) return first.message;
    }
    return 'İşlem başarısız';
}

function needsCaptcha(data) {
    const msg = extractError(data).toLowerCase();
    const code = data?.error?.[0]?.code || '';
    return msg.includes('captcha') || msg.includes('recaptcha')
        || ['hipodrom.102036', 'hipodrom.102037'].includes(code);
}

function shouldTryBrowserLogin(errOrData) {
    const code = errOrData?.code || errOrData?.error?.[0]?.code || '';
    if (['hipodrom.102036', 'hipodrom.102037', 'hipodrom.102031', 'hipodrom.999999'].includes(code)) return true;
    if (errOrData?.needsCaptcha) return true;
    return false;
}

async function getBrowser() {
    if (browserFactory) {
        return browserFactory();
    }
    const puppeteer = require('puppeteer');
    const paths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome'
    ].filter(Boolean);
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    for (const p of paths) {
        try {
            return await puppeteer.launch({ ...launchOptions, executablePath: p });
        } catch (_) { /* sonraki */ }
    }
    return puppeteer.launch(launchOptions);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginWithBrowser(username, password) {
    let browser;
    try {
        browser = await getBrowser();
    } catch (err) {
        const e = new Error('Sunucuda tarayıcı modülü başlatılamadı. Chromium kurulu olduğundan emin olun.');
        e.code = 'browser_unavailable';
        throw e;
    }
    const page = await browser.newPage();
    try {
        await page.setUserAgent(BROWSER_UA);
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(HIPODROM_ORIGIN, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(1500);

        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('a, button, span')];
            const login = btns.find((b) => /giriş yap/i.test((b.textContent || '').trim()));
            if (login) login.click();
        });
        await sleep(1500);

        await page.waitForSelector('#username', { timeout: 15000 });
        await page.click('#username', { clickCount: 3 });
        await page.type('#username', String(username).trim(), { delay: 25 });
        await page.click('#password', { clickCount: 3 });
        await page.type('#password', String(password), { delay: 25 });

        const loginResponsePromise = page.waitForResponse(
            (res) => res.url().includes('auth/login') && res.request().method() === 'POST',
            { timeout: 45000 }
        ).catch(() => null);

        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]')
                || [...document.querySelectorAll('button')].find((b) => /giriş/i.test(b.textContent || ''));
            if (btn) btn.click();
        });

        const loginResponse = await loginResponsePromise;
        let loginJson = null;
        if (loginResponse) {
            try { loginJson = await loginResponse.json(); } catch (_) { /* */ }
        }

        await sleep(2000);

        const tokens = await page.evaluate(() => {
            const access = localStorage.getItem('auth._token.local');
            const refresh = localStorage.getItem('auth._refresh_token.local');
            if (!access || access === 'false') return null;
            return {
                accessToken: access,
                refreshToken: refresh && refresh !== 'false' ? refresh : null
            };
        });

        if (tokens?.accessToken) {
            return {
                accessToken: normalizeToken(tokens.accessToken),
                refreshToken: normalizeToken(tokens.refreshToken)
            };
        }

        if (loginJson && !loginJson.success) {
            const err = new Error(extractError(loginJson));
            err.code = loginJson.error?.[0]?.code;
            err.needsCaptcha = needsCaptcha(loginJson);
            throw err;
        }

        const pageError = await page.evaluate(() => {
            const el = document.querySelector('.errorMessage, .loginError, [class*="errorMessage"]');
            return el ? el.textContent.trim() : '';
        });
        throw new Error(pageError || 'Hipodrom girişi başarısız. Bilgilerinizi kontrol edin.');
    } finally {
        await page.close().catch(() => {});
    }
}

function normalizeToken(token) {
    if (!token || token === 'false') return null;
    const t = String(token).trim();
    if (t.startsWith('Bearer ')) return t.slice(7);
    return t;
}

async function login(username, password, recaptchaCode) {
    const headers = { 'User-Agent': BROWSER_UA };
    if (recaptchaCode) headers['X-G-Recaptcha'] = recaptchaCode;

    const { data } = await hipodromApi('/auth/login', {
        method: 'POST',
        headers,
        body: { username: String(username || '').trim(), password: String(password || '') }
    });

    if (!data?.success) {
        const err = new Error(extractError(data));
        err.needsCaptcha = needsCaptcha(data);
        err.code = data?.error?.[0]?.code;
        throw err;
    }

    const tokens = {
        accessToken: normalizeToken(data.data?.accessToken),
        refreshToken: normalizeToken(data.data?.refreshToken)
    };
    if (!tokens.accessToken) throw new Error('Giriş yanıtında token alınamadı');
    return tokens;
}

async function loginAuto(username, password, recaptchaCode) {
    try {
        return { tokens: await login(username, password, recaptchaCode), method: 'api' };
    } catch (apiErr) {
        if (!shouldTryBrowserLogin(apiErr)) throw apiErr;
        try {
            return { tokens: await loginWithBrowser(username, password), method: 'browser' };
        } catch (browserErr) {
            const err = new Error(browserErr.message || apiErr.message);
            err.needsCaptcha = apiErr.needsCaptcha || browserErr.needsCaptcha;
            err.code = browserErr.code || apiErr.code;
            throw err;
        }
    }
}

function loginWithTimeout(username, password, recaptchaCode, timeoutMs) {
    const ms = timeoutMs || 55000;
    return Promise.race([
        loginAuto(username, password, recaptchaCode),
        new Promise((_, reject) => {
            setTimeout(() => {
                const e = new Error('Giriş zaman aşımına uğradı. Lütfen tekrar deneyin.');
                e.code = 'login_timeout';
                reject(e);
            }, ms);
        })
    ]);
}

async function fetchUserDetails(accessToken) {
    const { data } = await hipodromApi('/user/details', { token: accessToken });
    if (!data?.success) throw new Error(extractError(data));
    return data.data;
}

async function fetchUserBalance(accessToken) {
    const { data } = await hipodromApi('/user/balance', { token: accessToken });
    if (!data?.success) return null;
    return data.data;
}

async function logoutApi(accessToken) {
    if (!accessToken) return;
    try {
        await hipodromApi('/auth/logout', { method: 'DELETE', token: accessToken });
    } catch (_) { /* sessiz */ }
}

function publicUser(session) {
    const u = session.user || {};
    return {
        loggedIn: true,
        displayName: u.name || u.firstName || u.loginName || u.username || 'Üye',
        memberNo: u.memberNo || u.emn || u.id || null,
        amount: u.amount ?? null,
        bonusAmount: u.bonusAmount ?? null,
        totalAmount: u.totalAmount ?? null,
        registrationDate: u.registrationDate || null
    };
}

module.exports = {
    COOKIE_NAME,
    RECAPTCHA_SITE_KEY,
    parseCookies,
    setSessionCookie,
    clearSessionCookie,
    getSession,
    createSession,
    destroySession,
    login,
    loginAuto,
    loginWithTimeout,
    loginWithBrowser,
    setBrowserFactory,
    fetchUserDetails,
    fetchUserBalance,
    logoutApi,
    publicUser
};
