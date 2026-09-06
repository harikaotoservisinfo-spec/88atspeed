/* Test T8Δ derinlik — GÖSTERİM TEST8 |0'a| yakınlık % */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;

function kosu(tarih, atDr, birinciDr, s8001, s8002, mesafe) {
    return {
        tarih,
        mesafe: String(mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr,
        son800_bir: s8001,
        son800_iki: s8002 || s8001
    };
}

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'SabitT8',
            kosular: [
                kosu('20.08.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10'),
                kosu('10.08.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10'),
                kosu('01.08.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10'),
                kosu('20.07.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10')
            ]
        },
        {
            no: 2, name: 'DegisenT8',
            kosular: [
                kosu('18.08.2026', '1.28.00', '1.27.00', '0.50.00', '0.55.00'),
                kosu('08.08.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10'),
                kosu('28.07.2026', '1.28.00', '1.27.00', '0.50.00', '0.50.10')
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const sabit = pkg.rows.find(r => r.name === 'SabitT8');
const degisen = pkg.rows.find(r => r.name === 'DegisenT8');

if (!sabit?.test8Depths[0] || sabit.test8Depths[0].pct !== 100) {
    console.error('FAIL: SabitT8 SON derinlikte %100 olmalı, got', sabit?.test8Depths[0]);
    process.exit(1);
}

if (!degisen?.test8Depths[0] || degisen.test8Depths[0].pct >= 100) {
    console.error('FAIL: DegisenT8 SON derinlikte %100 olmamalı');
    process.exit(1);
}

const t8 = IE._test8AtDepth(
    IE._kosularYenidenEskiye(race.horses[0].kosular, '24.08.2026'),
    0,
    1400
);
if (!t8 || t8.absTest8 !== 0) {
    console.error('FAIL: SabitT8 TEST8=0 bekleniyor, got', t8);
    process.exit(1);
}

if (!sabit.test8OrtOzeti?.agirlikli || sabit.test8OrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: ağırlıklı ortalama eksik');
    process.exit(1);
}

console.log('SabitT8 T8Δ SON:', sabit.test8Depths[0].pct + '%', '|TEST8|=', sabit.test8Depths[0].absTest8);
console.log('DegisenT8 T8Δ SON:', degisen.test8Depths[0].pct + '%', '|TEST8|=', degisen.test8Depths[0].absTest8);
console.log('maxDepthT8:', pkg.maxDepthT8);
console.log('OK');
