/* Test koşu içi min–max yüzde ölçeği (her koşu kendi min/max) */
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
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.48.00' },
                { tarih: '10.08.2026', mesafe: '1400', at_derece: '1.30.00', son800_bir: '0.48.00' }
            ]
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
            no: 3, name: 'Koşu2 Tek At',
            kosular: [{ tarih: '19.08.2026', mesafe: '1400', at_derece: '1.35.00', son800_bir: '0.48.00' }]
        }
    ]
};

const pkg1 = IE.buildRaceIstatistikPackage(race1, 'İstanbul', '24.08.2026');
const pkg2 = IE.buildRaceIstatistikPackage(race2, 'İstanbul', '24.08.2026');
IE.applyRacePctScales(pkg1);
IE.applyRacePctScales(pkg2);

const best = pkg1.rows.find(r => r.name === 'Koşu1 En İyi');
const mid = pkg1.rows.find(r => r.name === 'Koşu1 Orta');
const solo = pkg2.rows.find(r => r.name === 'Koşu2 Tek At');

if (!best?.test1Depths[0] || best.test1Depths[0].pct !== 100) {
    console.error('FAIL: koşu1 en iyi SON %100 olmalı, got', best?.test1Depths[0]?.pct);
    process.exit(1);
}

if (!best?.test1Depths[1] || best.test1Depths[1].pct !== 0) {
    console.error('FAIL: koşu1 en kötü geçmiş koşu %0 olmalı, got', best?.test1Depths[1]?.pct);
    process.exit(1);
}

if (!mid?.test1Depths[0] || mid.test1Depths[0].pct !== 50) {
    console.error('FAIL: koşu1 orta at SON %50 olmalı (1.27 arada), got', mid?.test1Depths[0]?.pct);
    process.exit(1);
}

if (!solo?.test1Depths[0] || solo.test1Depths[0].pct !== 100) {
    console.error('FAIL: tek atlı koşuda tek değer %100 olmalı');
    process.exit(1);
}

function countPct(pkg, target) {
    let n = 0;
    for (const row of pkg.rows) {
        for (const cell of row.test1Depths || []) {
            if (cell?.pct === target) n++;
        }
    }
    return n;
}

if (countPct(pkg1, 100) !== 1 || countPct(pkg1, 0) !== 1) {
    console.error('FAIL: koşu1\'de bir %100 ve bir %0 olmalı, got', countPct(pkg1, 100), countPct(pkg1, 0));
    process.exit(1);
}

// Koşular birbirinden bağımsız — her ikisinde de %100 olabilir
if (countPct(pkg2, 100) !== 1) {
    console.error('FAIL: koşu2 kendi %100 değerine sahip olmalı');
    process.exit(1);
}

console.log('Koşu1 en iyi:', best.test1Depths[0].pct + '% /', best.test1Depths[1].pct + '%');
console.log('Koşu1 orta SON:', mid.test1Depths[0].pct + '%');
console.log('Koşu2 tek at:', solo.test1Depths[0].pct + '%');
console.log('OK');
