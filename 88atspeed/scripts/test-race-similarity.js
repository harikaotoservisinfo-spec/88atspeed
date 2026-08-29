#!/usr/bin/env node
/**
 * Koşu benzerlik analizi — sınıflandırma + sonuç karşılaştırma (terminal rapor)
 *
 * Her koşudaki renk durumları, hücre değerleri, bayraklar ve metrik imzalarına göre
 * koşuları gruplar; benzer özellikteki koşularda sonuçların ne kadar tutarlı olduğunu ölçer.
 *
 * Kullanım:
 *   npm run test:race-similarity
 *   node scripts/test-race-similarity.js --db /var/www/88atspeed/atlar.db
 *   node scripts/test-race-similarity.js --field-size 10 --min-sample 3
 *   node scripts/test-race-similarity.js --phase archetypes,outcomes,similarity
 *   node scripts/test-race-similarity.js --quick
 */
const {
    loadSimilarityEngines,
    buildFlatEntriesWithFlagsFromDb,
    buildAllRaceProfiles,
    clusterByArchetype,
    clusterByTokenOverlap,
    outcomeStats,
    computeSimilarityValidation,
    featureOutcomeCorrelation,
    formatToken,
    pct,
    pad
} = require('./race-similarity-lib');
const { makeGostergeHost, openDb } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || require('path').join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
    minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 3,
    minJaccard: argVal('--min-jaccard') ? Number(argVal('--min-jaccard')) : 0.45,
    top: argVal('--top') ? Number(argVal('--top')) : 20,
    quick: args.includes('--quick'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    phases: (argVal('--phase') || 'all') === 'all'
        ? ['overview', 'archetypes', 'clusters', 'outcomes', 'features', 'similarity', 'examples']
        : (argVal('--phase') || 'all').split(',').map(s => s.trim()).filter(Boolean)
};

function hr(title) {
    console.log('\n── ' + title + ' ──');
}

function printOverview(profiles, flatEntries) {
    hr('Genel özet');
    const withBitis = profiles.filter(p => p.bitisCount > 0);
    const withWinner = profiles.filter(p => p.hasWinner);
    const byFs = {};
    for (const p of profiles) {
        byFs[p.fieldSize] = (byFs[p.fieldSize] || 0) + 1;
    }
    console.log('  Satır (at):     ' + flatEntries.length);
    console.log('  Koşu:           ' + profiles.length);
    console.log('  Bitiş etiketli: ' + withBitis.length + ' koşu · ' + withWinner.length + ' kazanan biliniyor');
    console.log('  At sayıları:    ' + Object.keys(byFs).sort((a, b) => a - b)
        .map(fs => fs + 'at×' + byFs[fs]).join(' · '));

    let tokenTypes = new Set();
    let visualTypes = new Set();
    for (const p of profiles) {
        for (const k of Object.keys(p.tokenCounts)) tokenTypes.add(k.split('|')[0]);
        for (const k of Object.keys(p.visualCounts)) visualTypes.add(k);
    }
    console.log('  Özellik türleri: Renk(V) · Δ gap · BS · % dilim · Bayrak · Ton · Trend · SON·Δ');
    console.log('  Benzersiz archetype: ' + new Set(profiles.map(p => p.archetypeId)).size);
}

function printArchetypes(profiles) {
    hr('Koşu archetype sınıfları (en sık ' + cli.top + ')');
    const clusters = clusterByArchetype(profiles);
    const ranked = [...clusters.entries()]
        .map(([id, list]) => ({ id, list, stats: outcomeStats(list) }))
        .sort((a, b) => b.list.length - a.list.length);

    for (let i = 0; i < Math.min(cli.top, ranked.length); i++) {
        const row = ranked[i];
        const sample = row.list[0];
        console.log('\n  ' + pad(String(i + 1) + '.', 4) + pad(row.list.length + ' koşu', 8)
            + ' · bitişli ' + pad(String(row.stats.nw), 3)
            + ' · SON800-1 lider kazandı ' + pct(row.stats.leaderSonWinRate));
        console.log('       ' + sample.archetypeShort);
        if (sample.topVisuals.length) {
            console.log('       Renk dağılımı: ' + sample.topVisuals
                .map(v => v.key + '×' + v.count).join(' · '));
        }
        if (sample.topTokens.length) {
            console.log('       Öne çıkan: ' + sample.topTokens.slice(0, 5)
                .map(t => formatToken(t.key) + '×' + t.count).join(' · '));
        }
        if (row.stats.winnerVisuals.length) {
            console.log('       Kazanan at profili: ' + row.stats.winnerVisuals
                .map(v => v.key + ' (' + v.count + '/' + row.stats.nw + ')').join(' · '));
        }
    }
}

