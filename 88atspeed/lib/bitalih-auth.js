/**
 * Bi'Talih oturum — tarayıcı girişi (API doğrudan SR500 verebilir).
 */
const {
    ORIGIN,
    BROWSER_UA,
    COOKIES_FILE,
    SESSION_FILE,
    cookieHeaderFromFile,
    saveJson,
    getBrowser,
    setBrowserFactory,
    usesSharedBrowser
} = require('./bitalih-browser');

const API_BASE = ORIGIN + '/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                const e = new Error((label || 'İşlem') + ' zaman aşımına uğradı (' + Math.round(ms / 1000) + ' sn).');
                e.code = 'timeout';
                reject(e);
            }, ms);
        })
    ]);
}

async function dismissCookieBanner(page) {
    await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a')];
        const accept = btns.find((b) => /kabul|anladım|tamam|accept/i.test((b.textContent || '').trim()));
        if (accept) accept.click();
    });
}

async function openLoginModal(page) {
    await page.evaluate(() => {
        const el = [...document.querySelectorAll('a, button, span')].find((n) => /^giriş yap$/i.test((n.textContent || '').trim()));
        if (el) el.click();
    });
}

async function loginWithBrowser(ssn, password) {
    return withTimeout(loginWithBrowserInner(ssn, password), 60000, 'Bi\'Talih giriş');
}

async function loginWithBrowserInner(ssn, password) {
    let browser;
    try {
        browser = await getBrowser();
    } catch (err) {
        const e = new Error('Sunucuda tarayıcı modülü başlatılamadı.');
        e.code = 'browser_unavailable';
        throw e;
    }
    const page = await browser.newPage();
    try {
        await page.setUserAgent(BROWSER_UA);
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2000);
        await dismissCookieBanner(page);
        await sleep(500);
        await openLoginModal(page);
        await page.waitForSelector('input[name=ssn]', { timeout: 15000 });
        await page.click('input[name=ssn]', { clickCount: 3 });
        await page.type('input[name=ssn]', String(ssn).trim(), { delay: 20 });
        await page.click('input[name=password]', { clickCount: 3 });
        await page.type('input[name=password]', String(password), { delay: 20 });

        const loginResponsePromise = page.waitForResponse(
            (res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST',
            { timeout: 45000 }
        ).catch(() => null);

        await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) {
                form.requestSubmit();
                return;
            }
            const btn = [...document.querySelectorAll('button[type=submit], button')].find((b) => /giriş yap/i.test(b.textContent || ''));
            if (btn) btn.click();
        });

        const loginResponse = await loginResponsePromise;
        let loginJson = null;
        if (loginResponse) {
            try { loginJson = await loginResponse.json(); } catch (_) { /* */ }
        }
        await sleep(2000);

        const session = await page.evaluate(async () => {
            const r = await fetch('/api/auth/session');
            return r.json();
        });

        if (!session?.authenticated) {
            const msg = loginJson?.error?.message || loginJson?.data?.message || 'Giriş başarısız — TC ve şifreyi kontrol edin.';
            const err = new Error(msg);
            err.code = loginJson?.error?.errorCode || loginJson?.data?.errorCode || 'login_failed';
            throw err;
        }

        const cookies = await page.cookies(ORIGIN);
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(__dirname, '..', 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 0));
        saveJson(SESSION_FILE, {
            authenticated: true,
            user: session.user,
            jwt: session.jwt || null,
            playerInfo: session.playerInfo || null,
            savedAt: Date.now()
        });

        return session;
    } finally {
        await page.close().catch(() => {});
        if (!usesSharedBrowser() && browser) await browser.close().catch(() => {});
    }
}

async function fetchSessionRemote() {
    const cookieHeader = cookieHeaderFromFile();
    if (!cookieHeader) return { authenticated: false };
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(API_BASE + '/auth/session', {
            headers: {
                Accept: 'application/json',
                Cookie: cookieHeader,
                Referer: ORIGIN + '/',
                Origin: ORIGIN,
                'User-Agent': BROWSER_UA
            },
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        if (data?.authenticated) {
            saveJson(SESSION_FILE, {
                authenticated: true,
                user: data.user,
                jwt: data.jwt || null,
                playerInfo: data.playerInfo || null,
                savedAt: Date.now()
            });
        }
        return data;
    } finally {
        clearTimeout(tid);
    }
}

function publicProfile(session) {
    const pi = session?.playerInfo || {};
    const wallet = pi.wallet || {};
    const name = [pi.firstname, pi.lastname].filter(Boolean).join(' ') || session?.user?.username || 'Üye';
    return {
        loggedIn: true,
        displayName: name,
        balance: wallet.totalBalance || wallet.withdrawalBalance || null,
        memberNo: session?.user?.number || pi.number || null
    };
}

function configureBrowserFactory(fn) {
    setBrowserFactory(fn);
}

module.exports = {
    setBrowserFactory: configureBrowserFactory,
    loginWithBrowser,
    fetchSessionRemote,
    publicProfile,
    FIXED_ODDS_URL: ORIGIN + '/at-yarisi/tjk-sabit-ihtimalli-bahis'
};
