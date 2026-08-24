/* İstatistik tahmin motoru — sütun bazlı etki */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-tahmin-engine.js'), 'utf8') + '\n; global.IstatistikTahminEngine = IstatistikTahminEngine;');

const IE = global.IstatistikEngine;
const TE = global.IstatistikTahminEngine;

function ort3(pct) {
    return {
        ort3: { pct },
        agirlikli: { pct },
        ort1: { pct },
        ort2: { pct }
    };
}

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

// Sütun bazlı: kirmizi SON derinlik + ort3
const influences = {};
influences[TE.depthSlotId('kirmizi', 0)] = 10;
influences[TE.slotId('kirmizi', 'ort3')] = 5;
const row = {
    name: 'X',
    kirmiziDepths: [{ pct: 100 }, { pct: 50 }],
    kirmiziOrtOzeti: { ort3: { pct: 80 } }
};
const t = TE.computeRowTahmin(row, pkg.extraSections, influences);
// (100*10 + 50*1 + 80*5) / (10+1+5) default 1 for d1 = (1000+50+400)/16 = 90.625 -> 91
if (t.pct !== 91) {
    console.error('FAIL: sütun bazlı skor beklenen ~91, got', t.pct, t.terms.length, 'terms');
    process.exit(1);
}

TE.setInfluence(TE.slotId('kirmizi', 'ort3'), 5);
if (TE.adjustInfluence(TE.slotId('kirmizi', 'ort3'), -1) !== 4) {
    console.error('FAIL: adjustInfluence 5->4 olmalı');
    process.exit(1);
}
TE.resetWeights();

if (TE.getInfluence(TE.slotId('test1', 'd0')) !== TE.DEFAULT_INFLUENCE) {
    console.error('FAIL: varsayılan etki', TE.DEFAULT_INFLUENCE);
    process.exit(1);
}

console.log('Sütun bazlı tahmin:', t.pct + '%', '|', t.metricCount, 'terim');
console.log('OK');
