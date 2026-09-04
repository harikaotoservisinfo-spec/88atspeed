#!/usr/bin/env node
/**
 * Deney: Her koşudan sırayla 1 at seç → kosular[] çek → meta kapsam raporu
 *
 *   node scripts/test-fetch-one-per-race.js --kayit 112
 *   node scripts/test-fetch-one-per-race.js --kayit 112 --pick 2 --max-races 3
 *   node scripts/test-fetch-one-per-race.js --sehir İzmir --sehir-id 2 --tarih 29/08/2026
 */
const fs = require('fs');
const path = require('path');
const { openDb, dbGet, parseCliArgs } = require('./ptest-terminal-lib');
const {
    launchBrowser,
    gotoWithHeaders,
    fetchAtKosularFromPage,
    evaluateKosuKayit
} = require('../lib/tjk-scrape');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    pick: argVal('--pick') != null ? Number(argVal('--pick')) : 0,
    maxRaces: argVal('--max-races') ? Number(argVal('--max-races')) : null,
    maxKosu: Number(argVal('--max-kosu') || '7'),
    maxAllKosu: argVal('--max-all-kosu') ? Number(argVal('--max-all-kosu')) : 7,
    delayMs: Number(argVal('--delay')) || 600,
    quick: args.includes('--quick'),
    allFieldSizes: args.includes('--all-field-sizes'),
    sehir: argVal('--sehir') || '',
    sehirId: argVal('--sehir-id') || '',
    tarih: argVal('--tarih') || ''
};

const TAB_FIELDS = [
    { key: 'sira', label: 'sira' },
    { key: 'at_sayisi', label: 'at_sayisi', num: true },
    { key: 'sehir', label: 'sehir' },
    { key: 'kcins_kosu', label: 'kcins_kosu' },
    { key: 'taki', label: 'taki' },
    { key: 'pist', label: 'pist' },
    { key: 'hp', label: 'hp' },
    { key: 'siklet', label: 'siklet' }
];

function filled(v) {
    return v != null && v !== '' && v !== '-' && v !== '—';
}

function pct(n, d) {
    return d ? Math.round(1000 * n / d) / 10 : 0;
}

function parseKayitVeri(raw) {
    try {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(d) ? d : null;
    } catch (_) {
        return null;
    }
}

function pickHorse(race, pickIndex) {
    const horses = (race.horses || []).filter(h => h.atId && h.name);
    if (!horses.length) return null;
    const idx = Math.min(Math.max(0, pickIndex), horses.length - 1);
    return horses[idx];
}

function loadRacesFromKayit(db, kayitId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [kayitId], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            const races = parseKayitVeri(row.veri);
            resolve({ meta: { kayitId: row.id, hipodrom: row.hipodrom, tarih: row.tarih }, races });
        });
    });
}

