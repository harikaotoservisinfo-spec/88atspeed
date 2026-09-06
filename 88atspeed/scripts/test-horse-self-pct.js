/* AT·İÇ derinlik ölçeği — atın kendi min/max arasında selfPct */
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
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.35.00', son800_bir: '0.47.00', son800_iki: '0.48.00' }
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
IE.applyRacePctScales(pkg);

const atA = pkg.rows.find(r => r.name === 'At A');
const atB = pkg.rows.find(r => r.name === 'At B');
const d0 = atA.test1Depths[0];
const d1 = atA.test1Depths[1];

const t1min = Math.min(d0.test1, d1.test1);
const t1max = Math.max(d0.test1, d1.test1);
const expected0 = U.pctLinearMinBest(d0.test1, t1min, t1max);
const expected1 = U.pctLinearMinBest(d1.test1, t1min, t1max);

if (d0.selfPct !== expected0 || d1.selfPct !== expected1) {
    console.error('FAIL: At A selfPct', d0.selfPct, expected0, d1.selfPct, expected1);
    process.exit(1);
}

if (atB.test1Depths[0].selfPct !== 100) {
    console.error('FAIL: tek derinlik selfPct 100 olmalı', atB.test1Depths[0]);
    process.exit(1);
}

if (d0.pct === d0.selfPct && d1.pct === d1.selfPct && atA.test1Depths.length > 1) {
    console.error('FAIL: koşu ve at içi ölçek farklı olmalı (çok derinlik)');
    process.exit(1);
}

console.log('At A SON koşu pct:', d0.pct, 'selfPct:', d0.selfPct);
console.log('At A 1 ÖNCE pct:', d1.pct, 'selfPct:', d1.selfPct);
console.log('At B tek derinlik selfPct:', atB.test1Depths[0].selfPct);
console.log('OK');
