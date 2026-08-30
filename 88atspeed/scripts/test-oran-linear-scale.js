/* 800-1/2 ORAN — ana derece %100, en kötü derece %0, arada doğrusal ölçek */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;
const U = global.AtSpeedUtils;

const race = {
    mesafe: '2200',
    horses: [
        {
            no: 1, name: 'En İyi',
            kosular: [{ tarih: '20.08.2026', son800_bir: '0.44.31', son800_iki: '0.44.50' }]
        },
        {
            no: 2, name: 'Orta',
            kosular: [{ tarih: '18.08.2026', son800_bir: '0.46.00', son800_iki: '0.46.10' }]
        },
        {
            no: 3, name: 'En Kötü',
            kosular: [{ tarih: '15.08.2026', son800_bir: '0.48.00', son800_iki: '0.48.20' }]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İzmir', '24.08.2026');
const best = pkg.rows.find(r => r.name === 'En İyi');
const mid = pkg.rows.find(r => r.name === 'Orta');
const worst = pkg.rows.find(r => r.name === 'En Kötü');

const anaSal = U.dereceToSalise(pkg.oranAnaDerece1);
const kotuSal = U.dereceToSalise(pkg.oranKotuDerece1);

if (best.oran1Depths[0].pct !== 100) {
    console.error('FAIL: ana derece %100 olmalı', best.oran1Depths[0]);
    process.exit(1);
}

if (worst.oran1Depths[0].pct !== 0) {
    console.error('FAIL: en kötü derece %0 olmalı', worst.oran1Depths[0]);
    process.exit(1);
}

const midSal = U.dereceToSalise(mid.oran1Depths[0].derece);
const expectedMid = U.pctLinearMinBest(midSal, anaSal, kotuSal);
if (mid.oran1Depths[0].pct !== expectedMid) {
    console.error('FAIL: orta derece doğrusal ölçek', mid.oran1Depths[0].pct, expectedMid);
    process.exit(1);
}

if (pkg.oranAnaDerece1 !== '0.44.31' || pkg.oranKotuDerece1 !== '0.48.00') {
    console.error('FAIL: ana/kötü derece meta', pkg.oranAnaDerece1, pkg.oranKotuDerece1);
    process.exit(1);
}

console.log('Ana:', pkg.oranAnaDerece1, '→ %100');
console.log('En kötü:', pkg.oranKotuDerece1, '→ %0');
console.log('Orta:', mid.oran1Depths[0].derece, '→ %' + mid.oran1Depths[0].pct);
console.log('OK');
