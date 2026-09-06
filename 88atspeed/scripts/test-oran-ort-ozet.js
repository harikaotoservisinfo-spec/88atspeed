/* Test 800-2 ORAN AĞ. ORT.1/2/3 — eksik derinlik 0 sayılmaz */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Tek Koşu',
            kosular: [{ tarih: '20.08.2026', son800_bir: '0.48.00', son800_iki: '0.48.10' }]
        },
        {
            no: 2, name: 'İki Koşu',
            kosular: [
                { tarih: '20.08.2026', son800_bir: '0.47.00', son800_iki: '0.47.10' },
                { tarih: '10.08.2026', son800_bir: '0.49.00', son800_iki: '0.49.20' }
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const tek = pkg.rows.find(r => r.name === 'Tek Koşu');
const iki = pkg.rows.find(r => r.name === 'İki Koşu');

if (!tek?.oran2OrtOzeti?.agirlikli || tek.oran2OrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: tek koşu ağırlıklı ort. eksik');
    process.exit(1);
}

if (tek.oran2OrtOzeti.ort1?.pct !== tek.oran2Depths[0].pct) {
    console.error('FAIL: tek koşu AĞ. ORT.1 = SON olmalı');
    process.exit(1);
}

if (tek.oran2OrtOzeti.ort2?.pct !== tek.oran2Depths[0].pct) {
    console.error('FAIL: tek koşu AĞ. ORT.2 = SON olmalı');
    process.exit(1);
}

const oz2 = iki.oran2OrtOzeti;
const d0 = iki.oran2Depths[0].pct;
const d1 = iki.oran2Depths[1].pct;
if (oz2.ort2?.pct !== Math.round((d0 + d1) / 2)) {
    console.error('FAIL: iki koşu AĞ. ORT.2');
    process.exit(1);
}

console.log('Tek Koşu AĞ. ORT.:', tek.oran2OrtOzeti.agirlikli.pct + '%');
console.log('İki Koşu AĞ. ORT.2:', oz2.ort2.pct + '%');
console.log('OK');
