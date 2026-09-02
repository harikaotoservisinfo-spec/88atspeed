#!/usr/bin/env node
/**
 * TAHMİN GÖSTERİM faktörleri — tekil + ikili kombinasyon başarı testi
 * Taban: 7 BAŞ+ (dimension-only) · kayıt #148,154 varsayılan
 *
 *   npm run test:tahmin-factors
 *   node scripts/test-tahmin-factor-combo.js --kayit 148,154
 *   node scripts/test-tahmin-factor-combo.js --pairs-only
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    openDb,
    dbAll,
    rowKeyParts,
    pct,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitIds: (argVal('--kayit') || '148,154').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)),
    pairsOnly: args.includes('--pairs-only'),
    topN: argVal('--top') ? Number(argVal('--top')) : 15
};

const BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };
const BAS_SOURCES = ['fieldSize', 'sehir', 'kcins_kosu', 'taki', 'pist', 'hp', 'siklet'];

function hr(title) {
    console.log('\n' + '='.repeat(78));
    console.log(title);
    console.log('='.repeat(78));
}

function loadEngines() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    const files = [
        ['public/js/formula-engine.js', 'GosterimEngine'],
        ['public/js/gosterim-headers.js', 'GosterimHeaders'],
        ['public/js/scenario48-scoring-engine.js', 'Scenario48ScoringEngine'],
        ['public/js/astest-son-gosterim-cols.js', 'AtestSonGosterimCols'],
        ['public/js/field-size-stats-engine.js', 'FieldSizeStatsEngine'],
        ['public/js/sehir-stats-engine.js', 'SehirStatsEngine'],
        ['public/js/kosu-dimension-stats-engine.js', 'KosuDimensionStatsEngine'],
        ['public/js/astest-son800-shared.js', 'AtestSon800Shared'],
        ['public/js/dimension-tahmin-boost-engine.js', 'DimensionTahminBoostEngine']
    ];
    for (const [file, name] of files) {
        eval(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n; global.' + name + ' = ' + name + ';');
    }
    Scenario48ScoringEngine.setScenarioBonusCap(38, 38);
}

async function loadBitisMap(db) {
    const sqlite3 = require('sqlite3').verbose();
    return new Promise((resolve) => {
        const db2 = new sqlite3.Database(cli.dbPath);
        db2.get('SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1', [], (err, row) => {
            db2.close();
            if (err || !row?.veri) return resolve({});
            try {
                const parsed = JSON.parse(row.veri);
                return resolve(parsed.bitis || parsed);
            } catch (_) {
                return resolve({});
            }
        });
    });
}

function resolveBitis(horse, kayitId, raceNo, bitisMap) {
    const key = rowKeyParts(kayitId, raceNo, horse.no);
    let b = bitisMap[key];
    if (b == null || b < 1) b = global.AtSpeedUtils.extractBitisFromHorseName(horse.name);
    return b != null && b >= 1 ? b : null;
}

function computeBasForSource(horse, race, meta, sourceKey, sonCtx) {
    const kosular = horse.kosular || [];
    const programTarih = meta?.tarih || null;
    const hedefSehir = meta?.hipodrom || '';
    let st;
    if (sourceKey === 'fieldSize') {
        st = FieldSizeStatsEngine.computeStats(
            kosular, programTarih, FieldSizeStatsEngine.raceFieldSize(race));
    } else if (sourceKey === 'sehir') {
        st = SehirStatsEngine.computeStats(kosular, hedefSehir, programTarih);
    } else {
        const dim = KosuDimensionStatsEngine.getDim(sourceKey);
        if (!dim) return { basSuccess: { display: '—' } };
        const horseCtx = Object.assign({}, horse, { kosular: kosular });
        st = KosuDimensionStatsEngine.computeStats(kosular, sourceKey, dim.getTarget(horseCtx, race), programTarih);
    }
    if (typeof AtestSon800Shared !== 'undefined' && sonCtx) {
        st = AtestSon800Shared.applyBasDeltaBoost(st, horse, sonCtx);
    }
    return st;
}

function buildHorseRows(race, meta, enabledFactors) {
    const horses = [...(race.horses || [])].sort((a, b) => {
        const na = parseInt(a.no, 10);
        const nb = parseInt(b.no, 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
    });
    const sonCtx = AtestSon800Shared.buildRaceContext(race, horses, meta.hipodrom, meta.tarih);
    const horseRows = horses.map(function (h) {
        const basBySource = {};
        for (let i = 0; i < BAS_SOURCES.length; i++) {
            basBySource[BAS_SOURCES[i]] = computeBasForSource(h, race, meta, BAS_SOURCES[i], sonCtx);
        }
        return { h: h, basBySource: basBySource, tahmin: null };
    });
    DimensionTahminBoostEngine.computeDimensionOnlyFromBasBySource(horseRows);
    const resolveKosular = (horse) => horse.kosular || [];
    const gosByKey = AtestSonGosterimCols.buildSiraOneMap(race, meta, resolveKosular);
    const opts = enabledFactors && enabledFactors.size
        ? { enabledFactors: enabledFactors }
        : { enabledFactors: new Set() };
    if (enabledFactors && enabledFactors.size && gosByKey.size) {
        AtestSonGosterimCols.applyTahminBonuses(
            horseRows, gosByKey, race, meta, resolveKosular, opts);
    } else if (!enabledFactors || !enabledFactors.size) {
        /* taban only — sıra dimension skorundan */
    } else if (gosByKey.size) {
        AtestSonGosterimCols.applyTahminBonuses(
            horseRows, gosByKey, race, meta, resolveKosular, opts);
    }
    return horseRows;
}

