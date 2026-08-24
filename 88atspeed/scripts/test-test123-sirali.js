/* Test TEST·SIRA (T3≥T2≥T1) derinlik kıyası */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');

const IE = global.IstatistikEngine;

// Görseldeki örnek değerlere yakın salise hesabı
const race = {
    mesafe: '1400',
    horses: [
        {
            no: 1, name: 'Kural Uyan',
            kosular: [{
                tarih: '20.08.2026', mesafe: '1400',
                at_derece: '1.36.70', son800_bir: '1.37.05', son800_iki: '1.39.19'
            }]
        },
        {
            no: 2, name: 'Kural Bozuk',
            kosular: [{
                tarih: '18.08.2026', mesafe: '1400',
                at_derece: '1.40.00', son800_bir: '0.40.00', son800_iki: '0.42.00'
            }]
        },
        {
            no: 3, name: 'Kısmi Uyan',
            kosular: [{
                tarih: '15.08.2026', mesafe: '1400',
                at_derece: '1.37.09', son800_bir: '1.37.16', son800_iki: '1.37.80'
            }]
        }
    ]
};

const skor = IE._computeTest123SiraliSkor(
    IE._kosuTest1Metrikleri(race.horses[0].kosular[0], 1400).test1,
    IE._kosuTest2Metrikleri(race.horses[0].kosular[0], 1400).test2,
    IE._kosuTest3Metrikleri(race.horses[0].kosular[0], 1400).test3
);
if (!skor.qualifies) {
    console.error('FAIL: horse 1 should qualify T3>=T2>=T1');
    process.exit(1);
}
if (skor.rulePct !== 100) {
    console.error('FAIL: qualified horse rulePct should be 100, got', skor.rulePct);
    process.exit(1);
}

const skor2 = IE._computeTest123SiraliSkor(
    IE._kosuTest1Metrikleri(race.horses[1].kosular[0], 1400).test1,
    IE._kosuTest2Metrikleri(race.horses[1].kosular[0], 1400).test2,
    IE._kosuTest3Metrikleri(race.horses[1].kosular[0], 1400).test3
);
if (skor2.qualifies) {
    console.error('FAIL: horse 2 should NOT qualify (T2 < T1)');
    process.exit(1);
}
if (skor2.rulePct >= 100) {
    console.error('FAIL: non-qualifier rulePct should be < 100');
    process.exit(1);
}

const pkg = IE.buildRaceIstatistikPackage(race, 'İstanbul', '24.08.2026');
const uyan = pkg.rows.find(r => r.name === 'Kural Uyan');
const bozuk = pkg.rows.find(r => r.name === 'Kural Bozuk');

if (!uyan?.test123SiraliDepths[0] || uyan.test123SiraliDepths[0].pct !== 100) {
    console.error('FAIL: qualifying horse field pct should be 100');
    process.exit(1);
}

if (!bozuk?.test123SiraliDepths[0] || bozuk.test123SiraliDepths[0].pct >= 100) {
    console.error('FAIL: non-qualifier field pct should be < 100');
    process.exit(1);
}

if (!uyan.test123SiraliAgirlikliOrt || uyan.test123SiraliAgirlikliOrt.pct !== 100) {
    console.error('FAIL: weighted avg for qualifier should be 100');
    process.exit(1);
}

console.log('Kural Uyan:', uyan.test123SiraliDepths[0].pct + '%', 'rulePct=' + uyan.test123SiraliDepths[0].rulePct);
console.log('Kural Bozuk:', bozuk.test123SiraliDepths[0].pct + '%', 'rulePct=' + bozuk.test123SiraliDepths[0].rulePct);
console.log('OK');
