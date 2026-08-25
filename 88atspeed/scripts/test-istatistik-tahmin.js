/* İstatistik tahmin motoru — görsel profil + trend */
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

// Görsel profil sınıflandırma
const cellYesilMavi = {
    gosterim: { maviKenar: true, sehirEslesme: true, yesilSatir: false, sariTest12: false }
};
cellYesilMavi.visualProfile = IE.classifyCellVisual(cellYesilMavi);
if (cellYesilMavi.visualProfile !== 'yesilMavi') {
    console.error('FAIL: yesilMavi profil', cellYesilMavi.visualProfile);
    process.exit(1);
}

const cellSari = {
    gosterim: { sariTest12: true, maviKenar: false, kirmiziKenar: false, yesilSatir: true }
};
cellSari.visualProfile = IE.classifyCellVisual(cellSari);
if (cellSari.visualProfile !== 'sari') {
    console.error('FAIL: sari profil', cellSari.visualProfile);
    process.exit(1);
}

// Trend
const trendUp = IE.computeDepthTrend([{ pct: 95 }, { pct: 88 }, { pct: 80 }], 3);
if (!trendUp.includes('trendUp3') || !trendUp.includes('trendUpSon')) {
    console.error('FAIL: trendUp', trendUp);
    process.exit(1);
}

// Skorlama
TE.resetWeights();
const influences = {};
influences[TE.visualSlotId('yesilMavi')] = 20;
influences[TE.visualSlotId('maviKenar')] = 10;
const row = {
    son8001Depths: [
        { pct: 100, visualProfile: 'yesilMavi', gosterim: { maviKenar: true, sehirEslesme: true } },
        { pct: 90, visualProfile: 'maviKenar', gosterim: { maviKenar: true } }
    ]
};
const t = TE.computeRowTahmin(row, [], influences);
if (t.score < 30 || t.metricCount < 2) {
    console.error('FAIL: görsel skor', t.score, t.metricCount, t.terms);
    process.exit(1);
}

// Paket entegrasyonu
const race = {
    mesafe: '1400',
    horses: [
        { no: 1, name: 'Alpha', kosular: [kosu('20.08.2026', '1.28.00', '1.27.00')] },
        { no: 2, name: 'Beta', kosular: [kosu('18.08.2026', '1.30.00', '1.27.00')] }
    ]
};
const pkg = IE.buildRaceIstatistikPackage(race, 'İzmir', '24.08.2026');
TE.attachRaceTahmin(pkg);
const alpha = pkg.rows.find(r => r.name === 'Alpha');
if (!alpha?.tahmin?.rank) {
    console.error('FAIL: tahmin rank eksik');
    process.exit(1);
}

const hasVisual = (alpha.son8001Depths || []).some(c => c?.visualProfile);
if (!hasVisual) {
    console.error('FAIL: visualProfile bağlanmadı');
    process.exit(1);
}

console.log('Görsel TAHMİN skor:', t.score, '|', t.metricCount, 'sinyal');
console.log('OK');
