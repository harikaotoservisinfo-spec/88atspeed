#!/usr/bin/env node
/**
 * SİKLET ↔ SON800-1 eksaustif korelasyon raporu
 *
 * SİKLET sekmesi sütunları (BAŞ+, SK%, SK+, cnt*, GEN+ …) ile
 * SON800-1 derinlik sütunları (SON·Eİ/İÇ/Δ/BS … AĞ. ORT.*) arasında
 * tüm çiftleri test eder.
 *
 * Fazlar (--phase):
 *   matrix   — global Spearman (tüm atlar havuzu)
 *   race     — koşu-içi ortalama Spearman (sıra korelasyonu)
 *   leader   — alan lideri eşleşmesi (SON800 lider = SK lider?)
 *   bitis    — BİTİŞ sırası ile korelasyon
 *   agree    — üst sıra anlaşması (top3 overlap)
 *   forensics — tek koşu at-at tablo + koşu-içi ρ
 *   top      — en güçlü çiftler özeti (varsayılan: hepsi)
 *
 *   node scripts/test-siklet-son800-correlation.js --db atlar.db
 *   node scripts/test-siklet-son800-correlation.js --kayit 148 --race 1 -v
 *   node scripts/test-siklet-son800-correlation.js --phase matrix,top --min-sample 8
 *   node scripts/test-siklet-son800-correlation.js --list
 *   node scripts/test-siklet-son800-correlation.js --demo
 *   node scripts/test-siklet-son800-correlation.js --fixture scripts/fixtures/siklet-son800-race1-demo.json
 */
const fs = require('fs');
const path = require('path');
const DEMO_FIXTURE = path.join(__dirname, 'fixtures/siklet-son800-race1-demo.json');
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

const phasesRaw = argVal('--phase') || 'all';
const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    minSample: argVal('--min-sample') ? Number(argVal('--min-sample')) : 6,
    minRaces: argVal('--min-races') ? Number(argVal('--min-races')) : 3,
    top: argVal('--top') ? Number(argVal('--top')) : 40,
    verbose: args.includes('--verbose') || args.includes('-v'),
    listOnly: args.includes('--list'),
    demo: args.includes('--demo'),
    fixturePath: argVal('--fixture') || (args.includes('--demo') ? DEMO_FIXTURE : null),
    phases: (() => {
        if (phasesRaw === 'all') return ['matrix', 'race', 'leader', 'bitis', 'agree', 'top', 'forensics', 'exhaustive'];
        return phasesRaw.split(',').map(s => s.trim()).filter(Boolean);
    })()
};

function hr(title) {
    console.log('\n' + '═'.repeat(72));
    if (title) console.log('  ' + title);
    console.log('═'.repeat(72));
}

function sub(title) {
    console.log('\n── ' + title + ' ──');
}

function loadEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8') + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8') + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8') + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8') + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-gosterim-flags.js'), 'utf8'));
}

function rankArray(values) {
    const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(values.length);
    for (let r = 0; r < indexed.length; r++) ranks[indexed[r].i] = r + 1;
    return ranks;
}

