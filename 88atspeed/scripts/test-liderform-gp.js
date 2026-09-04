#!/usr/bin/env node
/**
 * Liderform GP (@2) doğrulama — prod veya lokal test
 *
 * Kullanım:
 *   node scripts/test-liderform-gp.js --iso 2026-09-04 --hipodrom Bursa --race 1
 *   node scripts/test-liderform-gp.js --iso 2026-09-04 --hipodrom Bursa --race 1 --refresh
 */
const liderformGp = require('../lib/liderform-gp');

const BURSA_R1_EXPECTED = {
    MAMBAFOREVER: '51',
    FILIUSVENTUS: '43',
    BATTLECAT: '89',
    BEBEGIMOLDUN: '34',
    LABOMBONERA: '132',
    TRUEANGEL: '7',
    CAPGUR: '124',
    KHANOFTHEFOREST: '5',
    TANNURSTAR: '16',
    JESKO: '24',
    HEROWIND: '9'
};

function parseArgs(argv) {
    const opts = { race: '1', refresh: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--iso' && argv[i + 1]) opts.iso = argv[++i];
        else if (a === '--hipodrom' && argv[i + 1]) opts.hipodrom = argv[++i];
        else if (a === '--race' && argv[i + 1]) opts.race = argv[++i];
        else if (a === '--refresh') opts.refresh = true;
        else if (a === '--help' || a === '-h') opts.help = true;
    }
    return opts;
}

function printUsage() {
    console.log(`Kullanım: node scripts/test-liderform-gp.js --iso YYYY-MM-DD --hipodrom Bursa [--race 1] [--refresh]`);
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help || !opts.iso || !opts.hipodrom) {
        printUsage();
        process.exit(opts.help ? 0 : 1);
    }

    const t0 = Date.now();
    console.log(`→ Liderform GP test: ${opts.hipodrom} koşu ${opts.race} (${opts.iso})`);

    try {
        const result = await liderformGp.fetchGpForHipodrom({
            iso: opts.iso,
            hipodrom: opts.hipodrom,
            raceNos: [String(opts.race)],
            refresh: opts.refresh
        });

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const race = result.races?.[String(opts.race)];
        const byName = race?.byName || {};

        console.log(`✓ ${elapsed}s — ${result.raceCount} koşu, kaynak: ${result.source}`);
        if (result.fromCache) console.log(`  cache: ${result.fromCache} (${result.cacheAgeSec}s)`);
        if (result.partial) console.log(`  uyarı: kısmi sonuç`, result.errors);
        if (result.stale) console.log(`  uyarı: eski disk cache kullanıldı`);

        console.log('\nGP değerleri (at adına göre):');
        Object.entries(byName).sort((a, b) => a[0].localeCompare(b[0], 'tr')).forEach(([name, gp]) => {
            console.log(`  ${name.padEnd(22)} ${gp}`);
        });

        if (opts.hipodrom.toLocaleLowerCase('tr-TR').includes('bursa') && String(opts.race) === '1') {
            console.log('\nBursa 1. koşu referans karşılaştırması:');
            let ok = 0;
            let fail = 0;
            for (const [name, expected] of Object.entries(BURSA_R1_EXPECTED)) {
                const actual = byName[name];
                const match = String(actual) === String(expected);
                const mark = match ? '✓' : '✗';
                if (match) ok++; else fail++;
                console.log(`  ${mark} ${name}: beklenen=${expected}, gelen=${actual ?? '—'}`);
            }
            console.log(`\nSonuç: ${ok}/${ok + fail} eşleşme`);
            if (fail > 0) process.exitCode = 2;
        }
    } catch (err) {
        console.error(`✗ Hata (${((Date.now() - t0) / 1000).toFixed(1)}s):`, err.message);
        process.exitCode = 1;
    } finally {
        await liderformGp.closeLfBrowser();
    }
}

main();
