/**
 * TJK scrape yardımcıları — alan parse, kalite kontrol, retry
 */
const puppeteer = require('puppeteer');

const KOSU_KRITIK = ['at_derece', 'birinci_derece', 'son800_bir'];
const KOSU_TUM_ALANLAR = [
    'tarih', 'sehir', 'mesafe', 'pist', 'sira', 'at_derece', 'birinci_derece',
    'son800_bir', 'son800_iki', 'siklet', 'grup', 'kcins', 'hp', 'taki', 'yas',
    'kcins_kosu', 'kategori', 'pist_kosu', 'at_sayisi', 'cikan_sayisi'
];

function getBrowserHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'https://www.tjk.org/'
    };
}

async function launchBrowser() {
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    const fs = require('fs');
    for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
        if (p && fs.existsSync(p)) {
            launchOptions.executablePath = p;
            break;
        }
    }
    return puppeteer.launch(launchOptions);
}

async function gotoWithHeaders(page, url) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
}

function isKosmazText(text) {
    if (!text) return false;
    return /\(\s*koşmaz\s*\)/i.test(text)
        || /\(\s*kosmaz\s*\)/i.test(text)
        || /\(\s*koşm\s*\)/i.test(text)
        || /\(\s*çekildi\s*\)/i.test(text)
        || /^koşmaz$/i.test(String(text).trim());
}

function parseRaceHeaderLine(line) {
    const out = { kcins_kosu: '', kategori: '', kilo: '', mesafe: '', pist_kosu: '', eid: '' };
    if (!line) return out;
    const clean = line.replace(/\s+/g, ' ').trim();
    const mesafePist = clean.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/i);
    if (mesafePist) {
        out.mesafe = mesafePist[1];
        out.pist_kosu = mesafePist[2];
    }
    const eid = clean.match(/E\.İ\.D\.\s*:\s*([\d\.:]+)/i);
    if (eid) out.eid = eid[1];
    const parts = clean.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) out.kcins_kosu = parts[0];
    if (parts.length > 1) {
        const kat = parts[1];
        if (!/^\d/.test(kat) && !/kg/i.test(kat)) out.kategori = kat;
        else out.kategori = kat;
    }
    for (const p of parts) {
        if (/yaşlı|yukarı|ingiliz|arap|dişi|erkek|i̇ngiliz|yasli/i.test(p) && !out.kategori) out.kategori = p;
        if (/\d+\s*kg/i.test(p)) out.kilo = p;
    }
    if (parts.length >= 2 && !out.kategori.match(/yaşlı|yukarı|ingiliz|arap/i)) {
        out.kategori = parts.find(p => /yaşlı|yukarı|ingiliz|arap|ve\s+/i.test(p)) || parts[1] || '';
    }
    return out;
}

function parseRaceHeaderFromBody(bodyText, raceNo) {
    if (!bodyText) return parseRaceHeaderLine('');
    const re = new RegExp(raceNo + '\\.\\s*Koşu\\s+\\d+\\.\\d+\\s*\\n([^\\n]+(?:Kum|Çim|Sentetik)[^\\n]*)', 'i');
    const m = bodyText.match(re);
    return parseRaceHeaderLine(m ? m[1] : '');
}

function parseAtKosuRowEval() {
    return function parseRow(row) {
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
        if (/çim/i.test(pistRaw)) pist = 'Çim';
        else if (/kum/i.test(pistRaw)) pist = 'Kum';
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
    };
}

function normalizePist(raw) {
    if (!raw) return '';
    const s = String(raw);
    if (/^K:|kum/i.test(s)) return 'Kum';
    if (/^Ç:|^C:|^S:|çim/i.test(s)) return 'Çim';
    if (/sentetik/i.test(s)) return 'Sentetik';
    return s.replace(/\s+/g, ' ').trim();
}

function parseHorseNameCellEval() {
    return function parseNameCell(nameCell) {
        if (!nameCell) return { name: '', taki_badges: [], kosmaz: false };
        const fullText = nameCell.innerText || '';
        const link = nameCell.querySelector('a');
        let name = (link?.innerText || fullText.split('\n')[0] || '').replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
        const badges = [...nameCell.querySelectorAll('span.aciklamaFancy')]
            .map(s => s.innerText.trim())
            .filter(t => t && t.length <= 6 && /^[A-ZÇĞİÖŞÜ0-9]+$/i.test(t));
        const kosmaz = isKosmazText(fullText);
        return { name, taki_badges: badges, kosmaz, fullText: fullText.slice(0, 120) };
    };
}

