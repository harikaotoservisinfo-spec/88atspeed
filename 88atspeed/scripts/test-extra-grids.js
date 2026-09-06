/* Test ek derinlik gridleri — GÖSTERİM/Tahminim eksik sütunlar */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));

const IE = global.IstatistikEngine;

function kosu(tarih, atDr, birinciDr, mesafe, opts = {}) {
    return {
        tarih,
        mesafe: String(mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr,
        son800_bir: opts.son800_bir || '0.50.00',
        son800_iki: opts.son800_iki || opts.son800_bir || '0.50.00',
        sehir: opts.sehir || 'İstanbul',
        sira: opts.sira || '3'
    };
}

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Alpha', atId: 101,
            kosular: [
                kosu('20.08.2026', '1.28.00', '1.27.00', 1400, { son800_bir: '0.49.00', son800_iki: '0.49.00' }),
                kosu('10.08.2026', '1.28.50', '1.27.50', 1400, { son800_bir: '0.49.50', son800_iki: '0.49.50' }),
                kosu('01.08.2026', '1.29.00', '1.28.00', 1400, { son800_bir: '0.50.00', son800_iki: '0.50.00' })
            ]
        },
        {
            no: 2, name: 'Beta', atId: 102,
            kosular: [
                kosu('18.08.2026', '1.30.00', '1.27.00', 1400, { son800_bir: '0.51.00', son800_iki: '0.52.00' }),
                kosu('08.08.2026', '1.28.00', '1.27.00', 1400, { son800_bir: '0.49.00', son800_iki: '0.49.00' })
            ]
        }
    ]
};

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');

if (!pkg.extraSections || pkg.extraSections.length !== IE.ISTAT_EXTRA_SECTIONS.length) {
    console.error('FAIL: extraSections beklenen sayıda değil', pkg.extraSections?.length, 'vs', IE.ISTAT_EXTRA_SECTIONS.length);
    process.exit(1);
}

const alpha = pkg.rows.find(r => r.name === 'Alpha');
const beta = pkg.rows.find(r => r.name === 'Beta');

if (!alpha?.f802Depths?.[0] || alpha.f802Depths[0].pct === null) {
    console.error('FAIL: Alpha 800Δ·2 derinlik eksik');
    process.exit(1);
}

if (!alpha?.dr1drDepths?.[0] || alpha.dr1drDepths[0].pct === null) {
    console.error('FAIL: Alpha DR/1DR derinlik eksik');
    process.exit(1);
}

if (!alpha?.sehirSonDepths?.[0] || alpha.sehirSonDepths[0].pct !== 100) {
    console.error('FAIL: Alpha ŞEH-SON %100 olmalı (İstanbul koşuları)');
    process.exit(1);
}

if (!alpha?.f802OrtOzeti?.agirlikli || alpha.f802OrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: Alpha 800Δ·2 ağırlıklı ortalama eksik');
    process.exit(1);
}

if (!beta?.f802Depths?.[0] || beta.f802Depths[0].pct >= alpha.f802Depths[0].pct) {
    console.error('FAIL: Beta 800Δ·2 Alpha\'dan düşük % olmalı');
    process.exit(1);
}

const ids = pkg.extraSections.map(s => s.id);
const expectedIds = IE.ISTAT_EXTRA_SECTIONS.map(s => s.id);
for (const id of expectedIds) {
    if (!ids.includes(id)) {
        console.error('FAIL: eksik section id', id);
        process.exit(1);
    }
    const depthsKey = id + 'Depths';
    if (!alpha[depthsKey]) {
        console.error('FAIL: row depths eksik', depthsKey);
        process.exit(1);
    }
}

console.log('extraSections:', pkg.extraSections.length);
console.log('Alpha 800Δ·2 SON:', alpha.f802Depths[0].pct + '%');
console.log('Alpha DR/1DR SON:', alpha.dr1drDepths[0].pct + '%');
console.log('Alpha ŞEH-SON SON:', alpha.sehirSonDepths[0].pct + '%');
console.log('OK');
