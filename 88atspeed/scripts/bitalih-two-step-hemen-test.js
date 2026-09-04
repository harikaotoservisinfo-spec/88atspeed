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

async function setupSlip(page) {
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
}

async function clickHemenInSmallestContainer(page, requiredTexts, excludeTexts) {
    const handle = await page.evaluateHandle((required, exclude) => {
        const candidates = [...document.querySelectorAll('div, section, aside, [role=dialog]')]
            .filter((d) => {
                const t = d.innerText || '';
                if (!required.every((s) => t.includes(s))) return false;
                if (exclude.some((s) => t.includes(s))) return false;
                return true;
            })
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        const container = candidates[0];
        if (!container) return null;
        return [...container.querySelectorAll('button')].find((b) => {
            return /^hemen oyna$/i.test((b.textContent || '').trim()) && !b.disabled;
        }) || null;
    }, requiredTexts, excludeTexts || []);
    const btn = handle.asElement();
    if (!btn) return { ok: false, reason: 'no_btn' };
    const box = await btn.boundingBox();
    if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await btn.click();
    }
    const snippet = await page.evaluate((el) => {
        const container = el.closest('div');
        return container ? container.innerText.slice(0, 200) : '';
    }, btn);
    return { ok: true, snippet };
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

    const postApis = [];
    page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().includes('/api/') && !/bulletin|popup|onboarding/i.test(r.url)) {
            postApis.push({ url: r.url().replace('https://www.bitalih.com', ''), post: r.postData()?.slice(0, 600) });
        }
    });
    page.on('response', async (r) => {
        if (r.request().method() !== 'POST' || !r.url().includes('/api/')) return;
        if (/bulletin|popup|onboarding/i.test(r.url)) return;
        let body = null;
        try { body = await r.json(); } catch (_) { /* */ }
        postApis.push({ url: r.url().replace('https://www.bitalih.com', ''), status: r.status(), body });
    });

    await setupSlip(page);

    const balBefore = await page.evaluate(async () => {
        return (await (await fetch('/api/auth/session')).json()).playerInfo?.wallet?.totalBalance;
    });
    console.log('balance before:', balBefore);

    const step1 = await clickHemenInSmallestContainer(page, ['Maksimum Kazanç', 'Hemen Oyna', 'Toplam Oran'], ['Bahis Detayı']);
    console.log('step1 slip hemen:', step1);
    await sleep(3500);

    const modalVisible = await page.evaluate(() => {
        const el = [...document.querySelectorAll('div, [role=dialog]')]
            .filter((d) => (d.innerText || '').includes('Bahis Detayı'))
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
        return el ? el.innerText.slice(0, 300) : null;
    });
    console.log('modal text:', modalVisible);

    postApis.length = 0;
    const step2 = await clickHemenInSmallestContainer(page, ['Bahis Detayı', 'Toplam Tutar', 'Hemen Oyna'], []);
    console.log('step2 modal hemen:', step2);
    await sleep(8000);

    const balAfter = await page.evaluate(async () => {
        return (await (await fetch('/api/auth/session')).json()).playerInfo?.wallet?.totalBalance;
    });
    console.log('balance after:', balAfter);
    console.log('bet APIs:', JSON.stringify(postApis, null, 2));

    const toast = await page.evaluate(() => {
        return [...document.querySelectorAll('[role=alert], [class*=toast], [class*=Toast]')]
            .map((e) => e.innerText.trim()).filter(Boolean);
    });
    console.log('toasts:', toast);

    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