function parseKosuDetayEval() {
    const parseNameCell = parseHorseNameCellEval();
    return function parseDetay(atIsmi) {
        function normName(value) {
            return (value || '').replace(/\(\d+\)/g, '').split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
        }
        function namesMatch(cellText, target) {
            const a = normName(cellText);
            const b = normName(target);
            return a && b && (a.includes(b) || b.includes(a));
        }
        function findTableByHash() {
            const hashId = (location.hash || '').replace(/^#/, '');
            if (!hashId) return -1;
            const anchor = document.getElementById(hashId);
            if (!anchor) return -1;
            let node = anchor;
            for (let i = 0; i < 8 && node; i++) {
                const table = node.querySelector ? node.querySelector('table') : null;
                if (table) {
                    const tables = document.querySelectorAll('table');
                    return Array.prototype.indexOf.call(tables, table);
                }
                node = node.nextElementSibling || node.parentElement;
            }
            return -1;
        }
        function getBirinciFromTable(table) {
            if (!table) return null;
            for (const row of table.querySelectorAll('tbody tr')) {
                const siraCell = row.querySelector('td:nth-child(2)');
                const dereceCell = row.querySelector('td:nth-child(10)');
                if (siraCell?.innerText.trim() === '1' && dereceCell) {
                    const d = dereceCell.innerText.trim();
                    if (d && d !== '-' && !/^koşmaz$/i.test(d)) return d;
                }
            }
            return null;
        }
        function parseNameCell(nameCell) {
            if (!nameCell) return { taki_badges: [], kosmaz: false };
            const fullText = nameCell.innerText || '';
            const badges = [...nameCell.querySelectorAll('span.aciklamaFancy')]
                .map(s => s.innerText.trim())
                .filter(t => t && t.length <= 6);
            const kosmaz = /\(\s*koşmaz\s*\)/i.test(fullText) || /\(\s*kosmaz\s*\)/i.test(fullText);
            return { taki_badges: badges, kosmaz };
        }
        function extractSon800(text) {
            if (!text) return null;
            const idx = text.indexOf('Son 800');
            if (idx === -1) return null;
            const chunk = text.substring(idx, idx + 120);
            let match = chunk.match(/Son\s*800\s*:?\s*(\d+[\.:]\d+[\.:]\d+)\s*[\-–—]\s*(\d+[\.:]\d+[\.:]\d+)/);
            if (match) return match[1] + '|' + match[2];
            match = chunk.match(/Son\s*800\s*:?\s*(\d+[\.:]\d+[\.:]\d+)/);
            return match ? match[1] + '|' : null;
        }

        const tables = document.querySelectorAll('table');
        let atTabloIndex = findTableByHash();
        if (atTabloIndex === -1) {
            for (let t = 0; t < tables.length; t++) {
                for (const row of tables[t].querySelectorAll('tbody tr')) {
                    const atIsimCell = row.querySelector('td:nth-child(3)');
                    if (atIsimCell && namesMatch(atIsimCell.innerText, atIsmi)) {
                        atTabloIndex = t;
                        break;
                    }
                }
                if (atTabloIndex !== -1) break;
            }
        }

        let birinciDerece = null;
        let atDereceDetay = null;
        let son800 = null;
        let yas = null;
        let hp = null;
        let taki_badges = [];
        let kosmaz = false;

        if (atTabloIndex !== -1) {
            const tablo = tables[atTabloIndex];
            birinciDerece = getBirinciFromTable(tablo);
            son800 = extractSon800(tablo.innerText);
            for (const row of tablo.querySelectorAll('tbody tr')) {
                const atIsimCell = row.querySelector('td:nth-child(3)');
                if (!atIsimCell || !namesMatch(atIsimCell.innerText, atIsmi)) continue;
                const dereceCell = row.querySelector('td:nth-child(10)');
                const parsed = parseNameCell(atIsimCell);
                taki_badges = parsed.taki_badges;
                kosmaz = parsed.kosmaz || /^koşmaz$/i.test(dereceCell?.innerText?.trim() || '');
                yas = row.querySelector('td:nth-child(4)')?.innerText?.trim() || null;
                hp = row.querySelector('td:nth-child(16)')?.innerText?.trim() || null;
                if (dereceCell) {
                    const d = dereceCell.innerText.trim();
                    if (d && d !== '-' && !/^koşmaz$/i.test(d)) atDereceDetay = d;
                }
            }
        }

        if (!son800) son800 = extractSon800(document.body.innerText);

        const raceHeader = (() => {
            const bt = document.body.innerText || '';
            const m = bt.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+(?:Kum|Çim|Sentetik)[^\n]*)/);
            return m ? m[1] : '';
        })();

        return { birinciDerece, atDereceDetay, son800, yas, hp, taki_badges, kosmaz, raceHeaderLine: raceHeader };
    };
}

