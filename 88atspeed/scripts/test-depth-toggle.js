/**
 * Derinlik genişlet/kapat toggle — sütun sayısı ve buton metni doğrulama
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const race = {
    mesafe: '2200',
    pist: 'Çim',
    horses: Array.from({ length: 6 }, (_, i) => ({
        no: i + 1,
        name: 'At ' + (i + 1),
        kosular: Array.from({ length: 7 }, (_, j) => ({
            tarih: String(10 + j).padStart(2, '0') + '.08.2026',
            mesafe: '2200',
            hipodrom: 'Bursa',
            at_derece: '2.' + String(20 + i + j).padStart(2, '0') + '.00',
            son800_bir: '0.' + String(46 + j).padStart(2, '0') + '.00',
            son800_iki: '0.' + String(47 + j).padStart(2, '0') + '.00',
            test1: 80 + j,
            test2: 70 + j,
            test3: 60 + j
        }))
    }))
};

const kayit = {
    id: 1,
    tarih: '24.08.2026',
    hipodrom: 'Bursa',
    race_count: 1,
    veri: [race]
};

function countSon8001DepthHeaders(page) {
    return page.evaluate(() => {
        const ths = [...document.querySelectorAll('thead tr:nth-child(2) th')];
        return ths.filter(t => t.textContent.trim() === 'SON'
            || /^[1-9] ÖNCE$/.test(t.textContent.trim())).length;
    });
}

function countSon8001GroupHeaders(page) {
    return page.evaluate(() => {
        return [...document.querySelectorAll('thead tr:nth-child(2) th.istat-grp-son8001')]
            .filter(t => t.textContent.trim() === 'SON'
                || /^[1-9] ÖNCE$/.test(t.textContent.trim())).length;
    });
}

function getMainSon8001BtnText(page) {
    return page.evaluate(() => {
        const grp = [...document.querySelectorAll('thead tr:first-child th.istat-grp-son8001')]
            .find(el => !el.classList.contains('istat-tahmin-active-metric'));
        return grp?.querySelector('[data-depth-expand]')?.textContent?.trim() || null;
    });
}

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3023/istatistikler.html?v=20260826o', { waitUntil: 'networkidle0' });

    await page.evaluate((k) => {
        if (typeof onKayitLoaded === 'function') onKayitLoaded(k);
    }, kayit);

    await page.waitForSelector('[data-depth-expand="son8001"]');

    const collapsedMain = await getMainSon8001BtnText(page);
    const collapsedDepths = await countSon8001GroupHeaders(page);
    console.log('collapsed btn:', collapsedMain, 'depth cols:', collapsedDepths);

    if (collapsedDepths !== 1) {
        console.error('FAIL: collapsed should show 1 SON depth in main son8001, got', collapsedDepths);
        process.exit(1);
    }

    // expand via main button
    await page.evaluate(() => {
        const grp = [...document.querySelectorAll('thead tr:first-child th.istat-grp-son8001')]
            .find(el => !el.classList.contains('istat-tahmin-active-metric'));
        grp.querySelector('[data-depth-expand="son8001"]').click();
    });
    await page.waitForFunction(() => {
        const grp = [...document.querySelectorAll('thead tr:first-child th.istat-grp-son8001')]
            .find(el => !el.classList.contains('istat-tahmin-active-metric'));
        return grp?.querySelector('[data-depth-expand]')?.textContent?.includes('Yalnız SON');
    });

    const expandedDepths = await countSon8001GroupHeaders(page);
    console.log('expanded depth cols:', expandedDepths);
    if (expandedDepths !== 7) {
        console.error('FAIL: expanded should show 7 depths, got', expandedDepths);
        process.exit(1);
    }

    // collapse via same main button
    await page.evaluate(() => {
        const grp = [...document.querySelectorAll('thead tr:first-child th.istat-grp-son8001')]
            .find(el => !el.classList.contains('istat-tahmin-active-metric'));
        grp.querySelector('[data-depth-expand="son8001"]').click();
    });
    await page.waitForFunction(() => {
        const grp = [...document.querySelectorAll('thead tr:first-child th.istat-grp-son8001')]
            .find(el => !el.classList.contains('istat-tahmin-active-metric'));
        return grp?.querySelector('[data-depth-expand]')?.textContent?.includes('derinlik');
    });

    const collapsedAgain = await countSon8001GroupHeaders(page);
    const btnAgain = await getMainSon8001BtnText(page);
    console.log('collapsed again btn:', btnAgain, 'depth cols:', collapsedAgain);

    if (collapsedAgain !== 1) {
        console.error('FAIL: collapse did not restore 1 depth, got', collapsedAgain);
        process.exit(1);
    }

    // toggle via sticky active metric button
    await page.evaluate(() => {
        document.querySelector('th.istat-tahmin-active-metric [data-depth-expand="son8001"]').click();
    });
    await page.waitForFunction(() => {
        return [...document.querySelectorAll('thead tr:nth-child(2) th.istat-grp-son8001')]
            .filter(t => t.textContent.trim() === 'SON' || /^[1-9] ÖNCE$/.test(t.textContent.trim())).length === 7;
    });

    await page.evaluate(() => {
        document.querySelector('th.istat-tahmin-active-metric [data-depth-expand="son8001"]').click();
    });
    await page.waitForFunction(() => {
        return [...document.querySelectorAll('thead tr:nth-child(2) th.istat-grp-son8001')]
            .filter(t => t.textContent.trim() === 'SON' || /^[1-9] ÖNCE$/.test(t.textContent.trim())).length === 1;
    });

    console.log('OK depth toggle expand/collapse');
    await browser.close();
})().catch(err => {
    console.error(err);
    process.exit(1);
});
