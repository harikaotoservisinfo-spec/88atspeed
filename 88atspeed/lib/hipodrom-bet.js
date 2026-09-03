/**
 * Hipodrom sabit ihtimalli bahis — sunucu tarafı otomasyon (kalıcı profil).
 */
const { withPage } = require('./hipodrom-browser');

const FIXED_ODDS_URL = 'https://www.hipodrom.com/at-yarisi/sabit-ihtimalli-bahis';
const HOME_URL = 'https://www.hipodrom.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);
    await dismissCookieBanner(page);
    await sleep(800);

    let state = await readSessionState(page);
    if (state.loggedIn) return state;

    if (!username || !password) {
        const err = new Error('Hipodrom oturumu yok. Sunucuda giriş yapın (TC/üye no + şifre).');
        err.code = 'not_logged_in';
        throw err;
    }

    await page.waitForSelector('button.loginBtn, button.btn.login', { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
        const login = document.querySelector('button.loginBtn') || document.querySelector('button.btn.login');
        if (login) login.click();
    });
    await sleep(1200);
    await page.waitForSelector('#username', { timeout: 15000 });
    await page.click('#username', { clickCount: 3 });
    await page.type('#username', String(username).trim(), { delay: 20 });
    await page.click('#password', { clickCount: 3 });
    await page.type('#password', String(password), { delay: 20 });
    await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]')
            || [...document.querySelectorAll('button')].find((b) => /giriş/i.test(b.textContent || ''));
        if (btn) btn.click();
    });
    await sleep(4000);
    await dismissCookieBanner(page);
    state = await readSessionState(page);
    if (!state.loggedIn) {
        const err = new Error('Hipodrom girişi başarısız. TC/üye no ve şifreyi kontrol edin.');
        err.code = 'login_failed';
        throw err;
    }
    return state;
}

async function clickByText(page, pattern, rootSelector) {
    return page.evaluate((pat, rootSel) => {
        const re = new RegExp(pat, 'i');
        const root = rootSel ? document.querySelector(rootSel) : document;
        const scope = root || document;
        const nodes = [...scope.querySelectorAll('button, a, span, div, li')];
        const el = nodes.find((n) => {
            const t = (n.textContent || '').trim();
            if (!t || t.length > 80) return false;
            return re.test(t);
        });
        if (!el) return false;
        el.click();
        return true;
    }, pattern, rootSelector || '');
}

async function placeFixedOddsBet(opts = {}) {
    const city = String(opts.city || 'İzmir').trim();
    const raceNo = Number(opts.raceNo || opts.kosuNo || 3);
    const horseName = String(opts.horseName || opts.at || '').trim();
    const stake = Number(opts.stake || opts.misli || 20);
    const username = opts.username || process.env.HIPODROM_USER || null;
    const password = opts.password || process.env.HIPODROM_PASS || null;
    const dryRun = !!opts.dryRun;

    if (!horseName) throw new Error('At adı gerekli');

    return withPage(async (page) => {
        const apiCalls = [];
        page.on('response', async (res) => {
            const u = res.url();
            if (!u.includes('api.hipodrom.com')) return;
            if (!/bet|ante|ticket|bilet|play|coupon|slip/i.test(u)) return;
            let body = '';
            try { body = (await res.text()).slice(0, 500); } catch (_) { /* */ }
            apiCalls.push({
                method: res.request().method(),
                url: u.replace('https://api.hipodrom.com', ''),
                status: res.status(),
                body
            });
        });

        const session = await ensureLoggedIn(page, username, password);

        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(3000);
        await dismissCookieBanner(page);
        await sleep(500);

        const is404 = await page.evaluate(() => /404|bulunamadı/i.test(document.body?.innerText || ''));
        if (is404) {
            await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await sleep(2000);
            await clickByText(page, 'sabit ihtimalli');
            await sleep(2500);
        }

        const cityClicked = await clickByText(page, '^' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!cityClicked) {
            const err = new Error('Şehir bulunamadı: ' + city);
            err.code = 'city_not_found';
            throw err;
        }
        await sleep(1500);

        const raceClicked = await page.evaluate((no) => {
            const nodes = [...document.querySelectorAll('button, div, span, a')];
            const el = nodes.find((n) => (n.textContent || '').trim() === String(no));
            if (el) { el.click(); return true; }
            return false;
        }, raceNo);
        if (!raceClicked) {
            const err = new Error('Koşu bulunamadı: ' + raceNo);
            err.code = 'race_not_found';
            throw err;
        }
        await sleep(2000);

        const horseClicked = await page.evaluate((name) => {
            const rows = [...document.querySelectorAll('tr, [class*="horse"], [class*="runner"]')];
            const row = rows.find((r) => new RegExp(name, 'i').test(r.textContent || ''));
            if (!row) return false;
            const odds = [...row.querySelectorAll('button, div, span')].filter((el) => /^\d+\.\d+$/.test((el.textContent || '').trim()));
            if (odds[0]) { odds[0].click(); return true; }
            row.click();
            return true;
        }, horseName);
        if (!horseClicked) {
            const err = new Error('At bulunamadı: ' + horseName);
            err.code = 'horse_not_found';
            throw err;
        }
        await sleep(1500);

        await page.evaluate((amount) => {
            const inputs = [...document.querySelectorAll('input')];
            const misli = inputs.find((i) => {
                const ph = (i.placeholder || '').toLowerCase();
                const label = (i.closest('label')?.textContent || '').toLowerCase();
                return ph.includes('misli') || label.includes('misli') || i.type === 'number';
            });
            if (misli) {
                misli.focus();
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
                message: 'Kupon hazır (test modu — oynanmadı)',
                session,
                city,
                raceNo,
                horseName,
                stake
            };
        }

        const playPromise = page.waitForResponse(
            (res) => res.url().includes('api.hipodrom.com') && res.request().method() === 'POST',
            { timeout: 30000 }
        ).catch(() => null);

        const playClicked = await clickByText(page, 'hemen oyna');
        if (!playClicked) {
            const err = new Error('HEMEN OYNA butonu bulunamadı');
            err.code = 'play_button_not_found';
            throw err;
        }

        const playRes = await playPromise;
        await sleep(2000);

        let playBody = null;
        if (playRes) {
            try { playBody = await playRes.json(); } catch (_) { /* */ }
        }

        const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
        const success = playBody?.success === true
            || /başarı|kabul edildi|biletiniz|oynanmıştır/i.test(pageText);

        if (!success && playBody && playBody.success === false) {
            const err0 = playBody?.error?.[0];
            const msg = err0?.message || err0?.code || 'Bahis oynanamadı';
            const err = new Error(msg);
            err.code = 'bet_rejected';
            err.detail = playBody;
            throw err;
        }

        return {
            success: true,
            message: success ? 'Bahis oynandı' : 'İşlem gönderildi — sonucu panelden kontrol edin',
            session,
            city,
            raceNo,
            horseName,
            stake,
            apiCalls,
            playResponse: playBody
        };
    });
}

async function getAutoStatus() {
    return withPage(async (page) => {
        await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2500);
        await dismissCookieBanner(page);
        return readSessionState(page);
    });
}

async function saveLogin(username, password) {
    const state = await withPage(async (page) => ensureLoggedIn(page, username, password));
    return { success: true, ...state };
}

module.exports = {
    placeFixedOddsBet,
    getAutoStatus,
    saveLogin
};
