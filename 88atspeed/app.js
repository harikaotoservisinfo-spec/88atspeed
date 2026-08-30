const express = require('express');
const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const tjkScrape = require('./lib/tjk-scrape');
const app = express();
const PORT = 3023;

let browser = null;

// SQLite Veritabanı Bağlantısı
const db = new sqlite3.Database('atlar.db');

// Tabloları oluştur (yoksa)
db.run(`CREATE TABLE IF NOT EXISTS at_verileri (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    veri TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS hesaplama_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    veri TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS karsilastirma_kayitlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hipodrom TEXT,
    hipodrom_id TEXT,
    tarih TEXT,
    race_count INTEGER,
    total_horses INTEGER,
    siralama_veri TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    kaynak_kayit_id INTEGER,
    kaynak_tur TEXT,
    tablo_veri TEXT,
    hesaplamalar TEXT,
    sutunlar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS yonetim_calismalari_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT,
    aciklama TEXT,
    karsilastirma_kayit_id INTEGER,
    hesaplama_kayit_id INTEGER,
    tablo_veri TEXT,
    sutun_yapisi TEXT,
    hesaplamalar TEXT,
    kayit_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS puanlama_bitis_sonuclari (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    veri TEXT NOT NULL DEFAULT '{}',
    guncelleme DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.static('public', {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Gerçek tarayıcı headers
const getBrowserHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    'Referer': 'https://www.tjk.org/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin'
});

async function getBrowserInstance() {
    if (browser) return browser;
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    const chromePaths = [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);
    for (const chromePath of chromePaths) {
        try {
            const fs = require('fs');
            if (fs.existsSync(chromePath)) {
                launchOptions.executablePath = chromePath;
                break;
            }
        } catch (_) {}
    }
    browser = await puppeteer.launch(launchOptions);
    return browser;
}

async function gotoWithHeaders(page, url) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
}

// final_mesafeler.js / kesin_mesafeler.js ile aynı: hipodrom sekmesi + bekleme
async function gotoKosuSonucSayfasi(page, url, sehirAdi) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    const hashId = url.includes('#') ? url.split('#').pop() : '';
    const baseUrl = hashId ? url.split('#')[0] : url;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    try {
        await page.waitForSelector('.gunluk-tabs', { timeout: 15000 });
    } catch (_) {}

    const sehirKey = (sehirAdi || '').split(/[\s(]/)[0].trim();
    if (sehirKey) {
        await page.evaluate((sehir) => {
            const tabs = document.querySelectorAll('.gunluk-tabs a');
            for (const tab of tabs) {
                if (tab.textContent.includes(sehir)) {
                    tab.click();
                    break;
                }
            }
        }, sehirKey);
        await new Promise(r => setTimeout(r, 5000));
    }

    if (hashId) {
        await page.evaluate((id) => {
            location.hash = id;
            const el = document.getElementById(id) || document.querySelector('[id="' + id + '"]');
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

function getPageDebugInfo() {
    const bt = document.body.innerText || '';
    const tables = document.querySelectorAll('table');
    const samples = [];
    for (let t = 0; t < Math.min(3, tables.length); t++) {
        const rows = tables[t].querySelectorAll('tbody tr');
        for (let r = 0; r < Math.min(4, rows.length); r++) {
            const cells = [...rows[r].querySelectorAll('td')].map(c => c.innerText.trim().slice(0, 35));
            if (cells.length) samples.push({ tablo: t, satir: r, hucreler: cells });
        }
    }
    const idx = bt.indexOf('Son 800 :');
    return {
        url: location.href,
        hash: location.hash,
        tabloSayisi: tables.length,
        tablesorterSayisi: document.querySelectorAll('table.tablesorter').length,
        metinUzunluk: bt.length,
        son800Var: idx !== -1,
        son800Ornek: idx !== -1 ? bt.substring(idx, idx + 90) : null,
        ornekSatirlar: samples
    };
}

async function parseKosuDetayFromPage(page, atIsmi) {
    return page.evaluate((atIsmi) => {
        function normName(value) {
            return (value || '').split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
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
                    const idx = Array.prototype.indexOf.call(tables, table);
                    if (idx !== -1) return idx;
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
                if (siraCell && siraCell.innerText.trim() === '1' && dereceCell) {
                    const d = dereceCell.innerText.trim();
                    if (d && d !== '-') return d;
                }
            }
            return null;
        }
        function getSon800FromNode(node) {
            if (!node) return null;
            let el = node;
            for (let i = 0; i < 6 && el; i++) {
                const txt = el.innerText || '';
                const idx = txt.indexOf('Son 800 :');
                if (idx !== -1) {
                    const chunk = txt.substring(idx, idx + 100);
                    let match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)\s*[\-\–]\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) return match[1] + '|' + match[2];
                    match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) return match[1] + '|';
                }
                el = el.parentElement;
            }
            return null;
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

        if (atTabloIndex !== -1) {
            const tablo = tables[atTabloIndex];
            birinciDerece = getBirinciFromTable(tablo);
            son800 = getSon800FromNode(tablo);

            for (const row of tablo.querySelectorAll('tbody tr')) {
                const dereceCell = row.querySelector('td:nth-child(10)');
                const atIsimCell = row.querySelector('td:nth-child(3)');
                if (atIsimCell && namesMatch(atIsimCell.innerText, atIsmi) && dereceCell) {
                    atDereceDetay = dereceCell.innerText.trim();
                }
            }
        }

        if (!son800) {
            const bodyText = document.body.innerText;
            const son800Index = bodyText.indexOf('Son 800 :');
            if (son800Index !== -1) {
                const chunk = bodyText.substring(son800Index, son800Index + 100);
                let match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)\s*[\-\–]\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                if (match) son800 = match[1] + '|' + match[2];
                else {
                    match = chunk.match(/Son\s*800\s*:\s*(\d+[\.\:]\d+[\.\:]\d+)/);
                    if (match) son800 = match[1] + '|';
                }
            }
        }

        return { birinciDerece, atDereceDetay, son800 };
    }, atIsmi);
}

app.get('/api/scrape-test', async (req, res) => {
    const atId = req.query.id || '99891';
    const adi = (req.query.adi || 'SANCAKALAN').trim();
    const start = Date.now();
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await gotoWithHeaders(page, 'https://www.tjk.org/');
        const atUrl = `https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=${atId}`;
        await gotoWithHeaders(page, atUrl);
        const kosular = await page.evaluate(() => {
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            if (!kosuTablosu) return [];
            const rows = kosuTablosu.querySelectorAll('tbody tr');
            const data = [];
            for (const row of rows) {
                const tarihCell = row.querySelector('td:first-child');
                const tarihLink = tarihCell?.querySelector('a');
                if (!tarihLink?.href) continue;
                const sehirCell = row.querySelector('td:nth-child(2)');
                data.push({
                    tarih: tarihCell.innerText.trim(),
                    tarihLink: tarihLink.href,
                    sehir: sehirCell ? sehirCell.innerText.trim() : ''
                });
            }
            return data.slice(0, 1);
        });
        if (!kosular.length) {
            await page.close();
            return res.json({ success: false, error: 'Koşu listesi bulunamadı', ms: Date.now() - start });
        }
        const kosu = kosular[0];
        const tablesLoaded = await gotoKosuSonucSayfasi(page, kosu.tarihLink, kosu.sehir);
        const detay = await parseKosuDetayFromPage(page, adi);
        const debug = req.query.debug === '1'
            ? await page.evaluate(getPageDebugInfo)
            : undefined;
        await page.close();
        const son800Parts = detay.son800 ? detay.son800.split('|') : [];
        res.json({
            success: true,
            ms: Date.now() - start,
            kosu: kosu.tarih,
            kosuLink: kosu.tarihLink,
            tablolarYuklendi: tablesLoaded,
            birinci_derece: detay.birinciDerece || '-',
            son800_bir: son800Parts[0] || '-',
            son800_iki: son800Parts[1] || '-',
            tamam: !!(detay.birinciDerece && detay.son800),
            ...(debug ? { debug } : {})
        });
    } catch (e) {
        res.json({ success: false, error: e.message, ms: Date.now() - start });
    }
});

// API 1: Hipodromları getir
app.get('/api/hipodromlar', async (req, res) => {
    const tarih = req.query.tarih;
    console.log('📡 Hipodrom isteği - Tarih:', tarih);
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        const url = `https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=${tarih}&Era=today`;
        await gotoWithHeaders(page, url);
        
        const hipodromlar = await page.evaluate(() => {
            const tabs = document.querySelectorAll('ul.gunluk-tabs > li > a');
            const result = [];
            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const id = tab.getAttribute('data-sehir-id');
                let name = tab.innerText.trim();
                name = name.replace(/\(\d+\.\s*Y\.G\.\)/, '').trim();
                if (id && name) {
                    result.push({ id: id, name: name });
                }
            }
            return result;
        });
        
        await page.close();
        res.json({ success: true, hipodromlar: hipodromlar });
        
    } catch (error) {
        console.error('Hipodrom hatası:', error.message);
        res.json({ success: false, error: error.message, hipodromlar: [] });
    }
});

// API 2: Yarış programını getir (MESAFE BİLGİSİ - DÜZELTİLMİŞ, FİLTRE KALDIRILMIŞ)
app.get('/api/yaris-programi', async (req, res) => {
    const sehirId = req.query.sehir;
    const sehirAdi = req.query.sehirAdi;
    const tarih = req.query.tarih;
    
    console.log('📡 Yarış programı isteği - Şehir:', sehirId, sehirAdi, 'Tarih:', tarih);
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisProgrami?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=today`;
        await gotoWithHeaders(page, url);
        
        // Tüm sayfa metnini al
        const pageText = await page.evaluate(() => document.body.innerText);
        
        // Koşu bloklarını ayır — başlık meta (kcins, kategori, pist)
        const kosuBloklari = pageText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
        const mesafeler = {};
        const raceMeta = {};
        
        for (let blok of kosuBloklari) {
            const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
            if (!kosuMatch) continue;
            
            const kosuNo = parseInt(kosuMatch[1]);
            const headerLine = blok.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+(?:Kum|Çim|Sentetik)[^\n]*)/i);
            const meta = tjkScrape.parseRaceHeaderLine(headerLine ? headerLine[1] : '');
            
            if (meta.mesafe) {
                mesafeler[kosuNo] = { mesafe: meta.mesafe, pist: meta.pist_kosu || '?' };
                raceMeta[kosuNo] = meta;
                console.log(`✅ Koşu ${kosuNo}: ${meta.mesafe} ${meta.pist_kosu} · ${meta.kcins_kosu} · ${meta.kategori}`);
            } else {
                const match = blok.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/);
                if (match) {
                    mesafeler[kosuNo] = { mesafe: match[1], pist: match[2] };
                    raceMeta[kosuNo] = { mesafe: match[1], pist_kosu: match[2] };
                } else {
                    mesafeler[kosuNo] = { mesafe: '?', pist: '?' };
                }
            }
        }
        
        const yarisProgrami = await page.evaluate((mesafeler, raceMeta) => {
            function isKosmazText(text) {
                if (!text) return false;
                return /\(\s*koşmaz\s*\)/i.test(text) || /\(\s*kosmaz\s*\)/i.test(text)
                    || /\(\s*koşm\s*\)/i.test(text) || /\(\s*çekildi\s*\)/i.test(text);
            }
            function parseNameCell(nameCell) {
                const fullText = nameCell?.innerText || '';
                const link = nameCell?.querySelector('a');
                const name = (link?.innerText || fullText).replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
                const taki = [...(nameCell?.querySelectorAll('span.aciklamaFancy') || [])]
                    .map(s => s.innerText.trim()).filter(Boolean).join(' ');
                return { name, taki, kosmaz: isKosmazText(fullText) };
            }
            const races = [];
            const tables = document.querySelectorAll('table.tablesorter');
            
            for (let idx = 0; idx < tables.length; idx++) {
                const table = tables[idx];
                const horses = [];
                const rows = table.querySelectorAll('tbody tr');
                
                for (let j = 0; j < rows.length; j++) {
                    const row = rows[j];
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 5) continue;
                    
                    const horseNo = cells[1]?.innerText?.trim();
                    if (!horseNo || !/^\d+$/.test(horseNo)) continue;
                    
                    const nameCell = cells[2];
                    const link = nameCell?.querySelector('a');
                    let atId = '';
                    let parsed = parseNameCell(nameCell);
                    let horseName = parsed.name;
                    
                    if (link) {
                        const href = link.getAttribute('href');
                        if (href) {
                            const match = href.match(/AtId=(\d+)/);
                            if (match) atId = match[1];
                        }
                        if (link.innerText?.trim()) horseName = link.innerText.trim().replace(/\(\s*koşmaz\s*\)/gi, '').trim();
                    }
                    
                    if (!horseName || horseName === 'At İsmi' || parsed.kosmaz || isKosmazText(horseName)) continue;
                    
                    horses.push({
                        no: horseNo,
                        name: horseName,
                        atId: atId,
                        yas: cells[3]?.innerText?.trim() || '',
                        siklet: cells[5]?.innerText?.trim() || '',
                        hp: cells[10]?.innerText?.trim() || '',
                        taki: parsed.taki || ''
                    });
                }
                
                if (horses.length > 0) {
                    const raceNo = (races.length + 1).toString();
                    const rn = parseInt(raceNo, 10);
                    const meta = raceMeta[raceNo] || raceMeta[rn] || {};
                    races.push({
                        raceNo: raceNo,
                        horseCount: horses.length,
                        horses: horses,
                        mesafe: mesafeler[raceNo]?.mesafe || meta.mesafe || '?',
                        pist: mesafeler[raceNo]?.pist || meta.pist_kosu || '?',
                        kcins_kosu: meta.kcins_kosu || '',
                        kategori: meta.kategori || ''
                    });
                }
            }
            return races;
        }, mesafeler, raceMeta);
        
        await page.close();
        
        const totalHorses = yarisProgrami.reduce((s, r) => s + r.horses.length, 0);
        
        res.json({
            success: true,
            data: yarisProgrami,
            totalRaces: yarisProgrami.length,
            totalHorses: totalHorses,
            hipodrom: sehirAdi,
            tarih: tarih,
            mesafeler: mesafeler
        });
        
    } catch (error) {
        console.error('Yarış programı hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 3: Atın TÜM VERİLERİNİ getir (genişletilmiş alanlar + retry)
app.get('/api/at-tum-veriler', async (req, res) => {
    const atId = req.query.id;
    const adiParam = (req.query.adi || '').trim();
    
    console.log('📡 At tüm veriler isteği - ID:', atId);
    
    if (!atId) {
        return res.json({ success: false, error: 'At ID gerekli' });
    }
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        const result = await tjkScrape.fetchAtKosularFromPage(page, atId, adiParam, {
            maxKosu: 7,
            maxAllKosu: Number(req.query.maxAllKosu) || 40,
            fetchAllFieldSizes: req.query.allFieldSizes !== '0',
            maxRetry: Number(req.query.retry) || 1
        });
        
        await page.close();
        res.json(result);
        
    } catch (error) {
        console.error('At tüm veriler hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 4: Karşılaştırma için koşu sonuçlarını getir
app.get('/api/karsilastirma-sonuclari', async (req, res) => {
    const sehirId = req.query.sehirId || '5';
    const sehirAdi = req.query.sehirAdi || 'Ankara';
    const tarih = req.query.tarih;
    
    console.log('📡 Karşılaştırma isteği - Şehir:', sehirId, sehirAdi, 'Tarih:', tarih);
    
    if (!tarih) {
        return res.json({ success: false, error: 'Tarih gerekli' });
    }
    
    try {
        const browserInstance = await getBrowserInstance();
        const page = await browserInstance.newPage();
        const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisSonuclari?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=lastWeek`;
        await gotoWithHeaders(page, url);
        
        const sonuclar = await page.evaluate(() => {
            const tables = document.querySelectorAll("table.tablesorter");
            const raceResults = [];
            
            for (let t = 0; t < tables.length; t++) {
                const table = tables[t];
                const rows = table.querySelectorAll("tbody tr");
                const horses = [];
                
                for (let row of rows) {
                    const siraCell = row.querySelector("td:nth-child(2)");
                    const sira = siraCell ? siraCell.innerText.trim() : null;
                    
                    if (!sira || isNaN(parseInt(sira))) continue;
                    
                    const atIsimCell = row.querySelector("td:nth-child(3)");
                    let atIsmi = atIsimCell ? atIsimCell.innerText.trim() : null;
                    let atId = "-";
                    
                    const atLink = atIsimCell ? atIsimCell.querySelector("a") : null;
                    if (atLink && atLink.href) {
                        const match = atLink.href.match(/QueryParameter_AtId=(\d+)/);
                        if (match) atId = match[1];
                        if (atLink.innerText.trim()) atIsmi = atLink.innerText.trim();
                    }
                    
                    if (sira && atIsmi) {
                        horses.push({ sira: sira, atIsmi: atIsmi, atId: atId });
                    }
                }
                
                if (horses.length > 0) {
                    raceResults.push({
                        raceNo: (raceResults.length + 1).toString(),
                        horseCount: horses.length,
                        horses: horses
                    });
                }
            }
            
            return raceResults;
        });
        
        await page.close();
        
        res.json({
            success: true,
            data: sonuclar,
            totalRaces: sonuclar.length,
            hipodrom: sehirAdi,
            tarih: tarih
        });
        
    } catch (error) {
        console.error('Karşılaştırma hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 5: Verileri KAYDET (SQLite) ve diğer API'ler
app.post('/api/kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 Kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);
    
    const sql = `INSERT INTO at_verileri (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [veri.hipodrom, veri.hipodromId, veri.tarih, veri.raceCount, veri.totalHorses, JSON.stringify(veri.data)];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ Kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM at_verileri ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

app.get('/api/kayit/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM at_verileri WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.veri = JSON.parse(row.veri);
            res.json({ success: true, kayit: row });
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

// ==================== HESAPLAMA KAYITLARI API'leri ====================

app.post('/api/hesaplama-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 HESAPLAMA kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);
    
    const sql = `INSERT INTO hesaplama_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, veri) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [veri.hipodrom, veri.hipodromId, veri.tarih, veri.raceCount, veri.totalHorses, JSON.stringify(veri.data)];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ HESAPLAMA kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/hesaplama-kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM hesaplama_kayitlari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

app.get('/api/hesaplama-kayit/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM hesaplama_kayitlari WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.veri = JSON.parse(row.veri);
            res.json({ success: true, kayit: row });
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

/** hesaplama_kayitlari — veri güncelle (PUANLAMA TEST çıkan at kalıcı silme) */
app.put('/api/hesaplama-kayit/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    if (!body.veri || !Array.isArray(body.veri)) {
        res.json({ success: false, error: 'veri (dizi) gerekli' });
        return;
    }
    const raceCount = body.race_count != null ? body.race_count : body.raceCount;
    const totalHorses = body.total_horses != null ? body.total_horses : body.totalHorses;
    const sql = `UPDATE hesaplama_kayitlari SET veri = ?, race_count = ?, total_horses = ? WHERE id = ?`;
    db.run(sql, [JSON.stringify(body.veri), raceCount, totalHorses, id], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
            return;
        }
        console.log('💾 Hesaplama kaydı güncellendi ID:', id, '·', totalHorses, 'at');
        res.json({ success: true, id, race_count: raceCount, total_horses: totalHorses });
    });
});

function parsePuanlamaStore(raw) {
    if (!raw || typeof raw !== 'object') return { bitis: {}, cikan: {} };
    const isLegacy = !raw.bitis && !raw.cikan
        && Object.values(raw).some(v => typeof v === 'number');
    if (isLegacy) return { bitis: raw, cikan: {} };
    return { bitis: raw.bitis || {}, cikan: raw.cikan || {} };
}

function purgePuanlamaKayitId(kayitId, callback) {
    const prefix = String(kayitId) + '|';
    db.get(`SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1`, [], (err, row) => {
        if (err) return callback(err);
        if (!row?.veri) return callback(null);
        let store;
        try {
            store = parsePuanlamaStore(JSON.parse(row.veri));
        } catch (_) {
            return callback(null);
        }
        const bitis = {};
        for (const [k, v] of Object.entries(store.bitis)) {
            if (!k.startsWith(prefix)) bitis[k] = v;
        }
        const cikan = {};
        for (const [k, v] of Object.entries(store.cikan)) {
            if (!k.startsWith(prefix)) cikan[k] = v;
        }
        const veri = JSON.stringify({ bitis, cikan });
        const sql = `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`;
        db.run(sql, [veri], callback);
    });
}

app.delete('/api/hesaplama-kayit/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM hesaplama_kayitlari WHERE id = ?`, [id], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
            return;
        }
        purgePuanlamaKayitId(id, (errP) => {
            if (errP) {
                res.json({ success: false, error: errP.message });
                return;
            }
            console.log('🗑 Hesaplama kaydı silindi ID:', id);
            res.json({ success: true, deletedId: parseInt(id, 10) });
        });
    });
});

app.post('/api/hesaplama-kayitlar-temizle', (req, res) => {
    if (req.body?.onay !== 'SIL') {
        res.json({ success: false, error: 'Onay için body.onay = "SIL" gerekli' });
        return;
    }
    db.serialize(() => {
        db.run(`DELETE FROM hesaplama_kayitlari`, [], function(errH) {
            if (errH) {
                res.json({ success: false, error: errH.message });
                return;
            }
            const deletedHesaplama = this.changes;
            db.run(`DELETE FROM puanlama_bitis_sonuclari`, [], function(errP) {
                if (errP) {
                    res.json({ success: false, error: errP.message });
                    return;
                }
                console.log('🗑 Tüm hesaplama kayıtları silindi:', deletedHesaplama);
                res.json({
                    success: true,
                    deletedHesaplama,
                    deletedPuanlama: this.changes
                });
            });
        });
    });
});

// ==================== KARŞILAŞTIRMA KAYITLARI API'leri ====================

app.post('/api/karsilastirma-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 KARŞILAŞTIRMA kayıt isteği - Hipodrom:', veri.hipodrom, 'Tarih:', veri.tarih);
    
    const sql = `INSERT INTO karsilastirma_kayitlari (hipodrom, hipodrom_id, tarih, race_count, total_horses, siralama_veri, hesaplamalar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.hipodrom, veri.hipodromId, veri.tarih, veri.raceCount, veri.totalHorses, JSON.stringify(veri.siralama_veri), JSON.stringify(veri.hesaplamalar || {})];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ KARŞILAŞTIRMA kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/karsilastirma-kayitlar', (req, res) => {
    db.all(`SELECT id, hipodrom, tarih, race_count, total_horses, kayit_tarihi FROM karsilastirma_kayitlari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, kayitlar: rows });
        }
    });
});

