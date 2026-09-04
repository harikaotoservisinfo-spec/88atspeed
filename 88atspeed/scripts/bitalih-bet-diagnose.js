#!/usr/bin/env node
/**
 * Bi'Talih kupon akışı teşhis — her adımda DOM + API kaydı
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { resolveChromePath } = require('../lib/chrome-path');
const bitalihAuth = require('../lib/bitalih-auth');
const bitalihAutoConfig = require('../lib/bitalih-auto-config');
const { restoreSession, COOKIES_FILE, BROWSER_UA } = require('../lib/bitalih-browser');

const OUT = path.join(__dirname, '..', 'data', 'bitalih-diagnose.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXED_ODDS_URL = bitalihAuth.FIXED_ODDS_URL;

async function snap(page, label) {
    const buttons = await page.evaluate(() => {
        return [...document.querySelectorAll('button, a[role=button]')].map((b) => ({
            tag: b.tagName,
            text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            disabled: !!b.disabled,
            visible: !!(b.offsetParent || b.getClientRects().length),
            cls: (b.className || '').slice(0, 80)
        })).filter((b) => /oyna|onay|kupon|sabit|misli|bahis|hemen/i.test(b.text));
    });
    const inputs = await page.evaluate(() => {
        return [...document.querySelectorAll('input')].filter((i) => i.type !== 'hidden').map((i) => ({
            type: i.type,
            val: i.value,
            ph: i.placeholder,
            cls: (i.className || '').slice(0, 60),
            visible: !!(i.offsetParent || i.getClientRects().length)
        }));
    });
    const session = await page.evaluate(async () => {
        const r = await fetch('/api/auth/session');
        return r.json();
    }).catch(() => null);
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 1200) || '');
    return { label, url: page.url(), session: session?.authenticated, buttons, inputs, bodySnippet };
}

(async () => {
    const cfg = bitalihAutoConfig.getAutoConfig();
    const log = { at: new Date().toISOString(), steps: [], api: [] };
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: resolveChromePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1920, height: 1080 });

    page.on('response', async (res) => {
        const url = res.url();
        if (!/\/api\//.test(url)) return;
        let body = null;
        try { body = await res.json(); } catch (_) { /* */ }
        log.api.push({ url, status: res.status(), body });
    });

    try {
        // Login if needed
        await restoreSession(page);
        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2000);
        let sess = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
        log.steps.push({ step: 'initial_session', authenticated: sess?.authenticated });

        if (!sess?.authenticated) {
            log.steps.push({ step: 'logging_in' });
            await page.goto('https://www.bitalih.com/', { waitUntil: 'domcontentloaded' });
            await sleep(2000);
            await page.evaluate(() => {
                const el = [...document.querySelectorAll('a, button, span')].find((n) => /^giriş yap$/i.test((n.textContent || '').trim()));
                if (el) el.click();
            });
            await page.waitForSelector('input[name=ssn]', { timeout: 15000 });
            await page.type('input[name=ssn]', cfg.username, { delay: 15 });
            await page.type('input[name=password]', cfg.password, { delay: 15 });
            await page.evaluate(() => {
                const form = document.querySelector('form');
                if (form) form.requestSubmit();
            });
            await sleep(4000);
            sess = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
            log.steps.push({ step: 'after_login', authenticated: sess?.authenticated, user: sess?.user?.username });
            const cookies = await page.cookies('https://www.bitalih.com');
            fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies));
        }

        const city = 'Bursa';
        const raceNo = 1;
        const horseName = 'LA BOMBONERA';
        const horseNo = 5;
        const betType = 'ilk2';
        const stake = 20;
        const raceUrl = FIXED_ODDS_URL + '#1-kosu#ilk-2';

        await page.goto(FIXED_ODDS_URL, { waitUntil: 'domcontentloaded' });
        await sleep(2000);
        await page.evaluate((cityName) => {
            const el = [...document.querySelectorAll('div.cursor-pointer, button, a')].find((e) => (e.textContent || '').trim().startsWith(cityName));
            if (el) el.click();
        }, city);
        await sleep(2500);
        log.steps.push(await snap(page, 'after_hipodrom'));

        await page.goto(raceUrl, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
        await sleep(3500);
        log.steps.push(await snap(page, 'after_race_page'));

        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('İlk 2'));
            if (btn) btn.click();
        });
        await sleep(1500);
        log.steps.push(await snap(page, 'after_ilk2_tab'));

        const pick = await page.evaluate((name, no) => {
            const re = new RegExp(name, 'i');
            const row = [...document.querySelectorAll('tr')].find((r) => {
                const badges = [...r.querySelectorAll('div')].filter((d) => (d.className || '').includes('font-bold') && (d.className || '').includes('rounded'));
                if (badges.some((b) => b.textContent.trim() === String(no))) return true;
                return re.test(r.textContent || '');
            });
            if (!row) return { ok: false };
            const cells = [...row.querySelectorAll('div, button')].filter((el) => /^\d+\.\d+$/.test((el.textContent || '').replace(/\s+/g, '')));
            if (!cells[0]) return { ok: false, cells: cells.length };
            cells[0].click();
            return { ok: true, odd: cells[0].textContent.trim(), cells: cells.length };
        }, horseName, horseNo);
        log.steps.push({ step: 'horse_pick', pick });
        await sleep(2500);
        log.steps.push(await snap(page, 'after_odds_click'));

        // set stake before sabit
        const stakeBefore = await page.evaluate((amount) => {
            const inputs = [...document.querySelectorAll('input')].filter((i) => i.type !== 'hidden' && i.type !== 'checkbox');
            const misli = inputs.find((i) => i.type === 'text' && (i.className || '').includes('h-10'))
                || inputs.find((i) => i.type === 'number');
            if (!misli) return { ok: false, inputCount: inputs.length };
            const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (desc?.set) desc.set.call(misli, String(amount));
            else misli.value = String(amount);
            misli.dispatchEvent(new Event('input', { bubbles: true }));
            misli.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, val: misli.value, cls: misli.className };
        }, stake);
        log.steps.push({ step: 'stake_before_sabit', stakeBefore });
        await sleep(800);
        log.steps.push(await snap(page, 'after_stake_before'));

        const sabit = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Sabit Oranlı Oyna');
            if (!btn) return { ok: false };
            btn.click();
            return { ok: true, disabled: btn.disabled };
        });
        log.steps.push({ step: 'click_sabit_oranli', sabit });
        await sleep(3000);
        log.steps.push(await snap(page, 'after_sabit_oranli'));

        const stakeAfter = await page.evaluate((amount) => {
            const inputs = [...document.querySelectorAll('input')].filter((i) => i.type !== 'hidden' && i.type !== 'checkbox');
            const misli = inputs.find((i) => /misli|tutar/i.test((i.placeholder || '') + (i.name || '')))
                || inputs.find((i) => i.type === 'text' && (i.className || '').includes('h-10'))
                || inputs.find((i) => i.type === 'number');
            if (!misli) return { ok: false, inputs: inputs.map((i) => ({ type: i.type, val: i.value, ph: i.placeholder })) };
            const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (desc?.set) desc.set.call(misli, String(amount));
            else misli.value = String(amount);
            misli.dispatchEvent(new Event('input', { bubbles: true }));
            misli.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, val: misli.value };
        }, stake);
        log.steps.push({ step: 'stake_after_sabit', stakeAfter });
        await sleep(800);

        const hemenBtns = await page.evaluate(() => {
            return [...document.querySelectorAll('button')].map((b) => ({
                text: (b.textContent || '').trim(),
                disabled: b.disabled,
                visible: !!(b.offsetParent || b.getClientRects().length)
            })).filter((b) => /hemen oyna/i.test(b.text));
        });
        log.steps.push({ step: 'hemen_oyna_buttons', hemenBtns });

        const hemenClick = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => /^hemen oyna$/i.test((b.textContent || '').trim()) && !b.disabled);
            if (!btn) return { ok: false };
            btn.click();
            return { ok: true };
        });
        log.steps.push({ step: 'click_hemen_oyna', hemenClick });
        await sleep(5000);
        log.steps.push(await snap(page, 'after_hemen_oyna'));

        // check for modals
        const modal = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('[role=dialog], [class*=modal], [class*=Modal]')];
            return dialogs.map((d) => ({
                text: (d.innerText || '').slice(0, 400),
                buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
            }));
        });
        log.steps.push({ step: 'modals_after_hemen', modal });

    } catch (err) {
        log.error = { message: err.message, stack: err.stack };
    } finally {
        await browser.close();
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
        console.log('Wrote', OUT);
        console.log('Steps:', log.steps.length, 'API calls:', log.api.length);
        if (log.error) console.error(log.error.message);
        // print summary
        for (const s of log.steps) {
            if (s.label) {
                console.log('\n===', s.label, '===');
                console.log('buttons:', JSON.stringify(s.buttons, null, 2));
                console.log('inputs:', JSON.stringify(s.inputs, null, 2));
            } else {
                console.log('\n---', s.step, '---', JSON.stringify(s, null, 2).slice(0, 800));
            }
        }
        const betApis = log.api.filter((a) => /bet|kupon|play|slip|ticket|wager/i.test(a.url));
        console.log('\nBet-related APIs:', betApis.length);
        betApis.forEach((a) => console.log(a.status, a.url, JSON.stringify(a.body).slice(0, 200)));
    }
})();
