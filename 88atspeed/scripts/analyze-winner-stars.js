#!/usr/bin/env node
/**
 * Kazanan-belirleyici yıldız analizi.
 *
 * hesaplama_kayitlari.veri (SON TEST anlık görüntüsü, geçmiş koşularla) +
 * puanlama_bitis_sonuclari (bitiş sırası) birleştirilir. Her koşuda birincinin
 * (ve ilk-2'nin) renk-kuralı yıldızları, sahanın geri kalanıyla kıyaslanır:
 *   - SADECE birincide olan kural (diğer atlarda yok)
 *   - birincide daha FAZLA olan kural (diğerlerinden çok)
 * Bunlar SON (son koşu) / SON 2 / SON 7 pencerelerinde ayrı ayrı raporlanır.
 *
 *   node scripts/analyze-winner-stars.js --db atlar.db
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { loadGostergeEngines } = require('./ptest-terminal-lib');
const { t1drEqualsTest1, resolveHorseKosular, horseKey } = require('../lib/t1dr-test1-match');

loadGostergeEngines();
const G = global.GosterimEngine;
const COL = G.COL;
const MAXCOL = Math.max(...Object.values(COL));

// Anlamlı renk kuralları (yapısal/kendi-satır vurguları hariç) — lib ile aynı katalog
const KURALLAR = [
    { token: 'kirmizi-yazi',               ad: 'Kırmızı (TEST en küçük)' },
    { token: 'fosfor-kirmizi-yazi',        ad: 'Kırmızı (T1×DR son koşu)' },
    { token: 'fosfor-kirmizi-kenar-satir', ad: 'Kırmızı kenar satır', satir: true },
    { token: 'guclu-uyari-satir',          ad: 'Güçlü uyarı satır', satir: true },
    { token: 'eslesme-yesil',              ad: 'Yeşil eşleşme' },
    { token: 'guclu-sehir-eslesme',        ad: 'Güçlü şehir eşleşme' },
    { token: 'fosfor-yesil-hucre',         ad: 'Yeşil (TEST4=TEST6)' },
    { token: 'fosfor-yesil-satir',         ad: 'Satır tam yeşil', satir: true },
    { token: 'fosfor-yesil-koyu-yazi',     ad: 'Koyu yeşil (en negatif)' },
    { token: 'yesil-yazi',                 ad: 'Yeşil yazı (TEST5)' },
    { token: 'fosfor-sari-yazi',           ad: 'Sarı (TEST1-2 yakın)' },
    { token: 'mavi-yanip-son',             ad: 'Mavi yanıp (8002-8001)' },
    { token: 'test23-yanip-son',           ad: 'Turuncu yanıp (TEST2-3)' },
    { token: 'test9-yanip-son-guclu',      ad: 'Mor yanıp (TEST9)' },
    { token: 't1dr-eniyi-yanip-son',       ad: 'Mavi yanıp (T1×DR en iyi 2)' },
    { token: 'fosfor-mavi-yazi',           ad: 'Mavi fosfor' },
    { token: 'fosfor-mavi-satir',          ad: 'Mavi fosfor satır', satir: true },
    { token: 'pembe-hucre',                ad: 'Pembe (boş fark)' }
];
const SATIR_KURAL = KURALLAR.filter((r) => r.satir);
const HUCRE_KURAL = KURALLAR.filter((r) => !r.satir);
const RX = new Map(KURALLAR.map((r) => [r.token, new RegExp('\\b' + r.token + '\\b')]));
const GOLD = 'T1×DR eşleşme';
const WINDOWS = ['son1', 'son2', 'son7'];
const WIN_LABEL = { son1: 'SON (son koşu)', son2: 'SON 2 yarış', son7: 'SON 7 yarış' };

function argVal(flag, def) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : def;
}

function openDb(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
}

/** Bir atın satırlarından SON7/SON2/SON1 pencerelerinde kural -> toplam görülme sayısı */
function computeWindows(rows) {
    const W = { son7: new Map(), son2: new Map(), son1: new Map() };
    const matched = { son7: false, son2: false, son1: false };
    const add = (w, ad) => W[w].set(ad, (W[w].get(ad) || 0) + 1);
    for (const row of rows) {
        const sira = parseInt(row.values[0], 10);
        if (isNaN(sira) || sira < 1 || sira > 7) continue;
        const wins = sira <= 1 ? ['son7', 'son2', 'son1'] : (sira <= 2 ? ['son7', 'son2'] : ['son7']);
        if (t1drEqualsTest1(row.values[COL.TEST1_ENTEGRE], row.values[COL.TEST1])) wins.forEach((w) => { matched[w] = true; });
        const sc = row.classes?.satirClass || '';
        if (sc) for (const r of SATIR_KURAL) if (RX.get(r.token).test(sc)) wins.forEach((w) => add(w, r.ad));
        for (let c = 0; c <= MAXCOL; c++) {
            const cls = G.getCellClass(c, row.classes);
            if (!cls) continue;
            for (const r of HUCRE_KURAL) if (RX.get(r.token).test(cls)) wins.forEach((w) => add(w, r.ad));
        }
    }
    for (const w of WINDOWS) if (matched[w]) W[w].set(GOLD, (W[w].get(GOLD) || 0) + 1);
    return W;
}