app.get('/api/karsilastirma-kayit/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM karsilastirma_kayitlari WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.siralama_veri = JSON.parse(row.siralama_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, kayit: row });
        } else {
            res.json({ success: false, error: 'Kayıt bulunamadı' });
        }
    });
});

// ==================== YÖNETİM ÇALIŞMALARI API'leri ====================

app.post('/api/yonetim-calisma-kaydet', (req, res) => {
    const veri = req.body;
    console.log('💾 YÖNETİM çalışması kayıt isteği - Ad:', veri.ad);
    
    const sql = `INSERT INTO yonetim_calismalari (ad, aciklama, kaynak_kayit_id, kaynak_tur, tablo_veri, hesaplamalar, sutunlar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.ad, veri.aciklama, veri.kaynak_kayit_id, veri.kaynak_tur, JSON.stringify(veri.tablo_veri), JSON.stringify(veri.hesaplamalar), veri.sutunlar];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ YÖNETİM çalışması kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/yonetim-calismalari', (req, res) => {
    db.all(`SELECT id, ad, aciklama, kaynak_kayit_id, kaynak_tur, kayit_tarihi FROM yonetim_calismalari ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, calismalar: rows });
        }
    });
});

app.get('/api/yonetim-calisma/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM yonetim_calismalari WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.tablo_veri = JSON.parse(row.tablo_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, calisma: row });
        } else {
            res.json({ success: false, error: 'Çalışma bulunamadı' });
        }
    });
});