function printFuzzyClusters(profiles) {
    hr('Benzerlik kümeleri (Jaccard ≥ ' + cli.minJaccard + ', at sayısı ±2)');
    const clusters = clusterByTokenOverlap(profiles, cli.minJaccard)
        .filter(c => c.length >= cli.minSample)
        .sort((a, b) => b.length - a.length);

    console.log('  Küme sayısı (n≥' + cli.minSample + '): ' + clusters.length);
    const limit = cli.quick ? 10 : cli.top;
    for (let i = 0; i < Math.min(limit, clusters.length); i++) {
        const cluster = clusters[i];
        const st = outcomeStats(cluster);
        const seed = cluster[0];
        console.log('\n  Küme ' + (i + 1) + ' · ' + cluster.length + ' koşu · '
            + seed.fieldSize + ' at ort · bitişli ' + st.nw
            + ' · SON800-1 lider=' + pct(st.leaderSonWinRate));
        console.log('    Temsil: ' + seed.archetypeShort);
        if (st.winnerTokens.length) {
            console.log('    Kazanan ortak: ' + st.winnerTokens.slice(0, 4)
                .map(t => formatToken(t.key) + ' %' + pct(t.count / st.nw).replace('%', '')).join(' · '));
        }
        if (cli.verbose) {
            const examples = cluster.slice(0, 4).map(p =>
                p.hipodrom + ' ' + p.tarih + ' K' + p.raceNo + (p.hasWinner ? ' ✓' : ''));
            console.log('    Örnek: ' + examples.join(' · '));
        }
    }
}

function printOutcomeComparison(profiles) {
    hr('Archetype sonuç tutarlılığı (benzer koşu → benzer sonuç?)');
    const clusters = clusterByArchetype(profiles);
    const multi = [...clusters.entries()]
        .filter(([, list]) => list.length >= cli.minSample && outcomeStats(list).nw >= cli.minSample)
        .map(([id, list]) => ({ id, list, stats: outcomeStats(list) }))
        .sort((a, b) => b.stats.nw - a.stats.nw);

    console.log('  n≥' + cli.minSample + ' archetype: ' + multi.length);
    console.log('  Sütunlar: koşu · bitişli · SON800-1 lider kazandı · kazanan renk çeşitliliği');

    for (const row of multi.slice(0, cli.quick ? 12 : cli.top)) {
        const visVariety = row.stats.winnerVisuals.length;
        const topVis = row.stats.winnerVisuals[0];
        const topVisPct = topVis ? topVis.count / row.stats.nw : 0;
        const consistent = topVisPct >= 0.5 ? '✓ tutarlı' : '~ karışık';
        console.log('  ' + pad(row.list.length + ' koşu', 8)
            + ' · bitiş ' + pad(String(row.stats.nw), 3)
            + ' · lider ' + pad(pct(row.stats.leaderSonWinRate), 7)
            + ' · kazanan renk çeşit ' + visVariety
            + ' · en sık ' + (topVis ? topVis.key + ' ' + pct(topVisPct) : '—')
            + ' ' + consistent);
        console.log('    ' + row.list[0].archetypeShort);
    }
}

function printFeatureCorrelation(profiles) {
    hr('Özellik → kazanan korelasyonu (koşuda özellik varsa kazanan aynı profilde mi?)');
    console.log('  min örnek: ' + cli.minSample + ' koşu · sıralama: kazanan olma oranı');
    const rows = featureOutcomeCorrelation(profiles, cli.minSample);
    const limit = cli.quick ? 15 : cli.top;

    for (let i = 0; i < Math.min(limit, rows.length); i++) {
        const r = rows[i];
        console.log('  ' + pad(String(i + 1) + '.', 4)
            + pad(formatToken(r.token), 42)
            + pad(r.races + ' koşu', 8)
            + ' kazanan ' + pad(String(r.wins), 3)
            + ' · ' + pct(r.winRate));
    }

    hr('Düşük kazanan oranı (tuzak profiller, n≥' + cli.minSample + ')');
    const low = rows.slice().sort((a, b) => a.winRate - b.winRate);
    for (let i = 0; i < Math.min(8, low.length); i++) {
        const r = low[i];
        if (r.winRate > 0.35) break;
        console.log('  ' + pad(formatToken(r.token), 42)
            + pad(r.races + ' koşu', 8) + ' kazanan oranı ' + pct(r.winRate));
    }
}