function ensureStat(map, ad) {
    let s = map.get(ad);
    if (!s) { s = { kosu: 0, birinci: 0, sadece: 0, fazla: 0 }; map.set(ad, s); }
    return s;
}

async function main() {
    const dbPath = argVal('--db', path.join(__dirname, '..', 'atlar.db'));
    const db = await openDb(dbPath);

    const bitisRow = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id=1');
    const bitis = bitisRow ? (JSON.parse(bitisRow.veri).bitis || {}) : {};
    if (!Object.keys(bitis).length) { console.log('Bitiş sonucu yok.'); process.exit(0); }

    const kayitlar = await dbAll(db, 'SELECT id, tarih, hipodrom, veri FROM hesaplama_kayitlari ORDER BY id');

    // STATS[window] = Map(ad -> stat)  — sadece birinci
    const STATS = { son1: new Map(), son2: new Map(), son7: new Map() };
    // TOP2[window] = Map(ad -> stat) — ilk 2 (birinci+ikinci) sadece-onlarda
    const TOP2 = { son1: new Map(), son2: new Map(), son7: new Map() };
    let kosuSayisi = 0;
    let kayitSayisi = 0;

    for (const kayit of kayitlar) {
        let races;
        try { races = JSON.parse(kayit.veri || '[]'); } catch (_) { continue; }
        if (!Array.isArray(races) || !races.length) continue;
        let kayitKatildi = false;

        for (const race of races) {
            const raceNo = String(race.raceNo);
            const horses = race.horses || [];
            if (horses.length < 4) continue;

            // bitiş sırası
            const pos = new Map(); // horseIndex -> finishPos
            let winnerIdx = -1;
            let secondIdx = -1;
            horses.forEach((h, i) => {
                const p = bitis[kayit.id + '|' + raceNo + '|' + String(h.no)];
                if (p != null) {
                    pos.set(i, p);
                    if (p === 1) winnerIdx = i;
                    if (p === 2) secondIdx = i;
                }
            });
            if (winnerIdx < 0) continue; // birinci bilinmiyorsa atla

            // yıldız pencereleri (tüm atlar)
            const calcHorses = horses.map((h) => Object.assign({}, h, { kosular: resolveHorseKosular(null, h) }));
            const calcRace = Object.assign({}, race, { horses: calcHorses });
            let rows;
            try {
                rows = G.buildRaceRows(calcRace, { programTarih: kayit.tarih, hipodromSehir: kayit.hipodrom, raceIndex: 0 });
            } catch (_) { continue; }
            const rowsByIdx = new Map();
            for (const row of rows || []) {
                const hi = row.meta?.horseIndex;
                if (hi == null) continue;
                if (!rowsByIdx.has(hi)) rowsByIdx.set(hi, []);
                rowsByIdx.get(hi).push(row);
            }
            const winByIdx = new Map();
            for (const [hi, hrows] of rowsByIdx) winByIdx.set(hi, computeWindows(hrows));
            if (!winByIdx.has(winnerIdx)) continue; // birincinin geçmişi yoksa atla

            kosuSayisi++;
            kayitKatildi = true;
            const allIdx = [...winByIdx.keys()];

            for (const w of WINDOWS) {
                // koşuda geçen tüm kurallar
                const rulesInRace = new Set();
                for (const hi of allIdx) for (const ad of winByIdx.get(hi)[w].keys()) rulesInRace.add(ad);
                for (const ad of rulesInRace) ensureStat(STATS[w], ad).kosu++;

                // birinci
                const wMap = winByIdx.get(winnerIdx)[w];
                const others = allIdx.filter((hi) => hi !== winnerIdx);
                for (const [ad, wc] of wMap) {
                    const s = ensureStat(STATS[w], ad);
                    s.birinci++;
                    const oc = others.map((hi) => winByIdx.get(hi)[w].get(ad) || 0);
                    const oMax = oc.length ? Math.max(...oc) : 0;
                    const oHave = oc.filter((x) => x > 0).length;
                    if (oHave === 0) s.sadece++;
                    else if (wc > oMax) s.fazla++;
                }

                // ilk 2 (birinci + ikinci) — sahanın geri kalanında olmayan
                const top2 = [winnerIdx];
                if (secondIdx >= 0 && winByIdx.has(secondIdx)) top2.push(secondIdx);
                const rest = allIdx.filter((hi) => !top2.includes(hi));
                const top2Rules = new Set();
                for (const hi of top2) for (const ad of winByIdx.get(hi)[w].keys()) top2Rules.add(ad);
                for (const ad of rulesInRace) ensureStat(TOP2[w], ad).kosu++;
                for (const ad of top2Rules) {
                    const s = ensureStat(TOP2[w], ad);
                    s.birinci++;
                    const restHave = rest.some((hi) => (winByIdx.get(hi)[w].get(ad) || 0) > 0);
                    if (!restHave) s.sadece++;
                }
            }
        }
        if (kayitKatildi) kayitSayisi++;
    }

    db.close();

    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    console.log('\n=== KAZANAN-BELİRLEYİCİ YILDIZ ANALİZİ ===');
    console.log('Kayıt: ' + kayitSayisi + ' · Analiz edilen koşu (birinci bilinen): ' + kosuSayisi + '\n');

    for (const w of WINDOWS) {
        console.log('\n################  ' + WIN_LABEL[w] + '  ################');
        console.log('(BİRİNCİ atı sahanın geri kalanıyla kıyaslama)');
        console.log('kural'.padEnd(30) + 'koşu  birinci-var  SADECE-1.  1.-FAZLA  belirginlik');
        const rows = [...STATS[w].entries()]
            .map(([ad, s]) => ({ ad, ...s, skor: s.sadece + s.fazla }))
            .filter((r) => r.kosu >= 2)
            .sort((a, b) => b.skor - a.skor || b.sadece - a.sadece);
        for (const r of rows) {
            const belirgin = pct(r.sadece + r.fazla, r.kosu);
            console.log(
                r.ad.padEnd(30)
                + String(r.kosu).padEnd(6)
                + String(r.birinci).padEnd(13)
                + String(r.sadece).padEnd(11)
                + String(r.fazla).padEnd(10)
                + '%' + belirgin
            );
        }

        console.log('\n(İLK 2 [birinci+ikinci] — sahanın geri kalanında OLMAYAN kural)');
        console.log('kural'.padEnd(30) + 'koşu  ilk2-var  SADECE-ilk2  oran');
        const rows2 = [...TOP2[w].entries()]
            .map(([ad, s]) => ({ ad, ...s }))
            .filter((r) => r.kosu >= 2)
            .sort((a, b) => b.sadece - a.sadece);
        for (const r of rows2) {
            console.log(
                r.ad.padEnd(30)
                + String(r.kosu).padEnd(6)
                + String(r.birinci).padEnd(10)
                + String(r.sadece).padEnd(13)
                + '%' + pct(r.sadece, r.kosu)
            );
        }
    }
}

main().catch((e) => { console.error('HATA:', e.message || e); process.exit(1); });
