#!/usr/bin/env node
/**
 * Tek koşu — tüm faktörler (TÜM + S5–S1 pencereleri) birlikte değerlendirme
 *
 *   node scripts/test-race-all-factors.js --kayit 148 --race 1 --dim siklet
 *   node scripts/test-race-all-factors.js --fixture k148-r1-siklet
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
    raceNo: argVal('--race') ? Number(argVal('--race')) : 1,
    dim: argVal('--dim') || 'siklet',
    fixture: argVal('--fixture') || null
};

const WINDOWS = [null, 5, 4, 3, 2, 1];
const WIN_LABEL = { null: 'TÜM', 5: 'S5', 4: 'S4', 3: 'S3', 2: 'S2', 1: 'S1' };

const NUMERIC_KEYS = [
    { key: 'kosuSayisi', col: 'KOŞU', higher: true },
    { key: 'matchPct', col: 'SK%', higher: true, pct: true },
    { key: 'matchCount', col: 'SK-KOŞU', higher: true },
    { key: 'max1', col: 'MAX-1', higher: true },
    { key: 'max12', col: 'MAX-12', higher: true },
    { key: 'max123', col: 'MAX-123', higher: true },
    { key: 'max1234', col: 'MAX-1234', higher: true },
    { key: 'cnt1', col: '1.', higher: true },
    { key: 'cnt12', col: '1-2', higher: true },
    { key: 'cnt123', col: '1-2-3', higher: true },
    { key: 'cnt1234', col: '1-2-3-4', higher: true }
];

/** Örnek tablo — kullanıcının paylaştığı UI verisi (gerçek kayıt #148 DEĞİL) */
const FIXTURE_LITTLE_JOE_K1 = {
    label: 'FIXTURE · LITTLE JOE K1 demo (8 at — kayıt #148 DB ile aynı koşu DEĞİL)',
    fieldSize: 8,
    horses: [
        { no: 1, name: 'LITTLE JOE', bitis: 1, tum: { kosuSayisi: 6, max1: 6, max12: 9, max123: 9, max1234: 9, cnt1: 11, cnt12: 3, cnt123: 3, cnt1234: 3 },
            w5: { kosuSayisi: 5, max1: 9, max12: 9, max123: 9, max1234: 9, cnt1: 3, cnt12: 3, cnt123: 3, cnt1234: 3 },
            w4: { kosuSayisi: 4, max1: 9, max12: 9, max123: 9, max1234: 9, cnt1: 2, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w3: { kosuSayisi: 3, max1: 9, max12: 9, max123: 9, max1234: 9, cnt1: 1, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w2: { kosuSayisi: 2, max1: 9, max12: 9, max123: 9, max1234: 9, cnt1: 1, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w1: { kosuSayisi: 1, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 } },
        { no: 2, name: 'DISTANCE RUNNER', bitis: 6, tum: { kosuSayisi: 6, max1: 6, max12: null, max123: 9, max1234: 9, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w5: { kosuSayisi: 5, max1: null, max12: 9, max123: 9, max1234: 9, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w4: { kosuSayisi: 4, max1: null, max12: 9, max123: 9, max1234: 9, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w3: { kosuSayisi: 3, max1: null, max12: 9, max123: 9, max1234: 9, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w2: { kosuSayisi: 2, max1: null, max12: 9, max123: 9, max1234: 9, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w1: { kosuSayisi: 1, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 } },
        { no: 3, name: 'MR MONK', bitis: 4, tum: { kosuSayisi: 6, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w5: { kosuSayisi: 5, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w4: { kosuSayisi: 4, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w3: { kosuSayisi: 3, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w2: { kosuSayisi: 2, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 2, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w1: { kosuSayisi: 1, max1: 7, max12: 7, max123: 7, max1234: 7, cnt1: 1, cnt12: 1, cnt123: 1, cnt1234: 1 } },
        { no: 4, name: 'IRON WILL', bitis: 3, tum: { kosuSayisi: 6, max1: null, max12: 11, max123: 11, max1234: 11, cnt1: 0, cnt12: 3, cnt123: 3, cnt1234: 4 },
            w5: { kosuSayisi: 5, max1: null, max12: 11, max123: 11, max1234: 11, cnt1: 0, cnt12: 3, cnt123: 3, cnt1234: 3 },
            w4: { kosuSayisi: 4, max1: null, max12: 11, max123: 11, max1234: 11, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w3: { kosuSayisi: 3, max1: null, max12: 11, max123: 11, max1234: 11, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w2: { kosuSayisi: 2, max1: null, max12: 8, max123: 8, max1234: 8, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w1: { kosuSayisi: 1, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 } },
        { no: 5, name: 'KING ÇAĞDAŞ', bitis: 2, tum: { kosuSayisi: 6, max1: 10, max12: 10, max123: 12, max1234: 12, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w5: { kosuSayisi: 5, max1: 10, max12: 10, max123: 12, max1234: 12, cnt1: 2, cnt12: 2, cnt123: 3, cnt1234: 3 },
            w4: { kosuSayisi: 4, max1: 10, max12: 10, max123: 10, max1234: 10, cnt1: 2, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w3: { kosuSayisi: 3, max1: 10, max12: 10, max123: 10, max1234: 10, cnt1: 2, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w2: { kosuSayisi: 2, max1: 10, max12: 10, max123: 10, max1234: 10, cnt1: 2, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w1: { kosuSayisi: 1, max1: 10, max12: 10, max123: 10, max1234: 10, cnt1: 1, cnt12: 1, cnt123: 1, cnt1234: 1 } },
        { no: 6, name: 'FALCON OF MUTAFLAR', bitis: 8, tum: { kosuSayisi: 6, max1: null, max12: 7, max123: 7, max1234: 8, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 3 },
            w5: { kosuSayisi: 5, max1: null, max12: 7, max123: 7, max1234: 8, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 3 },
            w4: { kosuSayisi: 4, max1: null, max12: 7, max123: 7, max1234: 8, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 3 },
            w3: { kosuSayisi: 3, max1: null, max12: 7, max123: 7, max1234: 7, cnt1: 0, cnt12: 2, cnt123: 2, cnt1234: 2 },
            w2: { kosuSayisi: 2, max1: null, max12: 7, max123: 7, max1234: 7, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 },
            w1: { kosuSayisi: 1, max1: null, max12: 7, max123: 7, max1234: 7, cnt1: 0, cnt12: 1, cnt123: 1, cnt1234: 1 } },
        { no: 7, name: 'TRUE REFLECTION', bitis: 7, tum: { kosuSayisi: 6, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 },
            w5: { kosuSayisi: 5, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 },
            w4: { kosuSayisi: 4, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 },
            w3: { kosuSayisi: 3, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 },
            w2: { kosuSayisi: 2, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 },
            w1: { kosuSayisi: 1, max1: null, max12: null, max123: null, max1234: null, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0 } },
        { no: 8, name: 'STASERA', bitis: 5, tum: { kosuSayisi: 6, max1: null, max12: null, max123: null, max1234: 11, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 3 },
            w5: { kosuSayisi: 5, max1: null, max12: null, max123: null, max1234: 11, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 2 },
            w4: { kosuSayisi: 4, max1: null, max12: null, max123: null, max1234: 11, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 2 },
            w3: { kosuSayisi: 3, max1: null, max12: null, max123: null, max1234: 8, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 1 },
            w2: { kosuSayisi: 2, max1: null, max12: null, max123: null, max1234: 8, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 1 },
            w1: { kosuSayisi: 1, max1: null, max12: null, max123: null, max1234: 8, cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 1 } }
    ]
};

function loadEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function parseNum(v) {
    if (v == null || v === '' || v === '—' || v === '-') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function windowSrc(horse, w) {
    if (w == null) return horse.st || horse.tum || {};
    const key = 'w' + w;
    return horse.st?.windows?.[w] || horse[key] || {};
}

function getVal(horse, key, w) {
    const src = windowSrc(horse, w);
    return parseNum(src[key]);
}

function pickLeader(horses, getScore) {
    const scored = horses.map(h => ({ h, score: getScore(h) })).filter(x => x.score != null);
    if (scored.length < 2) return null;
    scored.sort((a, b) => b.score - a.score || a.h.no - b.h.no);
    if (scored[0].score === scored[1].score) return { tie: true, leaders: scored.filter(x => x.score === scored[0].score) };
    return { tie: false, leader: scored[0] };
}

function buildRankFusion(horses, getters) {
    const rankMaps = getters.map(get => {
        const scored = horses.map(h => ({ h, v: get(h) })).filter(x => x.v != null);
        scored.sort((a, b) => b.v - a.v || a.h.no - b.h.no);
        const map = new Map();
        scored.forEach((x, i) => map.set(x.h, i + 1));
        return map;
    });
    return h => {
        let sum = 0, n = 0;
        for (const map of rankMaps) {
            const r = map.get(h);
            if (r != null) { sum += r; n++; }
        }
        return n ? 1000 / (sum / n) : null;
    };
}

function bitisMark(b) {
    if (b == null) return '?';
    if (b === 1) return '★';
    if (b <= 3) return '◆';
    return '·';
}

function fmtVal(v, pct) {
    if (v == null) return '—';
    return pct ? v + '%' : String(v);
}

function buildFactorList(includePct) {
    const keys = includePct ? NUMERIC_KEYS : NUMERIC_KEYS.filter(k => k.key !== 'matchPct' && k.key !== 'matchCount');
    const factors = [];
    for (const w of WINDOWS) {
        for (const k of keys) {
            factors.push({
                id: (WIN_LABEL[w] || 'TÜM') + '.' + k.col,
                w, ...k,
                get: h => getVal(h, k.key, w)
            });
        }
    }
    return factors;
}

function summarizeDataQuality(horses, factors) {
    let evalCount = 0, tieSkip = 0, nullSkip = 0;
    for (const f of factors) {
        const vals = horses.map(h => f.get(h)).filter(v => v != null);
        if (vals.length < 2) { nullSkip++; continue; }
        const pick = pickLeader(horses, f.get);
        if (!pick || pick.tie) tieSkip++;
        else evalCount++;
    }
    const sk1 = horses.filter(h => {
        const mc = getVal(h, 'matchCount', null) ?? getVal(h, 'kosuSayisi', null);
        return mc === 1;
    }).length;
    return { evalCount, tieSkip, nullSkip, total: factors.length, sk1, field: horses.length };
}

function printHorseGrid(horses) {
    console.log('  ' + pad('At', 22) + pad('SK-KOŞU', 8) + pad('SK%', 6)
        + pad('MAX123', 7) + pad('cnt123', 7) + pad('cnt1', 5) + 'BİT');
    for (const h of horses) {
        const mc = getVal(h, 'matchCount', null);
        const pct = getVal(h, 'matchPct', null);
        console.log('  ' + pad(h.name.slice(0, 20), 22)
            + pad(mc != null ? String(mc) : '—', 8)
            + pad(pct != null ? pct + '%' : '—', 6)
            + pad(fmtVal(getVal(h, 'max123', null)), 7)
            + pad(fmtVal(getVal(h, 'cnt123', null)), 7)
            + pad(fmtVal(getVal(h, 'cnt1', null)), 5)
            + bitisMark(h.bitis) + (h.bitis ?? '?'));
    }
}

function analyzeRace(ctx) {
    const horses = ctx.horses;
    const fieldSize = ctx.fieldSize || horses.length;
    const factors = buildFactorList(!!ctx.hasPct);
    const quality = summarizeDataQuality(horses, factors);

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  Tüm faktörler — tek koşu birleşik değerlendirme                  ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log(ctx.label);
    console.log('Alan: ' + fieldSize + ' at · Faktör sayısı: ' + factors.length);
    console.log('Değerlendirilebilir: ' + quality.evalCount + '/' + quality.total
        + ' (berab=' + quality.tieSkip + ', veri yok=' + quality.nullSkip + ')');
    if (quality.sk1 >= quality.field * 0.6) {
        console.log('⚠ SK-KOŞU=1 olan ' + quality.sk1 + '/' + quality.field
            + ' at — tek eşleşme; MAX/cnt metrikleri zayıf ayırt eder');
    }
    if (quality.evalCount < quality.total * 0.25) {
        console.log('⚠ Seyrek veri — oy sayacı güvenilmez; rank fusion daha anlamlı');
    }
    console.log('');

    console.log('── AT BAŞINA ÖZET (TÜM pencere) ──');
    printHorseGrid(horses);

    console.log('── GERÇEK BİTİŞ ──');
    const byBitis = [...horses].sort((a, b) => (a.bitis ?? 99) - (b.bitis ?? 99));
    for (const h of byBitis) {
        console.log('  ' + bitisMark(h.bitis) + ' ' + pad(String(h.bitis ?? '?'), 3) + h.name);
    }

    console.log('\n── FAKTÖR LİDERLERİ (her sütunda en yüksek) ──');
    console.log('  ' + pad('Faktör', 18) + pad('Lider', 22) + pad('Değer', 8) + 'BİT');
    console.log('  ' + '-'.repeat(58));

    const votes = new Map();
    horses.forEach(h => votes.set(h.no, { h, wins: 0, factors: [] }));

    let evalCount = 0;
    for (const f of factors) {
        const pick = pickLeader(horses, f.get);
        if (!pick || pick.tie) continue;
        evalCount++;
        const l = pick.leader;
        const bitis = l.h.bitis;
        const rec = votes.get(l.h.no);
        rec.wins++;
        rec.factors.push(f.id);
        console.log('  ' + pad(f.id, 18) + pad(l.h.name.slice(0, 20), 22)
            + pad(fmtVal(l.score, f.pct), 8) + bitisMark(bitis) + (bitis ?? '?'));
    }

    const fusionGetters = factors.map(f => f.get);
    const fusion = buildRankFusion(horses, fusionGetters);
    const fusionPick = pickLeader(horses, fusion);

    console.log('\n── OY SAYACI (kaç faktörde lider?) ──');
    const ranked = [...votes.values()].sort((a, b) => b.wins - a.wins || a.h.no - b.h.no);
    for (const r of ranked) {
        console.log('  ' + pad(r.h.name, 22) + pad(String(r.wins) + '/' + evalCount, 8)
            + bitisMark(r.h.bitis) + ' BİT=' + (r.h.bitis ?? '?')
            + (r.wins ? ' · ' + r.factors.slice(0, 5).join(', ') + (r.factors.length > 5 ? '…' : '') : ''));
    }

    console.log('\n── RANK FUSION (tüm faktörler birleşik) ──');
    const fusionScored = horses.map(h => ({ h, score: fusion(h) })).filter(x => x.score != null);
    fusionScored.sort((a, b) => b.score - a.score || a.h.no - b.h.no);
    for (let i = 0; i < fusionScored.length; i++) {
        const x = fusionScored[i];
        console.log('  ' + (i + 1) + '. ' + pad(x.h.name, 22) + pad(x.score.toFixed(1), 8)
            + bitisMark(x.h.bitis) + ' BİT=' + (x.h.bitis ?? '?'));
    }

    if (fusionPick && !fusionPick.tie) {
        const top = fusionPick.leader.h;
        console.log('\n  → Birleşik 1. tahmin: ' + top.name + ' (BİTİŞ=' + (top.bitis ?? '?') + ')');
    }

    console.log('\n── PENCERE ÖZETİ (cnt123 + MAX-123 liderleri) ──');
    console.log('  ' + pad('Pencere', 8) + pad('1-2-3 lider', 20) + pad('cnt', 5)
        + pad('MAX-123 lider', 20) + pad('max', 5) + 'BİT');
    for (const w of WINDOWS) {
        const lbl = WIN_LABEL[w];
        const cPick = pickLeader(horses, h => getVal(h, 'cnt123', w));
        const mPick = pickLeader(horses, h => getVal(h, 'max123', w));
        const cName = cPick && !cPick.tie ? cPick.leader.h.name.slice(0, 18) : '—';
        const mName = mPick && !mPick.tie ? mPick.leader.h.name.slice(0, 18) : '—';
        const cBit = cPick && !cPick.tie ? cPick.leader.h.bitis : null;
        console.log('  ' + pad(lbl, 8) + pad(cName, 20) + pad(cPick && !cPick.tie ? String(cPick.leader.score) : '—', 5)
            + pad(mName, 20) + pad(mPick && !mPick.tie ? String(mPick.leader.score) : '—', 5)
            + (cBit != null ? bitisMark(cBit) + cBit : ''));
    }

    console.log('\n── İLK 3 TAHMİN (birleşik skor) ──');
    const top3pred = fusionScored.slice(0, 3).map(x => x.h.name + '(' + (x.h.bitis ?? '?') + ')');
    const actualTop3 = byBitis.filter(h => h.bitis <= 3).map(h => h.name + '(' + h.bitis + ')');
    console.log('  Tahmin : ' + top3pred.join(', '));
    console.log('  Gerçek : ' + actualTop3.join(', '));
    const hits = fusionScored.slice(0, 3).filter(x => x.h.bitis != null && x.h.bitis <= 3).length;
    console.log('  İsabet : ' + hits + '/3 at gerçek ilk 3\'te');
    console.log('');
}

async function loadFromDb() {
    loadEngines();
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    const db = openDb(cli.dbPath);
    try {
        const kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
        if (!kayitlar.length) return null;
        const kayit = kayitlar[0];
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) { return null; }
        const race = races.find((r, i) => Number(r.raceNo || i + 1) === cli.raceNo);
        if (!race) return null;

        const dim = KosuDimensionStatsEngine.DIMENSIONS[cli.dim];
        if (!dim) return null;
        const programTarih = kayit.tarih;
        const { bitisMap } = await buildFlatEntriesFromDb(db, { filterKayit: cli.kayitId });

        const horses = [];
        for (const h of race.horses || []) {
            const kosular = h.kosular || [];
            const horseCtx = Object.assign({}, h, { kosular });
            const hedef = dim.getTarget(horseCtx, race);
            const st = KosuDimensionStatsEngine.computeStats(kosular, cli.dim, hedef, programTarih);
            const key = rowKeyParts(kayit.id, cli.raceNo, h.no);
            let bitis = bitisMap[key];
            if (bitis == null || bitis < 1) bitis = global.AtSpeedUtils.extractBitisFromHorseName(h.name);
            horses.push({
                no: h.no,
                name: (h.name || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
                bitis: bitis != null && bitis >= 1 ? bitis : null,
                st
            });
        }

        return {
            label: 'Kayıt #' + kayit.id + ' · K' + cli.raceNo + ' · ' + cli.dim.toUpperCase()
                + ' · ' + kayit.tarih + ' ' + kayit.hipodrom,
            fieldSize: FieldSizeStatsEngine.raceFieldSize(race),
            horses,
            hasPct: true
        };
    } finally {
        db.close();
    }
}

function loadFixture() {
    if (cli.fixture === 'little-joe-k1-demo' || cli.fixture === 'k148-r1-siklet') return FIXTURE_LITTLE_JOE_K1;
    return null;
}

async function main() {
    let ctx = cli.fixture ? loadFixture() : null;
    if (!ctx && cli.kayitId) ctx = await loadFromDb();
    if (!ctx && !cli.fixture && !cli.kayitId) {
        cli.kayitId = 148;
        ctx = await loadFromDb();
    }
    if (!ctx && !cli.fixture) ctx = FIXTURE_LITTLE_JOE_K1;
    if (!ctx) {
        console.error('Veri bulunamadı. --kayit ID --race N veya --fixture little-joe-k1-demo');
        process.exit(1);
    }
    analyzeRace(ctx);
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
