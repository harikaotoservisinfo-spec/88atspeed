/**
 * TJK scrape yardımcıları — alan parse, kalite kontrol, retry
 */
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

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

function fetchHtml(url, headers, redirectsLeft = 3, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                res.resume();
                fetchHtml(next, headers, redirectsLeft - 1, timeoutMs).then(resolve).catch(reject);
                return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
                else reject(new Error('TJK HTTP ' + res.statusCode));
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('TJK isteği zaman aşımı'));
        });
    });
}

function parseHipodromlarFromHtml(html) {
    const result = [];
    const seen = new Set();
    const $ = cheerio.load(html);
    $('ul.gunluk-tabs > li > a').each((_, el) => {
        const id = $(el).attr('data-sehir-id');
        let name = $(el).text().trim();
        name = name.replace(/\(\d+\.\s*Y\.G\.\)/, '').trim();
        if (id && name && !seen.has(id)) {
            seen.add(id);
            result.push({ id, name });
        }
    });
    if (result.length) return result;
    const re = /data-sehir-id="(\d+)"[^>]*>([^<]+)/g;
    let match;
    while ((match = re.exec(html)) !== null) {
        const id = match[1];
        let name = match[2].trim().replace(/\(\d+\.\s*Y\.G\.\)/, '').trim();
        if (id && name && !seen.has(id)) {
            seen.add(id);
            result.push({ id, name });
        }
    }
    return result;
}

/** Puppeteer olmadan günlük yarış programı hipodrom sekmelerini çeker (yeniden denemeli). */
async function fetchHipodromlarForDate(tarih, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    const timeoutMs = opts.timeoutMs || 20000;
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami'
        + '?QueryParameter_Tarih=' + encodeURIComponent(tarih) + '&Era=today';
    const headers = getBrowserHeaders();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const html = await fetchHtml(url, headers, 3, timeoutMs);
            const hipodromlar = parseHipodromlarFromHtml(html);
            if (hipodromlar.length) return hipodromlar;
            lastError = new Error('TJK sayfasında hipodrom sekmesi bulunamadı');
        } catch (err) {
            lastError = err;
        }
        if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
        }
    }
    throw lastError || new Error('Hipodrom listesi alınamadı');
}

function resolveChromeExecutable() {
    const fs = require('fs');
    const isLinux = process.platform === 'linux';
    const candidates = [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ].filter(Boolean);
    if (!isLinux) {
        candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    }
    for (const p of candidates) {
        if (isLinux && p.includes('/Applications/')) continue;
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) { /* yoksay */ }
    }
    return null;
}

function buildLaunchOptions() {
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    const chromePath = resolveChromeExecutable();
    if (chromePath) launchOptions.executablePath = chromePath;
    return launchOptions;
}

