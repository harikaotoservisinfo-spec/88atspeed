#!/usr/bin/env node
/**
 * TJK'dan çekilen verileri terminalde listele — şema, DB örnekleri, canlı fetch
 *
 *   node scripts/list-tjk-fetch-data.js --db atlar.db
 *   node scripts/list-tjk-fetch-data.js --db atlar.db --kayit 131 --race 6
 *   node scripts/list-tjk-fetch-data.js --live --at-id 114236 --adi "AT ADI"
 *   node scripts/list-tjk-fetch-data.js --raw --at-id 114236
 */
const http = require('http');
const path = require('path');
const { openDb, dbAll, dbGet } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    atId: argVal('--at-id'),
    adi: argVal('--adi') || '',
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    live: args.includes('--live'),
    raw: args.includes('--raw'),
    apiBase: argVal('--api') || 'http://127.0.0.1:3023',
    sample: Number(argVal('--sample')) || 5
};

const FETCHED_FIELDS = [
    { key: 'tarih', kaynak: 'AtKosuBilgileri td:1', aciklama: 'Koşu tarihi' },
    { key: 'sehir', kaynak: 'AtKosuBilgileri td:2', aciklama: 'Hipodrom' },
    { key: 'mesafe', kaynak: 'AtKosuBilgileri td:3', aciklama: 'Mesafe (m)' },
    { key: 'pist', kaynak: 'AtKosuBilgileri td:4 + koşu başlığı', aciklama: 'Kum / Çim / Sentetik' },
    { key: 'sira', kaynak: 'AtKosuBilgileri td:5', aciklama: 'Bitiş sırası' },
    { key: 'at_derece', kaynak: 'Sonuç td:10', aciklama: 'At derecesi' },
    { key: 'birinci_derece', kaynak: 'Sonuç sıra=1 td:10', aciklama: '1. derece' },
    { key: 'son800_bir', kaynak: 'Son 800 footer', aciklama: 'Son 800m 1.' },
    { key: 'son800_iki', kaynak: 'Son 800 footer', aciklama: 'Son 800m 2.' },
    { key: 'siklet', kaynak: 'AtKosuBilgileri td:7', aciklama: 'Sıklet' },
    { key: 'grup', kaynak: 'AtKosuBilgileri td:12', aciklama: 'Grup (3İ vb.)' },
    { key: 'kcins', kaynak: 'AtKosuBilgileri td:14', aciklama: 'Koşu cinsi (Handikap 15 vb.)' },
    { key: 'hp', kaynak: 'AtKosuBilgileri td:17 + sonuç td:16', aciklama: 'Handikap puanı' },
    { key: 'taki', kaynak: 'td:8 + span.aciklamaFancy', aciklama: 'KG DB SK vb.' },
    { key: 'yas', kaynak: 'Sonuç td:4', aciklama: '3y k e vb.' },
    { key: 'kcins_kosu', kaynak: 'Koşu başlığı', aciklama: 'Maiden/DHÖ vb.' },
    { key: 'kategori', kaynak: 'Koşu başlığı', aciklama: '3 Yaşlı Araplar vb.' },
    { key: 'pist_kosu', kaynak: 'Koşu başlığı', aciklama: '1200 Çim → Çim' }
];

const TJK_ANA_TABLO_ATLANAN = [
    { col: 4, muhtemel: 'Pist türü / koşu tipi (çekilmiyor)' },
    { col: 7, muhtemel: 'Jokey / ek bilgi (çekilmiyor)' },
    { col: 8, muhtemel: 'Ek sütun (çekilmiyor)' },
    { col: '9+', muhtemel: 'Diğer sütunlar (çekilmiyor)' }
];

const GEREKLI_DERINLIK = ['son800_bir', 'at_derece', 'birinci_derece'];
const GEREKLI_TEST = ['mesafe', 'sehir', 'sira', 'tarih'];

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }
function pad(s, n) { return String(s).padEnd(n); }

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('JSON parse: ' + body.slice(0, 200))); }
            });
        }).on('error', reject);
    });
}

