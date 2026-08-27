#!/usr/bin/env node
'use strict';

const { DegisimSkoruEngine: DS } = require('../public/js/degisim-skoru-engine.js');

function assert(cond, msg) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

function row(overrides) {
    return {
        son8001Depths: [{
            gapPct: 9, successPct: 91, selfPct: 97, horseBestPct: 99, pct: 92
        }],
        t1drDepths: [{
            gapPct: 0, successPct: 98, selfPct: 100, horseBestPct: 97, pct: 100
        }],
        ...overrides
    };
}

// AKTAŞKAYA örneği
const aktas = DS.compute(row());
assert(aktas.components.degisimPts === 30, 'AKTAŞKAYA degisim +30');
assert(aktas.components.perfPts === 25, 'AKTAŞKAYA perf +25');
assert(aktas.normalized === 100, 'AKTAŞKAYA normalized 100, got ' + aktas.normalized);
assert(aktas.scenario.id === 'muthis', 'AKTAŞKAYA scenario muthis');

// İkili düşüş
const ikili = DS.compute(row({
    son8001Depths: [{ gapPct: 0, successPct: 85, selfPct: 80, horseBestPct: 82, pct: 78 }],
    t1drDepths: [{ gapPct: 0, successPct: 88, selfPct: 82, horseBestPct: 84, pct: 80 }]
}));
assert(ikili.scenario.id === 'ikili' || ikili.normalized >= 60, 'ikili zero scenario');

// Negatif değişim
const neg = DS.compute(row({
    son8001Depths: [{ gapPct: 0, successPct: 30, selfPct: 30, horseBestPct: 30, pct: 30 }],
    t1drDepths: [{ gapPct: 40, successPct: 30, selfPct: 30, horseBestPct: 30, pct: 30 }]
}));
assert(neg.components.degisimPts === -20, 'negatif degisim -20');

assert(DS.highlightColsForMetric('son8001').join() === 'gap,success', 'son8001 highlight cols');
assert(DS.highlightColsForMetric('t1dr').join() === 'best,self,gap,success', 't1dr highlight cols');

console.log('OK: test-degisim-skoru (' + aktas.normalized + '/100)');
