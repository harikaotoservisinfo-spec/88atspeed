const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3023;
const HOST = process.env.HOST || '0.0.0.0';
const API_USER = process.env.API_USER || '';
const API_PASS = process.env.API_PASS || '';

app.set('trust proxy', 1);
puppeteer.use(StealthPlugin());

let browser = null;
const db = new sqlite3.Database('atlar.db');

function safeJsonParse(str, fallback = null) {
    try { return JSON.parse(str); } catch (_) { return fallback; }
}

function requireAuth(req, res, next) {
    if (!API_USER || !API_PASS) return next();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="88ATSPEED"');
        return res.status(401).json({ success: false, error: 'Kimlik doğrulama gerekli' });
    }
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (user === API_USER && pass === API_PASS) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="88ATSPEED"');
    return res.status(401).json({ success: false, error: 'Geçersiz kimlik bilgileri' });
}

const APP_VERSION = '2026.08.20-scraper-v3';

async function setupPage(page) {
    await page.setViewport({ width: 1920, height: 1080 });
}

async function withPage(fn) {
    const browserInstance = await getBrowserInstance();
    const page = await browserInstance.newPage();
    try {
        await setupPage(page);
        return await fn(page);
    } finally {
        await page.close().catch(() => {});
    }
}

async function shutdown() {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    db.close();
    console.log('\n👋 Program kapatıldı.');
    process.exit(0);
}

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

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', version: APP_VERSION }));
app.use('/api', requireAuth);

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
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
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

function normalizeHorseName(name) {
    if (!name) return '';
    return name
        .split('(')[0]
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I');
}

async function gotoWithHeaders(page, url, options = {}) {
    const waitMs = options.waitMs ?? 2000;
    const waitUntil = options.waitUntil ?? 'domcontentloaded';
    await page.setExtraHTTPHeaders(getBrowserHeaders());
    await page.goto(url, { waitUntil, timeout: options.timeout ?? 60000 });
    if (options.waitSelector) {
        try {
            await page.waitForSelector(options.waitSelector, { timeout: options.selectorTimeout ?? 20000 });
        } catch (_) {}
    }
    if (waitMs > 0) {
        await new Promise(r => setTimeout(r, waitMs));
    }
}

