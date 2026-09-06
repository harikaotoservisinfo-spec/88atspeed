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
    const traffic = [];
    page.on('request', (r) => {
        if (r.url().includes('bitalih.com')) {
            traffic.push({ dir: 'req', method: r.method(), url: r.url(), post: r.postData()?.slice(0, 800) });
        }
    });
    page.on('response', async (r) => {
        if (!r.url().includes('/api/')) return;
        let body = null;
        try { body = await r.json(); } catch (_) { /* */ }
        traffic.push({ dir: 'res', url: r.url(), status: r.status(), body });
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

    // Click stake preset 20 in slip panel
    const stakeClick = await page.evaluate(() => {
        const slip = [...document.querySelectorAll('div')].find((d) => {
            return (d.innerText || '').includes('Hemen Oyna') && (d.innerText || '').includes('Maksimum Kazanç');
        });
        if (!slip) return { ok: false, reason: 'no_slip' };
        const btn20 = [...slip.querySelectorAll('button, div, span')].find((el) => {
            return (el.textContent || '').trim() === '20' && el.getBoundingClientRect().width > 0;
        });
        if (btn20) btn20.click();
        const checkbox = slip.querySelector('input[type=checkbox]');
        if (checkbox && !checkbox.checked) checkbox.click();
        return { ok: true, has20: !!btn20, checkbox: !!checkbox, checked: checkbox?.checked };
    });
    console.log('stake preset:', stakeClick);
    await sleep(1000);

    const balBefore = await page.evaluate(async () => {
        return (await (await fetch('/api/auth/session')).json()).playerInfo?.wallet?.totalBalance;
    });
    console.log('balance before:', balBefore);

    traffic.length = 0;
    const hemen = await page.evaluateHandle(() => {
        const slip = [...document.querySelectorAll('div')].find((d) => {
            return (d.innerText || '').includes('Hemen Oyna') && (d.innerText || '').includes('Maksimum Kazanç');
        });
        if (!slip) return null;
        return [...slip.querySelectorAll('button')].find((b) => /^hemen oyna$/i.test((b.textContent || '').trim())) || null;
    });
    const hemenEl = hemen.asElement();
    if (hemenEl) {
        const box = await hemenEl.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await sleep(8000);

    const balAfter = await page.evaluate(async () => {
        return (await (await fetch('/api/auth/session')).json()).playerInfo?.wallet?.totalBalance;
    });
    console.log('balance after:', balAfter);

    const afterUi = await page.evaluate(() => {
        const alerts = [...document.querySelectorAll('[role=alert]')].map((a) => a.innerText.trim());
        const dialogs = [...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText.trim().slice(0, 300));
        const onayBtns = [...document.querySelectorAll('button')].filter((b) => {
            return /onayla|kuponu oyna|bahsi onayla/i.test((b.textContent || '').trim()) && !b.disabled;
        }).map((b) => b.textContent.trim());
        return { alerts, dialogs: dialogs.filter((d) => d.length > 10), onayBtns };
    });
    console.log('after UI:', JSON.stringify(afterUi, null, 2));

    const apiTraffic = traffic.filter((t) => t.dir === 'res' && !/popup|onboarding|settings|session|bulletin|fixo-bulletin/i.test(t.url));
    console.log('API traffic:', JSON.stringify(apiTraffic, null, 2));
    const postTraffic = traffic.filter((t) => t.dir === 'req' && t.method === 'POST' && t.url.includes('/api/'));
    console.log('POST traffic:', JSON.stringify(postTraffic, null, 2));

    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
