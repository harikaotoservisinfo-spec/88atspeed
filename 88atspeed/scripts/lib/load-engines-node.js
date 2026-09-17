/**
 * Tarayıcı istatistik motorlarını Node içinde yükle (tek scope).
 */
const fs = require('fs');
const path = require('path');

const JS_ROOT = path.join(__dirname, '../../public/js');

const BUNDLE_FILES = [
    'utils.js',
    'istatistik-engine.js',
    'istatistik-grids-extra.js',
    'istatistik-tahmin-engine.js',
    'gosterge-scoring-engine.js'
];

let _cached = null;

function loadEngines() {
    if (_cached) return _cached;
    const ctx = {
        console,
        Math,
        Date,
        parseInt,
        parseFloat,
        JSON,
        Array,
        Object,
        String,
        Number,
        Map,
        Set,
        Promise,
        isNaN,
        RegExp,
        Error,
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        }
    };

    const code = BUNDLE_FILES.map((f) => {
        return '/* ' + f + ' */\n' + fs.readFileSync(path.join(JS_ROOT, f), 'utf8');
    }).join('\n\n');

    const keys = Object.keys(ctx);
    const vals = keys.map((k) => ctx[k]);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, code + `
;return {
  IE: typeof IstatistikEngine !== 'undefined' ? IstatistikEngine : null,
  ITE: typeof IstatistikTahminEngine !== 'undefined' ? IstatistikTahminEngine : null,
  GSE: typeof GostergeScoringEngine !== 'undefined' ? GostergeScoringEngine : null,
  utils: typeof AtSpeedUtils !== 'undefined' ? AtSpeedUtils : null
};`);
    _cached = fn(...vals);
    return _cached;
}

module.exports = { loadEngines, JS_ROOT };