function printSchema() {
    hr('1. TJK ÇEKİM AKIŞI (/api/at-tum-veriler)');
    console.log('  Adım 1: AtKosuBilgileri?QueryParameter_AtId=<atId>');
    console.log('          → tablesorter tablosundan koşu listesi (tüm satırlar okunur)');
    console.log('  Adım 2: Son 7 koşu için tarihLink → GünlükYarisSonuclari sayfası');
    console.log('          → hipodrom sekmesi tıklanır, hash scroll');
    console.log('  Adım 3: Sonuç tablosundan at_derece, birinci_derece, son800 çekilir');
    console.log('  Limit:  Son 7 koşu · koşu başına ~500ms bekleme');

    sub('Kaydedilen alanlar (kosular[] her eleman)');
    for (const f of FETCHED_FIELDS) {
        console.log('  ' + pad(f.key, 16) + ' ← ' + f.kaynak);
        console.log('    ' + f.aciklama);
    }

    sub('Ana tabloda OKUNMAYAN sütunlar');
    for (const c of TJK_ANA_TABLO_ATLANAN) {
        console.log('  td:nth-child(' + c.col + ') → ' + c.muhtemel);
    }

    sub('TJK\'dan ÇEKİLMEYEN ama sistemde hesaplanan');
    console.log('  TEST1, TEST2, TEST3, TEST·SIRA, T1×DR, T8Δ, FFΔ, 800Δ·7, ORAN vb.');
    console.log('  → Bunlar kosular[] ham verisinden formula-engine ile türetilir');
    console.log('  → Ham veri için minimum: mesafe + at_derece + birinci_derece + son800_bir/iki');
}

async function scanDb() {
    hr('2. DB\'DEKİ kosular[] İSTATİSTİĞİ');
    const db = openDb(cli.dbPath);
    try {
        const rows = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
        let totalKosu = 0;
        let totalHorse = 0;
        let emptyKosular = 0;
        const fieldStats = {};
        for (const f of FETCHED_FIELDS) fieldStats[f.key] = { ok: 0, dash: 0, empty: 0 };

        const samples = [];

        for (const row of rows) {
            if (cli.kayitId && row.id !== cli.kayitId) continue;
            let races;
            try { races = JSON.parse(row.veri || '[]'); } catch (_) { continue; }
            for (let ri = 0; ri < races.length; ri++) {
                const race = races[ri];
                const rNo = race.raceNo || (ri + 1);
                if (cli.raceNo && rNo !== cli.raceNo) continue;
                for (const h of race.horses || []) {
                    totalHorse++;
                    const kosular = h.kosular || [];
                    if (!kosular.length) {
                        emptyKosular++;
                        if (samples.length < cli.sample && h.atId) {
                            samples.push({ type: 'bos', kayit: row.id, race: rNo, no: h.no, name: h.name, atId: h.atId });
                        }
                        continue;
                    }
                    for (const k of kosular) {
                        totalKosu++;
                        for (const f of FETCHED_FIELDS) {
                            const v = k[f.key];
                            if (v == null || v === '') fieldStats[f.key].empty++;
                            else if (v === '-') fieldStats[f.key].dash++;
                            else fieldStats[f.key].ok++;
                        }
                    }
                    if (samples.filter(s => s.type === 'dolu').length < cli.sample) {
                        samples.push({
                            type: 'dolu',
                            kayit: row.id,
                            race: rNo,
                            no: h.no,
                            name: h.name,
                            atId: h.atId,
                            kosular
                        });
                    }
                }
            }
        }

        console.log('  Kayıt: ' + rows.length + ' · taranan at: ' + totalHorse + ' · kosular satırı: ' + totalKosu);
        console.log('  kosular[]=0: ' + emptyKosular + ' at');
        if (cli.kayitId) console.log('  Filtre: kayit#' + cli.kayitId + (cli.raceNo ? ' K' + cli.raceNo : ''));

        sub('Alan doluluk oranı (tüm kosular[] satırları)');
        for (const f of FETCHED_FIELDS) {
            const s = fieldStats[f.key];
            const tot = s.ok + s.dash + s.empty;
            const pct = tot ? ((s.ok / tot) * 100).toFixed(1) : '0';
            console.log('  ' + pad(f.key, 16) + ' dolu: ' + pad(s.ok, 6) + '  "-": ' + pad(s.dash, 5)
                + '  boş: ' + pad(s.empty, 5) + '  → %' + pct + ' dolu');
        }

        sub('Örnek kayıtlar');
        for (const s of samples.slice(0, cli.sample)) {
            if (s.type === 'bos') {
                console.log('  [BOŞ] kayit#' + s.kayit + ' K' + s.race + ' #' + s.no + ' ' + s.name + ' atId=' + s.atId);
            } else {
                console.log('  [DOLU] kayit#' + s.kayit + ' K' + s.race + ' #' + s.no + ' ' + s.name
                    + ' atId=' + s.atId + ' · ' + s.kosular.length + ' koşu');
                for (let i = 0; i < Math.min(3, s.kosular.length); i++) {
                    const k = s.kosular[i];
                    console.log('    [' + i + '] ' + [k.tarih, k.sehir, k.mesafe + 'm', 'S' + k.sira,
                        'at=' + (k.at_derece || '-'), '1=' + (k.birinci_derece || '-'),
                        'S800-1=' + (k.son800_bir || '-'), 'S800-2=' + (k.son800_iki || '-')].join(' · '));
                }
                if (s.kosular.length > 3) console.log('    … +' + (s.kosular.length - 3) + ' koşu daha');
            }
        }
    } finally {
        db.close();
    }
}

