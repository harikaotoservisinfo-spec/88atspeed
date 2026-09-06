#!/usr/bin/env node
/**
 * TJK geçmiş koşu sayfalarından koşan at sayısı (çıkan/koşmaz hariç) testi
 *
 *   node scripts/test-tjk-field-size.js --at-id 111738 --max-kosu 8
 */
const {
    launchBrowser,
    gotoWithHeaders,
    gotoKosuSonucSayfasi,
    countFieldSizePageEval
} = require('../lib/tjk-scrape');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    atId: argVal('--at-id') || '111738',
    maxKosu: Number(argVal('--max-kosu') || '8')
};

async function main() {
    console.log('TJK koşu at sayısı testi — atId=' + cli.atId);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        const atUrl = 'https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=' + cli.atId;
        await gotoWithHeaders(page, atUrl);

        const anaKosular = await page.evaluate(() => {
            function parseRow(row) {
                const cell = n => {
                    const el = row.querySelector('td:nth-child(' + n + ')');
                    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
                };
                const tarihCell = row.querySelector('td:first-child');
                const tarihLink = tarihCell?.querySelector('a');
                const tarihText = tarihCell?.innerText?.trim() || '';
                if (!tarihLink?.href || !/\d{2}\.\d{2}\.\d{4}/.test(tarihText)) return null;
                return {
                    tarih: tarihText,
                    tarihLink: tarihLink.href,
                    sehir: cell(2),
                    sira: cell(5)
                };
            }
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            if (!kosuTablosu) return [];
            const data = [];
            for (const row of kosuTablosu.querySelectorAll('tbody tr')) {
                const rec = parseRow(row);
                if (rec) data.push(rec);
            }
            return data;
        });

        const title = await page.evaluate(() => document.querySelector('h2.tableTitle')?.innerText?.trim() || '');
        console.log('\nAt: ' + title + ' · ' + anaKosular.length + ' koşu\n');
        console.log('Tarih       | Şehir    | Sıra | at_sayisi | çıkan');
        console.log('-'.repeat(55));

        const limit = Math.min(cli.maxKosu, anaKosular.length);
        for (let i = 0; i < limit; i++) {
            const ana = anaKosular[i];
            await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
            const field = await page.evaluate(countFieldSizePageEval());
            const pad = (s, n) => String(s ?? '—').padEnd(n);
            console.log(
                pad(ana.tarih, 12) + '| '
                + pad(ana.sehir?.slice(0, 8), 9) + '| '
                + pad(ana.sira, 5) + '| '
                + pad(field.at_sayisi, 10) + '| '
                + pad(field.cikan_sayisi, 6)
                + (field.error ? ' · ' + field.error : '')
            );
            await new Promise(r => setTimeout(r, 300));
        }
        console.log('\n✓ TJK sonuç tablosundan at_sayisi çekilebilir.');
    } finally {
        await browser.close();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