function countFieldSizePageEval() {
    return function countField() {
        function parseNameCell(nameCell) {
            if (!nameCell) return { name: '', kosmaz: false };
            const fullText = nameCell.innerText || '';
            const link = nameCell.querySelector('a');
            const name = (link?.innerText || fullText.split('\n')[0] || '')
                .replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
            const kosmaz = /\(\s*koşmaz\s*\)/i.test(fullText)
                || /\(\s*kosmaz\s*\)/i.test(fullText)
                || /\(\s*çekildi\s*\)/i.test(fullText)
                || /\(\s*koşm\s*\)/i.test(fullText);
            return { name, kosmaz };
        }
        function findTableByHash() {
            const hashId = (location.hash || '').replace(/^#/, '');
            if (!hashId) return null;
            const anchor = document.getElementById(hashId);
            if (!anchor) return null;
            let node = anchor;
            for (let i = 0; i < 10 && node; i++) {
                const table = node.querySelector ? node.querySelector('table') : null;
                if (table && table.querySelectorAll('tbody tr').length) return table;
                node = node.nextElementSibling || node.parentElement;
            }
            return null;
        }
        function findResultTable() {
            let target = findTableByHash();
            if (target) return target;
            const tables = document.querySelectorAll('table');
            let best = null;
            let bestRows = 0;
            for (const t of tables) {
                const ths = [...t.querySelectorAll('thead th')].map(x => x.innerText.trim());
                const looksLike = ths.some(h => /at/i.test(h) && /ism/i.test(h))
                    || (ths.includes('S') && ths.some(h => /at/i.test(h)));
                const rows = t.querySelectorAll('tbody tr').length;
                if (looksLike && rows > bestRows) {
                    best = t;
                    bestRows = rows;
                }
            }
            if (best) return best;
            for (const t of tables) {
                const rows = t.querySelectorAll('tbody tr').length;
                if (rows > bestRows && t.querySelector('tbody tr td:nth-child(3) a')) {
                    best = t;
                    bestRows = rows;
                }
            }
            return best;
        }
        const target = findResultTable();
        if (!target) return { error: 'tablo_yok', at_sayisi: 0, cikan_sayisi: 0 };

        let atSayisi = 0;
        let cikan = 0;
        for (const row of target.querySelectorAll('tbody tr')) {
            const nameCell = row.querySelector('td:nth-child(3)');
            if (!nameCell) continue;
            const derece = row.querySelector('td:nth-child(10)')?.innerText?.trim() || '';
            const parsed = parseNameCell(nameCell);
            const kosmaz = parsed.kosmaz || /^koşmaz$/i.test(derece);
            if (kosmaz) { cikan++; continue; }
            if (parsed.name) atSayisi++;
        }
        return { at_sayisi: atSayisi, cikan_sayisi: cikan };
    };
}

async function gotoKosuSonucSayfasi(page, url, sehirAdi) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    const hashId = url.includes('#') ? url.split('#').pop() : '';
    const baseUrl = hashId ? url.split('#')[0] : url;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.waitForSelector('.gunluk-tabs', { timeout: 15000 }); } catch (_) {}
    const sehirKey = (sehirAdi || '').split(/[\s(]/)[0].trim();
    if (sehirKey) {
        await page.evaluate((sehir) => {
            for (const tab of document.querySelectorAll('.gunluk-tabs a')) {
                if (tab.textContent.includes(sehir)) { tab.click(); break; }
            }
        }, sehirKey);
        await new Promise(r => setTimeout(r, 5000));
    }
    if (hashId) {
        await page.evaluate((id) => {
            location.hash = id;
            const el = document.getElementById(id);
            if (el) el.scrollIntoView({ block: 'start' });
        }, hashId);
        await new Promise(r => setTimeout(r, 2000));
    }
    try {
        await page.waitForFunction(
            () => document.querySelectorAll('table tbody tr').length > 0 && document.body.innerText.length > 3000,
            { timeout: 30000, polling: 500 }
        );
    } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));
    return page.evaluate(() => document.querySelectorAll('table tbody tr').length > 0);
}

