/**
 * Hipodrom otomasyonu — paylaşımlı Puppeteer + çerez/token dosyası (tek Chromium).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const COOKIES_FILE = path.join(DATA_DIR, 'hipodrom-cookies.json');
const TOKENS_FILE = path.join(DATA_DIR, 'hipodrom-tokens.json');
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browserFactory = null;
let queue = Promise.resolve();

function setBrowserFactory(fn) {
    browserFactory = fn;
}

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function getBrowser() {
    if (browserFactory) return browserFactory();
    const puppeteer = require('puppeteer');
    const paths = [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/local/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ].filter(Boolean);
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    for (const p of paths) {
        try {
            return await puppeteer.launch({ ...launchOptions, executablePath: p });
        } catch (_) { /* */ }
    }
    return puppeteer.launch(launchOptions);
}

function loadJson(file) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { /* */ }
    return null;
}

function saveJson(file, data) {
    ensureDataDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 0));
}

async function restoreSession(page) {
    const cookies = loadJson(COOKIES_FILE);
    if (cookies?.length) {
        try {
            await page.setCookie(...cookies);
        } catch (_) { /* */ }
    }
    const tokens = loadJson(TOKENS_FILE);
    if (tokens?.accessToken) {
        await page.goto('https://www.hipodrom.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.evaluate((t) => {
            if (t.accessToken) localStorage.setItem('auth._token.local', t.accessToken);
            if (t.refreshToken) localStorage.setItem('auth._refresh_token.local', t.refreshToken);
        }, tokens);
    }
}

async function persistSession(page) {
    try {
        const cookies = await page.cookies('https://www.hipodrom.com');
        if (cookies?.length) saveJson(COOKIES_FILE, cookies);
        const tokens = await page.evaluate(() => ({
            accessToken: localStorage.getItem('auth._token.local'),
            refreshToken: localStorage.getItem('auth._refresh_token.local')
        }));
        if (tokens?.accessToken && tokens.accessToken !== 'false') {
            saveJson(TOKENS_FILE, tokens);
        }
    } catch (_) { /* */ }
}

function withLock(fn) {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
}

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

async function withPage(fn, timeoutMs) {
    const ms = timeoutMs || 90000;
    return withLock(() => withTimeout((async () => {
        let browser;
        try {
            browser = await getBrowser();
        } catch (err) {
            const e = new Error('Tarayıcı başlatılamadı: ' + err.message);
            e.code = 'browser_unavailable';
            throw e;
        }
        const page = await browser.newPage();
        try {
            await page.setUserAgent(BROWSER_UA);
            await page.setViewport({ width: 1400, height: 900 });
            await restoreSession(page);
            const result = await fn(page);
            await persistSession(page);
            return result;
        } finally {
            await page.close().catch(() => {});
        }
    })(), ms, 'Hipodrom'));
}

module.exports = {
    DATA_DIR,
    COOKIES_FILE,
    TOKENS_FILE,
    BROWSER_UA,
    setBrowserFactory,
    getBrowser,
    withLock,
    withPage,
    withTimeout,
    persistSession,
    restoreSession
};
