/* İstatistik tahmin motoru — metrik grubu bazlı görsel profil */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/formula-engine.js'), 'utf8') + '\n; global.GosterimEngine = GosterimEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-gosterim-flags.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-tahmin-engine.js'), 'utf8') + '\n; global.IstatistikTahminEngine = IstatistikTahminEngine;');

const IE = global.IstatistikEngine;
const TE = global.IstatistikTahminEngine;

function kosu(tarih, atDr, birinciDr, opts = {}) {
    return {
        tarih,
        mesafe: String(opts.mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr,
        son800_bir: opts.son800_bir || '0.49.00',
        son800_iki: opts.son800_iki || '0.49.00',
        sehir: opts.sehir || 'İzmir',
        sira: opts.sira || '3'
    };
}

TE.resetWeights();

// Metrik bazlı kayıt
TE.setMetricInfluence('son8001', 'visual', 'maviKenar', 25);
TE.setMetricInfluence('t8', 'visual', 'maviKenar', 5);
if (TE.getMetricInfluence('son8001', 'visual', 'maviKenar') !== 25) {
    console.error('FAIL: son8001 maviKenar kayıt');
    process.exit(1);
}
if (TE.getMetricInfluence('t8', 'visual', 'maviKenar') !== 5) {
    console.error('FAIL: t8 maviKenar ayrı kayıt');
    process.exit(1);
}

const row = {
    son8001Depths: [{ visualProfile: 'maviKenar' }],
    test8Depths: [{ visualProfile: 'maviKenar' }]
};
const t = TE.computeRowTahmin(row, []);
const son8001Term = t.terms.find(x => x.metricId === 'son8001');
const t8Term = t.terms.find(x => x.metricId === 't8');
if (!son8001Term || son8001Term.points !== 25) {
    console.error('FAIL: son8001 skor', son8001Term);
    process.exit(1);
}
if (!t8Term || t8Term.points !== 5) {
    console.error('FAIL: t8 skor', t8Term);
    process.exit(1);
}

TE.setSelectedMetric('t8');
if (TE.getSelectedMetric() !== 't8') {
    console.error('FAIL: seçili metrik');
    process.exit(1);
}

const race = {
    mesafe: '1400',
    horses: [
        { no: 1, name: 'Alpha', kosular: [kosu('20.08.2026', '1.28.00', '1.27.00')] },
        { no: 2, name: 'Beta', kosular: [kosu('18.08.2026', '1.30.00', '1.27.00')] }
    ]
};
const pkg = IE.buildRaceIstatistikPackage(race, 'İzmir', '24.08.2026');
TE.attachRaceTahmin(pkg);
if (!pkg.rows[0]?.tahmin?.rank) {
    console.error('FAIL: tahmin rank');
    process.exit(1);
}

const catalog = TE.getMetricCatalog(pkg.extraSections);
if (!catalog.find(m => m.id === 'son8001') || !catalog.find(m => m.id === 'f802')) {
    console.error('FAIL: metrik katalog', catalog.length);
    process.exit(1);
}

TE.resetMetricInfluences('son8001');
if (TE.hasCustomMetricInfluences('son8001')) {
    console.error('FAIL: son8001 sıfırlanmadı');
    process.exit(1);
}
if (!TE.hasCustomMetricInfluences('t8')) {
    console.error('FAIL: t8 etkileri kalmalı');
    process.exit(1);
}

console.log('Metrik bazlı TAHMİN: son8001 +' + son8001Term.points + ', t8 +' + t8Term.points);
console.log('OK');