function buildKosuKayit(ana, detay, raceMeta) {
    let atDerece = ana.at_derece_ana_tablo || '-';
    let birinciDerece = detay?.birinciDerece || '-';
    if (birinciDerece === '-' && ana.sira === '1' && atDerece && atDerece !== '-') birinciDerece = atDerece;
    if (detay?.atDereceDetay && detay.atDereceDetay !== '-') atDerece = detay.atDereceDetay;
    let son800Bir = '-';
    let son800Iki = '-';
    if (detay?.son800 && detay.son800 !== '-') {
        const parts = detay.son800.split('|');
        son800Bir = parts[0] || '-';
        son800Iki = parts[1] || '-';
    }
    const header = parseRaceHeaderLine(detay?.raceHeaderLine || '');
    const meta = Object.assign({}, raceMeta || {}, header);
    const takiBadges = (detay?.taki_badges || []).join(' ');
    const takiAna = (ana.taki || '').replace(/\s+/g, ' ').trim();
    const taki = takiBadges || takiAna;
    const pistNorm = normalizePist(ana.pist || meta.pist_kosu || '');
    return {
        tarih: ana.tarih,
        sehir: ana.sehir,
        mesafe: ana.mesafe || meta.mesafe || '',
        pist: pistNorm,
        pist_raw: ana.pist_raw || ana.pist || '',
        sira: ana.sira,
        at_derece: atDerece,
        birinci_derece: birinciDerece,
        son800_bir: son800Bir,
        son800_iki: son800Iki,
        siklet: ana.siklet || '',
        grup: ana.grup || '',
        kcins: ana.kcins || '',
        hp: detay?.hp || ana.hp || '',
        taki: taki,
        yas: detay?.yas || '',
        kcins_kosu: meta.kcins_kosu || '',
        kategori: meta.kategori || '',
        pist_kosu: normalizePist(meta.pist_kosu || ana.pist || ''),
        kosmaz: !!detay?.kosmaz,
        at_sayisi: detay?.at_sayisi != null ? detay.at_sayisi : '',
        cikan_sayisi: detay?.cikan_sayisi != null ? detay.cikan_sayisi : ''
    };
}

function evaluateKosuKayit(k) {
    const missing = [];
    const dash = [];
    for (const f of KOSU_TUM_ALANLAR) {
        const v = k[f];
        if (v == null || v === '') missing.push(f);
        else if (v === '-') dash.push(f);
    }
    const criticalMissing = KOSU_KRITIK.filter(f => !k[f] || k[f] === '-');
    const optionalMissing = ['son800_iki', 'yas', 'taki', 'grup', 'hp', 'siklet', 'kcins', 'kategori', 'pist']
        .filter(f => !k[f] || k[f] === '-');
    let status = 'tam';
    if (criticalMissing.length) status = 'kritik_eksik';
    else if (optionalMissing.length > 4) status = 'kismi';
    return { status, missing, dash, criticalMissing, optionalMissing };
}

function mergeKosuRetry(prev, next) {
    const out = Object.assign({}, prev);
    for (const f of KOSU_TUM_ALANLAR) {
        const nv = next[f];
        const pv = prev[f];
        if ((!pv || pv === '-') && nv && nv !== '-') out[f] = nv;
    }
    return out;
}