function evaluateRace(horseRows, kayitId, raceNo, bitisMap) {
    const ranked = horseRows
        .filter(r => r.tahmin?.rank != null)
        .sort((a, b) => a.tahmin.rank - b.tahmin.rank);
    if (ranked.length < 2) return null;
    const pick = (rank) => {
        const row = ranked.find(r => r.tahmin.rank === rank);
        return row ? resolveBitis(row.h, kayitId, raceNo, bitisMap) : null;
    };
    const b1 = pick(1);
    if (b1 == null) return null;
    const b2 = pick(2);
    const b3 = pick(3);
    return {
        star1: b1 === 1,
        top3Leader: b1 <= 3,
        rank2Exact: b2 === 2,
        rank3Exact: b3 === 3,
        blend: b1 === 1 ? BLEND.b1 : b1 <= 2 ? BLEND.b12 : b1 <= 3 ? BLEND.b123 : 0
    };
}

async function loadKayitRaces(db, kayitId) {
    const rows = await dbAll(db,
        'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [kayitId]);
    if (!rows.length) return null;
    const kayit = rows[0];
    let races;
    try { races = JSON.parse(kayit.veri); } catch (_) { return null; }
    if (!Array.isArray(races)) return null;
    return {
        kayitId: kayit.id,
        meta: { tarih: kayit.tarih, hipodrom: kayit.hipodrom },
        races: races.map((race, i) => Object.assign({}, race, {
            raceNo: race.raceNo || (i + 1),
            horses: (race.horses || []).map(h => Object.assign({}, h, { kosular: h.kosular || [] }))
        }))
    };
}

function evaluateFactorSet(allRaces, bitisMap, enabledFactors) {
    const agg = { races: 0, star1: 0, top3Leader: 0, rank2Exact: 0, rank3Exact: 0, blendSum: 0 };
    for (const bundle of allRaces) {
        for (const race of bundle.races) {
            const horseRows = buildHorseRows(race, bundle.meta, enabledFactors);
            const ev = evaluateRace(horseRows, bundle.kayitId, race.raceNo, bitisMap);
            if (!ev) continue;
            agg.races++;
            if (ev.star1) agg.star1++;
            if (ev.top3Leader) agg.top3Leader++;
            if (ev.rank2Exact) agg.rank2Exact++;
            if (ev.rank3Exact) agg.rank3Exact++;
            agg.blendSum += ev.blend;
        }
    }
    const n = Math.max(1, agg.races);
    return {
        races: agg.races,
        star1: agg.star1,
        top3: agg.top3Leader,
        r2: agg.rank2Exact,
        r3: agg.rank3Exact,
        star1Pct: agg.star1 / n,
        top3Pct: agg.top3Leader / n,
        blend: agg.blendSum / n
    };
}

function factorLabel(ids, factors) {
    const map = new Map(factors.map(f => [f.id, f.short]));
    return ids.map(id => map.get(id) || id).join('+');
}

function printMetricRow(label, m, base) {
    const d1 = base ? m.star1 - base.star1 : 0;
    const d3 = base ? m.top3 - base.top3 : 0;
    const sign1 = d1 > 0 ? '+' : '';
    const sign3 = d3 > 0 ? '+' : '';
    console.log(pad(label, 22)
        + pad(pct(m.star1Pct) + ' (' + m.star1 + '/' + m.races + ')', 16)
        + pad(pct(m.top3Pct) + ' (' + m.top3 + '/' + m.races + ')', 16)
        + pad((m.blend * 100).toFixed(1) + '%', 10)
        + pad(base ? sign1 + d1 : '—', 6)
        + pad(base ? sign3 + d3 : '—', 6));
}

function allPairs(factors) {
    const out = [];
    for (let i = 0; i < factors.length; i++) {
        for (let j = i + 1; j < factors.length; j++) {
            out.push([factors[i].id, factors[j].id]);
        }
    }
    return out;
}

function greedyChain(factors, allRaces, bitisMap, base) {
    const remaining = factors.map(f => f.id);
    const chain = [];
    let current = base;
    const steps = [];

    while (remaining.length) {
        let bestId = null;
        let bestMetric = null;
        for (const id of remaining) {
            const set = new Set(chain.concat([id]));
            const m = evaluateFactorSet(allRaces, bitisMap, set);
            const gain = m.star1 - current.star1;
            const gain3 = m.top3 - current.top3;
            if (!bestMetric
                || gain > bestMetric.gain
                || (gain === bestMetric.gain && gain3 > bestMetric.gain3)) {
                bestId = id;
                bestMetric = { m: m, gain: gain, gain3: gain3 };
            }
        }
        chain.push(bestId);
        remaining.splice(remaining.indexOf(bestId), 1);
        current = bestMetric.m;
        steps.push({
            id: bestId,
            metric: bestMetric.m,
            gainStar1: bestMetric.gain,
            gainTop3: bestMetric.gain3
        });
    }
    return steps;
}

async function main() {
    loadEngines();
    const factors = AtestSonGosterimCols.TAHMIN_BONUS_FACTORS;
    const db = openDb(cli.dbPath);
    const bitisMap = await loadBitisMap(db);

    hr('TAHMİN GÖSTERİM FAKTÖR KOMBİNASYON TESTİ');
    console.log('DB: ' + cli.dbPath + ' · Kayıtlar: ' + cli.kayitIds.join(', '));
    console.log('Taban: 7 BAŞ+ dimension-only · metrik: TAHMİN #1 → ★1 / ◆1-3\n');

    const allRaces = [];
    for (const kid of cli.kayitIds) {
        const bundle = await loadKayitRaces(db, kid);
        if (bundle) allRaces.push(bundle);
    }
    db.close();
    if (!allRaces.length) {
        console.error('Kayıt bulunamadı.');
        process.exit(1);
    }

    const header = pad('Kombinasyon', 22)
        + pad('★1', 16) + pad('◆1-3', 16)
        + pad('Blend', 10) + pad('Δ★1', 6) + pad('Δ◆3', 6);

    const base = evaluateFactorSet(allRaces, bitisMap, new Set());
    const full = evaluateFactorSet(allRaces, bitisMap,
        new Set(factors.map(f => f.id)));

    console.log('Koşu: ' + base.races);
    console.log(header);
    console.log('-'.repeat(78));
    printMetricRow('TABAN (7 BAŞ+)', base, null);

    if (!cli.pairsOnly) {
        hr('TEK FAKTÖR (taban + 1)');
        console.log(header);
        console.log('-'.repeat(78));
        const singles = [];
        for (const f of factors) {
            const m = evaluateFactorSet(allRaces, bitisMap, new Set([f.id]));
            singles.push({ ids: [f.id], label: f.short, metric: m });
            printMetricRow(f.short + ' (' + f.label + ')', m, base);
        }
        singles.sort((a, b) => b.metric.star1 - a.metric.star1
            || b.metric.top3 - a.metric.top3);
        console.log('\nTek faktör sıralama (★1): '
            + singles.map(s => s.label + '=' + s.metric.star1).join(' · '));
    }

    hr('İKİLİ KOMBİNASYON (taban + A + B) — ★1 artışına göre');
    console.log(header);
    console.log('-'.repeat(78));

    const pairResults = [];
    for (const [a, b] of allPairs(factors)) {
        const m = evaluateFactorSet(allRaces, bitisMap, new Set([a, b]));
        pairResults.push({
            ids: [a, b],
            label: factorLabel([a, b], factors),
            metric: m,
            gainStar1: m.star1 - base.star1,
            gainTop3: m.top3 - base.top3
        });
    }
    pairResults.sort((x, y) => y.gainStar1 - x.gainStar1
        || y.gainTop3 - x.gainTop3
        || y.metric.star1 - x.metric.star1);

    const show = pairResults.slice(0, cli.topN);
    for (const p of show) {
        printMetricRow(p.label, p.metric, base);
    }
    console.log('\n… toplam ' + pairResults.length + ' ikili · ilk ' + show.length + ' gösterildi');

    hr('EN İYİ 5 İKİLİ (Δ★1)');
    for (let i = 0; i < Math.min(5, pairResults.length); i++) {
        const p = pairResults[i];
        const fa = factors.find(f => f.id === p.ids[0]);
        const fb = factors.find(f => f.id === p.ids[1]);
        console.log((i + 1) + '. ' + p.label
            + ' · ' + fa.label + ' + ' + fb.label
            + '\n   ★1 ' + pct(p.metric.star1Pct) + ' (Δ' + (p.gainStar1 >= 0 ? '+' : '') + p.gainStar1 + ')'
            + ' · ◆1-3 ' + pct(p.metric.top3Pct) + ' (Δ' + (p.gainTop3 >= 0 ? '+' : '') + p.gainTop3 + ')'
            + ' · blend ' + (p.metric.blend * 100).toFixed(1) + '%');
    }

    hr('GREEDY ZİNCİR (sırayla en iyi eklenen faktör)');
    const steps = greedyChain(factors, allRaces, bitisMap, base);
    let acc = base;
    console.log(pad('Adım', 6) + pad('Eklenen', 10) + pad('★1', 14) + pad('Δ★1', 6) + pad('◆1-3', 14) + pad('Δ◆3', 6));
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const f = factors.find(x => x.id === s.id);
        console.log(pad(String(i + 1), 6)
            + pad(f.short, 10)
            + pad(s.metric.star1 + '/' + s.metric.races, 14)
            + pad((s.gainStar1 >= 0 ? '+' : '') + s.gainStar1, 6)
            + pad(s.metric.top3 + '/' + s.metric.races, 14)
            + pad((s.gainTop3 >= 0 ? '+' : '') + s.gainTop3, 6));
        acc = s.metric;
    }

    hr('DOĞRULAMA — TÜM FAKTÖRLER');
    console.log(header);
    console.log('-'.repeat(78));
    printMetricRow('TÜM FAKTÖRLER', full, base);
    console.log('\n(Üretim TAHMİN ile aynı olmalı — önceki cap test: ★1 ~35%, ◆1-3 ~71%)');
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
