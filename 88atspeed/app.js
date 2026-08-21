const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = 3023;

// Stealth plugin ile bot tespitini engelle
puppeteer.use(StealthPlugin());

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

app.use(express.static('public'));
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
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--lang=tr-TR',
            '--window-size=1920,1080'
        ]
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

async function waitForRaceTables(page, hashId) {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await page.waitForFunction(() => {
                const rows = document.querySelectorAll('table.tablesorter tbody tr');
                if (rows.length === 0) return false;
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    for (let i = cells.length - 1; i >= 0; i--) {
                        const t = cells[i].innerText.trim();
                        if (/^\d[\.\:]\d{2}[\.\:]\d{2}$/.test(t)) return true;
                    }
                }
                return false;
            }, { timeout: 20000, polling: 500 });
            return true;
        } catch (_) {
            if (hashId) {
                await page.evaluate((id) => {
                    location.hash = '';
                    void document.body.offsetHeight;
                    location.hash = id;
                    const el = document.getElementById(id);
                    if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
                }, hashId);
            } else if (attempt < 3) {
                await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
            }
            await new Promise(r => setTimeout(r, 3000 + attempt * 2000));
        }
    }
    return false;
}

async function gotoKosuDetay(page, url, extraWaitMs) {
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    const hashId = url.includes('#') ? url.split('#').pop() : '';
    const baseUrl = hashId ? url.split('#')[0] : url;
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    if (hashId) {
        await page.evaluate((id) => {
            location.hash = id;
            const el = document.getElementById(id) || document.querySelector('[id="' + id + '"]');
            if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
        }, hashId);
    }
    await waitForRaceTables(page, hashId);
    await new Promise(r => setTimeout(r, extraWaitMs || 3000));
    const loaded = await page.evaluate(() => document.querySelectorAll('table.tablesorter tbody tr').length > 0);
    return loaded;
}

async function waitForKosuDetayReady(page, atIsmi) {
    try {
        await page.waitForFunction((horseName) => {
            const norm = (value) => (value || '').split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
            const target = norm(horseName);
            const timeRe = /^\d[\.\:]\d{2}[\.\:]\d{2}$/;
            const findRowDerece = (row) => {
                const cells = row.querySelectorAll('td');
                for (let i = cells.length - 1; i >= 0; i--) {
                    const t = cells[i].innerText.trim();
                    if (timeRe.test(t)) return t;
                }
                return '';
            };
            for (const tablo of document.querySelectorAll('table.tablesorter')) {
                for (const row of tablo.querySelectorAll('tbody tr')) {
                    const derece = findRowDerece(row);
                    if (!timeRe.test(derece)) continue;
                    const nameCell = row.querySelector('td:nth-child(3)');
                    if (target && nameCell && norm(nameCell.innerText).includes(target)) return true;
                    const siraCell = row.querySelector('td:nth-child(2)');
                    if (siraCell && siraCell.innerText.trim() === '1') return true;
                }
            }
            return false;
        }, { timeout: 45000, polling: 500 }, atIsmi);
    } catch (_) {}
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
    const idx = bt.indexOf('Son 800');
    const tablesorter = document.querySelectorAll('table.tablesorter').length;
    return {
        url: location.href,
        hash: location.hash,
        tabloSayisi: tables.length,
        tablesorterSayisi: tablesorter,
        metinUzunluk: bt.length,
        son800Var: idx !== -1,
        son800Ornek: idx !== -1 ? bt.substring(idx, idx + 90) : null,
        ornekSatirlar: samples
    };
}

