#!/usr/bin/env node
/**
 * SİKLET BAŞ+ ← SON800-1 · Δ katkı birim testleri
 *   node scripts/test-siklet-bas-delta-boost.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'public/js/siklet-bas-delta-boost.js'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
        return;
    }
    failed++;
    console.error('FAIL:', msg);
}

function approx(a, b, eps = 0.15) {
    return Math.abs(a - b) <= eps;
}

// recency: SON ağır, 5 ÖNCE hafif
const w = B.recencyWeights(6);
assert(w.length === 6, 'weights length 6');
assert(w[0] > w[5], 'SON > 5 ÖNCE ağırlık');
assert(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9, 'weights sum 1');

// gap proximity
assert(B.gapProximity(0) === 1, 'gap 0 → 1');
assert(B.gapProximity(8) === 0.85, 'gap 8 → 0.85');
assert(B.gapProximity(50) === 0, 'gap 50 → 0');

// SON Δ=0 tam taban ~10, eski derinlik daha az
const rowSonOnly = {
    son8001Depths: [{ gapPct: 0, gosterim: {} }]
};
const bSon = B.computeFromIstatRow(rowSonOnly, 1);
assert(approx(bSon.basePts, 10), 'SON Δ=0 taban ~10, got ' + bSon.basePts);

const rowAllZero = {
    son8001Depths: [
        { gapPct: 0, gosterim: {} },
        { gapPct: 0, gosterim: {} },
        { gapPct: 0, gosterim: {} }
    ]
};
const bAll = B.computeFromIstatRow(rowAllZero, 3);
assert(approx(bAll.basePts, 10), '3 derinlik Δ=0 toplam taban ~10, got ' + bAll.basePts);
assert(bAll.basePts > bSon.basePts * 0.99, 'çoklu derinlik ek katkı yok (toplam sabit)');

// bonus: kırmızı + mavi + yeşil aynı SON hücrede
const rowBonus = {
    son8001Depths: [{
        gapPct: 0,
        gosterim: { kirmiziKenar: true, maviKenar: true, gucluUyari: true }
    }]
};
const bBonus = B.computeFromIstatRow(rowBonus, 1);
assert(approx(bBonus.bonusPts, 5 + 3 + 15), 'bonus toplam 23, got ' + bBonus.bonusPts);

// eski derinlik bonusu düşük
const rowOldBonus = {
    son8001Depths: [
        { gapPct: 5, gosterim: {} },
        { gapPct: 0, gosterim: { kirmiziKenar: true } }
    ]
};
const bOld = B.computeFromIstatRow(rowOldBonus, 2);
const bSonRed = B.computeFromIstatRow({
    son8001Depths: [{ gapPct: 0, gosterim: { kirmiziKenar: true } }]
}, 1);
assert(bOld.parts.some(p => p.includes('1 ÖNCE')), '1 ÖNCE katkısı var');
assert(bOld.bonusPts < bSonRed.bonusPts, 'eski derinlik bonusu SON’dan düşük');

// applyToStats mutate
const st = {
    basSuccess: { pct: 55, display: '%55', tooltip: 'taban' }
};
const out = B.applyToStats(st, rowBonus, 1);
assert(out.basSuccess.pct === 88, '55 + 33 = 88, got ' + out.basSuccess.pct);
assert(out.basSuccess.deltaBoost != null, 'deltaBoost kaydı');

console.log('\nSikletBasDeltaBoost: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
