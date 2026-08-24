/* Test SON800·1DR/SL derinlik bazlı korelasyon */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Hızlı800 İyi1DR',
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', son800_bir: '0.48.00', birinci_derece: '1.24.00', at_derece: '1.25.00' },
                { tarih: '01.08.2026', mesafe: '1400', son800_bir: '0.50.00', birinci_derece: '1.26.00', at_derece: '1.27.00' }
            ]
        },
        {
            no: 2, name: 'Yavaş800 İyi1DR',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', son800_bir: '0.52.00', birinci_derece: '1.24.00', at_derece: '1.26.00' },
                { tarih: '05.08.2026', mesafe: '1400', son800_bir: '0.49.00', birinci_derece: '1.25.00', at_derece: '1.26.00' }
            ]
        },
        {
            no: 3, name: 'Hızlı800 Kötü1DR',
            kosular: [{
                tarih: '15.08.2026', mesafe: '1400', son800_bir: '0.48.00', birinci_derece: '1.28.00', at_derece: '1.29.00'
            }]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
console.log('maxDepthDr1:', pkg.maxDepthDr1);

for (const row of pkg.rows) {
    const depths = row.son800Dr1Depths || [];
    const summary = depths.map((c, i) => c ? (i === 0 ? 'SON' : i + 'ÖNCE') + '=' + c.pct : '—').join(', ');
    console.log(row.name + ':', summary || '—');
}

if (pkg.maxDepthDr1 !== 2) {
    console.error('FAIL: maxDepthDr1 should be 2');
    process.exit(1);
}

const best = pkg.rows.find(r => r.name === 'Hızlı800 İyi1DR');
if (!best?.son800Dr1Depths[0] || best.son800Dr1Depths[0].pct !== 100) {
    console.error('FAIL: best horse at SON depth should be 100%');
    process.exit(1);
}

if (!best.son800Dr1Depths[1]) {
    console.error('FAIL: best horse should have 1 ÖNCE depth');
    process.exit(1);
}

const ort = best.son800Dr1AgirlikliOrt;
if (!ort || ort.pct === null || ort.depthCount !== 2) {
    console.error('FAIL: weighted average should use 2 depths for best horse');
    process.exit(1);
}
// SON=100 w2, 1ÖNCE=98 w1 → (100*2+98*1)/3 = 99.33 → 99
if (ort.pct !== 99) {
    console.error('FAIL: expected weighted avg 99, got', ort.pct);
    process.exit(1);
}

const s1ort = best.son8001AgirlikliOrt;
if (!s1ort || s1ort.pct === null) {
    console.error('FAIL: SON800-1 weighted avg should exist');
    process.exit(1);
}

console.log('OK');