function printKosuTable(kosular, atAdi) {
    sub('Çekilen kosular[] (' + kosular.length + ' koşu)');
    console.log('  ' + pad('#', 3) + pad('tarih', 12) + pad('sehir', 12) + pad('mesafe', 8)
        + pad('sira', 5) + pad('at_derece', 12) + pad('birinci', 12) + pad('son800_1', 12) + 'son800_2');
    kosular.forEach((k, i) => {
        console.log('  ' + pad(i + 1, 3) + pad(k.tarih || '-', 12) + pad((k.sehir || '-').slice(0, 11), 12)
            + pad(k.mesafe || '-', 8) + pad(k.sira || '-', 5) + pad(k.at_derece || '-', 12)
            + pad(k.birinci_derece || '-', 12) + pad(k.son800_bir || '-', 12) + (k.son800_iki || '-'));
    });

    sub('Derinlik hesabı için yeterlilik');
    for (let i = 0; i < kosular.length; i++) {
        const k = kosular[i];
        const miss = [];
        for (const f of GEREKLI_DERINLIK) {
            if (!k[f] || k[f] === '-') miss.push(f);
        }
        const ok = miss.length === 0;
        console.log('  Koşu ' + (i + 1) + ' (' + (k.tarih || '?') + '): '
            + (ok ? '✓ derinlik OK' : '✗ eksik: ' + miss.join(', ')));
    }
}

async function liveFetch() {
    if (!cli.atId) {
        console.error('--live veya --raw için --at-id gerekli');
        process.exit(1);
    }
    hr('3. CANLI TJK FETCH (' + cli.apiBase + ')');
    const url = cli.apiBase + '/api/at-tum-veriler?id=' + encodeURIComponent(cli.atId)
        + '&adi=' + encodeURIComponent(cli.adi);
    console.log('  GET ' + url);
    try {
        const data = await fetchJson(url);
        console.log('  success: ' + data.success + ' · atAdi: ' + (data.atAdi || '—') + ' · atId: ' + (data.atId || cli.atId));
        if (data.error) console.log('  error: ' + data.error);
        if (!data.kosular?.length) {
            console.log('  ⚠ kosular[] boş döndü');
            return;
        }
        printKosuTable(data.kosular, data.atAdi);
    } catch (e) {
        console.log('  ✗ API erişilemedi: ' + e.message);
        console.log('  → Sunucuda app.js çalışıyor olmalı: node app.js (port 3023)');
        console.log('  → veya: node scripts/list-tjk-fetch-data.js --raw --at-id ' + cli.atId);
    }
}

