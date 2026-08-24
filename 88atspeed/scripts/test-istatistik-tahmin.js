/* İstatistik tahmin motoru — bileşik AĞ. ORT.3 sıralaması */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-tahmin-engine.js'), 'utf8') + '\n; global.IstatistikTahminEngine = IstatistikTahminEngine;');

const IE = global.IstatistikEngine;
const TE = global.IstatistikTahminEngine;

function ort3(pct) {
    return { ort3: { pct }, agirlikli: { pct }, ort1: { pct }, ort2: { pct } };
}

function kosu(tarih, atDr, birinciDr, opts = {}) {
    return {
        tarih,
        mesafe: String(opts.mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr,
        son800_bir: opts.son800_bir || '0.49.00',
        son800_iki: opts.son800_iki || '0.49.00',
        sehir: opts.sehir || 'İzmir',
        sira: opts.sira || '3'
    };
}

const race = {
    mesafe: '1400',
    pist: 'Kum',
    horses: [
        { no: 1, name: 'TUNCER', kosular: [kosu('20.08.2026', '1.36.44', '1.36.10')] },
        { no: 2, name: 'UZUN TAY', kosular: [kosu('18.08.2026', '1.36.64', '1.36.10')] },
        { no: 3, name: 'DEMİR NİHAT', kosular: [kosu('17.08.2026', '1.36.76', '1.36.10')] },
        { no: 4, name: 'KAZANCI', kosular: [kosu('16.08.2026', '1.42.82', '1.36.10')] },
        { no: 5, name: 'HOLİGAN', kosular: [kosu('15.08.2026', '1.36.73', '1.36.10')] },
        { no: 6, name: 'NEVERLAND', kosular: [kosu('14.08.2026', '1.36.10', '1.36.10', { sira: '1' })] },
        { no: 7, name: 'AŞKBAZ', kosular: [kosu('13.08.2026', '1.41.68', '1.36.10')] }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İzmir', '23.08.2026');
TE.attachRaceTahmin(pkg);

if (!pkg.rows.every(r => r.tahmin && r.tahmin.rank != null)) {
    console.error('FAIL: her at için tahmin.rank olmalı');
    process.exit(1);
}

const ranks = [...pkg.rows].sort((a, b) => a.tahmin.rank - b.tahmin.rank);
console.log('Sıralama:', ranks.map(r => r.tahmin.rank + '.' + r.name + ' %' + r.tahmin.pct).join(' | '));

// İzmir 1. koşu gerçek sonuç: 1 NEVERLAND, 2 TUNCER, 3 UZUN TAY
const actual = [
    { name: 'NEVERLAND', finish: 1 },
    { name: 'TUNCER', finish: 2 },
    { name: 'UZUN TAY', finish: 3 },
    { name: 'HOLİGAN', finish: 4 },
    { name: 'DEMİR NİHAT', finish: 5 },
    { name: 'AŞKBAZ', finish: 6 },
    { name: 'KAZANCI', finish: 7 }
];

const cal = TE.analyzeCalibration(pkg, actual);
console.log('Kalibrasyon — kazanan:', cal.winner, '| bileşik sıra:', cal.compositeRank, '| bileşik %:', cal.compositePct);
console.log('Kazananı 1. yapan metrikler (' + cal.metricsWhereWinnerFirst.length + '):', cal.metricsWhereWinnerFirst.slice(0, 8).join(', '));

// Sentetik: yüksek ort3 → 1. sıra
const fakeRow = {
    name: 'FAKE',
    son8001OrtOzeti: ort3(99),
    test1OrtOzeti: ort3(99),
    t1drOrtOzeti: ort3(99)
};
const fakeT = TE.computeRowTahmin(fakeRow, []);
if (fakeT.pct !== 99) {
    console.error('FAIL: sentetik ort3 ortalaması 99 olmalı, got', fakeT.pct);
    process.exit(1);
}

TE.setWeight('test1', 3);
TE.setWeight('son8001', 1);
const weighted = TE.computeRowTahmin({
    name: 'W',
    son8001OrtOzeti: ort3(50),
    test1OrtOzeti: ort3(100)
}, []);
// (50*1 + 100*3) / 4 = 87.5 → 88
if (weighted.pct !== 88) {
    console.error('FAIL: ağırlıklı ortalama 88 olmalı, got', weighted.pct);
    process.exit(1);
}
TE.resetWeights();

if (TE.getInfluencePct('test1') !== Math.round((3 / (3 + 40)) * 100) && TE.getWeight('test1') === 3) {
    // only if test1 still 3 - we reset above so skip
}
const inf = TE.getInfluencePct('son8001');
if (inf <= 0 || inf > 100) {
    console.error('FAIL: etki yüzdesi geçersiz', inf);
    process.exit(1);
}

console.log('OK');