function parseKosuDetayFromPage(atIsmi) {
    function findRowDerece(row) {
        const cells = row.querySelectorAll('td');
        for (let i = cells.length - 1; i >= 0; i--) {
            const t = cells[i].innerText.trim();
            if (/^\d[\.\:]\d{2}[\.\:]\d{2}$/.test(t)) return t;
        }
        const col10 = row.querySelector('td:nth-child(10)');
        return col10 ? col10.innerText.trim() : null;
    }

    function findRowSira(row) {
        const c2 = row.querySelector('td:nth-child(2)');
        if (c2 && /^\d+$/.test(c2.innerText.trim())) return c2.innerText.trim();
        const c1 = row.querySelector('td:nth-child(1)');
        if (c1 && /^\d+$/.test(c1.innerText.trim())) return c1.innerText.trim();
        return null;
    }

    function findRowName(row) {
        const c3 = row.querySelector('td:nth-child(3)');
        if (c3) return c3.innerText.trim();
        const cells = row.querySelectorAll('td');
        for (const cell of cells) {
            const t = cell.innerText.trim();
            if (t.length > 2 && /[A-ZÇĞİÖŞÜ]/i.test(t) && !/^\d[\.\:]/.test(t)) return t;
        }
        return '';
    }

    function parseSon800(text) {
        if (!text) return null;
        const isValidSon800 = (d) => {
            const parts = d.replace(/:/g, '.').split('.');
            if (parts.length !== 3) return false;
            const [m, s, cs] = parts.map(Number);
            if ([m, s, cs].some(n => isNaN(n))) return false;
            if (s > 59 || cs > 99) return false;
            const totalCs = m * 6000 + s * 100 + cs;
            return totalCs >= 4500 && totalCs <= 15000;
        };
        const chunk = text.substring(0, 250);
        const match = chunk.match(/Son\s*800\s*:?\s*([\d\.\:]+\s*[\-\–]?\s*[\d\.\:]*)/i);
        const segment = match ? match[1] : chunk;
        const times = segment.match(/\d[\.\:]\d{2}[\.\:]\d{2}/g) || [];
        const valid = times.filter(isValidSon800);
        if (!valid.length) return null;
        if (valid.length >= 2) return valid[0] + '|' + valid[1];
        return valid[0] + '|';
    }

    function getRaceSectionText(table) {
        let node = table;
        for (let i = 0; i < 6 && node; i++) {
            const txt = node.innerText || '';
            if (/Son\s*800\s*:/i.test(txt)) return txt;
            node = node.parentElement;
        }
        return '';
    }

    const target = (atIsmi || '').split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
    const tables = document.querySelectorAll('table.tablesorter');
    let atTabloIndex = -1;
    let birinciDerece = null;
    let atDereceDetay = null;
    let son800 = null;

    const hashId = (location.hash || '').replace(/^#/, '');
    if (hashId) {
        const anchor = document.getElementById(hashId);
        if (anchor) {
            let node = anchor;
            for (let i = 0; i < 8 && node; i++) {
                const table = node.querySelector ? node.querySelector('table') : null;
                if (table) {
                    const idx = Array.prototype.indexOf.call(tables, table);
                    if (idx !== -1) atTabloIndex = idx;
                    break;
                }
                node = node.nextElementSibling || node.parentElement;
            }
        }
    }

    const scanTables = atTabloIndex !== -1 ? [atTabloIndex] : [...tables.keys()];

    for (const t of scanTables) {
        const rows = tables[t].querySelectorAll('tbody tr');
        for (const row of rows) {
            const derece = findRowDerece(row);
            if (!derece || derece === '-') continue;
            const sira = findRowSira(row);
            const name = findRowName(row);
            if (sira === '1' && !birinciDerece) birinciDerece = derece;
            if (target && name) {
                const cellName = name.split('(')[0].replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
                if (cellName.includes(target) || target.includes(cellName)) {
                    atDereceDetay = derece;
                    atTabloIndex = t;
                }
            }
        }
    }

    if (atTabloIndex !== -1) {
        const rows = tables[atTabloIndex].querySelectorAll('tbody tr');
        for (const row of rows) {
            if (findRowSira(row) === '1') {
                const d = findRowDerece(row);
                if (d) { birinciDerece = d; break; }
            }
        }
        const sectionText = getRaceSectionText(tables[atTabloIndex]);
        const son800Idx = sectionText.indexOf('Son 800');
        if (son800Idx !== -1) {
            son800 = parseSon800(sectionText.substring(son800Idx));
        }
    }

    if (!birinciDerece) {
        for (let t = 0; t < tables.length; t++) {
            const rows = tables[t].querySelectorAll('tbody tr');
            for (const row of rows) {
                if (findRowSira(row) === '1') {
                    const d = findRowDerece(row);
                    if (d) { birinciDerece = d; break; }
                }
            }
            if (birinciDerece) break;
        }
    }

    return { birinciDerece, atDereceDetay, son800 };
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
                data.push({ tarih: tarihCell.innerText.trim(), tarihLink: tarihLink.href });
            }
            return data.slice(0, 1);
        });
        if (!kosular.length) {
            await page.close();
            return res.json({ success: false, error: 'Koşu listesi bulunamadı', ms: Date.now() - start });
        }
        const kosu = kosular[0];
        const tablesLoaded = await gotoKosuDetay(page, kosu.tarihLink, 3000);
        await waitForKosuDetayReady(page, adi);
        const detay = await page.evaluate(parseKosuDetayFromPage, adi);
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
        
        // Koşu bloklarını ayır
        const kosuBloklari = pageText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
        const mesafeler = {};
        
        for (let blok of kosuBloklari) {
            // Koşu numarasını bul
            const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
            if (!kosuMatch) continue;
            
            const kosuNo = parseInt(kosuMatch[1]);
            
            // Mesafeyi bul (Çim, Kum, Sentetik)
            let mesafe = null;
            let pist = null;
            
            const match = blok.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/);
            if (match) {
                mesafe = match[1];
                pist = match[2];
            }
            
            if (mesafe) {
                mesafeler[kosuNo] = { mesafe: mesafe, pist: pist };
                console.log(`✅ Koşu ${kosuNo}: ${mesafe} ${pist}`);
            } else {
                mesafeler[kosuNo] = { mesafe: '?', pist: '?' };
                console.log(`❌ Koşu ${kosuNo}: bulunamadı`);
            }
        }
        
        const yarisProgrami = await page.evaluate((mesafeler) => {
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
                    
                    const link = cells[2]?.querySelector('a');
                    let atId = '';
                    let horseName = '';
                    
                    if (link) {
                        horseName = link.innerText?.trim() || '';
                        const href = link.getAttribute('href');
                        if (href) {
                            const match = href.match(/AtId=(\d+)/);
                            if (match) atId = match[1];
                        }
                    } else {
                        horseName = cells[2]?.innerText?.trim() || '';
                    }
                    
                    if (horseName && horseName !== 'At İsmi') {
                        horses.push({
                            no: horseNo,
                            name: horseName,
                            atId: atId
                        });
                    }
                }
                
                if (horses.length > 0) {
                    const raceNo = (races.length + 1).toString();
                    races.push({
                        raceNo: raceNo,
                        horseCount: horses.length,
                        horses: horses,
                        mesafe: mesafeler[raceNo]?.mesafe || '?',
                        pist: mesafeler[raceNo]?.pist || '?'
                    });
                }
            }
            return races;
        }, mesafeler);
        
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

