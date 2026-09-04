/**
 * Yarının tam program çekimi (CLI / child process).
 */
const path = require('path');
const publicProgram = require('./public-program');
const { buildPublicTahmin, assessTahminReadiness } = require('./public-tahmin-build');
const programScheduler = require('./public-program-scheduler');

const DB_PATH = path.join(__dirname, '..', 'atlar.db');

async function fetchTomorrowProgramFull(db, opts = {}) {
    const tarih = publicProgram.tomorrowTr();

    programScheduler.markRunning({
        yarinTarih: tarih,
        source: opts.source || 'cli',
        phase: 'program',
        enrichDone: 0,
        enrichTotal: 0,
        childPid: process.pid
    });
    console.log('yarin-fetch: TAM veri çekimi —', tarih);

    const result = await publicProgram.buildPublicProgram(db, tarih, {
        onlyDomestic: true,
        publish: true,
        source: 'tjk',
        syncHesaplama: true,
        enrichKosular: opts.enrichKosular !== false,
        trigger: opts.trigger || 'cli-full',
        timeoutMs: 120000,
        maxAttempts: 5,
        hipDelayMs: 3000,
        horseDelayMs: opts.horseDelayMs ?? 600,
        maxKosu: opts.maxKosu ?? 7,
        onEnrichProgress: (progress) => {
            programScheduler.markRunning({
                yarinTarih: tarih,
                source: opts.source || 'cli',
                phase: 'enrich',
                enrichDone: progress.done,
                enrichTotal: progress.total,
                enrichHipodrom: progress.hipodrom,
                enrichPct: progress.pct,
                childPid: process.pid
            });
        }
    });

    if (result.basarili > 0) {
        programScheduler.markRunning({
            yarinTarih: tarih,
            phase: 'tahmin',
            childPid: process.pid
        });
        await buildPublicTahmin(db, tarih, { save: true, dbPath: DB_PATH });
    }

    const quality = await assessTahminReadiness(db, tarih);
    if (!quality.ready) {
        throw new Error(
            'Tahmin verisi yetersiz: ' + quality.scoredHorses + '/' + quality.totalHorses
            + ' at skorlu'
        );
    }

    return { tarih, result, quality };
}

module.exports = { fetchTomorrowProgramFull };
