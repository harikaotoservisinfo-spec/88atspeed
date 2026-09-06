#!/usr/bin/env node
/**
 * TJK geçmiş koşu meta alanları testi — kcins_kosu, taki, pist, hp, siklet, at_sayisi
 *
 *   node scripts/test-tjk-kosu-meta-fields.js --at-id 111738 --max-kosu 3
 */
const {
    launchBrowser,
    gotoWithHeaders,
    gotoKosuSonucSayfasi,
    parseKosuDetayEval,
    countFieldSizePageEval,
    buildKosuKayit
} = require('../lib/tjk-scrape');

const META_COLS = ['kcins_kosu', 'taki', 'pist', 'pist_kosu', 'hp', 'siklet', 'at_sayisi', 'sehir'];

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    atId: argVal('--at-id') || '111738',
    maxKosu: Number(argVal('--max-kosu') || '3')
};

async function main() {
    console.log('TJK koşu meta alanları testi — atId=' + cli.atId + ' · max ' + cli.maxKosu + ' koşu\n');
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        const atUrl = 'https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=' + cli.atId;
        await gotoWithHeaders(page, atUrl);

        const pageTitle = await page.evaluate(() => document.querySelector('h2.tableTitle')?.innerText?.trim() || '');
        const atIsmi = pageTitle || 'AT';

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
                const pistRaw = cell(4);
                let pist = '';
                if (/^K:|kum/i.test(pistRaw)) pist = 'Kum';
                else if (/^Ç:|^C:|^S:|çim/i.test(pistRaw)) pist = 'Çim';
                else if (/sentetik/i.test(pistRaw)) pist = 'Sentetik';
                else pist = pistRaw;
                return {
                    tarih: tarihText,
                    tarihLink: tarihLink.href,
                    sehir: cell(2),
                    mesafe: cell(3),
                    pist,
                    pist_raw: pistRaw,
                    sira: cell(5),
                    at_derece_ana_tablo: cell(6) || '-',
                    siklet: cell(7),
                    taki: cell(8).replace(/\s+/g, ' ').trim(),
                    grup: cell(12),
                    kcins: cell(14),
                    hp: cell(17)
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

        console.log('At: ' + atIsmi + ' · ' + anaKosular.length + ' koşu listede\n');
        const pad = (s, n) => String(s ?? '—').slice(0, n).padEnd(n);

        const limit = Math.min(cli.maxKosu, anaKosular.length);
        for (let i = 0; i < limit; i++) {
            const ana = anaKosular[i];
            await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
            const detay = await page.evaluate(parseKosuDetayEval(), atIsmi);
            const fieldSize = await page.evaluate(countFieldSizePageEval());
            const merged = Object.assign({}, detay, fieldSize);
            const kayit = buildKosuKayit(ana, merged, {});

            console.log('── Koşu ' + (i + 1) + ': ' + ana.tarih + ' · ' + ana.sehir + ' · S' + ana.sira + ' ──');
            for (const col of META_COLS) {
                const v = kayit[col];
                const ok = v != null && v !== '' && v !== '-';
                console.log('  ' + pad(col, 14) + (ok ? '✓ ' : '✗ ') + (v || '(boş)'));
            }
            if (detay.raceHeaderLine) {
                console.log('  ' + pad('raceHeader', 14) + detay.raceHeaderLine.slice(0, 80));
            }
            console.log('');
            await new Promise(r => setTimeout(r, 400));
        }

        console.log('✓ Meta alanları TJK sonuç sayfasından çekilebilir.');
        console.log('  kcins_kosu → koşu başlığı (raceHeaderLine)');
        console.log('  taki/hp/siklet → ana tablo + sonuç detayı');
        console.log('  pist/pist_kosu → ana tablo + koşu başlığı');
        console.log('  at_sayisi → sonuç tablosu sayımı');
    } finally {
        await browser.close();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
