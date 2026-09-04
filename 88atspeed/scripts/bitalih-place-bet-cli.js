#!/usr/bin/env node
/**
 * Bi'Talih sabit ihtimalli tek kupon — sunucudan CLI
 *
 *   node scripts/bitalih-place-bet-cli.js --city Bursa --race 1 --horse "LA BOMBONERA" --bet ilk2 --stake 20
 *   node scripts/bitalih-place-bet-cli.js --dry-run ...
 */
const bitalihBet = require('../lib/bitalih-bet');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const opts = {
    city: argVal('--city') || argVal('--hipodrom') || 'Bursa',
    raceNo: Number(argVal('--race') || argVal('--kosu') || 1),
    horseName: argVal('--horse') || argVal('--at') || '',
    betType: argVal('--bet') || argVal('--bahis') || 'ilk2',
    stake: Number(argVal('--stake') || argVal('--misli') || 20),
    dryRun: args.includes('--dry-run') || args.includes('--test')
};

if (!opts.horseName) {
    console.error('Kullanım: node scripts/bitalih-place-bet-cli.js --horse "AT ADI" [--city Bursa] [--race 1] [--bet ilk2] [--stake 20] [--dry-run]');
    process.exit(1);
}

(async () => {
    console.log('Bi\'Talih kupon:', opts.city, 'K' + opts.raceNo, opts.horseName, opts.betType, opts.stake + ' TL', opts.dryRun ? '(test)' : '(CANLI)');
    const result = await bitalihBet.placeFixedOddsBetInternal(opts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
})().catch((err) => {
    console.error('HATA:', err.message, err.code || '');
    process.exit(1);
});
