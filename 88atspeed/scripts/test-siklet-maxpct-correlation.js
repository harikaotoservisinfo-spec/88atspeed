#!/usr/bin/env node
/**
 * SİKLET MAX% korelasyon — 100%·100%·100%·100% olan atların birincilik başarısı
 *
 * MAX% = min(100, MAX-N ÷ bugünkü alan × 100) · dörtlü tam %100 = tüm MAX-* kanıtı
 * bugünkü kalabalığa yetiyor (MAX-1/12/123/1234 hepsi %100).
 *
 *   node scripts/test-siklet-maxpct-correlation.js --db atlar.db
 *   node scripts/test-siklet-maxpct-correlation.js --kayit 148
 *   node scripts/test-siklet-maxpct-correlation.js --kayit 148 --race 1 -v
 *   node scripts/test-siklet-maxpct-correlation.js --list
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    openDb,
    dbAll,
    buildFlatEntriesFromDb,
    makeGostergeHost,
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
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    minSkKosu: argVal('--min-sk-kosu') ? Number(argVal('--min-sk-kosu')) : 1,
    verbose: args.includes('--verbose') || args.includes('-v'),
    listOnly: args.includes('--list')
};

function loadEngines() {
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/utils.js'), 'utf8')
        + '\n; global.AtSpeedUtils = AtSpeedUtils;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function isMaxPctFull100(maxPct) {
    return !!(maxPct?.parts?.length === 4 && maxPct.parts.every(p => p.pct === 100));
}

function isMaxPctAvg100(maxPct) {
    return maxPct?.avg === 100;
}

function resolveBitis(kayitId, raceNo, horse, bitisLookup) {
    const key = rowKeyParts(kayitId, raceNo, horse.no);
    if (bitisLookup.has(key)) {
        const b = bitisLookup.get(key);
        if (b != null && b >= 1) return b;
    }
    const fromName = global.AtSpeedUtils.extractBitisFromHorseName(horse.name);
    return fromName != null && fromName >= 1 ? fromName : null;
}

function summarizeBitis(list) {
    const withBit = list.filter(h => h.bitis != null && h.bitis >= 1);
    const w1 = withBit.filter(h => h.bitis === 1).length;
    const w12 = withBit.filter(h => h.bitis <= 2).length;
    const w123 = withBit.filter(h => h.bitis <= 3).length;
    const n = withBit.length;
    return {
        n,
        w1,
        w12,
        w123,
        pct1: n ? Math.round(1000 * w1 / n) / 10 : null,
        pct12: n ? Math.round(1000 * w12 / n) / 10 : null,
        pct123: n ? Math.round(1000 * w123 / n) / 10 : null
    };
}

function fmtStat(s) {
    if (!s.n) return '— (n=0)';
    return pct(s.pct1 / 100) + ' ★ · ' + pct(s.pct12 / 100) + ' ◆ · n=' + s.n;
}

function buildHorseRow(ctx, bitisLookup) {
    const { horse, race, kayitId, hipodrom, tarih } = ctx;
    const dim = KosuDimensionStatsEngine.DIMENSIONS.siklet;
    const kosular = horse.kosular || [];
    const horseCtx = Object.assign({}, horse, { kosular });
    const hedef = dim.getTarget(horseCtx, race);
    const st = KosuDimensionStatsEngine.computeStats(kosular, 'siklet', hedef);
    const fieldSize = FieldSizeStatsEngine.raceFieldSize(race);
    const maxPct = FieldSizeStatsEngine.computeMaxSuccessPct(st, fieldSize);
    const skFilled = st.kosuSayisi > 0;

    return {
        kayitId,
        raceNo: race.raceNo,
        no: horse.no,
        name: horse.name,
        hipodrom,
        tarih,
        hedef: st.hedefAbbrev,
        fieldSize,
        bitis: resolveBitis(kayitId, race.raceNo, horse, bitisLookup),
        st,
        maxPct,
        maxDisplay: maxPct.display,
        maxAvg: maxPct.avg,
        maxFull100: isMaxPctFull100(maxPct),
        maxAvg100: isMaxPctAvg100(maxPct),
        skFilled,
        matchCount: st.matchCount,
        cnt1: st.cnt1,
        max1: st.max1
    };
}

function buildRaceGroups(rows, predicate) {
    const map = new Map();
    for (const h of rows.filter(predicate)) {
        const rk = h.kayitId + '|' + h.raceNo;
        if (!map.has(rk)) map.set(rk, []);
        map.get(rk).push(h);
    }
    return [...map.values()];
}

function evaluateRaceLeader(raceGroups, pickFn, label) {
    let races = 0;
    let skippedNoPick = 0;
    let skippedNoBitis = 0;
    let tie = 0;
    let b1 = 0;
    let b12 = 0;
    let b123 = 0;

    for (const horses of raceGroups) {
        const pick = pickFn(horses);
        if (!pick) {
            skippedNoPick++;
            continue;
        }
        if (pick.tie) {
            tie++;
            continue;
        }
        const bit = pick.horse.bitis;
        if (bit == null || bit < 1) {
            skippedNoBitis++;
            continue;
        }
        races++;
        if (bit === 1) b1++;
        if (bit <= 2) b12++;
        if (bit <= 3) b123++;
    }

    return {
        label,
        races,
        tie,
        skippedNoPick,
        skippedNoBitis,
        b1,
        b12,
        b123,
        pct1: races ? Math.round(1000 * b1 / races) / 10 : null,
        pct12: races ? Math.round(1000 * b12 / races) / 10 : null,
        pct123: races ? Math.round(1000 * b123 / races) / 10 : null
    };
}

function pickMaxFull100Leader(horses, minSkKosu) {
    const minSk = minSkKosu ?? cli.minSkKosu;
    const pool = horses.filter(h =>
        h.skFilled
        && h.matchCount >= minSk
        && h.maxFull100
    );
    if (!pool.length) return null;
    if (pool.length === 1) return { horse: pool[0], tie: false };
    pool.sort((a, b) => (b.cnt1 - a.cnt1) || (b.matchCount - a.matchCount) || ((a.no ?? 0) - (b.no ?? 0)));
    if (pool.length > 1 && pool[0].cnt1 === pool[1].cnt1 && pool[0].matchCount === pool[1].matchCount) {
        return { tie: true, pool };
    }
    return { horse: pool[0], tie: false };
}

function pickSkPctLeader(horses, minSkKosu) {
    const minSk = minSkKosu ?? cli.minSkKosu;
    const pool = horses.filter(h =>
        h.skFilled
        && h.matchCount >= minSk
        && h.st.matchPct != null
        && h.bitis != null
        && h.bitis >= 1
    );
    if (pool.length < 2) return null;
    pool.sort((a, b) => (b.st.matchPct - a.st.matchPct) || ((a.no ?? 0) - (b.no ?? 0)));
    if (pool[0].st.matchPct === pool[1].st.matchPct) return { tie: true, pool };
    return { horse: pool[0], tie: false };
}

function pickRandomBaseline(raceGroups) {
    let races = 0;
    let b1 = 0;
    for (const horses of raceGroups) {
        const pool = horses.filter(h => h.bitis != null && h.bitis >= 1);
        if (!pool.length) continue;
        races++;
        b1 += 1 / pool.length;
    }
    return {
        label: 'Rastgele (1/alan)',
        races,
        pct1: races ? Math.round(1000 * b1 / races) / 10 : null
    };
}

function buildPool(rows, minSkKosu) {
    const skPool = rows.filter(h => h.skFilled && h.matchCount >= minSkKosu);
    return {
        skPool,
        maxFull: skPool.filter(h => h.maxFull100),
        raceGroups: buildRaceGroups(skPool, h => h.bitis != null && h.bitis >= 1)
    };
}

function analyzeMinSk(rows, minSkKosu) {
    const { skPool, maxFull, raceGroups } = buildPool(rows, minSkKosu);
    const statFull = summarizeBitis(maxFull);
    const statAll = summarizeBitis(skPool);
    const leaderMax = evaluateRaceLeader(raceGroups, h => pickMaxFull100Leader(h, minSkKosu));
    return { skPool, maxFull, statFull, statAll, leaderMax };
}

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }

function printHorseLine(h) {
    const name = String(h.name || '').replace(/\(\d+\)/, '').trim().slice(0, 20);
    const mark = h.bitis === 1 ? '★' : h.bitis != null && h.bitis <= 3 ? '◆' : '·';
    console.log('  ' + mark + ' #' + kayitLabel(h) + ' K' + h.raceNo + ' · #' + pad(h.no, 2)
        + ' ' + pad(name, 20)
        + ' SK-KOŞU=' + pad(h.matchCount, 2)
        + ' MAX%=' + pad(h.maxDisplay, 22)
        + ' BİT=' + pad(h.bitis ?? '—', 3)
        + ' cnt1=' + h.cnt1);
}

function kayitLabel(h) {
    return String(h.kayitId);
}

async function main() {
    loadGostergeEngines();
    loadEngines();
    const db = openDb(cli.dbPath);

    try {
        let kayitlar = await dbAll(db,
            'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
        if (cli.kayitId) {
            kayitlar = kayitlar.filter(k => Number(k.id) === cli.kayitId);
        }
        if (!kayitlar.length) {
            console.error('Kayıt bulunamadı');
            process.exit(1);
        }

        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId || undefined,
            filterRace: cli.raceNo || undefined
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        const bitisLookup = new Map();
        for (const e of flatEntries) {
            bitisLookup.set(
                rowKeyParts(e.kayitId, e.raceNo, e.row?.no),
                host.bitisValueForSort(e)
            );
        }

        const rows = [];
        for (const kayit of kayitlar) {
            let races;
            try {
                races = JSON.parse(kayit.veri);
            } catch (_) {
                continue;
            }
            if (!Array.isArray(races)) continue;
            for (const race of races) {
                const raceNo = race.raceNo;
                if (cli.raceNo && Number(raceNo) !== cli.raceNo) continue;
                for (const horse of race.horses || []) {
                    rows.push(buildHorseRow({
                        horse,
                        race,
                        kayitId: kayit.id,
                        hipodrom: kayit.hipodrom,
                        tarih: kayit.tarih
                    }, bitisLookup));
                }
            }
        }

        if (!rows.length) {
            console.error('At bulunamadı');
            process.exit(1);
        }

        const skPool = rows.filter(h => h.skFilled && h.matchCount >= cli.minSkKosu);
        const maxFull = skPool.filter(h => h.maxFull100);
        const maxAvgOnly = skPool.filter(h => h.maxAvg100 && !h.maxFull100);
        const others = skPool.filter(h => !h.maxAvg100);

        if (cli.listOnly) {
            console.log('MAX% 100%·100%·100%·100% — ' + maxFull.length + ' at\n');
            for (const h of maxFull) printHorseLine(h);
            console.log('\nOK · ' + maxFull.length + ' at');
            return;
        }

        const raceGroupsAll = buildRaceGroups(skPool, h => h.bitis != null && h.bitis >= 1);
        const statFull = summarizeBitis(maxFull);
        const statAvgOnly = summarizeBitis(maxAvgOnly);
        const statOthers = summarizeBitis(others);
        const statAll = summarizeBitis(skPool);

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  SİKLET MAX% korelasyon — 100%·100%·100%·100% → BİTİŞ ★        ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt: ' + (cli.kayitId ? '#' + cli.kayitId : kayitlar.length + ' kayıt')
            + (cli.raceNo ? ' · K' + cli.raceNo : '')
            + ' · SK-KOŞU≥' + cli.minSkKosu);
        console.log('MAX% tam %100 = MAX-1/12/123/1234 hepsi bugünkü alana yetiyor\n');

        hr('1. AT DÜZEYİ — MAX% 100%·100%·100%·100% vs diğerleri');
        console.log('  ' + pad('Grup', 28) + pad('★ 1.', 12) + pad('◆ 1-2', 12) + 'n');
        console.log('  ' + '-'.repeat(58));
        console.log('  ' + pad('MAX% tam 100×4', 28) + pad(statFull.pct1 != null ? statFull.pct1 + '%' : '—', 12)
            + pad(statFull.pct12 != null ? statFull.pct12 + '%' : '—', 12) + statFull.n);
        console.log('  ' + pad('MAX%Ø=100 (tam değil)', 28) + pad(statAvgOnly.pct1 != null ? statAvgOnly.pct1 + '%' : '—', 12)
            + pad(statAvgOnly.pct12 != null ? statAvgOnly.pct12 + '%' : '—', 12) + statAvgOnly.n);
        console.log('  ' + pad('MAX%Ø<100', 28) + pad(statOthers.pct1 != null ? statOthers.pct1 + '%' : '—', 12)
            + pad(statOthers.pct12 != null ? statOthers.pct12 + '%' : '—', 12) + statOthers.n);
        console.log('  ' + pad('Tüm SİKLET (referans)', 28) + pad(statAll.pct1 != null ? statAll.pct1 + '%' : '—', 12)
            + pad(statAll.pct12 != null ? statAll.pct12 + '%' : '—', 12) + statAll.n);

        if (statFull.n && statAll.n) {
            const lift = statFull.pct1 != null && statAll.pct1 != null
                ? Math.round((statFull.pct1 - statAll.pct1) * 10) / 10 : null;
            console.log('\n  ★ lift (tam MAX%100 − genel): '
                + (lift != null ? (lift >= 0 ? '+' : '') + lift + ' puan' : '—'));
        }

        const sk1Count = maxFull.filter(h => h.matchCount === 1).length;
        if (maxFull.length && sk1Count >= Math.ceil(maxFull.length / 2)) {
            console.log('\n  ⚠ ' + sk1Count + '/' + maxFull.length
                + ' MAX%100×4 at SK-KOŞU=1 — tek eşleşme ile MAX% kolay dolabilir.'
                + ' Bölüm 4\'te SK-KOŞU≥2 kontrolüne bakın.');
        }

        hr('2. KOŞU LİDERİ — koşuda MAX%100×4 adayını seç → BİTİŞ');
        const leaderMax = evaluateRaceLeader(raceGroupsAll, h => pickMaxFull100Leader(h, cli.minSkKosu));
        const leaderSk = evaluateRaceLeader(raceGroupsAll, h => pickSkPctLeader(h, cli.minSkKosu));
        const baseline = pickRandomBaseline(raceGroupsAll);

        console.log('  Koşuda MAX%100×4 aday varsa seçilir; birden fazlaysa cnt1 ile tie-break.');
        console.log('  ' + pad('Strateji', 22) + pad('★ 1.', 10) + pad('◆ 1-2', 10)
            + pad('◆◆ 1-3', 10) + 'koşu');
        console.log('  ' + '-'.repeat(58));
        console.log('  ' + pad('MAX%100×4 lider', 24)
            + pad(leaderMax.pct1 != null ? leaderMax.pct1 + '%' : '—', 10)
            + pad(leaderMax.pct12 != null ? leaderMax.pct12 + '%' : '—', 10)
            + pad(leaderMax.pct123 != null ? leaderMax.pct123 + '%' : '—', 10)
            + leaderMax.races
            + ' (tie=' + leaderMax.tie + ', aday yok=' + leaderMax.skippedNoPick + ')');
        console.log('  ' + pad('SK% lider', 24)
            + pad(leaderSk.pct1 != null ? leaderSk.pct1 + '%' : '—', 10)
            + pad(leaderSk.pct12 != null ? leaderSk.pct12 + '%' : '—', 10)
            + pad(leaderSk.pct123 != null ? leaderSk.pct123 + '%' : '—', 10)
            + leaderSk.races
            + ' (tie=' + leaderSk.tie + ')');
        console.log('  ' + pad('Rastgele 1/alan', 22)
            + pad(baseline.pct1 != null ? baseline.pct1 + '%' : '—', 10)
            + pad('—', 10) + pad('—', 10) + baseline.races);

        hr('3. KOŞU BAŞINA MAX%100×4 ADAY SAYISI');
        const byCand = { 0: 0, 1: 0, '2+': 0 };
        const winByCand = { 1: { n: 0, w1: 0 }, '2+': { n: 0, w1: 0 } };
        for (const horses of raceGroupsAll) {
            const cands = horses.filter(h => h.maxFull100);
            const key = cands.length >= 2 ? '2+' : String(cands.length);
            byCand[key] = (byCand[key] || 0) + 1;
            if (cands.length === 1 && cands[0].bitis != null && cands[0].bitis >= 1) {
                winByCand[1].n++;
                if (cands[0].bitis === 1) winByCand[1].w1++;
            }
            if (cands.length >= 2) {
                const pick = pickMaxFull100Leader(horses, cli.minSkKosu);
                if (pick && !pick.tie && pick.horse?.bitis != null) {
                    winByCand['2+'].n++;
                    if (pick.horse.bitis === 1) winByCand['2+'].w1++;
                }
            }
        }
        console.log('  0 aday: ' + (byCand[0] || 0) + ' koşu · tek aday: ' + (byCand[1] || 0)
            + ' koşu · 2+ aday: ' + (byCand['2+'] || 0) + ' koşu');
        if (winByCand[1].n) {
            console.log('  Tek aday ★: '
                + Math.round(1000 * winByCand[1].w1 / winByCand[1].n) / 10 + '% (n=' + winByCand[1].n + ')');
        }
        if (winByCand['2+'].n) {
            console.log('  2+ aday (cnt1 tie-break) ★: '
                + Math.round(1000 * winByCand['2+'].w1 / winByCand['2+'].n) / 10 + '% (n=' + winByCand['2+'].n + ')');
        }

        if (cli.minSkKosu < 2) {
            hr('4. SAĞLAMLIK — SK-KOŞU≥2 (tek eşleşme artefaktı hariç)');
            const strict = analyzeMinSk(rows, 2);
            console.log('  MAX%100×4 at: ' + strict.maxFull.length
                + ' · ★ ' + (strict.statFull.pct1 != null ? strict.statFull.pct1 + '%' : '—')
                + ' (n=' + strict.statFull.n + ')');
            console.log('  Koşu lideri ★: '
                + (strict.leaderMax.pct1 != null ? strict.leaderMax.pct1 + '%' : '—')
                + ' · ' + strict.leaderMax.races + ' koşu (aday yok='
                + strict.leaderMax.skippedNoPick + ')');
            if (strict.maxFull.length) {
                console.log('  Kalan atlar:');
                for (const h of strict.maxFull) printHorseLine(h);
            } else {
                console.log('  (SK-KOŞU≥2 ile MAX%100×4 kalmadı — tüm DB ile genişlet: --db atlar.db)');
            }
        }

        if (kayitlar.length > 1 && !cli.kayitId) {
            sub('Kayıt bazında MAX%100×4 ★ oranı');
            for (const kayit of kayitlar) {
                const subRows = maxFull.filter(h => h.kayitId === kayit.id);
                const s = summarizeBitis(subRows);
                if (!s.n && !skPool.some(h => h.kayitId === kayit.id && h.maxFull100)) continue;
                console.log('  #' + pad(kayit.id, 4) + ' ' + pad(kayit.hipodrom || '', 12)
                    + ' ' + pad(kayit.tarih || '', 12)
                    + ' → ' + fmtStat(s));
            }
        }

        if (cli.verbose || cli.raceNo || maxFull.length <= 30) {
            sub('MAX%100×4 at listesi (' + maxFull.length + ')');
            for (const h of maxFull) printHorseLine(h);
        } else if (maxFull.length) {
            console.log('\n  (--list veya -v ile ' + maxFull.length + ' atın tam listesi)');
        }

        console.log('\nOK · MAX%100×4=' + maxFull.length + ' at · genel ★=' + (statAll.pct1 ?? '—') + '%');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
