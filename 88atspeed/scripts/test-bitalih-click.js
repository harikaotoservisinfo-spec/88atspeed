#!/usr/bin/env node
const bitalihBet = require('../lib/bitalih-bet');
const bitalihFob = require('../lib/bitalih-fob');

(async () => {
    const data = await bitalihFob.fetchFobForHipodrom({ hipodrom: 'Bursa' });
    const race = data.races['1'];
    const target = bitalihFob.normalizeHipName('LA BOMBONERA');
    let horseNo = null;
    for (const col of ['ilk2', 'ganyan']) {
        const byName = race.bets?.[col]?.byName || {};
        const byNo = race.bets?.[col]?.byNo || {};
        for (const [nk, odd] of Object.entries(byName)) {
            if (nk.includes(target)) {
                horseNo = Object.keys(byNo).find((n) => byNo[n] === odd);
                break;
            }
        }
        if (horseNo) break;
    }
    console.log('horseNo', horseNo);

    const result = await bitalihBet.placeFixedOddsBetInternal({
        city: 'Bursa',
        raceNo: 1,
        horseName: 'LA BOMBONERA',
        horseNo,
        betType: 'ilk2',
        stake: 20,
        dryRun: true
    });
    console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
    console.error(e.code, e.message, e.detail);
    process.exit(1);
});
