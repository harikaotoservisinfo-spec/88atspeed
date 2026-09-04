#!/usr/bin/env node
/**
 * Kalibrasyon bundle'ı diske yazar — panel MTR/HYB için gerekli.
 *
 *   node scripts/warm-calibration-bundle.js
 *   node scripts/warm-calibration-bundle.js --db /var/www/88atspeed/atlar.db --force
 */
const path = require('path');
const {
    buildCalibrationBundle,
    buildCalibrationBundleFresh,
    getBundleStatus,
    BUNDLE_FILE
} = require('../lib/calibration-bundle');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const dbPath = argVal('--db') || path.join(__dirname, '..', 'atlar.db');
const force = args.includes('--force');

(async function main() {
    console.log('🔥 Kalibrasyon bundle ısıtma');
    console.log('  DB:', dbPath);
    console.log('  Disk:', BUNDLE_FILE);
    const before = getBundleStatus();
    console.log('  Önce:', JSON.stringify(before));

    const t0 = Date.now();
    const built = force
        ? await buildCalibrationBundleFresh(dbPath, false)
        : await buildCalibrationBundle(dbPath, { force: false });
    const after = getBundleStatus();

    console.log('  Sonra:', JSON.stringify(after));
    console.log('✅ Tamam · ' + built.flatCount + ' flat · ' + built.buildMs + 'ms build · '
        + ((Date.now() - t0) / 1000).toFixed(1) + 's toplam');
    if (!after.ready) {
        console.error('❌ Bundle geçersiz — bitisRows yetersiz olabilir');
        process.exit(1);
    }
})().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