// ==================== YÖNETİM ÇALIŞMALARI V2 API'leri ====================

app.post('/api/yonetim-calisma-kaydet-v2', (req, res) => {
    const veri = req.body;
    console.log('💾 YÖNETİM çalışması v2 kayıt isteği - Ad:', veri.ad);
    
    const sql = `INSERT INTO yonetim_calismalari_v2 (ad, aciklama, karsilastirma_kayit_id, hesaplama_kayit_id, tablo_veri, sutun_yapisi, hesaplamalar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.ad, veri.aciklama, veri.karsilastirma_kayit_id, veri.hesaplama_kayit_id, JSON.stringify(veri.tablo_veri), veri.sutun_yapisi, veri.hesaplamalar];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('❌ Kayıt hatası:', err.message);
            res.json({ success: false, error: err.message });
        } else {
            console.log('✅ YÖNETİM çalışması v2 kayıt başarılı! ID:', this.lastID);
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.get('/api/yonetim-calismalari-v2', (req, res) => {
    db.all(`SELECT id, ad, aciklama, karsilastirma_kayit_id, hesaplama_kayit_id, kayit_tarihi FROM yonetim_calismalari_v2 ORDER BY kayit_tarihi DESC`, [], (err, rows) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true, calismalar: rows });
        }
    });
});

app.get('/api/yonetim-calisma-v2/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM yonetim_calismalari_v2 WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
        } else if (row) {
            row.tablo_veri = JSON.parse(row.tablo_veri);
            row.hesaplamalar = JSON.parse(row.hesaplamalar);
            res.json({ success: true, calisma: row });
        } else {
            res.json({ success: false, error: 'Çalışma bulunamadı' });
        }
    });
});

// ==================== PUANLAMA BİTİŞ SONUÇLARI API ====================

app.get('/api/puanlama-bitis-sonuclari', (req, res) => {
    db.get(`SELECT veri, guncelleme FROM puanlama_bitis_sonuclari WHERE id = 1`, [], (err, row) => {
        if (err) {
            res.json({ success: false, error: err.message });
            return;
        }
        let parsed = {};
        if (row?.veri) {
            try { parsed = JSON.parse(row.veri); } catch (_) { parsed = {}; }
        }
        const isLegacy = parsed && !parsed.bitis && !parsed.cikan
            && Object.values(parsed).some(v => typeof v === 'number');
        const sonuclar = isLegacy ? parsed : (parsed.bitis || {});
        const cikanAtlar = isLegacy ? {} : (parsed.cikan || {});
        res.json({ success: true, sonuclar, cikanAtlar, guncelleme: row?.guncelleme || null });
    });
});

app.post('/api/puanlama-bitis-sonuclari', (req, res) => {
    const sonuclar = req.body?.sonuclar;
    const cikanAtlar = req.body?.cikanAtlar;
    if (!sonuclar || typeof sonuclar !== 'object') {
        res.json({ success: false, error: 'Geçersiz veri' });
        return;
    }
    const wrapped = {
        bitis: sonuclar,
        cikan: cikanAtlar && typeof cikanAtlar === 'object' ? cikanAtlar : {}
    };
    const veri = JSON.stringify(wrapped);
    const sql = `INSERT INTO puanlama_bitis_sonuclari (id, veri, guncelleme) VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET veri = excluded.veri, guncelleme = CURRENT_TIMESTAMP`;
    db.run(sql, [veri], function(err) {
        if (err) {
            res.json({ success: false, error: err.message });
        } else {
            res.json({
                success: true,
                count: Object.keys(sonuclar).length,
                cikanRaceCount: Object.keys(wrapped.cikan).length
            });
        }
    });
});

// ==================== EXCEL EXPORT API ====================
const XLSX = require('xlsx');

app.post('/api/excel-export', (req, res) => {
    try {
        const { data, baslik } = req.body;
        
        if (!data || data.length === 0) {
            return res.json({ success: false, error: 'Veri yok' });
        }
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = data[0].map(() => ({ wch: 15 }));
        XLSX.utils.book_append_sheet(wb, ws, baslik || '88ATSPEED');
        
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        const base64 = excelBuffer.toString('base64');
        
        res.json({ success: true, url: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}` });
        
    } catch (error) {
        console.error('Excel hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ==================== PROSES KAPATMA ====================

process.on('SIGINT', async () => {
    if (browser) await browser.close();
    db.close();
    console.log('\n👋 Program kapatıldı. Veritabanı kapatıldı.');
    process.exit();
});

// ==================== SUNUCU BAŞLAT ====================

app.listen(PORT, async () => {
    console.log(`\n✅ 88ATSPEED Sunucusu çalışıyor:`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`💾 SQLite veritabanı hazır: atlar.db`);
    console.log(`🐎 API\'ler aktif!\n`);
    console.log(`🔒 Stealth plugin ile 403 engeli aşıldı.\n`);
});

module.exports = { db };