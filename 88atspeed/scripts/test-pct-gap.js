/* SON·Δ — derinlik değeri ile atın kendi en iyi değeri arasındaki salise farkı */
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
        },
        {
            no: 3, name: 'At C',
            kosular: [
                { tarih: '15.08.2026', mesafe: '1400', at_derece: '1.38.00', son800_bir: '0.52.00', son800_iki: '0.53.00' }
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
IE.applyRacePctScales(pkg);

const atA = pkg.rows.find(r => r.name === 'At A');
const d0 = atA.son8001Depths[0];
const d1 = atA.son8001Depths[1];

// At A SON = en iyi (0.48) → fark 0
if (d0.gapSalise !== 0) {
    console.error('FAIL: en iyi derinlikte fark 0 olmalı', d0);
    process.exit(1);
}

// At A 1 ÖNCE = 0.50, en iyi 0.48 → fark 200 salise
const expectedGap1 = Math.abs(d1.salise - d0.salise);
if (d1.gapSalise !== expectedGap1) {
    console.error('FAIL: 1 ÖNCE fark', d1.gapSalise, expectedGap1);
    process.exit(1);
}

const allDepth1 = pkg.rows.map(r => r.son8001Depths[1]).filter(Boolean);
const gaps = allDepth1.map(c => c.gapSalise);
const minGap = Math.min(...gaps);
const maxGap = Math.max(...gaps);

for (const cell of allDepth1) {
    const expected = U.pctLinearMaxBest(cell.gapSalise, minGap, maxGap);
    if (cell.gapPct !== expected) {
        console.error('FAIL: gapPct ölçek', cell.gapPct, expected, cell);
        process.exit(1);
    }
}

// At C tek derinlik → fark 0, gapPct 100 (tek değer)
const atC = pkg.rows.find(r => r.name === 'At C');
if (atC.son8001Depths[0].gapSalise !== 0) {
    console.error('FAIL: tek derinlik fark 0', atC.son8001Depths[0]);
    process.exit(1);
}

// horseBestPct — atın en iyi derecesi koşu min/max skalasında
if (d0.horseBestPct == null) {
    console.error('FAIL: horseBestPct hesaplanmalı', d0);
    process.exit(1);
}
if (d0.successPct == null || d0.successParts?.length < 2) {
    console.error('FAIL: successPct hesaplanmalı', d0);
    process.exit(1);
}
const manualSuccess = U.pctGeometricMean([
    d0.pct, d0.horseBestPct, d0.selfPct, 100
]);
if (d0.successPct !== manualSuccess) {
    console.error('FAIL: successPct', d0.successPct, manualSuccess);
    process.exit(1);
}
console.log('At A successPct:', d0.successPct, 'parts:', d0.successParts.map(p => p.label + '=' + p.val).join(' '));
console.log('At A SON gapSalise:', d0.gapSalise, 'gapPct:', d0.gapPct);
console.log('At A 1 ÖNCE gapSalise:', d1.gapSalise, 'gapPct:', d1.gapPct);
console.log('OK');