async function loadRacesFromLiveProgram(page) {
    const url = 'https://www.tjk.org/TR/YarisSever/Info/Sehir/GunlukYarisProgrami?SehirId=' + cli.sehirId
        + '&QueryParameter_Tarih=' + encodeURIComponent(cli.tarih)
        + '&SehirAdi=' + encodeURIComponent(cli.sehir) + '&Era=today';
    await gotoWithHeaders(page, url);

    const pageText = await page.evaluate(() => document.body.innerText);
    const kosuBloklari = pageText.split(/\n(?=\d+\.\s*Koşu\s+\d+\.\d+)/);
    const mesafeler = {};
    const raceMeta = {};

    for (const blok of kosuBloklari) {
        const kosuMatch = blok.match(/^(\d+)\.\s*Koşu\s+\d+\.\d+/);
        if (!kosuMatch) continue;
        const kosuNo = parseInt(kosuMatch[1], 10);
        const headerLine = blok.match(/\d+\.\s*Koşu\s+\d+\.\d+\s*\n([^\n]+(?:Kum|Çim|Sentetik)[^\n]*)/i);
        const metaLine = headerLine ? headerLine[1] : '';
        const mesafeMatch = metaLine.match(/(\d{3,4})/);
        const pistMatch = metaLine.match(/(Kum|Çim|Sentetik)/i);
        mesafeler[kosuNo] = { mesafe: mesafeMatch ? mesafeMatch[1] : '?', pist: pistMatch ? pistMatch[1] : '?' };
        raceMeta[kosuNo] = { kcins_kosu: metaLine.slice(0, 60), pist: pistMatch ? pistMatch[1] : '' };
    }

    const races = await page.evaluate((mesafeler, raceMeta) => {
        function isKosmazText(text) {
            if (!text) return false;
            return /\(\s*koşmaz\s*\)/i.test(text) || /\(\s*kosmaz\s*\)/i.test(text)
                || /\(\s*çekildi\s*\)/i.test(text);
        }
        function parseNameCell(nameCell) {
            const fullText = nameCell?.innerText || '';
            const link = nameCell?.querySelector('a');
            const name = (link?.innerText || fullText).replace(/\(\s*koşmaz\s*\)/gi, '').replace(/\s+/g, ' ').trim();
            return { name, kosmaz: isKosmazText(fullText) };
        }
        const out = [];
        const tables = document.querySelectorAll('table.tablesorter');
        for (let idx = 0; idx < tables.length; idx++) {
            const horses = [];
            for (const row of tables[idx].querySelectorAll('tbody tr')) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 5) continue;
                const horseNo = cells[1]?.innerText?.trim();
                if (!horseNo || !/^\d+$/.test(horseNo)) continue;
                const nameCell = cells[2];
                const parsed = parseNameCell(nameCell);
                if (!parsed.name || parsed.kosmaz) continue;
                const link = nameCell?.querySelector('a');
                let atId = '';
                const href = link?.getAttribute('href') || '';
                const m = href.match(/AtId=(\d+)/);
                if (m) atId = m[1];
                horses.push({
                    no: horseNo,
                    name: parsed.name,
                    atId,
                    siklet: cells[5]?.innerText?.trim() || '',
                    hp: cells[10]?.innerText?.trim() || ''
                });
            }
            if (horses.length) {
                const raceNo = String(out.length + 1);
                const rn = parseInt(raceNo, 10);
                const meta = raceMeta[raceNo] || raceMeta[rn] || {};
                out.push({
                    raceNo,
                    horses,
                    mesafe: mesafeler[raceNo]?.mesafe || '?',
                    pist: mesafeler[raceNo]?.pist || meta.pist || '?',
                    kcins_kosu: meta.kcins_kosu || ''
                });
            }
        }
        return out;
    }, mesafeler, raceMeta);

    return {
        meta: { hipodrom: cli.sehir, tarih: cli.tarih, source: 'live' },
        races
    };
}

