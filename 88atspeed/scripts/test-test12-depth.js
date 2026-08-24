/* Test TEST1·2 derinlik bazlı rakip kıyası */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'İyi TEST1+2',
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.48.00' },
                { tarih: '01.08.2026', mesafe: '1400', at_derece: '1.26.00', son800_bir: '0.50.00' }
            ]
        },
        {
            no: 2, name: 'Yavaş TEST1',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.28.00', son800_bir: '0.48.00' }
            ]
        },
        {
            no: 3, name: 'Yavaş TEST2',
            kosular: [
                { tarih: '15.08.2026', mesafe: '1400', at_derece: '1.24.00', son800_bir: '0.52.00' }
            ]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
console.log('maxDepthTest12:', pkg.maxDepthTest12);

for (const row of pkg.rows) {
    const depths = row.test12Depths || [];
    const summary = depths.map((c, i) => c ? (i === 0 ? 'SON' : i + 'ÖNCE') + '=' + c.pct + '(T1%' + c.test1Pct + ',T2%' + c.test2Pct + ')' : '—').join(', ');
    console.log(row.name + ':', summary || '—', '| AĞ.ORT:', row.test12AgirlikliOrt?.pct ?? '—');
}

if (pkg.maxDepthTest12 !== 2) {
    console.error('FAIL: maxDepthTest12 should be 2');
    process.exit(1);
}

const best = pkg.rows.find(r => r.name === 'İyi TEST1+2');
if (!best?.test12Depths[0] || best.test12Depths[0].pct !== 100) {
    console.error('FAIL: best horse at SON depth should be 100%, got', best?.test12Depths[0]?.pct);
    process.exit(1);
}

if (!best.test12Depths[0].isBest) {
    console.error('FAIL: best horse should be isBest at SON');
    process.exit(1);
}

const slow1 = pkg.rows.find(r => r.name === 'Yavaş TEST1');
if (!slow1?.test12Depths[0] || slow1.test12Depths[0].test1Pct >= 100) {
    console.error('FAIL: slow TEST1 horse should have test1Pct < 100');
    process.exit(1);
}

const slow2 = pkg.rows.find(r => r.name === 'Yavaş TEST2');
if (!slow2?.test12Depths[0] || slow2.test12Depths[0].test2Pct >= 100) {
    console.error('FAIL: slow TEST2 horse should have test2Pct < 100');
    process.exit(1);
}

if (!best.test12AgirlikliOrt || best.test12AgirlikliOrt.depthCount !== 2) {
    console.error('FAIL: weighted average should use 2 depths');
    process.exit(1);
}

console.log('OK');
