#!/usr/bin/env node
/**
 * Koşmayan (Koşmaz) atları hesaplama kayıtlarından temizle
 *
 *   node scripts/purge-kosmaz-horses.js --db atlar.db --scan
 *   node scripts/purge-kosmaz-horses.js --db atlar.db --apply
 *   node scripts/purge-kosmaz-horses.js --db atlar.db --kayit 135 --apply
 */
const path = require('path');
const { openDb, dbAll, dbGet, parsePuanlamaStore } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    apply: args.includes('--apply'),
    scan: args.includes('--scan') || !args.includes('--apply')
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }

function isKosmazName(name) {
    if (!name) return false;
    const s = String(name);
    return /\(\s*koşmaz\s*\)/i.test(s)
        || /\(\s*kosmaz\s*\)/i.test(s)
        || /\(\s*koşm\s*\)/i.test(s)
        || /\(\s*çekildi\s*\)/i.test(s)
        || /\(\s*cekildi\s*\)/i.test(s);
}

function parseKayitVeri(raw) {
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(data) ? data : null;
    } catch (_) {
        return null;
    }
}

function scanKayit(kayit) {
    const races = parseKayitVeri(kayit.veri);
    if (!races) return [];
    const found = [];
    for (const race of races) {
        const raceNo = race.raceNo || race.race_no;
        for (const horse of race.horses || []) {
            if (horse.kosmaz === true || isKosmazName(horse.name)) {
                found.push({
                    kayitId: kayit.id,
                    table: kayit._table,
                    hipodrom: kayit.hipodrom,
                    tarih: kayit.tarih,
                    raceNo,
                    horseNo: horse.no,
                    horseName: horse.name,
                    atId: horse.atId
                });
            }
        }
    }
    return found;
}

function purgeRaces(races) {
    let removed = 0;
    for (const race of races) {
        const before = (race.horses || []).length;
        race.horses = (race.horses || []).filter(h => {
            if (h.kosmaz === true || isKosmazName(h.name)) {
                removed++;
                return false;
            }
            return true;
        });
        race.horseCount = race.horses.length;
        if (before !== race.horses.length && race.horses.length === 0) {
            race._emptyAfterPurge = true;
        }
    }
    return removed;
}

async function main() {
    const db = openDb(cli.dbPath);
    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  Koşmaz at temizliği                                        ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Mod: ' + (cli.apply ? 'APPLY (sil + yaz)' : 'DRY-RUN (rapor)'));

        let cikanMap = {};
        try {
            const row = await dbGet(db, 'SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1');
            if (row?.veri) cikanMap = parsePuanlamaStore(JSON.parse(row.veri)).cikan || {};
        } catch (_) { /* yok */ }

        const tables = ['hesaplama_kayitlari', 'at_verileri'];
        const allFound = [];
        const jobs = [];

        for (const table of tables) {
            let rows;
            try {
                rows = await dbAll(db, `SELECT id, hipodrom, tarih, veri FROM ${table} ORDER BY id`);
            } catch (_) {
                continue;
            }
            for (const row of rows) {
                if (cli.kayitId && row.id !== cli.kayitId) continue;
                row._table = table;
                const found = scanKayit(row);
                allFound.push(...found);
                if (found.length) jobs.push({ table, kayitId: row.id, hipodrom: row.hipodrom, tarih: row.tarih });
            }
        }

        hr('Tarama');
        console.log('  Koşmaz at satırı: ' + allFound.length);
        console.log('  Etkilenen kayıt: ' + jobs.length);
        console.log('  PUANLAMA çıkan-at kaydı: '
            + Object.values(cikanMap).reduce((s, a) => s + (a?.length || 0), 0) + ' at (hesaptan zaten hariç)');

        if (!allFound.length) {
            console.log('\n✅ Koşmaz at bulunamadı.');
            return;
        }

        const byKayit = new Map();
        for (const f of allFound) {
            const key = f.table + '|' + f.kayitId;
            if (!byKayit.has(key)) byKayit.set(key, []);
            byKayit.get(key).push(f);
        }

        hr('Koşmaz atlar');
        for (const f of allFound.slice(0, 40)) {
            console.log('  ' + f.hipodrom + ' ' + f.tarih + ' K' + f.raceNo
                + ' #' + f.horseNo + ' ' + (f.horseName || '') + ' · atId=' + (f.atId || '—'));
        }
        if (allFound.length > 40) {
            console.log('  ... +' + (allFound.length - 40) + ' daha');
        }

        let totalRemoved = 0;
        for (const [key, items] of byKayit) {
            const [table, kayitIdStr] = key.split('|');
            const kayitId = Number(kayitIdStr);
            const row = await dbGet(db, `SELECT veri FROM ${table} WHERE id = ?`, [kayitId]);
            const races = parseKayitVeri(row?.veri);
            if (!races) continue;
            const n = purgeRaces(races);
            totalRemoved += n;
            if (!n) continue;
            if (cli.apply) {
                await new Promise((resolve, reject) => {
                    db.run(`UPDATE ${table} SET veri = ? WHERE id = ?`, [JSON.stringify(races), kayitId], err => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log('\n  ' + table + ' #' + kayitId + ': ' + n + ' koşmaz at silindi');
            } else {
                console.log('\n  ' + table + ' #' + kayitId + ': ' + n + ' koşmaz at silinebilir (dry-run)');
            }
        }

        hr('Özet');
        console.log('  Tespit: ' + allFound.length);
        console.log('  Silinen: ' + totalRemoved + (cli.apply ? '' : ' (dry-run — --apply ile yaz)'));
        console.log('\n  Not: Terminal testleri artık koşmaz atları otomatik hariç tutar.');
        console.log('  Yeni GETİR/kayıt: programda (Koşmaz) olan atlar eklenmez.');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
