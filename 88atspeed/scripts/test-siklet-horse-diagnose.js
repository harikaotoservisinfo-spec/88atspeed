#!/usr/bin/env node
/**
 * Tek at SİKLET + at_sayisi teşhisi — DB kaydından atId bulur, TJK'dan canlı çeker
 *
 *   node scripts/test-siklet-horse-diagnose.js --db atlar.db --kayit 148 --horse "KUZEYİN KRALI"
 *   node scripts/test-siklet-horse-diagnose.js --at-id 123456 --max-kosu 7
 */
const path = require('path');
const {
    launchBrowser,
    fetchAtKosularFromPage,
    evaluateKosuKayit
} = require('../lib/tjk-scrape');
const { openDb, dbGet } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    horseName: argVal('--horse') || '',
    atId: argVal('--at-id') || '',
    maxKosu: Number(argVal('--max-kosu') || '7')
};

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

async function findAtIdFromDb() {
    if (cli.atId) return { atId: cli.atId, name: cli.horseName, source: 'cli' };
    if (!cli.kayitId || !cli.horseName) return null;

    const db = openDb(cli.dbPath);
    try {
        const row = await dbGet(db,
            'SELECT veri FROM hesaplama_kayitlari WHERE id = ?',
            [cli.kayitId]
        );
        if (!row?.veri) {
            console.error('Kayıt #' + cli.kayitId + ' bulunamadı');
            return null;
        }
        const races = JSON.parse(row.veri);
        const target = normName(cli.horseName);
        for (const race of races) {
            for (const h of race.horses || []) {
                if (normName(h.name) === target || normName(h.name).includes(target)) {
                    return {
                        atId: h.atId,
                        name: h.name,
                        programSiklet: h.siklet,
                        storedKosular: h.kosular || [],
                        raceNo: race.raceNo,
                        source: 'db-kayit-' + cli.kayitId
                    };
                }
            }
        }
        console.error('At bulunamadı: ' + cli.horseName);
        return null;
    } finally {
        db.close();
    }
}

function pad(s, n) {
    return String(s ?? '—').slice(0, n).padEnd(n);
}

async function main() {
    const info = await findAtIdFromDb();
    if (!info?.atId) {
        console.log('Kullanım: --kayit 148 --horse "KUZEYİN KRALI"  veya  --at-id <id>');
        process.exit(1);
    }

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  SİKLET teşhis — ' + pad(info.name, 40) + ' ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('atId     : ' + info.atId);
    console.log('Kaynak   : ' + info.source);
    if (info.programSiklet != null) console.log('Program sıklet (DB): ' + info.programSiklet);
    console.log('');

    if (info.storedKosular?.length) {
        console.log('── DB\'de kayıtlı kosular[] (' + info.storedKosular.length + ') ──');
        console.log(pad('tarih', 12) + pad('sira', 5) + pad('siklet', 8)
            + pad('at_sayisi', 10) + pad('durum', 12));
        for (const k of info.storedKosular.slice(0, cli.maxKosu)) {
            const fs = k.at_sayisi;
            const st = fs != null && fs !== '' && Number(fs) > 0 ? 'OK' : 'FS_EKSIK';
            console.log(pad(k.tarih, 12) + pad(k.sira, 5) + pad(k.siklet, 8)
                + pad(fs, 10) + pad(st, 12));
        }
        const fsOk = info.storedKosular.filter(k => Number(k.at_sayisi) > 0).length;
        console.log('DB at_sayisi dolu: ' + fsOk + '/' + info.storedKosular.length + '\n');
    } else {
        console.log('── DB kosular[] boş — canlı fetch gerekli ──\n');
    }

    console.log('⏳ TJK canlı fetch (max ' + cli.maxKosu + ' koşu)…\n');
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        const result = await fetchAtKosularFromPage(page, info.atId, info.name, {
            maxKosu: cli.maxKosu,
            maxRetry: 1,
            fetchAllFieldSizes: true
        });

        if (!result.success) {
            console.error('Fetch başarısız:', result.error || 'bilinmiyor');
            process.exit(1);
        }

        console.log('── TJK canlı kosular[] (' + result.kosular.length + ') ──');
        console.log(pad('tarih', 12) + pad('sira', 5) + pad('siklet', 8)
            + pad('at_sayisi', 10) + pad('cikan', 6) + pad('kalite', 10));
        let liveFs = 0;
        for (const k of result.kosular) {
            const q = evaluateKosuKayit(k);
            if (Number(k.at_sayisi) > 0) liveFs++;
            console.log(pad(k.tarih, 12) + pad(k.sira, 5) + pad(k.siklet, 8)
                + pad(k.at_sayisi, 10) + pad(k.cikan_sayisi, 6) + pad(q.status, 10));
        }
        console.log('\nCanlı at_sayisi dolu: ' + liveFs + '/' + result.kosular.length);
        console.log('Kalite: tam=' + (result.quality?.tam ?? '?')
            + ' kritik=' + (result.quality?.kritik ?? '?'));

        if (liveFs === 0) {
            console.log('\n⚠ TJK sayfasından at_sayisi hiç gelmedi — countFieldSizePageEval veya tablo yapısı sorunu.');
        } else if (info.storedKosular?.length && liveFs > 0) {
            console.log('\n✓ Canlı fetch at_sayisi alıyor — DB kaydı eski/yarım. GETİR veya repair --refresh --apply ile güncelle.');
        }
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