async function waitForRaceResults(page, atIsmi) {
    const normalized = normalizeHorseName(atIsmi);
    try {
        await page.waitForFunction((horseName) => {
            const tables = document.querySelectorAll('table');
            for (const tablo of tables) {
                const rows = tablo.querySelectorAll('tbody tr');
                for (const row of rows) {
                    const nameCell = row.querySelector('td:nth-child(3)');
                    const dereceCell = row.querySelector('td:nth-child(10)');
                    if (!nameCell || !dereceCell) continue;
                    const cellName = nameCell.innerText.split('(')[0].trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
                    if (horseName && cellName.includes(horseName)) {
                        return !!dereceCell.innerText.trim();
                    }
                }
                if (!horseName) {
                    for (const row of rows) {
                        const siraCell = row.querySelector('td:nth-child(2)');
                        const dereceCell = row.querySelector('td:nth-child(10)');
                        if (siraCell?.innerText.trim() === '1' && dereceCell?.innerText.trim()) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }, { timeout: 12000 }, normalized);
    } catch (_) {}
}

async function scrollToHashAnchor(page) {
    try {
        await page.evaluate(() => {
            if (!location.hash) return;
            const target = document.querySelector(location.hash);
            if (target) target.scrollIntoView({ block: 'start' });
        });
        await new Promise(r => setTimeout(r, 500));
    } catch (_) {}
}

async function fetchKosuDetay(page, kosu, atIsmi) {
    let lastDetay = { birinciDerece: '-', atDerece: kosu.at_derece_ana_tablo, son800Bir: '-', son800Iki: '-' };
    const waitSteps = [3500, 5500];

    for (let attempt = 0; attempt < waitSteps.length; attempt++) {
        try {
            await gotoWithHeaders(page, kosu.tarihLink, {
                waitUntil: 'domcontentloaded',
                waitMs: waitSteps[attempt],
                waitSelector: 'table tbody tr',
                selectorTimeout: 10000,
                timeout: 30000
            });
            await scrollToHashAnchor(page);
            await waitForRaceResults(page, atIsmi);

            const detay = await page.evaluate((horseName) => {
                const normalize = (value) => (value || '')
                    .split('(')[0]
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLocaleUpperCase('tr-TR')
                    .replace(/İ/g, 'I');

                const target = normalize(horseName);
                const tables = document.querySelectorAll('table');
                let birinciDerece = null;
                let atDereceDetay = null;
                let atTabloIndex = -1;

                for (let t = 0; t < tables.length; t++) {
                    const rows = tables[t].querySelectorAll('tbody tr');
                    for (const row of rows) {
                        const siraCell = row.querySelector('td:nth-child(2)');
                        const nameCell = row.querySelector('td:nth-child(3)');
                        const dereceCell = row.querySelector('td:nth-child(10)');
                        if (!dereceCell) continue;

                        if (siraCell && siraCell.innerText.trim() === '1' && !birinciDerece) {
                            birinciDerece = dereceCell.innerText.trim();
                        }

                        if (target && nameCell) {
                            const cellName = normalize(nameCell.innerText);
                            if (cellName.includes(target) || target.includes(cellName)) {
                                atDereceDetay = dereceCell.innerText.trim();
                                atTabloIndex = t;
                            }
                        }
                    }
                    if (atTabloIndex !== -1) break;
                }

                if (atTabloIndex === -1) {
                    for (let t = 0; t < tables.length; t++) {
                        const rows = tables[t].querySelectorAll('tbody tr');
                        for (const row of rows) {
                            const siraCell = row.querySelector('td:nth-child(2)');
                            const dereceCell = row.querySelector('td:nth-child(10)');
                            if (siraCell?.innerText.trim() === '1' && dereceCell?.innerText.trim()) {
                                birinciDerece = dereceCell.innerText.trim();
                                break;
                            }
                        }
                        if (birinciDerece) break;
                    }
                } else {
                    const tablo = tables[atTabloIndex];
                    const rows = tablo.querySelectorAll('tbody tr');
                    for (const row of rows) {
                        const siraCell = row.querySelector('td:nth-child(2)');
                        const dereceCell = row.querySelector('td:nth-child(10)');
                        if (siraCell?.innerText.trim() === '1' && dereceCell) {
                            birinciDerece = dereceCell.innerText.trim();
                            break;
                        }
                    }
                }

                const bodyText = document.body.innerText || '';
                let son800 = null;
                const son800Index = bodyText.indexOf('Son 800');
                if (son800Index !== -1) {
                    const son800Text = bodyText.substring(son800Index, son800Index + 120);
                    let match = son800Text.match(/Son\s*800\s*:?\s*(\d+[\.\:]\d+[\.\:]\d+)\s*[\-\–]\s*(\d+[\.\:]\d+[\.\:]\d+)/i);
                    if (match) {
                        son800 = match[1] + '|' + match[2];
                    } else {
                        const matchTek = son800Text.match(/Son\s*800\s*:?\s*(\d+[\.\:]\d+[\.\:]\d+)/i);
                        if (matchTek) son800 = matchTek[1] + '|';
                    }
                }

                return { birinciDerece, atDereceDetay, son800 };
            }, atIsmi);

            let birinciDerece = detay.birinciDerece || '-';
            let atDerece = kosu.at_derece_ana_tablo;
            if (detay.atDereceDetay && detay.atDereceDetay !== '-') {
                atDerece = detay.atDereceDetay;
            }
            let son800Bir = '-';
            let son800Iki = '-';
            if (detay.son800 && detay.son800 !== '-') {
                const parts = detay.son800.split('|');
                son800Bir = parts[0] || '-';
                son800Iki = parts[1] || '-';
            }

            const hasDetail = birinciDerece !== '-' || son800Bir !== '-' || (detay.atDereceDetay && detay.atDereceDetay !== '-');
            lastDetay = { birinciDerece, atDerece, son800Bir, son800Iki };
            if (hasDetail) return lastDetay;
        } catch (err) {
            console.error(`Koşu detay deneme ${attempt + 1} hatası:`, err.message);
        }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }

    return lastDetay;
}

app.get('/api/hipodromlar', async (req, res) => {
    const tarih = req.query.tarih;
    console.log('📡 Hipodrom isteği - Tarih:', tarih);
    try {
        const hipodromlar = await withPage(async (page) => {
            const url = `https://www.tjk.org/TR/YarisSever/Info/Page/GunlukYarisProgrami?QueryParameter_Tarih=${tarih}&Era=today`;
            await gotoWithHeaders(page, url);
            return page.evaluate(() => {
                const tabs = document.querySelectorAll('ul.gunluk-tabs > li > a');
                const result = [];
                for (let i = 0; i < tabs.length; i++) {
                    const tab = tabs[i];
                    const id = tab.getAttribute('data-sehir-id');
                    let name = tab.innerText.trim();
                    name = name.replace(/\(\d+\.\s*Y\.G\.\)/, '').trim();
                    if (id && name) result.push({ id, name });
                }
                return result;
            });
        });
        res.json({ success: true, hipodromlar });
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
        const result = await withPage(async (page) => {
            const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisProgrami?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=today`;
            await gotoWithHeaders(page, url);
            const pageText = await page.evaluate(() => document.body.innerText);
            const kosuBloklari = pageText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
            const mesafeler = {};
            for (let blok of kosuBloklari) {
                const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
                if (!kosuMatch) continue;
                const kosuNo = parseInt(kosuMatch[1]);
                const match = blok.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/);
                mesafeler[kosuNo] = match
                    ? { mesafe: match[1], pist: match[2] }
                    : { mesafe: '?', pist: '?' };
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
                        let atId = '', horseName = '';
                        if (link) {
                            horseName = link.innerText?.trim() || '';
                            const href = link.getAttribute('href');
                            const m = href?.match(/AtId=(\d+)/);
                            if (m) atId = m[1];
                        } else {
                            horseName = cells[2]?.innerText?.trim() || '';
                        }
                        if (horseName && horseName !== 'At İsmi') {
                            horses.push({ no: horseNo, name: horseName, atId });
                        }
                    }
                    if (horses.length > 0) {
                        const raceNo = (races.length + 1).toString();
                        races.push({
                            raceNo, horseCount: horses.length, horses,
                            mesafe: mesafeler[raceNo]?.mesafe || '?',
                            pist: mesafeler[raceNo]?.pist || '?'
                        });
                    }
                }
                return races;
            }, mesafeler);
            return { yarisProgrami, mesafeler };
        });

        const totalHorses = result.yarisProgrami.reduce((s, r) => s + r.horses.length, 0);
        res.json({
            success: true, data: result.yarisProgrami,
            totalRaces: result.yarisProgrami.length, totalHorses,
            hipodrom: sehirAdi, tarih, mesafeler: result.mesafeler
        });
    } catch (error) {
        console.error('Yarış programı hatası:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API 3: Atın TÜM VERİLERİNİ getir (DÜZELTİLMİŞ)
app.get('/api/at-tum-veriler', async (req, res) => {
    const atId = req.query.id;
    const adiParam = req.query.adi || '';
    
    console.log('📡 At tüm veriler isteği - ID:', atId);
    
    if (!atId) {
        return res.json({ success: false, error: 'At ID gerekli' });
    }
    
    try {
        const result = await withPage(async (page) => {
            await gotoWithHeaders(page, 'https://www.tjk.org/');
            const atUrl = `https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=${atId}`;
            await gotoWithHeaders(page, atUrl);

            const pageOk = await page.evaluate(() => {
                const title = document.querySelector('h2.tableTitle');
                if (!title) return false;
                const text = title.innerText.trim().toLowerCase();
                return text && !text.includes('bulunamadı');
            });
            if (!pageOk) {
                return { blocked: true, atAdi: 'Erişim Engellendi', kosular: [] };
            }

            const atIsmi = await page.evaluate(() => {
                const el = document.querySelector('h2.tableTitle');
                return el ? el.innerText.trim() : 'Bilinmeyen At';
            });
            const atIsmiFinal = adiParam || atIsmi;
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
            const detay = await fetchKosuDetay(page, kosu, atIsmiFinal);
            
            sonuclar.push({
                tarih: kosu.tarih,
                sehir: kosu.sehir,
                mesafe: kosu.mesafe,
                sira: kosu.sira,
                at_derece: detay.atDerece,
                birinci_derece: detay.birinciDerece,
                son800_bir: detay.son800Bir,
                son800_iki: detay.son800Iki
            });
            
            await new Promise(r => setTimeout(r, 400));
        }

            return { blocked: false, atAdi: atIsmiFinal, kosular: sonuclar };
        });

        if (result.blocked) {
            return res.json({ success: true, atAdi: result.atAdi, atId, kosular: [] });
        }
        res.json({ success: true, atAdi: result.atAdi, atId, kosular: result.kosular });
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
        const sonuclar = await withPage(async (page) => {
            const url = `https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisSonuclari?SehirId=${sehirId}&QueryParameter_Tarih=${tarih}&SehirAdi=${encodeURIComponent(sehirAdi)}&Era=lastWeek`;
            await gotoWithHeaders(page, url);
            return page.evaluate(() => {
                const tables = document.querySelectorAll('table.tablesorter');
                const raceResults = [];
                for (let t = 0; t < tables.length; t++) {
                    const table = tables[t];
                    const rows = table.querySelectorAll('tbody tr');
                    const horses = [];
                    for (let row of rows) {
                        const siraCell = row.querySelector('td:nth-child(2)');
                        const sira = siraCell ? siraCell.innerText.trim() : null;
                        if (!sira || isNaN(parseInt(sira))) continue;
                        const atIsimCell = row.querySelector('td:nth-child(3)');
                        let atIsmi = atIsimCell ? atIsimCell.innerText.trim() : null;
                        let atId = '-';
                        const atLink = atIsimCell ? atIsimCell.querySelector('a') : null;
                        if (atLink?.href) {
                            const m = atLink.href.match(/QueryParameter_AtId=(\d+)/);
                            if (m) atId = m[1];
                            if (atLink.innerText.trim()) atIsmi = atLink.innerText.trim();
                        }
                        if (sira && atIsmi) horses.push({ sira, atIsmi, atId });
                    }
                    if (horses.length > 0) {
                        raceResults.push({
                            raceNo: (raceResults.length + 1).toString(),
                            horseCount: horses.length, horses
                        });
                    }
                }
                return raceResults;
            });
        });
        res.json({ success: true, data: sonuclar, totalRaces: sonuclar.length, hipodrom: sehirAdi, tarih });
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
            row.veri = safeJsonParse(row.veri, []);
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
            row.veri = safeJsonParse(row.veri, []);
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
            row.siralama_veri = safeJsonParse(row.siralama_veri, []);
            row.hesaplamalar = safeJsonParse(row.hesaplamalar, {});
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
            row.tablo_veri = safeJsonParse(row.tablo_veri, []);
            row.hesaplamalar = safeJsonParse(row.hesaplamalar, {});
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
    const hesaplamalarData = JSON.stringify({
        formulas: safeJsonParse(veri.hesaplamalar, veri.hesaplamalar) || {},
        cellValues: veri.cellValues || {}
    });
    const sql = `INSERT INTO yonetim_calismalari_v2 (ad, aciklama, karsilastirma_kayit_id, hesaplama_kayit_id, tablo_veri, sutun_yapisi, hesaplamalar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [veri.ad, veri.aciklama, veri.karsilastirma_kayit_id, veri.hesaplama_kayit_id, JSON.stringify(veri.tablo_veri), veri.sutun_yapisi, hesaplamalarData];
    
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
            row.tablo_veri = safeJsonParse(row.tablo_veri, []);
            const hesapData = safeJsonParse(row.hesaplamalar, {});
            row.hesaplamalar = hesapData.formulas || hesapData;
            row.cellValues = hesapData.cellValues || {};
            res.json({ success: true, calisma: row });
        } else {
            res.json({ success: false, error: 'Çalışma bulunamadı' });
        }
    });
});

// ==================== KAYIT SİLME API'leri ====================

function makeDeleteHandler(table) {
    return (req, res) => {
        db.run(`DELETE FROM ${table} WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.json({ success: false, error: err.message });
            if (this.changes === 0) return res.json({ success: false, error: 'Kayıt bulunamadı' });
            res.json({ success: true, deleted: this.changes });
        });
    };
}

app.delete('/api/hesaplama-kayit/:id', makeDeleteHandler('hesaplama_kayitlari'));
app.delete('/api/karsilastirma-kayit/:id', makeDeleteHandler('karsilastirma_kayitlari'));
app.delete('/api/yonetim-calisma-v2/:id', makeDeleteHandler('yonetim_calismalari_v2'));

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

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ==================== SUNUCU BAŞLAT ====================

app.listen(PORT, HOST, async () => {
    console.log(`\n✅ 88ATSPEED Sunucusu çalışıyor:`);
    console.log(`📍 http://${HOST}:${PORT}`);
    console.log(`💾 SQLite veritabanı hazır: atlar.db`);
    console.log(`🐎 API'ler aktif!\n`);
    console.log(`🔒 Stealth plugin ile 403 engeli aşıldı.\n`);
});

module.exports = { db };