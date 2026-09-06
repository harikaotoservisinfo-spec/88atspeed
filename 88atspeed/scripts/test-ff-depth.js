/* Test FFΔ derinlik — GÖSTERİM FARKLARIN FARKI |0'a| yakınlık % */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;

function kosu(tarih, atDr, birinciDr, mesafe) {
    return {
        tarih,
        mesafe: String(mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr
    };
}

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'SabitFark',
            kosular: [
                kosu('20.08.2026', '1.28.00', '1.27.00'),
                kosu('10.08.2026', '1.28.50', '1.27.50'),
                kosu('01.08.2026', '1.29.00', '1.28.00'),
                kosu('20.07.2026', '1.28.20', '1.27.20')
            ]
        },
        {
            no: 2, name: 'DegisenFark',
            kosular: [
                kosu('18.08.2026', '1.30.00', '1.27.00'),
                kosu('08.08.2026', '1.28.00', '1.27.00'),
                kosu('28.07.2026', '1.27.50', '1.27.00')
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const sabit = pkg.rows.find(r => r.name === 'SabitFark');
const degisen = pkg.rows.find(r => r.name === 'DegisenFark');

if (!sabit?.ffDepths[0] || sabit.ffDepths[0].pct !== 100) {
    console.error('FAIL: SabitFark SON derinlikte %100 olmalı, got', sabit?.ffDepths[0]);
    process.exit(1);
}

if (!degisen?.ffDepths[0] || degisen.ffDepths[0].pct >= 100) {
    console.error('FAIL: DegisenFark SON derinlikte %100 olmamalı');
    process.exit(1);
}

if (sabit.ffDepths[0].absFark >= degisen.ffDepths[0].absFark) {
    console.error('FAIL: SabitFark |farkların farkı| daha küçük olmalı');
    process.exit(1);
}

const ff0 = IE._farklarinFarkiAtDepth(
    IE._kosularYenidenEskiye(sabit.kosular || race.horses[0].kosular, '24.08.2026'),
    0
);
if (!ff0 || ff0.absFark !== 0) {
    console.error('FAIL: SabitFark tüm koşularda sabit fark → FF=0 bekleniyor, got', ff0);
    process.exit(1);
}

if (!sabit.ffOrtOzeti?.agirlikli || sabit.ffOrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: ağırlıklı ortalama eksik');
    process.exit(1);
}

console.log('SabitFark FFΔ SON:', sabit.ffDepths[0].pct + '%', '|ff|=', sabit.ffDepths[0].absFark);
console.log('DegisenFark FFΔ SON:', degisen.ffDepths[0].pct + '%', '|ff|=', degisen.ffDepths[0].absFark);
console.log('maxDepthFf:', pkg.maxDepthFf);
console.log('OK');