function spearmanFromPairs(pairs) {
    if (pairs.length < 3) return null;
    const xs = pairs.map(p => p.x);
    const ys = pairs.map(p => p.y);
    const rx = rankArray(xs);
    const ry = rankArray(ys);
    const n = pairs.length;
    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
        const d = rx[i] - ry[i];
        sumD2 += d * d;
    }
    return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function pearsonFromPairs(pairs) {
    if (pairs.length < 3) return null;
    const n = pairs.length;
    const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
    const my = pairs.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (const p of pairs) {
        const dx = p.x - mx;
        const dy = p.y - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const den = Math.sqrt(dx2 * dy2);
    return den ? num / den : null;
}

function depthPrefix(d) {
    return d === 0 ? 'SON' : d + 'Ö';
}

function depthLabel(d) {
    return d === 0 ? 'SON' : d + ' ÖNCE';
}

function buildSon800Catalog(maxDepth) {
    const catalog = [];
    function add(id, label, get) {
        catalog.push({ id, label, side: 'S800', get });
    }
    for (let d = 0; d < maxDepth; d++) {
        const p = depthPrefix(d);
        const dl = depthLabel(d);
        add('S800.' + p, dl, e => e._s800?.[d]?.pct ?? null);
        add('S800.' + p + '.EI', dl + '·Eİ', e => e._s800?.[d]?.horseBestPct ?? null);
        add('S800.' + p + '.IC', dl + '·İÇ', e => e._s800?.[d]?.selfPct ?? null);
        add('S800.' + p + '.D', dl + '·Δ', e => e._s800?.[d]?.gapPct ?? null);
        add('S800.' + p + '.BS', dl + '·BS', e => e._s800?.[d]?.successPct ?? null);
    }
    add('S800.AGORT', 'AĞ. ORT.', e => e._s800Ort?.agirlikli?.pct ?? null);
    add('S800.AGORT1', 'AĞ. ORT.1', e => e._s800Ort?.ort1?.pct ?? null);
    add('S800.AGORT2', 'AĞ. ORT.2', e => e._s800Ort?.ort2?.pct ?? null);
    add('S800.AGORT3', 'AĞ. ORT.3', e => e._s800Ort?.ort3?.pct ?? null);
    // türev: SON derinlik ortalaması
    add('S800.AVGdepth', 'Derinlik ort. pct', e => {
        const vals = (e._s800 || []).map(c => c?.pct).filter(v => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    add('S800.AVGdelta', 'Derinlik ort. Δ', e => {
        const vals = (e._s800 || []).map(c => c?.gapPct).filter(v => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return catalog;
}

function buildSikletCatalog() {
    const dim = 'siklet';
    function sk(key) {
        return e => {
            const g = e._dim?.[dim];
            if (!g) return null;
            const v = key.split('.').reduce((o, k) => o?.[k], g);
            if (v == null || v === '' || v === '—') return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
    }
    return [
        { id: 'SK.HEDEF', label: 'HEDEF (kg)', side: 'SK', get: e => {
            const raw = e._dim?.siklet?.hedefAbbrev || e._dimRaw?.horse?.siklet;
            const n = parseFloat(String(raw || '').replace(',', '.'));
            return Number.isFinite(n) ? n : null;
        }},
        { id: 'SK.BAS+', label: 'BAŞ+', side: 'SK', get: sk('basSuccess.pct') },
        { id: 'SK.KOSU', label: 'TÜM KOŞU', side: 'SK', get: sk('kosuSayisi') },
        { id: 'SK.SK-KOSU', label: 'SK-KOŞU', side: 'SK', get: sk('matchCount') },
        { id: 'SK.SK%', label: 'SK%', side: 'SK', get: sk('matchPct') },
        { id: 'SK.SK-FORM', label: 'SK-FORM', side: 'SK', get: sk('formTrend.pct') },
        { id: 'SK.SK+', label: 'SK+', side: 'SK', get: sk('dimAdj.pct') },
        { id: 'SK.1', label: '1.', side: 'SK', get: sk('cnt1') },
        { id: 'SK.1-2', label: '1-2', side: 'SK', get: sk('cnt2') },
        { id: 'SK.1-2-3', label: '1-2-3', side: 'SK', get: sk('cnt3') },
        { id: 'SK.1-2-3-4', label: '1-2-3-4', side: 'SK', get: sk('cnt4') },
        { id: 'SK.GEN+', label: 'GEN+', side: 'SK', get: sk('genAdj.pct') },
        { id: 'SK.G1', label: 'G1.', side: 'SK', get: sk('genCnt1') },
        { id: 'SK.G1-2', label: 'G1-2', side: 'SK', get: sk('genCnt2') },
        { id: 'SK.G1-3', label: 'G1-3', side: 'SK', get: sk('genCnt3') },
        { id: 'SK.G1-4', label: 'G1-4', side: 'SK', get: sk('genCnt4') },
        { id: 'SK.MAX-1', label: 'MAX-1', side: 'SK', get: sk('max1') },
        { id: 'SK.MAX-123', label: 'MAX-123', side: 'SK', get: sk('max123') },
        { id: 'SK.cnt123/KOSU', label: 'cnt123/KOŞU', side: 'SK', get: e => {
            const g = e._dim?.siklet;
            if (!g || !g.kosuSayisi) return null;
            return g.cnt123 != null ? g.cnt123 / g.kosuSayisi : null;
        }}
    ];
}

async function loadRawHorseLookup(db) {
    const lookup = new Map();
    let kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
    if (cli.kayitId) kayitlar = kayitlar.filter(k => Number(k.id) === cli.kayitId);
    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri); } catch (_) { continue; }
        if (!Array.isArray(races)) continue;
        for (let i = 0; i < races.length; i++) {
            const race = races[i];
            const raceNo = race.raceNo || (i + 1);
            if (cli.raceNo && Number(raceNo) !== cli.raceNo) continue;
            for (const horse of race.horses || []) {
                lookup.set(rowKeyParts(kayit.id, raceNo, horse.no), {
                    horse, race, hipodrom: kayit.hipodrom, tarih: kayit.tarih, kayitId: kayit.id, raceNo
                });
            }
        }
    }
    return lookup;
}

function computeDimensionBundle(raw) {
    const kosular = raw?.horse?.kosular || [];
    const horse = raw?.horse || {};
    const race = raw?.race || {};
    const hipodrom = raw?.hipodrom || '';
    const horseCtx = Object.assign({}, horse, { kosular });
    const programTarih = raw?.tarih || null;
    const out = {};
    for (const key of Object.keys(KosuDimensionStatsEngine.DIMENSIONS)) {
        const dim = KosuDimensionStatsEngine.DIMENSIONS[key];
        out[key] = KosuDimensionStatsEngine.computeStats(
            kosular, key, dim.getTarget(horseCtx, race), programTarih
        );
    }
    return out;
}

function attachMetrics(flatEntries, lookup) {
    let maxDepth = 0;
    for (const entry of flatEntries) {
        const raw = lookup.get(rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no));
        if (raw) {
            entry._dimRaw = raw;
            entry._dim = computeDimensionBundle(raw);
        }
        entry._s800 = entry.row?.son8001Depths || [];
        entry._s800Ort = entry.row?.son8001OrtOzeti || {};
        maxDepth = Math.max(maxDepth, entry._s800.length, entry._pkg?.maxDepth1 || 0);
    }
    return maxDepth;
}

function filterEntries(entries) {
    let out = entries.filter(e => e._dim?.siklet);
    if (cli.kayitId) out = out.filter(e => Number(e.kayitId) === cli.kayitId);
    if (cli.raceNo) out = out.filter(e => Number(e.raceNo) === cli.raceNo);
    return out;
}

function buildRaceGroups(entries) {
    const map = new Map();
    for (const e of entries) {
        const rk = String(e.kayitId) + '|' + e.raceNo;
        if (!map.has(rk)) map.set(rk, []);
        map.get(rk).push(e);
    }
    return [...map.entries()].map(([rk, horses]) => ({ rk, horses }));
}

function pickLeader(entries, getScore) {
    const scored = entries.map(e => ({ e, s: getScore(e) })).filter(x => x.s != null);
    if (!scored.length) return null;
    scored.sort((a, b) => b.s - a.s);
    const top = scored[0].s;
    const ties = scored.filter(x => x.s === top);
    return ties.length === 1 ? ties[0].e : null;
}

function evaluatePairGlobal(entries, mA, mB) {
    const pairs = [];
    for (const e of entries) {
        const x = mA.get(e);
        const y = mB.get(e);
        if (x != null && y != null) pairs.push({ x, y });
    }
    if (pairs.length < cli.minSample) return null;
    const rho = spearmanFromPairs(pairs);
    const r = pearsonFromPairs(pairs);
    return { n: pairs.length, rho, r };
}

function evaluatePairRaceAvg(raceGroups, mA, mB) {
    const rhos = [];
    for (const { horses } of raceGroups) {
        if (horses.length < 4) continue;
        const pairs = [];
        for (const e of horses) {
            const x = mA.get(e);
            const y = mB.get(e);
            if (x != null && y != null) pairs.push({ x, y });
        }
        if (pairs.length < 4) continue;
        const xs = pairs.map(p => p.x);
        if (Math.min(...xs) === Math.max(...xs)) continue;
        const ys = pairs.map(p => p.y);
        if (Math.min(...ys) === Math.max(...ys)) continue;
        const rho = spearmanFromPairs(pairs);
        if (rho != null && !isNaN(rho)) rhos.push(rho);
    }
    if (rhos.length < cli.minRaces) return null;
    const avg = rhos.reduce((a, b) => a + b, 0) / rhos.length;
    return { avgRho: avg, races: rhos.length, rhos };
}

function evaluateAllPairs(entries, raceGroups, sikletCat, s800Cat) {
    const results = [];
    for (const sk of sikletCat) {
        for (const s8 of s800Cat) {
            const g = evaluatePairGlobal(entries, sk, s8);
            const rc = evaluatePairRaceAvg(raceGroups, sk, s8);
            if (!g && !rc) continue;
            results.push({
                skId: sk.id, skLabel: sk.label,
                s8Id: s8.id, s8Label: s8.label,
                globalN: g?.n ?? 0,
                globalRho: g?.rho ?? null,
                globalR: g?.r ?? null,
                raceAvgRho: rc?.avgRho ?? null,
                raceCount: rc?.races ?? 0,
                score: Math.max(Math.abs(g?.rho ?? 0), Math.abs(rc?.avgRho ?? 0))
            });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}

function printTopPairs(results, title, sortKey) {
    sub(title);
    const sorted = [...results].sort((a, b) => Math.abs(b[sortKey] ?? 0) - Math.abs(a[sortKey] ?? 0));
    console.log(pad('SK metrik', 18) + pad('SON800 metrik', 22) + pad('ρ global', 10)
        + pad('n', 6) + pad('ρ koşu', 10) + pad('koşu#', 6));
    for (const r of sorted.slice(0, cli.top)) {
        if (r[sortKey] == null || isNaN(r[sortKey])) continue;
        console.log(
            pad(r.skLabel, 18)
            + pad(r.s8Label, 22)
            + pad(r.globalRho != null ? r.globalRho.toFixed(3) : '—', 10)
            + pad(String(r.globalN), 6)
            + pad(r.raceAvgRho != null ? r.raceAvgRho.toFixed(3) : '—', 10)
            + pad(String(r.raceCount), 6)
        );
    }
}

function evaluateLeaderAgreement(raceGroups, sikletCat, s800Cat, host) {
    sub('Alan lideri eşleşmesi (aynı at #1 mi?)');
    const pairs = [];
    for (const sk of sikletCat.filter(m => ['SK.SK%', 'SK.SK+', 'SK.BAS+', 'SK.GEN+'].includes(m.id))) {
        for (const s8 of s800Cat.filter(m => m.id.startsWith('S800.SON') || m.id.startsWith('S800.AGORT'))) {
            pairs.push({ sk, s8 });
        }
    }
    console.log(pad('SK lider', 14) + pad('S800 lider', 18) + pad('aynı at', 10)
        + pad('koşu', 6) + pad('★ BİTİŞ', 10));
    for (const { sk, s8 } of pairs) {
        let same = 0, total = 0, b1 = 0;
        for (const { horses } of raceGroups) {
            const lSk = pickLeader(horses, sk.get);
            const lS8 = pickLeader(horses, s8.get);
            if (!lSk || !lS8) continue;
            total++;
            if (lSk.row?.no === lS8.row?.no) {
                same++;
                const bit = host.bitisValueForSort(lSk);
                if (bit === 1) b1++;
            }
        }
        if (total < cli.minRaces) continue;
        console.log(
            pad(sk.label, 14) + pad(s8.label, 18)
            + pad(pct(same / total), 10) + pad(String(total), 6)
            + pad(total ? pct(b1 / total) : '—', 10)
        );
    }
}

function evaluateBitisCorr(entries, raceGroups, sikletCat, s800Cat, host) {
    sub('BİTİŞ sırası korelasyonu (ρ: yüksek metrik ↔ düşük BİTİŞ = iyi)');
    const bitisEntries = entries.filter(e => host.bitisValueForSort(e) != null);
    if (!bitisEntries.length) {
        console.log('⚠ BİTİŞ verisi yok — puanlama_bitis_sonuclari veya at ismi (N) gerekli.');
        return;
    }
    const allMetrics = [...sikletCat, ...s800Cat];
    const rows = [];
    for (const m of allMetrics) {
        const pairs = bitisEntries.map(e => ({ x: m.get(e), y: host.bitisValueForSort(e) }))
            .filter(p => p.x != null && p.y != null);
        if (pairs.length < cli.minSample) continue;
        const rho = spearmanFromPairs(pairs);
        if (rho == null) continue;
        rows.push({ id: m.id, label: m.label, side: m.side, rho, n: pairs.length, inv: -rho });
    }
    rows.sort((a, b) => b.inv - a.inv);
    console.log(pad('Metrik', 24) + pad('taraf', 6) + pad('ρ(BİTİŞ)', 10) + pad('-ρ', 10) + pad('n', 6));
    for (const r of rows.slice(0, cli.top)) {
        console.log(pad(r.label, 24) + pad(r.side, 6) + pad(r.rho.toFixed(3), 10)
            + pad(r.inv.toFixed(3), 10) + pad(String(r.n), 6));
    }
}

function evaluateTop3Overlap(raceGroups, host) {
    sub('Top-3 sıra örtüşmesi (SK% vs SON800 SON pct)');
    const skGet = e => e._dim?.siklet?.matchPct;
    const s8Get = e => e._s800?.[0]?.pct;
    let races = 0, overlapSum = 0, b1any = 0;
    for (const { horses } of raceGroups) {
        const skRanked = horses.map(e => ({ e, s: skGet(e) })).filter(x => x.s != null)
            .sort((a, b) => b.s - a.s).slice(0, 3);
        const s8Ranked = horses.map(e => ({ e, s: s8Get(e) })).filter(x => x.s != null)
            .sort((a, b) => b.s - a.s).slice(0, 3);
        if (skRanked.length < 3 || s8Ranked.length < 3) continue;
        races++;
        const skSet = new Set(skRanked.map(x => x.e.row?.no));
        const overlap = s8Ranked.filter(x => skSet.has(x.e.row?.no)).length;
        overlapSum += overlap;
        const bitWinner = horses.find(e => host.bitisValueForSort(e) === 1);
        if (bitWinner && (skSet.has(bitWinner.row?.no) || s8Ranked.some(x => x.e.row?.no === bitWinner.row?.no))) b1any++;
    }
    if (!races) {
        console.log('Yeterli koşu yok.');
        return;
    }
    console.log('Ort. top-3 örtüşme: ' + (overlapSum / races).toFixed(2) + ' / 3 · ' + races + ' koşu');
    console.log('SK% top3 veya SON800 top3 içinde kazanan: ' + pct(b1any / races) + ' (' + races + ' koşu)');
}

function printForensics(raceGroups, sikletCat, s800Cat, host) {
    if (!raceGroups.length) return;
    const { rk, horses } = raceGroups[0];
    const [kid, rno] = rk.split('|');
    hr('Koşu forensics · kayıt ' + kid + ' · ' + rno + '. koşu · ' + horses.length + ' at');
    horses.sort((a, b) => Number(a.row?.no) - Number(b.row?.no));

    const showSk = ['SK.BAS+', 'SK.SK%', 'SK.SK+', 'SK.1-2-3-4', 'SK.GEN+'];
    const showS8 = ['S800.SON', 'S800.SON.EI', 'S800.SON.D', 'S800.AGORT', 'S800.AGORT3'];
    const skM = sikletCat.filter(m => showSk.includes(m.id));
    const s8M = s800Cat.filter(m => showS8.includes(m.id));

    let hdr = pad('#', 4) + pad('AT', 22);
    for (const m of skM) hdr += pad(m.label, 8);
    hdr += ' | ';
    for (const m of s8M) hdr += pad(m.label, 8);
    hdr += pad('BİTİŞ', 6);
    console.log(hdr);

    for (const e of horses) {
        let line = pad(String(e.row?.no ?? ''), 4) + pad(String(e.row?.name || '').replace(/\s*\(\d+\)/, '').slice(0, 20), 22);
        for (const m of skM) {
            const v = m.get(e);
            line += pad(v != null ? (v % 1 ? v.toFixed(0) : String(v)) : '—', 8);
        }
        line += ' | ';
        for (const m of s8M) {
            const v = m.get(e);
            line += pad(v != null ? String(Math.round(v)) : '—', 8);
        }
        const bit = host.bitisValueForSort(e);
        line += pad(bit != null ? bit + '.' : '—', 6);
        console.log(line);
    }

    sub('Bu koşu — çift Spearman (tüm SK × SON800)');
    const pairs = [];
    for (const sk of sikletCat) {
        for (const s8 of s800Cat) {
            const ps = horses.map(e => ({ x: sk.get(e), y: s8.get(e) })).filter(p => p.x != null && p.y != null);
            if (ps.length < 4) continue;
            const rho = spearmanFromPairs(ps);
            if (rho == null || isNaN(rho)) continue;
            pairs.push({ sk: sk.label, s8: s8.label, rho, n: ps.length });
        }
    }
    pairs.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
    for (const p of pairs.slice(0, 20)) {
        console.log(pad(p.sk, 16) + ' ↔ ' + pad(p.s8, 16) + ' ρ=' + p.rho.toFixed(3) + ' n=' + p.n);
    }
}

async function listKayitlar(db) {
    const rows = await dbAll(db, 'SELECT id, hipodrom, tarih, race_count FROM hesaplama_kayitlari ORDER BY id DESC LIMIT 30');
    console.log('Son kayıtlar:');
    for (const r of rows) {
        console.log('  #' + r.id + ' · ' + r.hipodrom + ' · ' + r.tarih + ' · ' + (r.race_count || '?') + ' koşu');
    }
}

function loadFixture(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = [];
    for (const h of raw.horses || []) {
        const sk = h.sk || {};
        const depths = (h.s800 || []).map((cols, d) => ({
            pct: cols[0], horseBestPct: cols[1], selfPct: cols[2], gapPct: cols[3], successPct: cols[4], depth: d
        }));
        entries.push({
            kayitId: 'fixture',
            raceNo: raw.raceNo || 1,
            row: { no: h.no, name: h.name },
            _s800: depths,
            _s800Ort: {
                agirlikli: { pct: h.ort?.[0] ?? null },
                ort1: { pct: h.ort?.[1] ?? null },
                ort2: { pct: h.ort?.[2] ?? null },
                ort3: { pct: h.ort?.[3] ?? null }
            },
            _dim: {
                siklet: {
                    hedefAbbrev: String(sk.hedef ?? ''),
                    basSuccess: { pct: sk.bas ?? null },
                    kosuSayisi: sk.kosu ?? null,
                    matchCount: sk.skKosu ?? null,
                    matchPct: sk.skPct ?? null,
                    formTrend: sk.skForm != null ? { pct: sk.skForm } : { pct: null },
                    dimAdj: { pct: sk.skPlus ?? null },
                    cnt1: sk.c1 ?? 0, cnt2: sk.c2 ?? 0, cnt3: sk.c3 ?? 0, cnt4: sk.c4 ?? 0,
                    genAdj: { pct: sk.genPlus ?? null },
                    genCnt1: sk.g1 ?? 0, genCnt2: sk.g2 ?? 0, genCnt3: sk.g3 ?? 0, genCnt4: sk.g4 ?? 0
                }
            },
            _fixtureLabel: raw.label || path.basename(filePath)
        });
    }
    return { entries, maxDepth: raw.maxDepth || 6, label: raw.label || filePath };
}

function runExhaustiveRaceCorr(entries, sikletCat, s800Cat, label) {
    hr('Eksaustif koşu-içi korelasyon · ' + (label || ''));
    console.log('At sayısı: ' + entries.length + ' · Çift sayısı: '
        + (sikletCat.length * s800Cat.length + sikletCat.length * (sikletCat.length - 1) / 2
            + s800Cat.length * (s800Cat.length - 1) / 2));

    const allMetrics = [...sikletCat, ...s800Cat];
    const crossPairs = [];
    for (const sk of sikletCat) {
        for (const s8 of s800Cat) {
            crossPairs.push({ a: sk, b: s8, kind: 'SK↔S800' });
        }
    }
    for (let i = 0; i < sikletCat.length; i++) {
        for (let j = i + 1; j < sikletCat.length; j++) {
            crossPairs.push({ a: sikletCat[i], b: sikletCat[j], kind: 'SK↔SK' });
        }
    }
    for (let i = 0; i < s800Cat.length; i++) {
        for (let j = i + 1; j < s800Cat.length; j++) {
            crossPairs.push({ a: s800Cat[i], b: s800Cat[j], kind: 'S800↔S800' });
        }
    }

    const results = [];
    for (const { a, b, kind } of crossPairs) {
        const pairs = entries.map(e => ({ x: a.get(e), y: b.get(e) }))
            .filter(p => p.x != null && p.y != null && !isNaN(p.x) && !isNaN(p.y));
        if (pairs.length < 4) continue;
        const xs = pairs.map(p => p.x);
        const ys = pairs.map(p => p.y);
        if (Math.min(...xs) === Math.max(...xs) || Math.min(...ys) === Math.max(...ys)) continue;
        const rho = spearmanFromPairs(pairs);
        const r = pearsonFromPairs(pairs);
        if (rho == null) continue;
        results.push({ kind, a: a.label, b: b.label, aId: a.id, bId: b.id, rho, r, n: pairs.length });
    }
    results.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));

    sub('SK ↔ SON800 — en güçlü çiftler (Spearman ρ, n=' + entries.length + ')');
    console.log(pad('SK / A', 20) + pad('SON800 / B', 20) + pad('ρ', 8) + pad('r', 8) + pad('n', 4));
    for (const row of results.filter(r => r.kind === 'SK↔S800').slice(0, cli.top)) {
        console.log(pad(row.a, 20) + pad(row.b, 20) + pad(row.rho.toFixed(3), 8)
            + pad(row.r != null ? row.r.toFixed(3) : '—', 8) + pad(String(row.n), 4));
    }

    sub('SK ↔ SK (sıklet sütunları arası)');
    for (const row of results.filter(r => r.kind === 'SK↔SK' && Math.abs(r.rho) >= 0.5).slice(0, 15)) {
        console.log(pad(row.a, 18) + ' ↔ ' + pad(row.b, 18) + ' ρ=' + row.rho.toFixed(3));
    }

    sub('SON800 ↔ SON800 (derinlik sütunları arası · |ρ|≥0.7)');
    for (const row of results.filter(r => r.kind === 'S800↔S800' && Math.abs(r.rho) >= 0.7).slice(0, 20)) {
        console.log(pad(row.a, 18) + ' ↔ ' + pad(row.b, 18) + ' ρ=' + row.rho.toFixed(3));
    }

    sub('Yorum — SK↔SON800');
    const strong = results.filter(r => r.kind === 'SK↔S800' && Math.abs(r.rho) >= 0.55);
    const weak = results.filter(r => r.kind === 'SK↔S800' && Math.abs(r.rho) < 0.25);
    if (strong.length) {
        console.log('Güçlü (|ρ|≥0.55): ' + strong.length + ' çift');
        for (const s of strong.slice(0, 8)) {
            console.log('  · ' + s.a + ' ↔ ' + s.b + ' → ρ=' + s.rho.toFixed(3));
        }
    } else {
        console.log('Güçlü doğrusal korelasyon (|ρ|≥0.55) YOK — sıklet geçmişi ile SON800 farklı sinyaller.');
    }
    console.log('Zayıf (|ρ|<0.25): ' + weak.length + ' / '
        + results.filter(r => r.kind === 'SK↔S800').length + ' SK↔S800 çifti');

    return results;
}

async function checkDbSikletQuality(entries) {
    const groups = buildRaceGroups(entries);
    let skVarRaces = 0;
    for (const { horses } of groups) {
        if (horses.length < 4) continue;
        const pcts = horses.map(e => e._dim?.siklet?.matchPct).filter(v => v != null);
        if (pcts.length >= 4 && Math.min(...pcts) < Math.max(...pcts)) skVarRaces++;
    }
    if (skVarRaces === 0 && groups.length > 0) {
        console.log('\n⚠ DB uyarısı: koşu-içi SK% varyansı 0 — kayıtlı kosular[] içinde siklet alanı yok.');
        console.log('  SİKLET korelasyonu için: GETİR ile tam veri veya --demo / --fixture kullanın.');
    }
    return skVarRaces;
}

async function runFixtureMode() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    const { entries, maxDepth, label } = loadFixture(cli.fixturePath);
    const sikletCat = buildSikletCatalog();
    const s800Cat = buildSon800Catalog(maxDepth);
    const raceGroups = [{ rk: 'fixture|1', horses: entries }];
    const host = makeGostergeHost(entries, {});

    hr('SİKLET ↔ SON800-1 · FIXTURE modu');
    console.log(label);
    console.log('SK metrik: ' + sikletCat.length + ' · SON800: ' + s800Cat.length);

    if (cli.phases.includes('forensics') || cli.phases.includes('exhaustive')) {
        printForensics(raceGroups, sikletCat, s800Cat, host);
    }
    if (cli.phases.includes('exhaustive') || cli.phases.includes('all')) {
        runExhaustiveRaceCorr(entries, sikletCat, s800Cat, label);
    }
    if (cli.phases.includes('leader')) {
        evaluateLeaderAgreement(raceGroups, sikletCat, s800Cat, host);
    }
    if (cli.phases.includes('agree')) {
        evaluateTop3Overlap(raceGroups, host);
    }
}

async function main() {
    if (cli.fixturePath) {
        await runFixtureMode();
        return;
    }
    const db = openDb(cli.dbPath);
    if (cli.listOnly) {
        await listKayitlar(db);
        db.close();
        return;
    }

    loadEngines();
    const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {
        filterKayit: cli.kayitId,
        filterRace: cli.raceNo
    });
    const lookup = await loadRawHorseLookup(db);
    const maxDepth = attachMetrics(flatEntries, lookup);
    const entries = filterEntries(flatEntries);
    const host = makeGostergeHost(entries, bitisMap);
    const raceGroups = buildRaceGroups(entries);
    const sikletCat = buildSikletCatalog();
    const s800Cat = buildSon800Catalog(maxDepth);

    hr('SİKLET ↔ SON800-1 korelasyon raporu');
    console.log('Kayıt: ' + (cli.kayitId ?? 'TÜM') + ' · Koşu: ' + (cli.raceNo ?? 'TÜM')
        + ' · At: ' + entries.length + ' · Koşu: ' + raceGroups.length
        + ' · SON800 derinlik max: ' + maxDepth);
    console.log('SK metrik: ' + sikletCat.length + ' · SON800 metrik: ' + s800Cat.length
        + ' · Çift: ' + (sikletCat.length * s800Cat.length));

    await checkDbSikletQuality(entries);

    const allPairs = evaluateAllPairs(entries, raceGroups, sikletCat, s800Cat);

    if (cli.phases.includes('exhaustive') && raceGroups.length === 1) {
        runExhaustiveRaceCorr(entries, sikletCat, s800Cat, 'kayit ' + cli.kayitId + ' race ' + cli.raceNo);
    }

    if (cli.phases.includes('matrix') || cli.phases.includes('top')) {
        printTopPairs(allPairs, 'En güçlü global ρ (SK ↔ SON800)', 'globalRho');
    }
    if (cli.phases.includes('race') || cli.phases.includes('top')) {
        printTopPairs(allPairs, 'En güçlü koşu-içi ortalama ρ', 'raceAvgRho');
    }
    if (cli.phases.includes('leader')) {
        evaluateLeaderAgreement(raceGroups, sikletCat, s800Cat, host);
    }
    if (cli.phases.includes('bitis')) {
        evaluateBitisCorr(entries, raceGroups, sikletCat, s800Cat, host);
    }
    if (cli.phases.includes('agree')) {
        evaluateTop3Overlap(raceGroups, host);
    }
    if (cli.phases.includes('forensics') && (cli.raceNo || raceGroups.length === 1)) {
        printForensics(raceGroups, sikletCat, s800Cat, host);
    }

    // Özet yorum
    sub('Özet');
    const strongGlobal = allPairs.filter(r => r.globalRho != null && Math.abs(r.globalRho) >= 0.35 && r.globalN >= cli.minSample);
    const strongRace = allPairs.filter(r => r.raceAvgRho != null && Math.abs(r.raceAvgRho) >= 0.25 && r.raceCount >= cli.minRaces);
    if (strongGlobal.length) {
        const best = strongGlobal[0];
        console.log('En güçlü global çift: ' + best.skLabel + ' ↔ ' + best.s8Label
            + ' · ρ=' + best.globalRho.toFixed(3) + ' (n=' + best.globalN + ')');
    } else {
        console.log('Global |ρ|≥0.35 bulunamadı — zayıf/parçalı korelasyon.');
    }
    if (strongRace.length) {
        const best = strongRace.sort((a, b) => Math.abs(b.raceAvgRho) - Math.abs(a.raceAvgRho))[0];
        console.log('En güçlü koşu-içi çift: ' + best.skLabel + ' ↔ ' + best.s8Label
            + ' · ort ρ=' + best.raceAvgRho.toFixed(3) + ' (' + best.raceCount + ' koşu)');
    } else {
        console.log('Koşu-içi |ρ|≥0.25 bulunamadı.');
    }

    db.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
