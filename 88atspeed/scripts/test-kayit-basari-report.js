#!/usr/bin/env node
/**
 * Kayıt bazlı başarı % raporu — koşu koşu + sekme kırılımı
 *
 *   node scripts/test-kayit-basari-report.js --kayit 148
 *   node scripts/test-kayit-basari-report.js --kayit 148 --race 7
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    rowKeyParts,
    openDb,
    dbAll,
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
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 148,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null
};

const BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

const TAB_SIGNALS = [
    { id: 'TAH', label: 'TAHMİN', tab: 'TAHMİN', get: e => e.row?.tahmin?.score ?? null },
    { id: 'AS', label: 'AT SAYISI', tab: 'KOŞU AT SAYISI', group: 'fieldSize', key: 'cnt123', win: null },
    { id: 'SH', label: 'ŞEHİR', tab: 'ŞEHİR DURUMU', group: 'sehir', key: 'sehirPct', win: null },
    { id: 'KC', label: 'KOŞU CİNSİ', tab: 'KOŞU CİNSİ', group: 'kcins_kosu', key: 'matchPct', win: null },
    { id: 'TK', label: 'TAKİ', tab: 'TAKİ', group: 'taki', key: 'matchPct', win: null },
    { id: 'PS', label: 'PİST', tab: 'PİST', group: 'pist', key: 'matchPct', win: null },
    { id: 'HP', label: 'HP', tab: 'HP', group: 'hp', key: 'matchPct', win: null },
    { id: 'SK', label: 'SİKLET', tab: 'SİKLET', group: 'siklet', key: 'matchPct', win: null }
];

function loadAllEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8') + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8') + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/dimension-tahmin-boost-engine.js'), 'utf8') + '\n; global.DimensionTahminBoostEngine = DimensionTahminBoostEngine;');
}

function blendedFromBitis(bitis) {
    if (bitis == null || bitis < 1) return 0;
    if (bitis === 1) return BLEND.b1;
    if (bitis <= 2) return BLEND.b12;
    if (bitis <= 3) return BLEND.b123;
    return 0;
}

function blendedFromCounts(total, b1, b12, b123) {
    if (!total) return 0;
    return (b1 * BLEND.b1 + b12 * BLEND.b12 + b123 * BLEND.b123) / total;
}

function pickScoredLeader(scored) {
    if (!scored || scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || (a.entry.row?.no ?? 0) - (b.entry.row?.no ?? 0));
    if (scored[0].score === scored[1].score) return null;
    return scored[0];
}

function getMetric(entry, group, key, win) {
    const g = entry._dim?.[group];
    if (!g) return null;
    const src = win ? g.windows?.[win] : g;
    if (!src) return null;
    const v = src[key];
    if (v == null || v === '' || v === '—') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function signalGetter(sig) {
    if (sig.get) return sig.get;
    return e => getMetric(e, sig.group, sig.key, sig.win);
}

function pickLeaderInRace(entries, getScore, host) {
    const scored = entries.map(e => ({ entry: e, score: getScore(e) })).filter(s => s.score != null);
    const leader = pickScoredLeader(scored);
    if (!leader) return { tie: true, bitis: null, name: '—', blended: 0 };
    const bitis = host.bitisValueForSort(leader.entry);
    return {
        tie: false,
        bitis,
        name: (leader.entry.row?.name || '?').replace(/\(\d+\)/, '').trim(),
        blended: blendedFromBitis(bitis)
    };
}

function bitisMark(b) {
    if (b == null) return '?';
    if (b === 1) return '★';
    if (b <= 3) return '◆';
    return '·';
}

function formatCell(pick) {
    if (pick.tie) return pad('—', 8);
    return pad(bitisMark(pick.bitis) + Math.round(pick.blended * 100) + '%', 8);
}

async function loadRawHorseLookup(db) {
    const lookup = new Map();
    let kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) { continue; }
        for (let i = 0; i < races.length; i++) {
            const race = races[i];
            const raceNo = race.raceNo || (i + 1);
            if (cli.raceNo && Number(raceNo) !== cli.raceNo) continue;
            for (const horse of race.horses || []) {
                lookup.set(rowKeyParts(kayit.id, raceNo, horse.no), {
                    horse, race, hipodrom: kayit.hipodrom, tarih: kayit.tarih
                });
            }
        }
    }
    return lookup;
}

function computeDimensionBundle(raw) {
    const kosular = raw?.horse?.kosular || [];
    const horseCtx = Object.assign({}, raw.horse, { kosular });
    const programTarih = raw?.tarih || null;
    const out = {
        fieldSize: FieldSizeStatsEngine.computeStats(kosular, programTarih),
        sehir: SehirStatsEngine.computeStats(kosular, raw.hipodrom, programTarih)
    };
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        out[key] = KosuDimensionStatsEngine.computeStats(
            kosular, key, dim.getTarget(horseCtx, raw.race), programTarih);
    }
    return out;
}

function attachDimensionStats(entries, lookup) {
    for (const entry of entries) {
        const raw = lookup.get(rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no));
        if (!raw) continue;
        entry._dimRaw = raw;
        entry._dim = computeDimensionBundle(raw);
    }
}

function attachTahmin(raceGroups) {
    for (const entries of raceGroups) {
        const pkg = {
            rows: entries.map(e => e.row),
            kosuHistorySummary: entries[0]?._pkg?.kosuHistorySummary || null,
            hedefSehir: entries[0]?._pkg?.hedefSehir || entries[0]?.hipodrom || null
        };
        HybridTahminScoringEngine.attachRaceTahmin(pkg);
    }
}

function evaluateSignal(raceGroups, sig, host) {
    const get = signalGetter(sig);
    let n = 0, b1 = 0, b12 = 0, b123 = 0, sum = 0;
    for (const entries of raceGroups) {
        const pick = pickLeaderInRace(entries, get, host);
        if (pick.tie) continue;
        if (pick.bitis == null || pick.bitis < 1) continue;
        n++;
        sum += pick.blended;
        if (pick.bitis === 1) b1++;
        if (pick.bitis <= 2) b12++;
        if (pick.bitis <= 3) b123++;
    }
    return {
        n,
        b1,
        b12,
        b123,
        blended: blendedFromCounts(n, b1, b12, b123),
        exact: n ? b1 / n : 0,
        ties: raceGroups.length - n
    };
}

async function main() {
    loadAllEngines();
    const db = openDb(cli.dbPath);
    try {
        const kayitRow = await dbAll(db, 'SELECT id, hipodrom, tarih, race_count FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
        if (!kayitRow.length) {
            console.error('Kayıt #' + cli.kayitId + ' bulunamadı');
            process.exit(1);
        }
        const meta = kayitRow[0];

        const lookup = await loadRawHorseLookup(db);
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
            filterKayit: cli.kayitId,
            filterRace: cli.raceNo
        });
        const host = makeGostergeHost(flatEntries, bitisMap);
        attachDimensionStats(flatEntries, lookup);

        let entries = flatEntries.filter(e => e._dim);
        if (cli.kayitId) entries = entries.filter(e => Number(e.kayitId) === cli.kayitId);
        if (cli.raceNo) entries = entries.filter(e => Number(e.raceNo) === cli.raceNo);

        const withBitis = entries.filter(e => host.bitisValueForSort(e) != null);
        const raceMap = new Map();
        for (const e of withBitis) {
            const k = String(e.raceNo);
            if (!raceMap.has(k)) raceMap.set(k, []);
            raceMap.get(k).push(e);
        }
        const raceGroups = [...raceMap.values()].sort((a, b) => Number(a[0].raceNo) - Number(b[0].raceNo));
        attachTahmin(raceGroups);

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  Başarı % raporu — test sekmeleri (karışık 80/12/8)              ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('📅 ' + meta.tarih + ' · 🏟️ ' + meta.hipodrom + ' · 🏁 ' + raceGroups.length + ' koşu'
            + (cli.raceNo ? ' (sadece K' + cli.raceNo + ')' : ''));
        console.log('Kayıt #' + cli.kayitId + ' · BİTİŞ kayıtlı at: ' + withBitis.length);
        console.log('★=1. ◆=2-3. ·=4+ · karışık=80%·1. +12%·1-2 +8%·1-3\n');

        console.log('── GENEL — sekme / yöntem başarı % ──');
        console.log('  ' + pad('Sekme', 14) + pad('Karışık%', 10) + pad('★1.%', 8)
            + pad('1-2%', 8) + pad('1-3%', 8) + pad('n', 4) + 'Not');
        const totals = [];
        for (const sig of TAB_SIGNALS) {
            const r = evaluateSignal(raceGroups, sig, host);
            totals.push({ sig, ...r });
            const note = r.n < raceGroups.length ? 'berab=' + (raceGroups.length - r.n) : '';
            console.log('  ' + pad(sig.label, 14)
                + pad(pct(r.blended), 10)
                + pad(pct(r.exact), 8)
                + pad(r.n ? pct(r.b12 / r.n) : '—', 8)
                + pad(r.n ? pct(r.b123 / r.n) : '—', 8)
                + pad(String(r.n), 4)
                + note);
        }

        totals.sort((a, b) => b.blended - a.blended);
        console.log('\n  En iyi: ' + totals[0].sig.label + ' ' + pct(totals[0].blended)
            + ' (★' + pct(totals[0].exact) + ')');

        console.log('\n── KOŞU KOŞU — K1…K' + raceGroups.length + ' ──');
        console.log('  ' + pad('K#', 4) + pad('At', 4) + pad('Kazanan', 18)
            + TAB_SIGNALS.map(s => pad(s.id, 8)).join(''));
        console.log('  ' + '-'.repeat(28 + TAB_SIGNALS.length * 8));

        const colTotals = TAB_SIGNALS.map(() => ({ n: 0, sum: 0, b1: 0 }));

        for (const entries of raceGroups) {
            const rn = entries[0].raceNo;
            const winner = entries.find(e => host.bitisValueForSort(e) === 1);
            const wName = winner ? (winner.row?.name || '?').replace(/\(\d+\)/, '').trim().slice(0, 16) : '?';
            let line = pad('K' + rn, 4) + pad(String(entries.length), 4) + pad(wName, 18);

            TAB_SIGNALS.forEach((sig, i) => {
                const pick = pickLeaderInRace(entries, signalGetter(sig), host);
                line += formatCell(pick);
                if (!pick.tie && pick.bitis != null && pick.bitis >= 1) {
                    colTotals[i].n++;
                    colTotals[i].sum += pick.blended;
                    if (pick.bitis === 1) colTotals[i].b1++;
                }
            });
            console.log('  ' + line);
        }

        console.log('\n── S5 pencere (son 5 koşu) — ek kırılım ──');
        const s5Signals = TAB_SIGNALS.filter(s => s.group).map(s => ({
            ...s, id: s.id + '.S5', label: s.label + ' S5', win: 5
        }));
        console.log('  ' + pad('Sekme', 14) + pad('Karışık%', 10) + pad('★1.%', 8) + pad('n', 4));
        for (const sig of s5Signals) {
            const r = evaluateSignal(raceGroups, sig, host);
            console.log('  ' + pad(sig.label, 14) + pad(pct(r.blended), 10) + pad(pct(r.exact), 8) + pad(String(r.n), 4));
        }

        console.log('\n── Özet ──');
        const tah = totals.find(t => t.sig.id === 'TAH');
        const bestDim = totals.filter(t => t.sig.id !== 'TAH').sort((a, b) => b.blended - a.blended)[0];
        console.log('  TAHMİN karışık : ' + pct(tah?.blended || 0) + ' · ★1. ' + pct(tah?.exact || 0));
        console.log('  En iyi sekme   : ' + bestDim.sig.label + ' ' + pct(bestDim.blended) + ' · ★1. ' + pct(bestDim.exact));
        console.log('  Veri: kosular[] repair sonrası — MAX-* dolu atlarda metrikler ayırt edici');
        console.log('\nDetaylı korelasyon: npm run test:dimension-finish -- --kayit ' + cli.kayitId + ' --phase leader,per-race --min-races 1');
        console.log('');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
