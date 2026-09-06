/* Test genel mesafe uyumu (MES İLK3/2/1) — şehir filtresi olmadan mesafe eşleşmesi */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;
const programTarih = '24.08.2026';
const hedefMesafe = 1400;

const kosularA = [
    { tarih: '20.08.2026', sehir: 'Ankara', mesafe: '1400', sira: '1' },
    { tarih: '10.08.2026', sehir: 'Bursa', mesafe: '1400', sira: '2' },
    { tarih: '01.08.2026', sehir: 'İzmir', mesafe: '1400', sira: '5' },
    { tarih: '15.07.2026', sehir: 'İstanbul', mesafe: '1600', sira: '1' }
];

const kosularB = [
    { tarih: '18.08.2026', sehir: 'Bursa', mesafe: '1400', sira: '3' },
    { tarih: '05.08.2026', sehir: 'Ankara', mesafe: '1200', sira: '1' }
];

const r3ay = IE.computeMesafeDonemIlkBasari(kosularA, programTarih, hedefMesafe, { months: 3 }, 3);
if (r3ay.pct !== 67 || r3ay.hit !== 2 || r3ay.total !== 3) {
    console.error('FAIL: 3ay mesafe ilk3 expected 2/3 = 67%, got', r3ay);
    process.exit(1);
}

const rSm = IE.computeSehirMesafeDonemIlkBasari(
    kosularA, programTarih, 'İstanbul', hedefMesafe, { months: 3 }, 3
);
if (rSm.total !== 0) {
    console.error('FAIL: İstanbul+1400 should have 0 races for horse A');
    process.exit(1);
}

const rMf = IE.computeMesafeDonemIlkBasari(kosularB, programTarih, hedefMesafe, { months: 3 }, 3);
if (rMf.pct !== 100 || rMf.total !== 1) {
    console.error('FAIL: horse B single 1400 race should be 100% ilk3');
    process.exit(1);
}

const race = {
    mesafe: '1400',
    horses: [
        { no: 1, name: 'At A', kosular: kosularA },
        { no: 2, name: 'At B', kosular: kosularB }
    ]
};
const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', programTarih);
const rowA = pkg.rows.find(r => r.name === 'At A');
const rowB = pkg.rows.find(r => r.name === 'At B');

if (rowA.mesafeIlk3.ay3.pct !== 67) {
    console.error('FAIL: package mesafeIlk3.ay3 for At A');
    process.exit(1);
}
if (rowA.smIlk3.ay3.pct !== null) {
    console.error('FAIL: smIlk3 should be null (no İstanbul 1400 races)');
    process.exit(1);
}
if (rowB.mesafeIlk3.ay3.pct !== 100) {
    console.error('FAIL: package mesafeIlk3.ay3 for At B');
    process.exit(1);
}

console.log('At A mesafe ilk3 (3ay):', rowA.mesafeIlk3.ay3.hit + '/' + rowA.mesafeIlk3.ay3.total, '→', rowA.mesafeIlk3.ay3.pct + '%');
console.log('At B mesafe ilk3 (3ay):', rowB.mesafeIlk3.ay3.pct + '%');
console.log('OK');
