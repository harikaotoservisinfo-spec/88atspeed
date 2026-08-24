/* Test SON800·1DR/SL son koşu korelasyonu */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Hızlı800 İyi1DR',
            kosular: [{
                tarih: '20.08.2026', mesafe: '1400',
                son800_bir: '0.48.00', birinci_derece: '1.24.00', at_derece: '1.25.00'
            }]
        },
        {
            no: 2, name: 'Yavaş800 İyi1DR',
            kosular: [{
                tarih: '18.08.2026', mesafe: '1400',
                son800_bir: '0.52.00', birinci_derece: '1.24.00', at_derece: '1.26.00'
            }]
        },
        {
            no: 3, name: 'Hızlı800 Kötü1DR',
            kosular: [{
                tarih: '15.08.2026', mesafe: '1400',
                son800_bir: '0.48.00', birinci_derece: '1.28.00', at_derece: '1.29.00'
            }]
        }
    ]
};

const pkg = global.IstatistikEngine.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const byName = Object.fromEntries(pkg.rows.map(r => [r.name, r.son800Dr1Korelasyon]));

console.log('comparedCount:', pkg.son800Dr1ComparedCount);
for (const [name, k] of Object.entries(byName)) {
    console.log(name, k ? { pct: k.pct, son800Pct: k.son800Pct, dr1Pct: k.dr1Pct } : null);
}

const best = byName['Hızlı800 İyi1DR'];
const slow = byName['Yavaş800 İyi1DR'];
const badDr = byName['Hızlı800 Kötü1DR'];

if (!best || best.pct !== 100) {
    console.error('FAIL: Hızlı800 İyi1DR should be 100%');
    process.exit(1);
}
if (!slow || slow.pct >= best.pct) {
    console.error('FAIL: Yavaş800 should score lower than best');
    process.exit(1);
}
if (!badDr || badDr.pct >= best.pct) {
    console.error('FAIL: Kötü 1DR should score lower than best');
    process.exit(1);
}
if (best.pct <= badDr.pct) {
    console.error('FAIL: combined best should beat fast800+bad1dr');
    process.exit(1);
}

console.log('OK');
