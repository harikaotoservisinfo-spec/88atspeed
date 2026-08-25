/* Test program geneli min–max yüzde ölçeği (tüm koşular) */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));

const IE = global.IstatistikEngine;

const race1 = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Koşu1 En İyi',
            kosular: [{ tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.48.00' }]
        },
        {
            no: 2, name: 'Koşu1 Orta',
            kosular: [{ tarih: '18.08.2026', mesafe: '1400', at_derece: '1.27.00', son800_bir: '0.48.00' }]
        }
    ]
};

const race2 = {
    mesafe: '1400',
    horses: [
        {
            no: 3, name: 'Koşu2 En Kötü',
            kosular: [{ tarih: '19.08.2026', mesafe: '1400', at_derece: '1.30.00', son800_bir: '0.48.00' }]
        }
    ]
};

const pkg1 = IE.buildRaceIstatistikPackage(race1, 'İstanbul', '24.08.2026');
const pkg2 = IE.buildRaceIstatistikPackage(race2, 'İstanbul', '24.08.2026');
IE.applyProgramGlobalPctScales([pkg1, pkg2]);

const best = pkg1.rows.find(r => r.name === 'Koşu1 En İyi');
const mid = pkg1.rows.find(r => r.name === 'Koşu1 Orta');
const worst = pkg2.rows.find(r => r.name === 'Koşu2 En Kötü');

if (!best?.test1Depths[0] || best.test1Depths[0].pct !== 100) {
    console.error('FAIL: program genelinde en iyi TEST1 %100 olmalı, got', best?.test1Depths[0]?.pct);
    process.exit(1);
}

if (!worst?.test1Depths[0] || worst.test1Depths[0].pct !== 0) {
    console.error('FAIL: program genelinde en kötü TEST1 %0 olmalı, got', worst?.test1Depths[0]?.pct);
    process.exit(1);
}

if (!mid?.test1Depths[0] || mid.test1Depths[0].pct <= 0 || mid.test1Depths[0].pct >= 100) {
    console.error('FAIL: orta at %0–%100 arasında olmalı, got', mid?.test1Depths[0]?.pct);
    process.exit(1);
}

// Tek koşuda birden fazla %100 olmamalı (global ölçek)
const allPcts = [];
for (const pkg of [pkg1, pkg2]) {
    for (const row of pkg.rows) {
        for (const cell of row.test1Depths || []) {
            if (cell?.pct === 100) allPcts.push(row.name);
        }
    }
}
if (allPcts.length !== 1) {
    console.error('FAIL: tam olarak bir hücre %100 olmalı, got', allPcts);
    process.exit(1);
}

console.log('Koşu1 En İyi:', best.test1Depths[0].pct + '%');
console.log('Koşu1 Orta:', mid.test1Depths[0].pct + '%');
console.log('Koşu2 En Kötü:', worst.test1Depths[0].pct + '%');
console.log('OK');
