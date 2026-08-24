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
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00' },
                { tarih: '01.08.2026', mesafe: '1400', at_derece: '1.26.00' }
            ]
        },
        {
            no: 2, name: 'Yavaş TEST1',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.28.00' }
            ]
        },
        {
            no: 3, name: 'Orta TEST1',
            kosular: [
                { tarih: '15.08.2026', mesafe: '1400', at_derece: '1.25.00' }
            ]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
console.log('maxDepthTest1:', pkg.maxDepthTest1);

for (const row of pkg.rows) {
    const depths = row.test1Depths || [];
    const summary = depths.map((c, i) => c ? (i === 0 ? 'SON' : i + 'ÖNCE') + '=' + c.pct : '—').join(', ');
    console.log(row.name + ':', summary || '—', '| AĞ.ORT:', row.test1AgirlikliOrt?.pct ?? '—');
}

if (pkg.maxDepthTest1 !== 2) {
    console.error('FAIL: maxDepthTest1 should be 2');
    process.exit(1);
}

const best = pkg.rows.find(r => r.name === 'En iyi TEST1');
if (!best?.test1Depths[0] || best.test1Depths[0].pct !== 100) {
    console.error('FAIL: best horse at SON should be 100%, got', best?.test1Depths[0]?.pct);
    process.exit(1);
}

const slow = pkg.rows.find(r => r.name === 'Yavaş TEST1');
if (!slow?.test1Depths[0] || slow.test1Depths[0].pct >= 100) {
    console.error('FAIL: slow horse should have pct < 100 at SON');
    process.exit(1);
}

if (!best.test1AgirlikliOrt || best.test1AgirlikliOrt.depthCount !== 2) {
    console.error('FAIL: weighted average should use 2 depths');
    process.exit(1);
}

console.log('OK');
