#!/usr/bin/env node
/**
 * Tek hipodrom / tek koşu TJK veri çekimi testi
 *
 *   node scripts/test-tjk-race-fetch.js --sehir Ankara --sehir-id 5 --tarih 29/08/2026 --race 1
 *   node scripts/test-tjk-race-fetch.js --at-id 111738 --adi ATAERİ
 */
const path = require('path');
const {
    launchBrowser,
    parseRaceHeaderLine,
    fetchRaceSonuclari,
    fetchAtKosularFromPage,
    evaluateKosuKayit,
    KOSU_TUM_ALANLAR
} = require('../lib/tjk-scrape');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    sehir: argVal('--sehir') || 'Ankara',
    sehirId: argVal('--sehir-id') || '5',
    tarih: argVal('--tarih') || '29/08/2026',
    race: Number(argVal('--race') || '1'),
    atId: argVal('--at-id'),
    adi: argVal('--adi') || '',
    maxAt: Number(argVal('--max-at')) || 3,
    maxKosu: Number(argVal('--max-kosu')) || 3
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function pad(s, n) { return String(s ?? '—').padEnd(n); }

function printKosu(k, idx) {
    console.log('\n  [' + idx + '] ' + k.tarih + ' · ' + k.sehir + ' · ' + k.mesafe + 'm · S' + k.sira);
    for (const f of KOSU_TUM_ALANLAR) {
        const v = k[f];
        if (v && v !== '-') console.log('    ' + pad(f, 14) + v);
    }
    const q = evaluateKosuKayit(k);
    console.log('    _quality: ' + q.status + (q.criticalMissing.length ? ' · eksik: ' + q.criticalMissing.join(', ') : ''));
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  TJK koşu veri çekimi — test                                  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('Hipodrom: ' + cli.sehir + ' (id=' + cli.sehirId + ') · Tarih: ' + cli.tarih + ' · K' + cli.race);

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        hr('1. KOŞU SONUÇLARI (GünlükYarisSonuclari)');
        const race = await fetchRaceSonuclari(page, cli.sehirId, cli.sehir, cli.tarih, cli.race);
        if (race.error) {
            console.log('  ✗ ' + race.error);
            process.exit(1);
        }

        const header = parseRaceHeaderLine(race.raceHeaderLine);
        console.log('  Başlık: ' + race.raceHeaderLine);
        console.log('  kcins_kosu: ' + header.kcins_kosu);
        console.log('  kategori:   ' + header.kategori);
        console.log('  pist_kosu:  ' + header.pist_kosu + ' · mesafe: ' + header.mesafe + ' · E.İ.D.: ' + header.eid);
        console.log('  Koşan at:   ' + race.horseCount + ' (koşmaz atlar hariç)');

        console.log('\n  ' + pad('#', 4) + pad('At', 28) + pad('yas', 10) + pad('taki', 12) + pad('hp', 6) + 'derece');
        for (const h of race.horses) {
            console.log('  ' + pad(h.sira, 4) + pad(h.name.slice(0, 27), 28) + pad(h.yas, 10)
                + pad(h.taki, 12) + pad(h.hp, 6) + h.derece);
        }

        const testHorses = cli.atId
            ? race.horses.filter(h => h.atId === cli.atId)
            : race.horses.slice(0, cli.maxAt);

        if (!testHorses.length && cli.atId) {
            testHorses.push({ atId: cli.atId, name: cli.adi || cli.atId, sira: '?' });
        }

        hr('2. AT GEÇMİŞ KOŞULARI (AtKosuBilgileri + detay)');
        for (let i = 0; i < testHorses.length; i++) {
            const h = testHorses[i];
            if (!h.atId) {
                console.log('\n  #' + h.sira + ' ' + h.name + ' — atId yok, atlanıyor');
                continue;
            }
            console.log('\n── #' + h.sira + ' ' + h.name + ' (atId=' + h.atId + ') ──');
            const res = await fetchAtKosularFromPage(page, h.atId, h.name, { maxKosu: cli.maxKosu, maxRetry: 1 });
            if (!res.success) {
                console.log('  ✗ ' + (res.error || 'fetch başarısız'));
                continue;
            }
            console.log('  TJK adı: ' + res.atAdi + ' · koşu: ' + res.kosular.length);
            console.log('  Kalite: tam=' + res.quality.tam + ' kritik_eksik=' + res.quality.kritik + ' kısmi=' + res.quality.kismi);
            res.kosular.forEach((k, j) => printKosu(k, j + 1));
        }

        hr('3. ÖZET');
        console.log('  Çekilen yeni alanlar: pist, siklet, grup, kcins, hp, taki, yas, kcins_kosu, kategori, pist_kosu');
        console.log('  Koşmaz atlar sonuç tablosundan filtrelenir — DB\'ye kaydedilmez.');
        console.log('  Kritik alan boşsa (at_derece/birinci/son800_bir) otomatik 1 kez retry yapılır.');
        console.log('\nOK');
    } finally {
        await page.close();
        await browser.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
