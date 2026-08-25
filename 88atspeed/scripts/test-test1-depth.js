/* Test TEST1 derinlik bazlı rakip kıyası */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'En iyi TEST1',
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.48.00', son800_iki: '0.49.00' },
                { tarih: '01.08.2026', mesafe: '1400', at_derece: '1.26.00', son800_bir: '0.50.00', son800_iki: '0.51.00' }
            ]
        },
        {
            no: 2, name: 'Yavaş TEST1',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.28.00', son800_bir: '0.48.00', son800_iki: '0.52.00' }
            ]
        },
        {
            no: 3, name: 'Orta TEST1',
            kosular: [
                { tarih: '15.08.2026', mesafe: '1400', at_derece: '1.25.00', son800_bir: '0.52.00', son800_iki: '0.50.00' }
            ]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
console.log('maxDepthTest1:', pkg.maxDepthTest1);

for (const row of pkg.rows) {
    const depths = row.test1Depths || [];
    const summary = depths.map((c, i) => c ? (i === 0 ? 'SON' : i + 'ÖNCE') + '=' + c.pct : '—').join(', ');
    console.log(row.name + ':', summary || '—', '| AĞ.ORT:', row.test1OrtOzeti?.agirlikli?.pct ?? '—');
}

if (pkg.maxDepthTest1 !== 2) {
    console.error('FAIL: maxDepthTest1 should be 2');
    process.exit(1);
}

// Doğrusal min–max yüzde: en düşük %100, en yüksek %0
const U = require('../public/js/utils.js');
const min = 8398; // 1.33.98 salise
const max = 9102; // 1.51.02 salise
const mid = 8750;
if (U.pctLinearMinBest(min, min, max) !== 100) {
    console.error('FAIL: min should be 100%');
    process.exit(1);
}
if (U.pctLinearMinBest(max, min, max) !== 0) {
    console.error('FAIL: max should be 0%');
    process.exit(1);
}
const midPct = U.pctLinearMinBest(mid, min, max);
if (midPct <= 0 || midPct >= 100) {
    console.error('FAIL: mid should be between 0 and 100, got', midPct);
    process.exit(1);
}
console.log('Linear pct: min=100%, max=0%, mid=' + midPct + '%');

const best = pkg.rows.find(r => r.name === 'En iyi TEST1');
if (!best?.test1Depths[0] || best.test1Depths[0].pct !== 100) {
    console.error('FAIL: best horse at SON should be 100%, got', best?.test1Depths[0]?.pct);
    process.exit(1);
}

const slow = pkg.rows.find(r => r.name === 'Yavaş TEST1');
if (!slow?.test1Depths[0] || slow.test1Depths[0].pct !== 0) {
    console.error('FAIL: slow horse (worst) should be 0% at SON, got', slow?.test1Depths[0]?.pct);
    process.exit(1);
}

const orta = pkg.rows.find(r => r.name === 'Orta TEST1');
if (!orta?.test1Depths[0] || orta.test1Depths[0].pct <= 0 || orta.test1Depths[0].pct >= 100) {
    console.error('FAIL: middle horse should have pct between 0 and 100, got', orta?.test1Depths[0]?.pct);
    process.exit(1);
}

if (!best.test1OrtOzeti?.agirlikli || best.test1OrtOzeti.agirlikli.depthCount !== 2) {
    console.error('FAIL: TEST1 weighted average should use 2 depths');
    process.exit(1);
}

if (pkg.maxDepthTest2 !== 2) {
    console.error('FAIL: maxDepthTest2 should be 2');
    process.exit(1);
}

const bestT2 = pkg.rows.find(r => r.name === 'En iyi TEST1');
if (!bestT2?.test2Depths[0] || bestT2.test2Depths[0].pct !== 100) {
    console.error('FAIL: best horse TEST2 at SON should be 100%');
    process.exit(1);
}

if (pkg.maxDepthTest3 !== 2) {
    console.error('FAIL: maxDepthTest3 should be 2');
    process.exit(1);
}

const bestT3 = pkg.rows.find(r => r.name === 'En iyi TEST1');
if (!bestT3?.test3Depths[0] || bestT3.test3Depths[0].pct !== 100) {
    console.error('FAIL: best horse TEST3 at SON should be 100%, got', bestT3?.test3Depths[0]?.pct);
    process.exit(1);
}

if (!bestT3.test3Depths[0].usedSon8002) {
    console.error('FAIL: TEST3 should use son800_iki when available');
    process.exit(1);
}

const slowT3 = pkg.rows.find(r => r.name === 'Yavaş TEST1');
if (!slowT3?.test3Depths[0] || slowT3.test3Depths[0].pct >= 100) {
    console.error('FAIL: slow TEST3 horse should have pct < 100');
    process.exit(1);
}

// SON800-2 yoksa SON800-1 yedek
const fallbackRace = {
    mesafe: '1400',
    horses: [{
        no: 1, name: 'Yedek TEST3',
        kosular: [{ tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.48.00' }]
    }]
};
const fbPkg = global.IstatistikEngine.buildRaceIstatistikPackage(fallbackRace, 'İstanbul', '24.08.2026');
if (!fbPkg.rows[0].test3Depths[0] || fbPkg.rows[0].test3Depths[0].usedSon8002 !== false) {
    console.error('FAIL: TEST3 should fall back to son800_bir');
    process.exit(1);
}

console.log('OK');
