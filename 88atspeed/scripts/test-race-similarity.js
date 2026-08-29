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
 *   node scripts/test-race-similarity.js --phase deep10,winner-field,noise
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
    rowFlagOutcomeCorrelation,
    winnerVsFieldAnalysis,
    deepTenHorseReport,
    noiseFilterReport,
    formatToken,
    DEEP_TEN_METRICS,
    pct,
    pad
} = require('./race-similarity-lib');
const { makeGostergeHost, openDb } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const ALL_PHASES = [
    'overview', 'noise', 'archetypes', 'clusters', 'outcomes',
    'features', 'rowflags', 'winner-field', 'deep10', 'similarity', 'examples'
];

const cli = {
    dbPath: argVal('--db') || require('path').join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null,
    minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 3,
    minJaccard: argVal('--min-jaccard') ? Number(argVal('--min-jaccard')) : 0.45,
    top: argVal('--top') ? Number(argVal('--top')) : 20,
    quick: args.includes('--quick'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    phases: (argVal('--phase') || 'all') === 'all'
        ? ALL_PHASES
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
    console.log('  Özellik türleri: Renk(V) · Δ gap · BS · % dilim · Ton · Trend · SON·Δ · Satır bayrağı(ROW)');
    console.log('  Benzersiz archetype: ' + new Set(profiles.map(p => p.archetypeId)).size);
    const tenAt = profiles.filter(p => p.fieldSize === 10);
    if (tenAt.length) {
        console.log('  10 at koşu:     ' + tenAt.length + ' (derin rapor için --phase deep10)');
    }
}

function printNoiseReport(profiles) {
    hr('Gürültü filtresi (satır bayrağı / t1drKirmizi çoğaltması)');
    const rep = noiseFilterReport(profiles);
    console.log('  ' + rep.note);
    console.log('  Bastırılan F|metrik|satırBayrağı token sayısı: ' + rep.suppressedDuplicateTokens);
    if (rep.removedFlagExamples.length) {
        console.log('  Eski gürültü kaynakları: ' + rep.removedFlagExamples
            .map(e => e.key + '×' + e.count).join(' · '));
    }
    console.log('  Satır bayrakları (ROW|): ' + rep.rowPropagatedFlags.slice(0, 8).join(', ') + '…');
    console.log('  Korelasyon: metrik-spesifik (V|G|B|P|T|R|Δ) ayrı · satır bayrakları (ROW|) ayrı bölümde');
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
            console.log('       Metrik sinyaller: ' + sample.topTokens.slice(0, 5)
                .map(t => formatToken(t.key) + '×' + t.count).join(' · '));
        }
        if (sample.topRowFlags?.length) {
            console.log('       Satır bayrakları: ' + sample.topRowFlags.slice(0, 4)
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
    hr('Metrik-spesifik korelasyon (V|G|B|P|T|R|Δ — satır bayrağı gürültüsü hariç)');
    console.log('  min örnek: ' + cli.minSample + ' koşu · sıralama: kazanan olma oranı');
    const rows = featureOutcomeCorrelation(profiles, cli.minSample, { metricOnly: true });
    const limit = cli.quick ? 15 : cli.top;

    if (!rows.length) {
        console.log('  (yeterli örnek yok — --min-sample düşürün)');
        return;
    }

    for (let i = 0; i < Math.min(limit, rows.length); i++) {
        const r = rows[i];
        console.log('  ' + pad(String(i + 1) + '.', 4)
            + pad(formatToken(r.token), 42)
            + pad(r.races + ' koşu', 8)
            + ' kazanan ' + pad(String(r.wins), 3)
            + ' · ' + pct(r.winRate)
            + ' · ort ' + (r.horses / r.races).toFixed(1) + ' at/koşu');
    }

    hr('Düşük kazanan oranı — tuzak metrik profilleri (n≥' + cli.minSample + ')');
    const low = rows.slice().sort((a, b) => a.winRate - b.winRate);
    for (let i = 0; i < Math.min(10, low.length); i++) {
        const r = low[i];
        if (r.winRate > 0.35) break;
        console.log('  ' + pad(formatToken(r.token), 42)
            + pad(r.races + ' koşu', 8) + ' kazanan oranı ' + pct(r.winRate));
    }
}

function printRowFlagCorrelation(profiles) {
    hr('Satır bayrağı korelasyonu (ROW| — tek seferlik, metrik çoğaltması yok)');
    console.log('  t1drKirmizi vb. artık F|×N metrik olarak sayılmaz');
    const rows = rowFlagOutcomeCorrelation(profiles, cli.minSample);
    const limit = cli.quick ? 12 : cli.top;

    for (let i = 0; i < Math.min(limit, rows.length); i++) {
        const r = rows[i];
        console.log('  ' + pad(formatToken(r.token), 38)
            + pad(r.races + ' koşu', 8)
            + ' kazanan ' + pad(String(r.wins), 3)
            + ' · ' + pct(r.winRate));
    }
}

function printWinnerVsField(profiles) {
    hr('Kazanan vs alan — “koşuda var ama kazanan farklı profilde”');
    console.log('  Metrik: koşuda özellik görüldüğünde kazananın aynı profile sahip olma oranı');
    console.log('  divergence = kazanan yok oranı − kazanan var oranı (yüksek = tuzak sinyal)');

    const analysis = winnerVsFieldAnalysis(profiles, cli.minSample);
    const limit = cli.quick ? 12 : cli.top;

    hr('Farklı profil tuzakları (kazanan genelde bu sinyali taşımıyor)');
    for (let i = 0; i < Math.min(limit, analysis.differentProfile.length); i++) {
        const r = analysis.differentProfile[i];
        if (r.divergence < 0.05) break;
        console.log('  ' + pad(formatToken(r.token), 40)
            + pad(r.races + ' koşu', 8)
            + ' kazanan var ' + pad(pct(r.winnerHasRate), 7)
            + ' · yok ' + pad(pct(r.winnerLacksRate), 7)
            + ' · ort ' + r.avgFieldCount.toFixed(1) + ' at');
    }

    hr('Kazanan hizalı sinyaller (koşuda görüldüğünde kazanan sık taşıyor)');
    for (let i = 0; i < Math.min(limit, analysis.winnerAligned.length); i++) {
        const r = analysis.winnerAligned[i];
        if (r.winnerHasRate < 0.4) break;
        console.log('  ' + pad(formatToken(r.token), 40)
            + pad(r.races + ' koşu', 8)
            + ' kazanan var ' + pad(pct(r.winnerHasRate), 7)
            + ' · lider eşleşme ' + pad(pct(r.leaderMatchRate), 7));
    }

    hr('SON800-1 lider ile hizalı sinyaller');
    for (let i = 0; i < Math.min(8, analysis.leaderAligned.length); i++) {
        const r = analysis.leaderAligned[i];
        if (r.leaderMatchRate == null || r.leaderMatchRate < 0.5) break;
        console.log('  ' + pad(formatToken(r.token), 40)
            + pad(r.races + ' koşu', 8)
            + ' lider taşıyor ' + pct(r.leaderMatchRate));
    }
}

function printDeepTen(profiles) {
    hr('10 at derin rapor — SON800-1 + TEST1 + T1×DR');
    const deepMin = Math.max(2, cli.minSample <= 3 ? 2 : cli.minSample);
    const rep = deepTenHorseReport(profiles, deepMin);

    console.log('  Koşu sayısı: ' + rep.raceCount);
    console.log('  SON800-1 lider kazandı: ' + pct(rep.leaderSonWinRate));
    console.log('  Metrikler: ' + DEEP_TEN_METRICS.map(m => m.label).join(' · '));

    for (const m of DEEP_TEN_METRICS) {
        const bd = rep.metricBreakdown[m.id];
        if (!bd || !bd.n) continue;
        console.log('\n  ▶ ' + bd.label + ' (kazanan profili, n=' + bd.n + ')');
        if (bd.visuals.length) {
            console.log('    Renk:  ' + bd.visuals.map(v => v.key + ' ' + pct(v.count / bd.n)).join(' · '));
        }
        if (bd.gaps.length) {
            console.log('    Δ:     ' + bd.gaps.map(v => v.key + ' ' + pct(v.count / bd.n)).join(' · '));
        }
        if (bd.bs.length) {
            console.log('    BS:    ' + bd.bs.map(v => v.key + ' ' + pct(v.count / bd.n)).join(' · '));
        }
        if (bd.deltas.length) {
            console.log('    SON·Δ: ' + bd.deltas.map(v => v.key + ' ' + pct(v.count / bd.n)).join(' · '));
        }
    }

    hr('Kazanan renk geçişleri (10 at)');
    console.log('  SON800-1 → TEST1:');
    for (const row of rep.crossTabs.son8001_to_test1.slice(0, cli.quick ? 6 : 10)) {
        console.log('    ' + pad(row.key, 28) + row.count + '/' + rep.raceCount
            + ' · ' + pct(row.count / rep.raceCount));
    }
    console.log('  SON800-1 → T1×DR:');
    for (const row of rep.crossTabs.son8001_to_t1dr.slice(0, cli.quick ? 6 : 10)) {
        console.log('    ' + pad(row.key, 28) + row.count + '/' + rep.raceCount
            + ' · ' + pct(row.count / rep.raceCount));
    }
    console.log('  Saha baskın SON800-1 → kazanan TEST1:');
    for (const row of rep.crossTabs.fieldSon_to_winnerTest.slice(0, cli.quick ? 6 : 8)) {
        console.log('    ' + row.key + ' ×' + row.count);
    }

    hr('Tam kombinasyon profilleri (SON800-1/TEST1/T1×DR renk+Δ+BS, n≥' + deepMin + ')');
    const combos = rep.comboRows.length ? rep.comboRows : rep.allCombos;
    const limit = cli.quick ? 8 : 15;
    for (let i = 0; i < Math.min(limit, combos.length); i++) {
        const c = combos[i];
        console.log('\n  ' + pad(String(i + 1) + '.', 4) + c.races + ' koşu · kazanan %100');
        console.log('    ' + c.combo);
        if (c.examples?.length) {
            console.log('    Örnek: ' + c.examples.join(' · '));
        }
    }

    if (!rep.comboRows.length && rep.allCombos.length) {
        console.log('\n  (n≥' + deepMin + ' eşiği için tüm tekil kombinasyonlar — --min-sample 2 deneyin)');
        for (let i = 0; i < Math.min(6, rep.allCombos.length); i++) {
            const c = rep.allCombos[i];
            console.log('  ' + c.races + '× ' + c.combo.slice(0, 100) + (c.combo.length > 100 ? '…' : ''));
        }
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
            const wTok = [...p.winnerSig.metricTokenSet].slice(0, 6).map(formatToken).join(' · ');
            const wRow = [...p.winnerSig.rowFlagSet].slice(0, 4).map(formatToken).join(' · ');
            console.log('    Kazanan renk: ' + wVis);
            console.log('    Kazanan metrik: ' + (wTok || '—'));
            console.log('    Kazanan satır bayrağı: ' + (wRow || '—'));
        }
        console.log('    Koşu renk özeti: ' + p.topVisuals.map(v => v.key + '×' + v.count).join(' · '));
        console.log('    Koşu metrik özeti: ' + p.topTokens.slice(0, 6)
            .map(t => formatToken(t.key) + '×' + t.count).join(' · '));
    }
}

async function main() {
    loadSimilarityEngines();
    const db = openDb(cli.dbPath);
    console.log('══ Koşu benzerlik analizi (v2 — gürültü filtresi + kazanan/alan + 10at derin) ══');
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
        if (cli.phases.includes('noise')) printNoiseReport(profiles);
        if (cli.phases.includes('archetypes')) printArchetypes(profiles);
        if (cli.phases.includes('clusters')) printFuzzyClusters(profiles);
        if (cli.phases.includes('outcomes')) printOutcomeComparison(profiles);
        if (cli.phases.includes('features')) printFeatureCorrelation(profiles);
        if (cli.phases.includes('rowflags')) printRowFlagCorrelation(profiles);
        if (cli.phases.includes('winner-field')) printWinnerVsField(profiles);
        if (cli.phases.includes('deep10')) printDeepTen(profiles);
        if (cli.phases.includes('similarity')) printSimilarityValidation(profiles);
        if (cli.phases.includes('examples')) printExamples(profiles);

        console.log('\n── Kullanım ──');
        console.log('  npm run test:race-similarity');
        console.log('  node scripts/test-race-similarity.js --field-size 10 --phase deep10,winner-field');
        console.log('  node scripts/test-race-similarity.js --phase features,rowflags,noise --min-sample 5');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
