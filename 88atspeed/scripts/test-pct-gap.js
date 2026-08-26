/* SON–İÇ fark (Δ) sütunu — koşu ölçeğinde pct vs selfPct süre farkı */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;
const U = global.AtSpeedUtils;

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'At A',
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.36.00', son800_bir: '0.48.00', son800_iki: '0.49.00' },
                { tarih: '10.08.2026', mesafe: '1400', at_derece: '1.40.00', son800_bir: '0.50.00', son800_iki: '0.51.00' }
            ]
        },
        {
            no: 2, name: 'At B',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.35.00', son800_bir: '0.47.00', son800_iki: '0.48.00' },
                { tarih: '08.08.2026', mesafe: '1400', at_derece: '1.37.00', son800_bir: '0.49.00', son800_iki: '0.50.00' }
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
IE.applyRacePctScales(pkg);

const atA = pkg.rows.find(r => r.name === 'At A');
const d0 = atA.son8001Depths[0];
const d1 = atA.son8001Depths[1];

if (d0.gapSalise == null || d0.gapPct == null) {
    console.error('FAIL: gapSalise/gapPct hesaplanmalı', d0);
    process.exit(1);
}

const allDepth0 = pkg.rows.map(r => r.son8001Depths[0]).filter(Boolean);
const gaps = allDepth0.map(c => c.gapSalise);
const minGap = Math.min(...gaps);
const maxGap = Math.max(...gaps);

for (const cell of allDepth0) {
    const expected = U.pctLinearMaxBest(cell.gapSalise, minGap, maxGap);
    if (cell.gapPct !== expected) {
        console.error('FAIL: gapPct ölçek', cell.gapPct, expected, cell);
        process.exit(1);
    }
}

const maxCell = allDepth0.find(c => c.gapSalise === maxGap);
if (maxCell.gapPct !== 100) {
    console.error('FAIL: en büyük fark %100 olmalı', maxCell);
    process.exit(1);
}

const minCell = allDepth0.find(c => c.gapSalise === minGap);
if (minCell.gapPct !== 100 && minGap !== maxGap) {
    // min gap should be 0% when there's spread
    if (minCell.gapPct !== 0) {
        console.error('FAIL: en küçük fark %0 olmalı', minCell);
        process.exit(1);
    }
}

// Tek derinlikli at: pct === selfPct → fark 0
const atB = pkg.rows.find(r => r.name === 'At B');
const bOnly = atB.son8001Depths.find((_, i, arr) => arr.length === 1 || i === 0);
// At B has 2 depths, check that gap exists when scales differ
if (d0.pct === d0.selfPct && d0.gapSalise !== 0) {
    console.error('FAIL: aynı pct/selfPct ise fark 0', d0);
    process.exit(1);
}

console.log('At A SON pct:', d0.pct, 'selfPct:', d0.selfPct, 'gapSalise:', d0.gapSalise, 'gapPct:', d0.gapPct);
console.log('At A 1 ÖNCE gapSalise:', d1.gapSalise, 'gapPct:', d1.gapPct);
console.log('OK');
