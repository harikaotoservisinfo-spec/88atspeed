/* Test 800Δ·7 derinlik — son 7 koşu FARK 8002-8001 ort. |0'a| yakınlık % */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;

function kosu(tarih, s1, s2) {
    return { tarih, son800_bir: s1, son800_iki: s2 || s1 };
}

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Dengeli',
            kosular: [
                kosu('20.08.2026', '0.48.00', '0.48.05'),
                kosu('10.08.2026', '0.47.50', '0.47.55'),
                kosu('01.08.2026', '0.49.00', '0.49.02'),
                kosu('20.07.2026', '0.48.20', '0.48.22'),
                kosu('10.07.2026', '0.48.10', '0.48.12'),
                kosu('01.07.2026', '0.47.80', '0.47.85'),
                kosu('20.06.2026', '0.48.00', '0.48.03')
            ]
        },
        {
            no: 2, name: 'Farklı',
            kosular: [
                kosu('18.08.2026', '0.48.00', '0.50.00'),
                kosu('08.08.2026', '0.47.00', '0.49.00'),
                kosu('28.07.2026', '0.48.00', '0.51.00')
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const dengeli = pkg.rows.find(r => r.name === 'Dengeli');
const farkli = pkg.rows.find(r => r.name === 'Farklı');

if (!dengeli?.fark827Depths[0] || dengeli.fark827Depths[0].pct !== 100) {
    console.error('FAIL: Dengeli at SON derinlikte %100 olmalı, got', dengeli?.fark827Depths[0]);
    process.exit(1);
}

if (!farkli?.fark827Depths[0] || farkli.fark827Depths[0].pct >= 100) {
    console.error('FAIL: Farklı at SON derinlikte %100 olmamalı');
    process.exit(1);
}

if (dengeli.fark827Depths[0].absOrt >= farkli.fark827Depths[0].absOrt) {
    console.error('FAIL: Dengeli |ort| daha küçük olmalı');
    process.exit(1);
}

if (!dengeli.fark827OrtOzeti?.agirlikli || dengeli.fark827OrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: ağırlıklı ortalama eksik');
    process.exit(1);
}

const oz = dengeli.fark827OrtOzeti;
const depths = dengeli.fark827Depths;
const expectedOrt1 = Math.round((depths[0].pct + depths[1].pct + depths[2].pct) / 3);
const expectedOrt2 = Math.round((depths[0].pct + depths[1].pct) / 2);
const expectedOrt3 = Math.round(
    (oz.agirlikli.pct * 1 + expectedOrt1 * 2 + expectedOrt2 * 4) / (1 + 2 + 4)
);

if (oz.ort1?.pct !== expectedOrt1) {
    console.error('FAIL: AĞ. ORT.1 expected', expectedOrt1, 'got', oz.ort1?.pct);
    process.exit(1);
}
if (oz.ort2?.pct !== expectedOrt2) {
    console.error('FAIL: AĞ. ORT.2 expected', expectedOrt2, 'got', oz.ort2?.pct);
    process.exit(1);
}
if (oz.ort3?.pct !== expectedOrt3) {
    console.error('FAIL: AĞ. ORT.3 expected', expectedOrt3, 'got', oz.ort3?.pct);
    process.exit(1);
}

console.log('AĞ. ORT.:', oz.agirlikli.pct + '%');
console.log('AĞ. ORT.1:', oz.ort1.pct + '%');
console.log('AĞ. ORT.2:', oz.ort2.pct + '%');
console.log('AĞ. ORT.3:', oz.ort3.pct + '%');
console.log('maxDepthFark827:', pkg.maxDepthFark827);
console.log('OK');
