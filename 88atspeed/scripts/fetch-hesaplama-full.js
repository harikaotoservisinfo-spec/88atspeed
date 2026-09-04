#!/usr/bin/env node
/**
 * Eski tam veri akışı: TJK program + at geçmişi (kosular[]) + hesaplama_kayitlari + vitrin
 *
 *   node scripts/fetch-hesaplama-full.js --bugun
 *   node scripts/fetch-hesaplama-full.js --tarih 04/09/2026 --hipodrom Bursa
 *   node scripts/fetch-hesaplama-full.js --bugun --tahmin
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const publicProgram = require('../lib/public-program');
const { buildPublicTahmin } = require('../lib/public-tahmin-build');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

let tarih = publicProgram.tomorrowTr();
let hipodromFilter = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tarih' && args[i + 1]) tarih = args[i + 1];
    if (args[i] === '--bugun') tarih = publicProgram.todayTr();
    if (args[i] === '--hipodrom' && args[i + 1]) hipodromFilter = args[i + 1];
}

const db = new sqlite3.Database(path.join(__dirname, '..', 'atlar.db'));

(async function main() {
    const startedAt = Date.now();
    console.log('📥 Eski format tam veri çekimi:', tarih, hipodromFilter ? ('· ' + hipodromFilter) : '');
    const result = await publicProgram.buildPublicProgram(db, tarih, {
        source: 'tjk',
        enrichKosular: true,
        onlyDomestic: true,
        publish: true,
        syncHesaplama: true,
        hipodromFilter,
        trigger: 'cli-full',
        horseDelayMs: Number(argVal('--delay')) || 600,
        maxKosu: Number(argVal('--max-kosu')) || 7
    });

    console.log('📋 Kaynak: TJK + Puppeteer kosular[]');
    const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
    console.log('⏱ Toplam süre:', elapsedMin > 0 ? (elapsedMin + ' dk') : (Math.round((Date.now() - startedAt) / 1000) + ' sn'));
    console.log('✅ Tamamlandı:', result.basarili + '/' + result.hipodromSayisi, 'hipodrom');
    if (result.kosularStats) {
        const ks = result.kosularStats;
        console.log('🐴 At geçmişi:', ks.withData + '/' + ks.total, 'geçmişli',
            '(eksik fetch:', ks.missing + ')');
        if (result.enrichDetails?.length) {
            for (const d of result.enrichDetails) {
                console.log('   ' + d.hipodrom + ': ' + d.withKosular + ' geçmişli'
                    + (d.noHistory ? ' · ' + d.noHistory + ' ilk koşu' : '')
                    + (d.stillMissing ? ' · ' + d.stillMissing + ' eksik' : ''));
            }
        }
        if (ks.missing > 0) {
            const hipArg = hipodromFilter ? (' --hipodrom ' + hipodromFilter) : '';
            const tarihArg = ' --tarih ' + tarih;
            const appRoot = path.join(__dirname, '..');
            const dbPath = path.join(appRoot, 'atlar.db');
            console.log('🔧 Eksik atları tamamlamak için (sunucuda):');
            console.log('   cd ' + appRoot + ' && node scripts/repair-missing-kosular.js --db ' + dbPath + tarihArg + hipArg + ' --fetch --apply');
        }
    }

    const failed = (result.results || []).filter((r) => !r.ok);
    if (failed.length) {
        console.warn('⚠️ Başarısız:', failed.map((f) => f.hipodrom + ' (' + f.error + ')').join(', '));
    }

    if (args.includes('--tahmin')) {
        console.log('🎯 Tahmin üretiliyor…');
        const tahmin = await buildPublicTahmin(db, tarih, {
            hipodrom: hipodromFilter || undefined,
            dbPath: path.join(__dirname, '..', 'atlar.db'),
            save: true
        });
        for (const r of tahmin.results || []) {
            console.log('  ✓', r.hipodrom, '—', r.scored + '/' + r.raceCount, 'koşu ·', r.engine);
        }
    }

    db.close();
    process.exit(result.basarili > 0 ? 0 : 1);
})().catch((err) => {
    console.error('❌', err.message);
    db.close();
    process.exit(1);
});