async function rawFetch() {
    if (!cli.atId) {
        console.error('--raw için --at-id gerekli');
        process.exit(1);
    }
    hr('3. TJK HAM TABLO (AtKosuBilgileri — tüm sütunlar)');
    let puppeteer;
    try { puppeteer = require('puppeteer'); } catch (_) {
        console.log('  puppeteer yok — --live ile API kullanın');
        process.exit(1);
    }
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR']
    };
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
        try {
            const fs = require('fs');
            if (fs.existsSync(p)) { launchOptions.executablePath = p; break; }
        } catch (_) {}
    }
    const browser = await puppeteer.launch(launchOptions);
    try {
        const page = await browser.newPage();
        const atUrl = 'https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=' + cli.atId;
        console.log('  URL: ' + atUrl);
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'tr-TR,tr;q=0.9'
        });
        await page.goto(atUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        const raw = await page.evaluate(() => {
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            if (!kosuTablosu) return { error: 'Tablo bulunamadı', tableCount: tables.length };

            const headers = [...kosuTablosu.querySelectorAll('thead th')].map((th, i) => ({
                index: i + 1,
                text: th.innerText.trim()
            }));
            const rows = [];
            for (const row of kosuTablosu.querySelectorAll('tbody tr')) {
                const cells = [...row.querySelectorAll('td')].map((td, i) => ({
                    index: i + 1,
                    text: td.innerText.trim().slice(0, 50)
                }));
                if (cells.length) rows.push(cells);
                if (rows.length >= 7) break;
            }
            const atIsmi = document.querySelector('h2.tableTitle')?.innerText?.trim() || '';
            return { atIsmi, tableCount: tables.length, headers, rows };
        });

        if (raw.error) {
            console.log('  ✗ ' + raw.error + ' (tablo sayısı: ' + raw.tableCount + ')');
            return;
        }
        console.log('  At: ' + raw.atIsmi + ' · tablo: ' + raw.tableCount);

        sub('TJK sütun başlıkları (AtKosuBilgileri)');
        for (const h of raw.headers) {
            const cekiliyor = [1, 2, 3, 5, 6].includes(h.index);
            console.log('  td:' + pad(h.index, 2) + ' ' + pad(h.text.slice(0, 30), 32)
                + (cekiliyor ? ' ← ÇEKİLİYOR' : ' ← ATLANIYOR'));
        }

        sub('İlk ' + raw.rows.length + ' koşu ham satır');
        for (let ri = 0; ri < raw.rows.length; ri++) {
            console.log('  Koşu ' + (ri + 1) + ':');
            for (const c of raw.rows[ri]) {
                const cek = [1, 2, 3, 5, 6].includes(c.index) ? '✓' : '·';
                console.log('    ' + cek + ' td:' + pad(c.index, 2) + ' ' + c.text);
            }
        }

        sub('Bizim API\'nin döndürdüğü vs TJK ham');
        console.log('  Çekilen: tarih(1), sehir(2), mesafe(3), sira(5), at_derece(6 ana tablo)');
        console.log('  + sonuç sayfası: birinci_derece, at_derece detay, son800_bir, son800_iki');
        console.log('  Atlanan sütunlar: ' + raw.headers.filter(h => ![1, 2, 3, 5, 6].includes(h.index)).map(h => h.text).join(', '));
    } finally {
        await browser.close();
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  TJK veri çekimi — alan listesi                             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);

    printSchema();
    await scanDb();

    if (cli.live) await liveFetch();
    else if (cli.raw) await rawFetch();
    else {
        hr('3. CANLI FETCH (opsiyonel)');
        console.log('  node scripts/list-tjk-fetch-data.js --live --at-id <ID> --adi "AT ADI"');
        console.log('  node scripts/list-tjk-fetch-data.js --raw --at-id <ID>   (TJK ham sütunlar)');
    }

    hr('4. ÖZET');
    console.log('  Her at için max 7 koşu çekiliyor.');
    console.log('  Derinlik (S800/T1/T1DR) için son800_bir + at_derece + birinci_derece şart.');
    console.log('  TEST/ORAN/renk göstergeleri kosular[] sonrası hesaplanır — TJK\'dan gelmez.');
    console.log('\nOK');
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
