/* Test derinlik yüzde tabanı TAHMİN skoru */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-gosterim-flags.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-tahmin-engine.js'), 'utf8') + '\n; global.IstatistikTahminEngine = IstatistikTahminEngine;');

const IE = global.IstatistikEngine;
const TE = global.IstatistikTahminEngine;

global.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] || null; },
    setItem(k, v) { this._d[k] = v; },
    removeItem(k) { delete this._d[k]; }
};
TE._storeCache = null;
TE.resetWeights();

// SON %100 ≠ 4 ÖNCE %100 (ham ağırlıklı toplam)
const c1a = IE.computeDepthPctTahminComponents([{ pct: 100 }], 7);
const c1b = IE.computeDepthPctTahminComponents([null, null, null, null, { pct: 100 }], 7);
if (!c1a || !c1b || c1a.weightSum <= c1b.weightSum) {
    console.error('FAIL: SON ağırlığı > 4ÖNCE ağırlığı', c1a?.weightSum, c1b?.weightSum);
    process.exit(1);
}

// SON %0 ceza
const c2 = IE.computeDepthPctTahminComponents([{ pct: 0 }, { pct: 80 }], 7);
if (!c2 || c2.sonZeroPenalty !== TE.SON_ZERO_PENALTY_REF) {
    console.error('FAIL: SON %0 penalty', c2);
    process.exit(1);
}

// Trend eğimi
const c3 = IE.computeDepthPctTahminComponents([{ pct: 75 }, { pct: 79 }, { pct: 63 }], 7);
if (!c3 || c3.trendSlope !== 6) {
    console.error('FAIL: trend slope', c3?.trendSlope);
    process.exit(1);
}

TE.setSelectedMetric('test1');
TE.setCalcMode(TE.CALC_MODE_SOLO);
TE.zeroDraftMetric('test1');

const rowA = {
    test1Depths: [{ pct: 100 }, { pct: 70 }, { pct: 60 }]
};
const rowB = {
    test1Depths: [null, null, null, null, { pct: 100 }]
};

const tA = TE.computeRowTahmin(rowA, [], null, { maxDepthTest1: 7 });
const tB = TE.computeRowTahmin(rowB, [], null, { maxDepthTest1: 7 });

const baseA = tA.terms.find(x => x.label.includes('yüzde tabanı'));
const baseB = tB.terms.find(x => x.label.includes('yüzde tabanı'));

if (!baseA || !baseB) {
    console.error('FAIL: yüzde tabanı terimi yok', tA.terms, tB.terms);
    process.exit(1);
}

if (baseA.points <= baseB.points) {
    console.error('FAIL: SON %100 daha yüksek puan almalı', baseA.points, baseB.points);
    process.exit(1);
}

// Aynı %75 farklı derinlik
const rowC = { test1Depths: [null, { pct: 75 }] };
const rowD = { test1Depths: [null, null, null, null, null, { pct: 75 }] };
const tC = TE.computeRowTahmin(rowC, [], null, { maxDepthTest1: 7 });
const tD = TE.computeRowTahmin(rowD, [], null, { maxDepthTest1: 7 });
const baseC = tC.terms.find(x => x.label.includes('yüzde tabanı'));
const baseD = tD.terms.find(x => x.label.includes('yüzde tabanı'));
if (!baseC || !baseD || baseC.points <= baseD.points) {
    console.error('FAIL: yakın derinlik %75 > uzak derinlik %75', baseC?.points, baseD?.points);
    process.exit(1);
}

// Trend eğimi — slider açıkken
const trendInfl = {};
trendInfl[TE.trendSlotId('test1', 'trendUp3')] = 10;
const rowUp = { test1Depths: [{ pct: 80 }, { pct: 70 }, { pct: 60 }] };
const rowDown = { test1Depths: [{ pct: 52 }, { pct: 68 }, { pct: 84 }] };
const tUp = TE.computeRowTahmin(rowUp, [], trendInfl, { maxDepthTest1: 7 });
const tDown = TE.computeRowTahmin(rowDown, [], trendInfl, { maxDepthTest1: 7 });
const slopeUp = tUp.terms.find(x => x.label.includes('eğim'));
const slopeDown = tDown.terms.find(x => x.label.includes('eğim'));
if (!slopeUp || slopeUp.points <= 0) {
    console.error('FAIL: yükselen eğim bonusu', slopeUp);
    process.exit(1);
}
if (!slopeDown || slopeDown.points >= 0) {
    console.error('FAIL: düşen eğim cezası', slopeDown);
    process.exit(1);
}

console.log('SON %100 puan:', baseA.points, '| 4ÖNCE %100:', baseB.points);
console.log('1ÖNCE %75:', baseC.points, '| 5ÖNCE %75:', baseD.points);
console.log('Eğim ↑:', slopeUp.points, '| Eğim ↓:', slopeDown.points);
console.log('OK');