async function fetchAtKosularFromPage(page, atId, atAdi, opts = {}) {
    const maxKosu = opts.maxKosu || 7;
    const maxRetry = opts.maxRetry ?? 1;
    const atUrl = 'https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=' + atId;
    await gotoWithHeaders(page, atUrl);

    const pageOk = await page.evaluate(() => {
        const title = document.querySelector('h2.tableTitle');
        if (!title) return false;
        const text = title.innerText.trim().toLowerCase();
        return text && !text.includes('bulunamadı');
    });
    if (!pageOk) {
        return { success: false, error: 'sayfa_erisim', atAdi: atAdi || '', atId, kosular: [], quality: {} };
    }

    const pageTitle = await page.evaluate(() => document.querySelector('h2.tableTitle')?.innerText?.trim() || '');
    const atIsmi = pageTitle || atAdi;
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

    const sonuclar = [];
    const qualityLog = [];

    for (let i = 0; i < Math.min(maxKosu, anaKosular.length); i++) {
        let kayit = null;
        let attempts = 0;
        let lastErr = null;

        while (attempts <= maxRetry) {
            attempts++;
            try {
                const ana = anaKosular[i];
                await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
                let detay = await page.evaluate(parseKosuDetayEval(), atIsmi);
                const fieldSize = await page.evaluate(countFieldSizePageEval());
                if (fieldSize?.at_sayisi) {
                    detay = Object.assign({}, detay, {
                        at_sayisi: fieldSize.at_sayisi,
                        cikan_sayisi: fieldSize.cikan_sayisi || 0
                    });
                }
                if (!detay.son800) {
                    const extraSon800 = await page.evaluate(() => {
                        const bt = document.body.innerText || '';
                        const idx = bt.indexOf('Son 800');
                        if (idx === -1) return null;
                        const chunk = bt.substring(idx, idx + 120);
                        let m = chunk.match(/Son\s*800\s*:?\s*(\d+[\.:]\d+[\.:]\d+)\s*[\-–—]\s*(\d+[\.:]\d+[\.:]\d+)/);
                        if (m) return m[1] + '|' + m[2];
                        m = chunk.match(/Son\s*800\s*:?\s*(\d+[\.:]\d+[\.:]\d+)/);
                        return m ? m[1] + '|' : null;
                    });
                    if (extraSon800) detay = Object.assign({}, detay, { son800: extraSon800 });
                }
                kayit = buildKosuKayit(ana, detay, {});
                kayit._fetch = { attempt: attempts, ok: true };
            } catch (err) {
                lastErr = err.message;
                kayit = buildKosuKayit(anaKosular[i], {}, {});
                kayit._fetch = { attempt: attempts, ok: false, error: lastErr };
            }

            const q = evaluateKosuKayit(kayit);
            if (q.status === 'tam' || q.criticalMissing.length === 0 || attempts > maxRetry) break;
            await new Promise(r => setTimeout(r, 1200));
        }

        if (kayit) {
            const q = evaluateKosuKayit(kayit);
            if (lastErr && q.criticalMissing.length) kayit._fetch = Object.assign(kayit._fetch || {}, { error: lastErr });
            delete kayit._fetch;
            delete kayit.kosmaz;
            sonuclar.push(kayit);
            qualityLog.push({ tarih: kayit.tarih, status: q.status, criticalMissing: q.criticalMissing, attempt: attempts });
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (opts.fetchAllFieldSizes !== false) {
        const maxAll = opts.maxAllKosu != null ? opts.maxAllKosu : anaKosular.length;
        const keys = new Set(sonuclar.map(k => [k.tarih, k.sehir, k.mesafe].join('|')));
        for (let i = maxKosu; i < Math.min(maxAll, anaKosular.length); i++) {
            const ana = anaKosular[i];
            const key = [ana.tarih, ana.sehir, ana.mesafe].join('|');
            if (keys.has(key)) continue;
            try {
                await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
                const fieldSize = await page.evaluate(countFieldSizePageEval());
                const kayit = buildKosuKayit(ana, fieldSize, {});
                delete kayit.kosmaz;
                sonuclar.push(kayit);
                keys.add(key);
                qualityLog.push({ tarih: kayit.tarih, status: 'alan_sayisi_only', criticalMissing: [], attempt: 1 });
            } catch (_) { /* at sayısı ek koşu atlanır */ }
            await new Promise(r => setTimeout(r, 350));
        }
    }

    const tam = qualityLog.filter(q => q.status === 'tam').length;
    const kritik = qualityLog.filter(q => q.status === 'kritik_eksik').length;
    return {
        success: true,
        atAdi: atIsmi,
        atId,
        kosular: sonuclar,
        quality: { tam, kritik, kismi: sonuclar.length - tam - kritik, detay: qualityLog }
    };
}

async function fetchRaceSonuclari(page, sehirId, sehirAdi, tarih, raceNo) {
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisSonuclari?SehirId=' + sehirId
        + '&QueryParameter_Tarih=' + encodeURIComponent(tarih)
        + '&SehirAdi=' + encodeURIComponent(sehirAdi) + '&Era=lastWeek';
    await gotoWithHeaders(page, url);

    return page.evaluate((raceNo) => {
        function isKosmazText(text) {
            if (!text) return false;
            return /\(\s*koşmaz\s*\)/i.test(text) || /\(\s*kosmaz\s*\)/i.test(text)
                || /\(\s*çekildi\s*\)/i.test(text) || /^koşmaz$/i.test(String(text).trim());
        }
        function parseNameCell(nameCell) {
            if (!nameCell) return { name: '', taki_badges: [], kosmaz: false };
            const fullText = nameCell.innerText || '';
            const link = nameCell.querySelector('a');
            const name = (link?.innerText || fullText.split('\n')[0] || '').replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
            const badges = [...nameCell.querySelectorAll('span.aciklamaFancy')]
                .map(s => s.innerText.trim())
                .filter(t => t && t.length <= 6 && /^[A-ZÇĞİÖŞÜ0-9]+$/i.test(t));
            return { name, taki_badges: badges, kosmaz: isKosmazText(fullText) };
        }
        const tables = document.querySelectorAll('table');
        const atTables = [];
        for (let ti = 0; ti < tables.length; ti++) {
            const ths = [...tables[ti].querySelectorAll('thead th')].map(x => x.innerText.trim());
            if (ths.includes('At İsmi')) atTables.push(tables[ti]);
        }
        const rn = parseInt(raceNo, 10) || 1;
        const target = atTables[rn - 1] || atTables[0];
        if (!target) return { error: 'Sonuç tablosu bulunamadı' };

        const bt = document.body.innerText;
        const hdrRe = new RegExp(raceNo + '\\.\\s*Koşu\\s+\\d+\\.\\d+\\s*\\n([^\\n]+(?:Kum|Çim|Sentetik)[^\\n]*)', 'i');
        const hdrMatch = bt.match(hdrRe);
        const raceHeaderLine = hdrMatch ? hdrMatch[1] : '';

        const horses = [];
        for (const row of target.querySelectorAll('tbody tr')) {
            const sira = row.querySelector('td:nth-child(2)')?.innerText?.trim();
            const nameCell = row.querySelector('td:nth-child(3)');
            if (!nameCell) continue;
            const parsed = parseNameCell(nameCell);
            const link = nameCell.querySelector('a');
            let atId = '';
            const href = link?.getAttribute('href') || '';
            const m = href.match(/AtId=(\d+)/);
            if (m) atId = m[1];
            const derece = row.querySelector('td:nth-child(10)')?.innerText?.trim() || '';
            const kosmaz = parsed.kosmaz || /^koşmaz$/i.test(derece);
            if (kosmaz) continue;
            horses.push({
                sira: sira || '',
                name: parsed.name || link?.innerText?.trim() || '',
                atId,
                yas: row.querySelector('td:nth-child(4)')?.innerText?.trim() || '',
                siklet: row.querySelector('td:nth-child(6)')?.innerText?.trim() || '',
                derece,
                gny: row.querySelector('td:nth-child(11)')?.innerText?.trim() || '',
                hp: row.querySelector('td:nth-child(16)')?.innerText?.trim() || '',
                taki: parsed.taki_badges.join(' '),
                taki_badges: parsed.taki_badges
            });
        }

        return { raceNo: rn, raceHeaderLine, horses, horseCount: horses.length, tableIndex: rn - 1 };
    }, String(raceNo));
}

module.exports = {
    KOSU_KRITIK,
    KOSU_TUM_ALANLAR,
    getBrowserHeaders,
    launchBrowser,
    gotoWithHeaders,
    gotoKosuSonucSayfasi,
    isKosmazText,
    parseRaceHeaderLine,
    parseRaceHeaderFromBody,
    parseAtKosuRowEval,
    parseHorseNameCellEval,
    parseKosuDetayEval,
    countFieldSizePageEval,
    buildKosuKayit,
    evaluateKosuKayit,
    mergeKosuRetry,
    fetchAtKosularFromPage,
    fetchRaceSonuclari
};
