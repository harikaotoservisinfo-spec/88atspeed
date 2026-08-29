#!/usr/bin/env node
/**
 * Başarı % TAHMİN — terminal benchmark ve koşu debug
 *
 * Kullanım:
 *   node scripts/test-basari-pct-tahmin.js
 *   node scripts/test-basari-pct-tahmin.js --kayit 140 --race 1
 *   node scripts/test-basari-pct-tahmin.js --db /path/to/atlar.db
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);

function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const dbPath = argVal('--db') || path.join(ROOT, 'atlar.db');
const filterKayit = argVal('--kayit') ? Number(argVal('--kayit')) : null;
const filterRace = argVal('--race') ? Number(argVal('--race')) : null;
const verbose = args.includes('--verbose') || args.includes('-v');

function loadEngines() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    eval(fs.readFileSync(path.join(ROOT, 'public/js/formula-engine.js'), 'utf8') + '\n; global.GosterimEngine = GosterimEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/istatistik-grids-extra.js'), 'utf8'));
    eval(fs.readFileSync(path.join(ROOT, 'public/js/gosterge-scoring-engine.js'), 'utf8') + '\n; global.GostergeScoringEngine = GostergeScoringEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/basari-pct-scoring-engine.js'), 'utf8') + '\n; global.BasariPctScoringEngine = BasariPctScoringEngine;');
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function parsePuanlamaStore(raw) {
    if (!raw || typeof raw !== 'object') return { bitis: {}, cikan: {} };
    const isLegacy = !raw.bitis && !raw.cikan && Object.values(raw).some(v => typeof v === 'number');
    if (isLegacy) return { bitis: raw, cikan: {} };
    return { bitis: raw.bitis || {}, cikan: raw.cikan || {} };
}

function rowKeyParts(kayitId, raceNo, horseNo) {
    return String(kayitId) + '|' + raceNo + '|' + String(horseNo ?? '');
}

async function buildFlatEntriesFromDb(db) {
    const IE = global.IstatistikEngine;
    let bitisMap = {};
    try {
        const bitisRow = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
        if (bitisRow?.veri) {
            bitisMap = parsePuanlamaStore(JSON.parse(bitisRow.veri)).bitis;
        }
    } catch (_) {
        console.warn('⚠ puanlama_bitis_sonuclari tablosu yok — bitiş verisi at adından okunur');
    }

    let kayitlar;
    try {
        kayitlar = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
    } catch (err) {
        throw new Error('hesaplama_kayitlari tablosu okunamadı: ' + err.message);
    }
    if (filterKayit) kayitlar = kayitlar.filter(k => Number(k.id) === filterKayit);

    const flat = [];
    for (const kayit of kayitlar) {
        let races;
        try {
            races = JSON.parse(kayit.veri);
        } catch (_) {
            continue;
        }
        if (!Array.isArray(races)) continue;

        const raceEntries = races.map((race, i) => {
            const raceNo = race.raceNo || (i + 1);
            const pkg = IE.buildRaceIstatistikPackage(race, kayit.hipodrom, kayit.tarih);
            return { race, raceNo, pkg };
        });
        if (raceEntries.length) IE.applyProgramGlobalPctScales(raceEntries.map(e => e.pkg));

        for (const { raceNo, pkg } of raceEntries) {
            if (filterRace && Number(raceNo) !== filterRace) continue;
            for (const row of pkg.rows) {
                const key = rowKeyParts(kayit.id, raceNo, row.no);
                const bitisRaw = bitisMap[key];
                const fromName = global.AtSpeedUtils.extractBitisFromHorseName(row.name);
                const bitisPos = bitisRaw != null && bitisRaw >= 1 ? bitisRaw : fromName;
                flat.push({
                    row,
                    tarih: kayit.tarih,
                    raceNo,
                    hipodrom: kayit.hipodrom,
                    kayitId: kayit.id,
                    _bitisPos: bitisPos != null && bitisPos >= 1 ? bitisPos : null,
                    _pkg: pkg
                });
            }
        }
    }
    return { flatEntries: flat, bitisMap };
}

function makeBitisHost(flatEntries, bitisMap) {
    return {
        flatEntries,
        bitisValueForSort(entry) {
            if (entry._bitisPos != null) return entry._bitisPos;
            const key = rowKeyParts(entry.kayitId, entry.raceNo, entry.row?.no);
            const raw = bitisMap[key];
            if (raw != null && raw >= 1) return raw;
            const fromName = global.AtSpeedUtils.extractBitisFromHorseName(entry.row?.name);
            return fromName != null && fromName >= 1 ? fromName : null;
        }
    };
}

function pct(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return (Math.round(n * 1000) / 10).toFixed(1) + '%';
}

function pad(s, n) {
    s = String(s ?? '');
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function printRaceDetail(entries, host) {
    const BPE = global.BasariPctScoringEngine;
    const pkg = entries[0]._pkg;
    const fs = entries.length;
    BPE.attachRaceTahmin(pkg);
    const weights = BPE.lookupWeights(fs);

    console.log('\n── Kayıt ' + entries[0].kayitId + ' · Koşu ' + entries[0].raceNo
        + ' · ' + fs + ' at · ' + entries[0].hipodrom + ' ' + entries[0].tarih + ' ──');
    console.log('Profil ağırlıkları (birleşik): ' + Object.entries(weights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, w]) => BPE.STAT_CATALOG.find(s => s.key === k)?.label + ' ' + w + '%')
        .join(' · '));

    console.log(pad('#', 3) + pad('AT', 28) + pad('Skor', 6) + pad('Tah', 5)
        + pad('Bit', 5) + 'Kullanılan başarı yüzdeleri');
    console.log('-'.repeat(90));

    const sorted = [...pkg.rows].sort((a, b) => (a.tahmin?.rank ?? 99) - (b.tahmin?.rank ?? 99));
    for (const row of sorted) {
        const bitis = host.bitisValueForSort(entries.find(e => e.row === row));
        const terms = (row.tahmin?.topTerms || [])
            .slice(0, verbose ? 8 : 4)
            .map(t => t.label + ' %' + t.pct)
            .join(', ');
        const match = bitis != null && row.tahmin?.rank === bitis ? ' ✓' : '';
        console.log(
            pad(row.no, 3)
            + pad((row.name || '').replace(/\s*\(\d+\)\s*$/, '').slice(0, 26), 28)
            + pad(row.tahmin?.score ?? '—', 6)
            + pad(row.tahmin?.rank != null ? row.tahmin.rank + '.' : '—', 5)
            + pad(bitis != null ? bitis + '.' : '—', 5)
            + (terms || '(veri yok)') + match
        );
        if (row.tahmin?.metricCount === 0) {
            console.log('    ⚠ hiç başarı yüzdesi yok — at geçmişi boş veya dönem dışı');
        }
    }

    const leader = sorted[0];
    const lb = host.bitisValueForSort(entries.find(e => e.row === leader));
    console.log('Lider: ' + (leader?.name || '?') + ' → bitiş ' + (lb ?? '?')
        + (lb === 1 ? ' ✓ BİRİNCİ' : (lb != null && lb <= 3 ? ' (ilk 3)' : '')));
}

async function main() {
    if (!fs.existsSync(dbPath)) {
        console.error('Veritabanı bulunamadı: ' + dbPath);
        console.error('Sunucudaki atlar.db yolunu --db ile verin veya 88atspeed klasöründe çalıştırın.');
        process.exit(1);
    }

    loadEngines();
    const db = new sqlite3.Database(dbPath);
    const BPE = global.BasariPctScoringEngine;

    try {
        const { flatEntries, bitisMap } = await buildFlatEntriesFromDb(db);
        const host = makeBitisHost(flatEntries, bitisMap);
        const withBitis = flatEntries.filter(e => host.bitisValueForSort(e) != null);

        console.log('=== Başarı % TAHMİN · Terminal Benchmark ===');
        console.log('DB: ' + dbPath);
        console.log('Satır: ' + flatEntries.length + ' · Bitişli: ' + withBitis.length
            + ' · Koşu: ' + new Set(flatEntries.map(e => e.kayitId + '|' + e.raceNo)).size);

        if (!flatEntries.length) {
            console.log('Veri yok.');
            process.exit(0);
        }

        const summary = BPE.calibrateFromFlatEntries(flatEntries, host.bitisValueForSort);
        if (summary?.list?.length) {
            console.log('\nAt sayısı profilleri (' + summary.list.length + '):');
            for (const p of summary.list.sort((a, b) => a.fieldSize - b.fieldSize)) {
                console.log('  ' + p.fieldSize + ' at · ' + p.raceCount + ' koşu · karışık '
                    + pct(p.leaderBlended) + ' · ' + (p.preview || []).join(' · '));
            }
        } else {
            console.log('\n⚠ Profil kalibre edilemedi (yeterli koşu yok) — varsayılan ağırlıklar');
        }

        const stats = BPE.evaluateTahminSuccess(flatEntries, host.bitisValueForSort);
        console.log('\nGenel başarı (birleşik skor):');
        console.log('  Lider 1.:  ' + stats.leaderB1 + '/' + stats.leaderTotal + ' (' + pct(stats.leaderB1Rate) + ')');
        console.log('  Lider 1-2: ' + stats.leaderB12 + '/' + stats.leaderTotal + ' (' + pct(stats.leaderB12Rate) + ')');
        console.log('  Lider 1-3: ' + stats.leaderB123 + '/' + stats.leaderTotal + ' (' + pct(stats.leaderB123Rate) + ')');
        console.log('  Karışık:   ' + pct(stats.leaderBlended));
        console.log('  Tam isabet:' + stats.exact + '/' + stats.exactTotal + ' (' + pct(stats.exactRate) + ')');
        if (stats.noScoreRaces) {
            console.log('  ⚠ Verisiz koşu (skor yok): ' + stats.noScoreRaces);
        }

        const statDiag = [];
        for (const { key, label } of BPE.STAT_CATALOG) {
            let n = 0;
            for (const e of flatEntries) {
                if (BPE.resolveBasariPct(e.row, key) != null) n++;
            }
            statDiag.push({ key, label, n, rate: n / flatEntries.length });
        }
        statDiag.sort((a, b) => b.rate - a.rate);
        console.log('\nEn yaygın başarı alanları:');
        for (const s of statDiag.slice(0, 8)) {
            console.log('  ' + pad(s.label, 22) + flatEntries.length + ' satırın '
                + pct(s.rate) + ' (' + s.n + ')');
        }
        const rare = statDiag.filter(s => s.rate < 0.15 && s.rate > 0);
        if (rare.length) {
            console.log('\n⚠ Seyrek alanlar (<15% doluluk) — profilde öne çıkarsa çoğu at skorsuz kalır:');
            for (const s of rare.slice(0, 6)) {
                console.log('  ' + s.label + ' ' + pct(s.rate));
            }
        }

        if (filterKayit || filterRace) {
            const byRace = new Map();
            for (const e of flatEntries) {
                const rk = e.kayitId + '|' + e.raceNo;
                if (!byRace.has(rk)) byRace.set(rk, []);
                byRace.get(rk).push(e);
            }
            for (const entries of byRace.values()) {
                printRaceDetail(entries, host);
            }
        } else {
            console.log('\nTek koşu detayı için: node scripts/test-basari-pct-tahmin.js --kayit ID --race N');
        }

        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
