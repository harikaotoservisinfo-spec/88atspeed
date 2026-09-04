#!/usr/bin/env node
const puppeteer = require('puppeteer');
const { resolveChromePath } = require('../lib/chrome-path');
const { restoreSession, BROWSER_UA } = require('../lib/bitalih-browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissAll(page) {
    await page.evaluate(() => {
        [...document.querySelectorAll('button, a')].forEach((b) => {
            const t = (b.textContent || '').trim();
            if (/öğrenmeye başla|teşekkürler|istemiyorum|anladım|kapat|tamam|kabul/i.test(t)) {
                b.click();
            }
        });
    });
}

async function setupToHemenReady(page) {
    await restoreSession(page);
    await page.goto('https://www.bitalih.com/at-yarisi/tjk-sabit-ihtimalli-bahis#1-kosu#ilk-2', {
        waitUntil: 'networkidle2',
        timeout: 90000
    }).catch(() => {});
    await sleep(3000);
    await dismissAll(page);
    await page.evaluate(() => {
        const el = [...document.querySelectorAll('div.cursor-pointer, button, a')]
            .find((e) => (e.textContent || '').trim().startsWith('Bursa'));
        if (el) el.click();
    });
    await sleep(2000);
    await dismissAll(page);
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
            .find((b) => (b.textContent || '').trim() === 'İlk 2-3-4');
        if (btn) btn.click();
    });
    await sleep(1500);
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('tr')].find((r) => /BOMBONERA/i.test(r.textContent || ''));
        const cell = [...row.querySelectorAll('div')].find((d) => {
            const cls = d.className || '';
            const t = (d.textContent || '').replace(/\s+/g, '').trim();
            return /^\d+\.\d+$/.test(t) && cls.includes('h-8') && cls.includes('rounded');
        });
        if (cell) cell.click();
    });
    await sleep(2500);
    await page.evaluate((amount) => {
        const misli = [...document.querySelectorAll('input')]
            .find((i) => i.type === 'text' && (i.className || '').includes('h-10'));
        if (!misli) return;
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc?.set) desc.set.call(misli, String(amount));
        else misli.value = String(amount);
        misli.dispatchEvent(new Event('input', { bubbles: true }));
        misli.dispatchEvent(new Event('change', { bubbles: true }));
    }, 20);
    await sleep(800);
}

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: resolveChromePath(),
        args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1920, height: 1080 });

    const allReqs = [];
    page.on('request', (req) => {
        if (!req.url().includes('/api/')) return;
        allReqs.push({
            type: 'req',
            url: req.url(),
            method: req.method(),
            post: req.postData()?.slice(0, 500) || null
        });
    });
    page.on('response', async (res) => {
        if (!res.url().includes('/api/')) return;
        let body = null;
        try { body = await res.json(); } catch (_) { /* */ }
        allReqs.push({ type: 'res', url: res.url(), status: res.status(), body });
    });

    await setupToHemenReady(page);

    const before = await page.evaluate(async () => {
        const s = await (await fetch('/api/auth/session')).json();
        return s.playerInfo?.wallet?.totalBalance;
    });
    console.log('Balance before:', before);

    const hemenBtn = await page.evaluateHandle(() => {
        return [...document.querySelectorAll('button')].find((b) => {
            const t = (b.textContent || '').trim();
            return /^hemen oyna$/i.test(t) && !b.disabled;
        }) || null;
    });
    const hemenEl = hemenBtn.asElement();
    console.log('Hemen button found:', !!hemenEl);
    if (hemenEl) {
        allReqs.length = 0;
        await hemenEl.click();
        await sleep(4000);
    }

    const afterClick = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role=dialog]')].map((d) => ({
            text: (d.innerText || '').trim().slice(0, 600),
            btns: [...d.querySelectorAll('button')].map((b) => ({
                text: (b.textContent || '').trim(),
                disabled: b.disabled
            }))
        }));
        const alerts = [...document.querySelectorAll('[role=alert]')].map((a) => a.innerText.trim());
        const allBtns = [...document.querySelectorAll('button')]
            .filter((b) => b.offsetParent && !b.disabled)
            .map((b) => (b.textContent || '').trim())
            .filter((t) => /onay|oyna|kupon|evet|tamam|iptal/i.test(t));
        return { dialogs, alerts, allBtns };
    });
    console.log('After click UI:', JSON.stringify(afterClick, null, 2));

    const apis = allReqs.filter((r) => !/popup|onboarding|settings|session|bulletin|fixo-bulletin|player\/settings/i.test(r.url));
    console.log('API traffic:', JSON.stringify(apis, null, 2));

    await browser.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
