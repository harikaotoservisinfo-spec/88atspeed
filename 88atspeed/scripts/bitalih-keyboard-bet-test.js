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

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: resolveChromePath(),
        args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1920, height: 1080 });
    const postReqs = [];
    page.on('request', (r) => {
        if (r.url().includes('/api/') && r.method() === 'POST') {
            postReqs.push({ url: r.url(), post: r.postData() });
        }
    });

    await restoreSession(page);
    await page.goto('https://www.bitalih.com/at-yarisi/tjk-sabit-ihtimalli-bahis#1-kosu#ilk-2', {
        waitUntil: 'networkidle2', timeout: 90000
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

    const inputHandle = await page.evaluateHandle(() => {
        return [...document.querySelectorAll('input')].find((i) => {
            return i.type === 'text' && (i.className || '').includes('h-10');
        }) || null;
    });
    const input = inputHandle.asElement();
    console.log('stake input:', !!input);
    if (input) {
        await input.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.keyboard.type('20', { delay: 40 });
        const val = await page.evaluate((el) => el.value, input);
        console.log('stake value:', val);
    }

    postReqs.length = 0;
    const hemenHandle = await page.evaluateHandle(() => {
        return [...document.querySelectorAll('button')].find((b) => {
            return /^hemen oyna$/i.test((b.textContent || '').trim()) && !b.disabled;
        }) || null;
    });
    const hemen = hemenHandle.asElement();
    if (hemen) {
        const box = await hemen.boundingBox();
        console.log('hemen box:', box);
        if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
    }
    await sleep(8000);

    console.log('POST requests:', JSON.stringify(postReqs, null, 2));
    const bal = await page.evaluate(async () => {
        const s = await (await fetch('/api/auth/session')).json();
        return s.playerInfo?.wallet?.totalBalance;
    });
    console.log('balance after:', bal);

    const ui = await page.evaluate(() => {
        return [...document.querySelectorAll('[role=alert], [class*=toast], [class*=Toast]')]
            .map((e) => e.innerText.trim()).filter(Boolean);
    });
    console.log('toasts:', ui);

    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