function printSimilarityValidation(profiles) {
    hr('Benzerlik doğrulama (Jaccard: aynı archetype içi vs farklı archetype)');
    const val = computeSimilarityValidation(profiles, cli.quick ? 400 : 1200);
    console.log('  Archetype sayısı:        ' + val.archetypeClusters);
    console.log('  Çoklu koşulu archetype:  ' + val.multiArchetypeClusters);
    console.log('  İç benzerlik (ort):      ' + (val.withinAvg != null ? val.withinAvg.toFixed(3) : '—')
        + ' · ' + val.withinPairs + ' çift');
    console.log('  Dış benzerlik (ort):     ' + (val.betweenAvg != null ? val.betweenAvg.toFixed(3) : '—')
        + ' · ' + val.betweenPairs + ' çift');
    if (val.withinAvg != null && val.betweenAvg != null) {
        const delta = val.withinAvg - val.betweenAvg;
        console.log('  Fark (iç − dış):         ' + delta.toFixed(3)
            + (delta > 0.05 ? ' → benzer koşular gerçekten daha yakın ✓' : ' → zayıf ayrım'));
    }
}

function printExamples(profiles) {
    hr('Örnek koşu detayları (ilk 5 bitişli)');
    const sample = profiles.filter(p => p.hasWinner).slice(0, 5);
    for (const p of sample) {
        console.log('\n  ' + p.hipodrom + ' · ' + p.tarih + ' · Koşu ' + p.raceNo
            + ' · ' + p.fieldSize + ' at · kayıt #' + p.kayitId);
        console.log('    Archetype: ' + p.archetypeShort);
        if (p.winnerSig) {
            console.log('    Kazanan #' + p.winnerSig.horseNo + ' ' + (p.winnerSig.horseName || ''));
            const wVis = [...p.winnerSig.visualSet].slice(0, 4).join(' · ') || '—';
            const wTok = [...p.winnerSig.tokenSet].slice(0, 6).map(formatToken).join(' · ');
            console.log('    Kazanan renk: ' + wVis);
            console.log('    Kazanan özellik: ' + wTok);
        }
        console.log('    Koşu renk özeti: ' + p.topVisuals.map(v => v.key + '×' + v.count).join(' · '));
        console.log('    Koşu Δ/BS özeti: ' + p.topTokens.slice(0, 6)
            .map(t => formatToken(t.key) + '×' + t.count).join(' · '));
    }
}

async function main() {
    loadSimilarityEngines();
    const db = openDb(cli.dbPath);
    console.log('══ Koşu benzerlik analizi ══');
    console.log('DB: ' + cli.dbPath);

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesWithFlagsFromDb(db, {});
        if (!flatEntries.length) {
            console.log('Veri yok.');
            process.exit(0);
        }
        const host = makeGostergeHost(flatEntries, bitisMap);
        let profiles = buildAllRaceProfiles(flatEntries, host);
        if (cli.fieldSize) {
            profiles = profiles.filter(p => p.fieldSize === cli.fieldSize);
        }

        if (cli.phases.includes('overview')) printOverview(profiles, flatEntries);
        if (cli.phases.includes('archetypes')) printArchetypes(profiles);
        if (cli.phases.includes('clusters')) printFuzzyClusters(profiles);
        if (cli.phases.includes('outcomes')) printOutcomeComparison(profiles);
        if (cli.phases.includes('features')) printFeatureCorrelation(profiles);
        if (cli.phases.includes('similarity')) printSimilarityValidation(profiles);
        if (cli.phases.includes('examples')) printExamples(profiles);

        console.log('\n── Kullanım ──');
        console.log('  npm run test:race-similarity');
        console.log('  node scripts/test-race-similarity.js --field-size 10');
        console.log('  node scripts/test-race-similarity.js --phase features,similarity --min-sample 5');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
