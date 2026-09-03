/**
 * Hipodrom için kalıcı tarayıcı profili (tek kullanıcı — oturum saklanır).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PROFILE_DIR = path.join(__dirname, '..', 'data', 'hipodrom-profile');
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browser = null;
let queue = Promise.resolve();

function resolveChromeExecutable() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/local/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ].filter(Boolean);
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) { /* */ }
    }
    return null;
}

async function getBrowser() {
    if (browser) {
        try {
            if (browser.isConnected()) return browser;
        } catch (_) {
            browser = null;
        }
    }
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const launchOptions = {
        headless: process.env.HIPODROM_HEADED === '1' ? false : 'new',
        userDataDir: PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    const chromePath = resolveChromeExecutable();
    if (chromePath) launchOptions.executablePath = chromePath;
    browser = await puppeteer.launch(launchOptions);
    return browser;
}

function withLock(fn) {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
}

async function withPage(fn) {
    return withLock(async () => {
        const b = await getBrowser();
        const page = await b.newPage();
        try {
            await page.setUserAgent(BROWSER_UA);
            await page.setViewport({ width: 1400, height: 900 });
            return await fn(page);
        } finally {
            await page.close().catch(() => {});
        }
    });
}

module.exports = {
    PROFILE_DIR,
    BROWSER_UA,
    getBrowser,
    withLock,
    withPage
};
