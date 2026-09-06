#!/usr/bin/env node
/**
 * TAHMİN durum raporu — başarı, eksikler, düzeltme öncelikleri
 *
 *   node scripts/test-tahmin-status-report.js --db atlar.db
 *   node scripts/test-tahmin-status-report.js --db atlar.db --field-size 10
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    loadGostergeEngines,
    buildFlatEntriesFromDb,
    makeGostergeHost,
    parsePuanlamaStore,
    dbAll,
    dbGet,
    openDb,
    pct,
    pad
} = require('./ptest-terminal-lib');

global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : null
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }
function sub(t) { console.log('\n── ' + t + ' ──'); }

function loadHybridEngines() {
    loadGostergeEngines();
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8')
        + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/hybrid-tahmin-scoring-engine.js'), 'utf8')
        + '\n; global.HybridTahminScoringEngine = HybridTahminScoringEngine;');
}

function raceKey(e) {
    return String(e.kayitId) + '|' + e.raceNo;
}

function filterByFieldSize(entries, fsFilter) {
    if (!fsFilter) return entries;
    const byRace = new Map();
    for (const e of entries) {
        const rk = raceKey(e);
        if (!byRace.has(rk)) byRace.set(rk, []);
        byRace.get(rk).push(e);
    }
    const out = [];
    for (const [, group] of byRace) {
        if (group.length === fsFilter) out.push(...group);
    }
    return out;
}

async function loadPuanlamaStats(db) {
    try {
        const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (!row?.veri) return { bitis: {}, cikan: {}, bitisCount: 0, cikanCount: 0 };
        const s = parsePuanlamaStore(JSON.parse(row.veri));
        const cikanCount = Object.values(s.cikan || {}).reduce((n, a) => n + (a?.length || 0), 0);
        return {
            bitis: s.bitis || {},
            cikan: s.cikan || {},
            bitisCount: Object.keys(s.bitis || {}).length,
            cikanCount
        };
    } catch (_) {
        return { bitis: {}, cikan: {}, bitisCount: 0, cikanCount: 0 };
    }
}

async function scanKayitGaps(db, flatEntries) {
    const kayitCache = new Map();
    for (const e of flatEntries) {
        if (!kayitCache.has(e.kayitId)) {
            const row = await dbGet(db, 'SELECT veri FROM hesaplama_kayitlari WHERE id = ?', [e.kayitId]);
            try {
                kayitCache.set(e.kayitId, JSON.parse(row?.veri || '[]'));
            } catch (_) {
                kayitCache.set(e.kayitId, []);
            }
        }
    }
    let kosEmpty = 0;
    let kosmazInKayit = 0;
    const kosEmptySamples = [];
    for (const e of flatEntries) {
        const races = kayitCache.get(e.kayitId) || [];
        const race = races.find((r, i) => Number(r.raceNo || (i + 1)) === Number(e.raceNo));
        const h = (race?.horses || []).find(x => String(x.no) === String(e.row.no));
        if (h && global.AtSpeedUtils.isKosmazHorse(h)) kosmazInKayit++;
        if (!h?.kosular?.length) {
            kosEmpty++;
            if (kosEmptySamples.length < 8) {
                kosEmptySamples.push('#' + e.row.no + ' ' + (e.row.name || '') + ' K' + e.raceNo + ' kayit#' + e.kayitId);
            }
        }
    }
    return { kosEmpty, kosmazInKayit, kosEmptySamples };
}

function analyzeNearMiss(entries, host) {
    const G = global.GostergeScoringEngine;
    const byRace = new Map();
    for (const e of entries) {
        const rk = raceKey(e);
        if (!byRace.has(rk)) byRace.set(rk, []);
        byRace.get(rk).push(e);
    }

    let exact = 0, pm1 = 0, pm2 = 0, worse = 0, total = 0;
    let zeroScore = 0, zeroScoreWithBitis = 0;
    let winnerPred1 = 0, winnerTotal = 0;
    let leaderMissDepth = 0;
    let pctClusterRaces = 0;

    for (const group of byRace.values()) {
        G.attachRaceTahmin({ rows: group.map(e => e.row) });
        const withBitis = group.filter(e => host.bitisValueForSort(e) >= 1);
        if (!withBitis.length) continue;

        const pctGroups = new Map();
        for (const e of group) {
            const p = e.row.tahmin?.pct ?? '—';
            if (!pctGroups.has(p)) pctGroups.set(p, 0);
            pctGroups.set(p, pctGroups.get(p) + 1);
        }
        if ([...pctGroups.values()].some(c => c > 1)) pctClusterRaces++;

        for (const e of withBitis) {
            total++;
            const pred = e.row.tahmin?.rank;
            const bitis = host.bitisValueForSort(e);
            const delta = pred != null ? bitis - pred : null;
            const score = e.row.tahmin?.score ?? 0;
            if (score <= 0) {
                zeroScore++;
                zeroScoreWithBitis++;
            }
            if (delta === 0) exact++;
            else if (delta === 1 || delta === -1) pm1++;
            else if (delta === 2 || delta === -2) pm2++;
            else if (delta != null) worse++;

            if (bitis === 1) {
                winnerTotal++;
                if (pred === 1) winnerPred1++;
                else {
                    const leader = group.find(x => x.row.tahmin?.rank === 1);
                    const wDepth = global.AtSpeedUtils.depthTieBreakScore(e.row);
                    const lDepth = leader ? global.AtSpeedUtils.depthTieBreakScore(leader.row) : -1;
                    if (wDepth > lDepth) leaderMissDepth++;
                }
            }
        }
    }

    return {
        races: byRace.size,
        total,
        exact,
        pm1,
        pm2,
        worse,
        zeroScore,
        winnerPred1,
        winnerTotal,
        leaderMissDepth,
        pctClusterRaces
    };
}

async function main() {
    loadHybridEngines();
    const db = openDb(cli.dbPath);

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  TAHMİN · BİTİŞ durum raporu                                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('DB: ' + cli.dbPath);
    console.log('Tarih: ' + new Date().toISOString().slice(0, 19).replace('T', ' '));

    try {
        const kayitCount = (await dbAll(db, 'SELECT COUNT(*) c FROM hesaplama_kayitlari'))[0]?.c || 0;
        const puan = await loadPuanlamaStats(db);
        let { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db, {});
        flatEntries = filterByFieldSize(flatEntries, cli.fieldSize);

        const host = makeGostergeHost(flatEntries, bitisMap);
        await global.GostergeScoringEngine.calibrate(flatEntries, host);
        global.GostergeScoringEngine.applyToFlatEntries(flatEntries);

        const raceCount = new Set(flatEntries.map(raceKey)).size;
        const withBitis = flatEntries.filter(e => host.bitisValueForSort(e) >= 1).length;
        const gaps = await scanKayitGaps(db, flatEntries);

        let depthMiss = 0, depthCore = 0;
        for (const e of flatEntries) {
            if (e.row.depthsMissing?.anyPrimary) depthMiss++;
            if (e.row.depthsMissing?.anyCore) depthCore++;
        }

        hr('1. VERİ TABANI DURUMU');
        console.log('  hesaplama_kayitlari: ' + kayitCount + ' kayıt');
        console.log('  Toplam satır: ' + flatEntries.length + ' · koşu: ' + raceCount
            + (cli.fieldSize ? ' (' + cli.fieldSize + '-at filtresi)' : ''));
        console.log('  Bitişli at: ' + withBitis + ' (' + pct(withBitis / Math.max(flatEntries.length, 1)) + ')');
        console.log('  PUANLAMA TEST bitiş kaydı: ' + puan.bitisCount + ' at');
        console.log('  PUANLAMA çıkan-at (soft liste): ' + puan.cikanCount + ' at');
        if (puan.cikanCount) {
            console.log('  ⚠ Çıkan atlar kayıtta duruyor → purge-cikan-from-kayitlar.js --apply');
        }
        console.log('  kosular[]=0: ' + gaps.kosEmpty + ' at (' + pct(gaps.kosEmpty / Math.max(flatEntries.length, 1)) + ')');
        console.log('  Kayıtta koşmaz/çekildi isim: ' + gaps.kosmazInKayit + ' at');
        console.log('  Derinlik eksik (anyPrimary): ' + depthMiss + ' · çekirdek (S800+T1+T1DR yok): ' + depthCore);
        if (gaps.kosEmptySamples.length) {
            sub('kosular boş örnek');
            gaps.kosEmptySamples.forEach(s => console.log('    ' + s));
        }

        hr('2. TAHMİN BAŞARI (Gösterge — PUANLAMA TEST motoru)');
        const nm = analyzeNearMiss(flatEntries, host);
        if (!nm.total) {
            console.log('  Bitiş verisi yok — PUANLAMA TEST BİTİŞ sütununu doldurun.');
        } else {
            const rate = n => pct(n / nm.total);
            console.log('  Koşu: ' + nm.races + ' · bitişli at: ' + nm.total);
            console.log('  Tam isabet:     ' + nm.exact + ' (' + rate(nm.exact) + ')');
            console.log('  ±1 yakın:       ' + nm.pm1 + ' (' + rate(nm.pm1) + ') → birlikte ' + rate(nm.exact + nm.pm1));
            console.log('  ±2:             ' + nm.pm2 + ' (' + rate(nm.pm2) + ')');
            console.log('  ≥3 sapma:       ' + nm.worse + ' (' + rate(nm.worse) + ')');
            console.log('  Skor=0 (gösterge eşleşmesi yok): ' + nm.zeroScore + ' (' + rate(nm.zeroScore) + ')');
            console.log('  pct kümeli koşu: ' + nm.pctClusterRaces + '/' + nm.races);
            console.log('  Kazanan T1 tahmin: ' + nm.winnerPred1 + '/' + nm.winnerTotal
                + ' (' + pct(nm.winnerPred1 / Math.max(nm.winnerTotal, 1)) + ')');
            console.log('  Kazanan derinlik > tahmin lideri: ' + nm.leaderMissDepth + '/' + nm.winnerTotal
                + ' (derinlik lideri kaçırıldı)');
        }

        hr('3. MOTOR KARŞILAŞTIRMA (bitişli koşular)');
        if (withBitis >= 10) {
            const subset = flatEntries.filter(e => host.bitisValueForSort(e) >= 1);
            const engines = ['basari', 'gosterge', 'hybrid'];
            for (const eng of engines) {
                const st = global.HybridTahminScoringEngine.evaluateEngineOnFlat(subset, host.bitisValueForSort, eng);
                console.log('  ' + pad(eng, 10) + ' karışık ' + pad(pct(st.leaderBlended), 7)
                    + ' · tam ' + pad(pct(st.exactRate), 7)
                    + ' · lider ' + st.leaderTotal + ' koşu');
            }
        } else {
            console.log('  Yetersiz bitiş verisi (<10 at)');
        }

        hr('4. NE YANLIŞ / NE EKSİK');
        const issues = [];
        if (gaps.kosEmpty > flatEntries.length * 0.05) {
            issues.push({ p: 'YÜKSEK', t: 'kosular[] boş (' + gaps.kosEmpty + ' at) → repair-missing-kosular.js --refresh --apply' });
        }
        if (gaps.kosmazInKayit > 0) {
            issues.push({ p: 'YÜKSEK', t: gaps.kosmazInKayit + ' koşmaz/çekildi at hâlâ kayıtta → PUANLAMA ✕ veya index kayıt filtresi' });
        }
        if (puan.cikanCount > 0) {
            issues.push({ p: 'ORTA', t: puan.cikanCount + ' soft çıkan-at → purge-cikan-from-kayitlar.js --apply' });
        }
        if (nm.zeroScore > nm.total * 0.15) {
            issues.push({ p: 'YÜKSEK', t: '%' + Math.round(100 * nm.zeroScore / nm.total) + ' at gösterge skoru=0 → renk kuralı eşleşmiyor veya veri eksik' });
        }
        if (nm.leaderMissDepth > nm.winnerTotal * 0.2) {
            issues.push({ p: 'YÜKSEK', t: 'Kazanan çoğu kez derinlik lideri ama tahmin lideri değil → renk/gösterge derinliği gölgede bırakıyor' });
        }
        if (nm.pctClusterRaces > nm.races * 0.5) {
            issues.push({ p: 'ORTA', t: 'pct küme oranı yüksek → tie-break / normalize iyileştirmesi' });
        }
        if (puan.bitisCount < withBitis * 0.5) {
            issues.push({ p: 'ORTA', t: 'PUANLAMA bitiş kaydı az (' + puan.bitisCount + ' vs ' + withBitis + ' bitişli) → bitiş sütununu kaydet' });
        }
        if (!issues.length) issues.push({ p: '—', t: 'Kritik veri boşluğu tespit edilmedi' });
        for (const i of issues) console.log('  [' + i.p + '] ' + i.t);

        hr('5. ÖNCELİKLİ DÜZELTMELER');
        console.log('  1. Çıkan/koşmaz atları kayıttan kalıcı sil (PR #51 deploy + purge-cikan)');
        console.log('  2. kosular=0 atları TJK fetch ile doldur (repair-missing-kosular.js --refresh)');
        console.log('  3. Derinlik lideri kazananları yukarı taşı — Final Share / depth boost');
        console.log('  4. Skor=0 kümesinde depth-primary sıra (yapıldı — deploy kontrol)');
        console.log('  5. PUANLAMA TEST bitişlerini kaydet → kalibrasyon güçlenir');

        hr('6. KOMUTLAR');
        console.log('  node scripts/test-tahmin-status-report.js --db atlar.db --field-size 10');
        console.log('  node scripts/test-near-miss-report.js --field-size 10 --verbose');
        console.log('  node scripts/repair-missing-kosular.js --scan-depth');
        console.log('  node scripts/purge-cikan-from-kayitlar.js --apply');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
