/* Test T1×DR derinlik bazlı rakip kıyası */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'İyi T1DR',
            kosular: [
                { tarih: '20.08.2026', mesafe: '1400', at_derece: '1.24.00', birinci_derece: '1.24.00' },
                { tarih: '01.08.2026', mesafe: '1400', at_derece: '1.26.00', birinci_derece: '1.25.00' }
            ]
        },
        {
            no: 2, name: 'Yavaş T1DR',
            kosular: [
                { tarih: '18.08.2026', mesafe: '1400', at_derece: '1.28.00', birinci_derece: '1.24.00' }
            ]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
console.log('maxDepthT1dr:', pkg.maxDepthT1dr);

const best = pkg.rows.find(r => r.name === 'İyi T1DR');
const slow = pkg.rows.find(r => r.name === 'Yavaş T1DR');

if (pkg.maxDepthT1dr !== 2) {
    console.error('FAIL: maxDepthT1dr should be 2');
    process.exit(1);
}

if (!best?.t1drDepths[0] || best.t1drDepths[0].pct !== 100) {
    console.error('FAIL: best T1DR at SON should be 100%');
    process.exit(1);
}

if (!slow?.t1drDepths[0] || slow.t1drDepths[0].pct >= 100) {
    console.error('FAIL: slower horse should be < 100%');
    process.exit(1);
}

if (!best.t1drOrtOzeti?.agirlikli || best.t1drOrtOzeti.agirlikli.pct === null) {
    console.error('FAIL: weighted average should exist');
    process.exit(1);
}

console.log('İyi T1DR:', best.t1drDepths[0].t1drDerece, '→', best.t1drDepths[0].pct + '%');
console.log('Yavaş T1DR:', slow.t1drDepths[0].t1drDerece, '→', slow.t1drDepths[0].pct + '%');
console.log('OK');