async function launchBrowser() {
    const launchOptions = buildLaunchOptions();
    try {
        return await puppeteer.launch(launchOptions);
    } catch (err) {
        if (launchOptions.executablePath) {
            delete launchOptions.executablePath;
            return puppeteer.launch(launchOptions);
        }
        throw err;
    }
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

/** TJK: "56 +1" → "57"; geçmiş kayıtlarda "561" → "57" */
function normalizeSikletStr(raw) {
    if (raw == null || raw === '' || raw === '-' || raw === '—') return '';
    const s = String(raw).replace(/\s+/g, ' ').trim();
    const plus = s.match(/^(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)$/);
    if (plus) {
        const base = parseFloat(plus[1].replace(',', '.'));
        const adj = parseFloat(plus[2].replace(',', '.'));
        if (!isNaN(base) && !isNaN(adj)) return String(Math.round(base + adj));
    }
    const plain = s.match(/^(\d+(?:[.,]\d+)?)$/);
    if (plain) {
        let n = parseFloat(plain[1].replace(',', '.'));
        if (!isNaN(n)) {
            if (Number.isInteger(n) && n >= 520 && n < 700) {
                const base = Math.floor(n / 10);
                const adj = n % 10;
                if (base >= 48 && base <= 66 && adj <= 4) return String(base + adj);
            }
            return String(Math.round(n));
        }
    }
    const first = s.match(/(\d+(?:[.,]\d+)?)/);
    if (first) {
        const n = parseFloat(first[1].replace(',', '.'));
        if (!isNaN(n)) return String(Math.round(n));
    }
    return s;
}

async function readFieldSizeFromPage(page) {
    let fieldSize = await page.evaluate(countFieldSizePageEval());
    if (!(Number(fieldSize?.at_sayisi) > 0)) {
        await new Promise(r => setTimeout(r, 1500));
        fieldSize = await page.evaluate(countFieldSizePageEval());
    }
    return fieldSize;
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
        let at_sayisi = 0;
        let cikan_sayisi = 0;

        if (atTabloIndex !== -1) {
            const tablo = tables[atTabloIndex];
            birinciDerece = getBirinciFromTable(tablo);
            son800 = extractSon800(tablo.innerText);
            for (const row of tablo.querySelectorAll('tbody tr')) {
                const atIsimCell = row.querySelector('td:nth-child(3)');
                if (!atIsimCell) continue;
                const dereceCell = row.querySelector('td:nth-child(10)');
                const parsed = parseNameCell(atIsimCell);
                const derece = dereceCell?.innerText?.trim() || '';
                const rowKosmaz = parsed.kosmaz || /^koşmaz$/i.test(derece);
                if (rowKosmaz) {
                    cikan_sayisi++;
                    continue;
                }
                const link = atIsimCell.querySelector('a');
                const rowName = (link?.innerText || atIsimCell.innerText || '').replace(/\(\s*koşmaz\s*\)/gi, '').trim();
                if (rowName) at_sayisi++;

                if (!namesMatch(atIsimCell.innerText, atIsmi)) continue;
                taki_badges = parsed.taki_badges;
                kosmaz = rowKosmaz;
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

        return {
            birinciDerece, atDereceDetay, son800, yas, hp, taki_badges, kosmaz, raceHeaderLine: raceHeader,
            at_sayisi: at_sayisi || null,
            cikan_sayisi: cikan_sayisi || 0
        };
    };
}

function mergeDetayFieldSize(detay, fieldSize) {
    const pageFs = Number(fieldSize?.at_sayisi);
    const detayFs = Number(detay?.at_sayisi);
    const atSayisi = pageFs > 0 ? pageFs : (detayFs > 0 ? detayFs : null);
    if (!atSayisi) return detay || {};
    return Object.assign({}, detay || {}, {
        at_sayisi: atSayisi,
        cikan_sayisi: Number(fieldSize?.cikan_sayisi) || Number(detay?.cikan_sayisi) || 0
    });
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
        siklet: normalizeSikletStr(ana.siklet || ''),
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
    if (opts.onProgress) opts.onProgress('at sayfası yüklendi');

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

    if (!anaKosular.length) {
        const rowHint = await page.evaluate(() => {
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            const rows = kosuTablosu ? kosuTablosu.querySelectorAll('tbody tr').length : 0;
            return { tableCount: tables.length, rowCount: rows };
        });
        if (opts.onProgress) {
            if (rowHint.rowCount > 0) {
                opts.onProgress('⚠ tabloda ' + rowHint.rowCount + ' satır var ama parse edilemedi');
            } else {
                opts.onProgress('koşu geçmişi yok (ilk koşu veya TJK kaydı boş)');
            }
        }
    } else if (opts.onProgress) {
        opts.onProgress('tabloda ' + anaKosular.length + ' koşu bulundu, ilk ' + Math.min(maxKosu, anaKosular.length) + ' detay çekilecek');
    }

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
                if (opts.onProgress) opts.onProgress('detay ' + (i + 1) + '/' + Math.min(maxKosu, anaKosular.length) + ' ' + ana.tarih);
                await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
                let detay = await page.evaluate(parseKosuDetayEval(), atIsmi);
                const fieldSize = await readFieldSizeFromPage(page);
                detay = mergeDetayFieldSize(detay, fieldSize);
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
                let detay = {};
                try {
                    const fieldSize = await readFieldSizeFromPage(page);
                    detay = mergeDetayFieldSize({}, fieldSize);
                } catch (_) { /* at_sayisi yedek denemesi */ }
                kayit = buildKosuKayit(anaKosular[i], detay, {});
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

    if (opts.fetchAllFieldSizes === true) {
        const maxAll = opts.maxAllKosu != null ? opts.maxAllKosu : anaKosular.length;
        const keys = new Set(sonuclar.map(k => [k.tarih, k.sehir, k.mesafe].join('|')));
        const extraEnd = Math.min(maxAll, anaKosular.length);
        if (opts.onProgress && extraEnd > maxKosu) {
            opts.onProgress('at_sayisi ek koşular ' + maxKosu + '..' + extraEnd + ' / ' + anaKosular.length);
        }
        for (let i = maxKosu; i < extraEnd; i++) {
            const ana = anaKosular[i];
            const key = [ana.tarih, ana.sehir, ana.mesafe].join('|');
            if (keys.has(key)) continue;
            if (opts.onProgress && (i - maxKosu) % 5 === 0) {
                opts.onProgress('at_sayisi ' + (i + 1) + '/' + extraEnd + ' ' + ana.tarih);
            }
            try {
                await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
                const fieldSize = await readFieldSizeFromPage(page);
                let detay = await page.evaluate(parseKosuDetayEval(), atIsmi);
                detay = mergeDetayFieldSize(detay, fieldSize);
                const raceHeaderLine = detay.raceHeaderLine || await page.evaluate(() => {
                    const bt = document.body.innerText || '';
                    const m = bt.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+(?:Kum|Çim|Sentetik)[^\n]*)/);
                    return m ? m[1] : '';
                });
                const kayit = buildKosuKayit(ana, Object.assign({}, detay, { raceHeaderLine }), {});
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
    fetchHtml,
    fetchHipodromlarForDate,
    parseHipodromlarFromHtml,
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