function auditKosular(kosular) {
    const counts = Object.fromEntries(TAB_FIELDS.map(f => [f.key, 0]));
    for (const k of kosular) {
        for (const f of TAB_FIELDS) {
            if (f.num ? Number(k[f.key]) > 0 : filled(k[f.key])) counts[f.key]++;
        }
    }
    return counts;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Deney: Koşu koşu — her koşudan 1 at sırayla çek            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('pick index=' + cli.pick + ' · maxKosu=' + cli.maxKosu
        + ' · delay=' + cli.delayMs + 'ms'
        + (cli.quick ? ' · quick (sadece ilk ' + cli.maxKosu + ' koşu detay)'
            : ' · maxAllKosu=' + cli.maxAllKosu + ' (GETİR ile aynı limit)') + '\n');

    let program;
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        if (cli.filterKayit) {
            const db = openDb(cli.dbPath);
            program = await loadRacesFromKayit(db, cli.filterKayit);
            db.close();
            if (!program?.races?.length) {
                console.error('Kayıt bulunamadı veya koşu yok: #' + cli.filterKayit);
                process.exit(1);
            }
            console.log('Kaynak: DB kayit #' + program.meta.kayitId + ' · ' + program.meta.hipodrom + ' · ' + program.meta.tarih);
        } else if (cli.sehirId && cli.sehir && cli.tarih) {
            program = await loadRacesFromLiveProgram(page);
            console.log('Kaynak: canlı program · ' + program.meta.hipodrom + ' · ' + program.meta.tarih);
        } else {
            console.error(' --kayit ID  veya  --sehir --sehir-id --tarih  gerekli');
            process.exit(1);
        }

        let races = program.races;
        if (cli.maxRaces) races = races.slice(0, cli.maxRaces);
        console.log('Koşu sayısı: ' + races.length + '\n');

        const results = [];
        let totalKosu = 0;
        const grandCounts = Object.fromEntries(TAB_FIELDS.map(f => [f.key, 0]));

        for (let ri = 0; ri < races.length; ri++) {
            const race = races[ri];
            const horse = pickHorse(race, cli.pick);
            const raceLabel = 'K' + race.raceNo + (race.mesafe ? ' · ' + race.mesafe + 'm ' + (race.pist || '') : '');

            if (!horse) {
                console.log('── ' + raceLabel + ' ──');
                console.log('  ✗ at seçilemedi (atId yok)\n');
                results.push({ raceNo: race.raceNo, ok: false, reason: 'at_yok' });
                continue;
            }

            console.log('── ' + raceLabel + ' ──');
            console.log('  At #' + horse.no + ' ' + horse.name + ' (atId=' + horse.atId + ') çekiliyor...');
            if (cli.allFieldSizes) {
                console.log('  (ilk ' + cli.maxKosu + ' koşu tam detay + at_sayisi ek, max ' + cli.maxAllKosu + ' — ~2-3 dk/at)');
            } else {
                console.log('  (son ' + cli.maxKosu + ' koşu tam detay — ~1 dk/at)');
            }

            const res = await fetchAtKosularFromPage(page, horse.atId, horse.name, {
                maxKosu: cli.maxKosu,
                maxAllKosu: cli.maxAllKosu,
                maxRetry: 1,
                fetchAllFieldSizes: cli.allFieldSizes,
                onProgress: cli.verbose ? (msg) => console.log('    … ' + msg) : null
            });

            if (!res.success) {
                console.log('  ✗ fetch hatası: ' + (res.error || 'bilinmiyor') + '\n');
                results.push({ raceNo: race.raceNo, horse, ok: false, reason: res.error });
                if (ri < races.length - 1) await sleep(cli.delayMs);
                continue;
            }

            const kosular = res.kosular || [];
            const counts = auditKosular(kosular);
            totalKosu += kosular.length;
            for (const f of TAB_FIELDS) grandCounts[f.key] += counts[f.key];

            const tam = res.quality?.tam || 0;
            const kritik = res.quality?.kritik || 0;
            console.log('  ✓ ' + kosular.length + ' koşu · tam=' + tam + ' kritik=' + kritik);
            for (const f of TAB_FIELDS) {
                const ok = counts[f.key] === kosular.length && kosular.length > 0;
                console.log('    ' + (ok ? '✓' : '△') + ' ' + f.label.padEnd(12)
                    + counts[f.key] + '/' + kosular.length
                    + (kosular.length ? ' (' + pct(counts[f.key], kosular.length) + '%)' : ''));
            }

            const sample = kosular[0];
            if (sample) {
                const q = evaluateKosuKayit(sample);
                console.log('  Son koşu örnek: ' + sample.tarih + ' · S' + sample.sira
                    + ' · fs=' + (sample.at_sayisi || '—')
                    + ' · sk=' + (sample.siklet || '—')
                    + ' · kalite=' + q.status);
            }
            console.log('');

            results.push({
                raceNo: race.raceNo,
                horse,
                ok: true,
                kosuCount: kosular.length,
                counts,
                quality: res.quality
            });

            if (ri < races.length - 1) await sleep(cli.delayMs);
        }

        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  ÖZET — koşu başına 1 at                                    ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        const okRaces = results.filter(r => r.ok).length;
        console.log('Başarılı koşu     : ' + okRaces + '/' + races.length);
        console.log('Toplam çekilen koşu kaydı: ' + totalKosu);
        console.log('');
        console.log('Tüm atların birleşik meta doluluk:');
        for (const f of TAB_FIELDS) {
            const ok = pct(grandCounts[f.key], totalKosu) >= 95;
            console.log('  ' + (ok ? '✓' : '△') + ' ' + f.label.padEnd(12)
                + grandCounts[f.key] + '/' + totalKosu
                + ' (' + pct(grandCounts[f.key], totalKosu) + '%)');
        }

        const allFsOk = totalKosu > 0 && grandCounts.at_sayisi === totalKosu;
        console.log('');
        if (allFsOk) {
            console.log('✓ Deney başarılı — koşu koşu tek at çekimi tüm meta alanlarını dolduruyor.');
            console.log('  GETİR\'de de aynı /api/at-tum-veriler endpoint\'i kullanılıyor.');
        } else if (okRaces === races.length) {
            console.log('△ Fetch tamamlandı; bazı alanlarda kısmi eksiklik var (TJK kaynağı veya retry).');
        } else {
            console.log('✗ Bazı koşularda at çekilemedi — atId veya TJK erişimini kontrol edin.');
        }
    } finally {
        await page.close();
        await browser.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
