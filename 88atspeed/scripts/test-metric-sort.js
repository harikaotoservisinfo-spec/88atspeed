/* Quick test for metric-based tahmin sorting */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/formula-engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/tahmin-engine.js'), 'utf8'));

const race = {
  mesafe: '1400',
  horses: [
    {
      name: 'At A', no: '1',
      kosular: [{
        tarih: '01.01.2026', sehir: 'İstanbul', mesafe: '1400',
        at_derece: '1.28.50', birinci_derece: '1.27.00',
        son800_bir: '0.52.00', son800_iki: '-', sira: '3'
      }]
    },
    {
      name: 'At B', no: '2',
      kosular: [{
        tarih: '01.01.2026', sehir: 'İstanbul', mesafe: '1400',
        at_derece: '1.27.00', birinci_derece: '1.26.50',
        son800_bir: '0.51.50', son800_iki: '-', sira: '1'
      }]
    },
    {
      name: 'At C', no: '3',
      kosular: [{
        tarih: '01.01.2026', sehir: 'İstanbul', mesafe: '1400',
        at_derece: '1.30.00', birinci_derece: '1.28.00',
        son800_bir: '0.53.00', son800_iki: '-', sira: '5'
      }]
    }
  ]
};

const { names, meta } = TahminEngine.computeTahminForRace(race, { hipodromSehir: 'İstanbul' });
console.log('Sıralama:', names.join(' > '));
console.log('1. at metrikleri:', meta[0]);
if (names[0] !== 'At B') {
  console.error('FAIL: At B should be first (best metrics)');
  process.exit(1);
}
console.log('OK');