// API 3: Atın TÜM VERİLERİNİ getir (DÜZELTİLMİŞ)
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
        await gotoWithHeaders(page, 'https://www.tjk.org/');
        
        // Sonra at sayfasına git
        const atUrl = `https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=${atId}`;
        await gotoWithHeaders(page, atUrl);
        
        // Sayfa yüklendi mi kontrol et
        const pageOk = await page.evaluate(() => {
            const title = document.querySelector('h2.tableTitle');
            if (!title) return false;
            const text = title.innerText.trim().toLowerCase();
            return text && !text.includes('bulunamadı');
        });
        if (!pageOk) {
            console.log(`⚠️ At ID ${atId} için sayfaya erişilemedi`);
            await page.close();
            return res.json({ success: true, atAdi: 'Erişim Engellendi', atId: atId, kosular: [] });
        }
        
        let atIsmi = await page.evaluate(() => {
            const isimElement = document.querySelector('h2.tableTitle');
            return isimElement ? isimElement.innerText.trim() : 'Bilinmeyen At';
        });
        if (adiParam) atIsmi = adiParam;
        
        // DÜZELTİLMİŞ: Koşu detaylarının olduğu ikinci tabloyu al (index 1)
        const kosular = await page.evaluate(() => {
            // Sayfadaki tüm tabloları bul
            const tables = document.querySelectorAll("table.tablesorter");
            // Koşu detayları genellikle ikinci tablodadır (index 1)
            let kosuTablosu;
            if (tables.length >= 2) {
                kosuTablosu = tables[1];
            } else if (tables.length === 1) {
                kosuTablosu = tables[0];
            } else {
                return [];
            }
            
            const rows = kosuTablosu.querySelectorAll("tbody tr");
            const data = [];
            
            for (let row of rows) {
                const tarihCell = row.querySelector("td:first-child");
                if (!tarihCell) continue;
                
                const tarihLink = tarihCell.querySelector("a");
                if (!tarihLink || !tarihLink.href) continue;
                
                const tarihText = tarihCell.innerText.trim();
                if (!tarihText.match(/\d{2}\.\d{2}\.\d{4}/)) continue;
                
                const sehirCell = row.querySelector("td:nth-child(2)");
                const mesafeCell = row.querySelector("td:nth-child(3)");
                const siraCell = row.querySelector("td:nth-child(5)");
                const dereceCell = row.querySelector("td:nth-child(6)");
                
                data.push({
                    tarih: tarihText,
                    tarihLink: tarihLink.href,
                    sehir: sehirCell ? sehirCell.innerText.trim() : "",
                    mesafe: mesafeCell ? mesafeCell.innerText.trim() : "",
                    sira: siraCell ? siraCell.innerText.trim() : "",
                    at_derece_ana_tablo: dereceCell ? dereceCell.innerText.trim() : "-"
                });
            }
            return data;
        });
        
        const son7Kosu = kosular.slice(0, 7);
        const sonuclar = [];
        
        for (let i = 0; i < son7Kosu.length; i++) {
            const kosu = son7Kosu[i];
            let birinciDerece = "-";
            let atDerece = kosu.at_derece_ana_tablo;
            let son800Bir = "-";
            let son800Iki = "-";
            
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    await gotoKosuDetay(page, kosu.tarihLink, attempt === 0 ? 4000 : 6000);
                    await waitForKosuDetayReady(page, atIsmi);
                    const detay = await page.evaluate(parseKosuDetayFromPage, atIsmi);
                    
                    birinciDerece = detay.birinciDerece || "-";
                    if (detay.atDereceDetay && detay.atDereceDetay !== "-") {
                        atDerece = detay.atDereceDetay;
                    }
                    if (detay.son800 && detay.son800 !== "-") {
                        const parts = detay.son800.split("|");
                        son800Bir = parts[0] || "-";
                        son800Iki = parts[1] || "-";
                    }
                    if (birinciDerece !== "-" || son800Bir !== "-") break;
                } catch (err) {
                    console.error('Koşu detay hatası:', kosu.tarih, err.message);
                }
            }
            
            sonuclar.push({
                tarih: kosu.tarih,
                sehir: kosu.sehir,
                mesafe: kosu.mesafe,
                sira: kosu.sira,
                at_derece: atDerece,
                birinci_derece: birinciDerece,
                son800_bir: son800Bir,
                son800_iki: son800Iki
            });
            
            await new Promise(r => setTimeout(r, 500));
        }
        
        await page.close();
        res.json({ success: true, atAdi: atIsmi, atId: atId, kosular: sonuclar });
        
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