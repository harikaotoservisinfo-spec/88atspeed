#!/usr/bin/env node
/**
 * Kayıtlardaki TJK meta alan kapsamını denetler (at + koşu + kosular[])
 *
 *   node scripts/audit-tjk-meta-coverage.js --db atlar.db
 *   node scripts/audit-tjk-meta-coverage.js --db atlar.db --kayit 131
 */
const path = require('path');
const { openDb, dbAll, dbGet } = require('./ptest-terminal-lib');

const HORSE_META = ['yas', 'taki', 'hp', 'siklet'];
const RACE_META = ['pist', 'kcins_kosu', 'kategori', 'mesafe'];
const KOSU_META = ['pist', 'siklet', 'grup', 'kcins', 'hp', 'taki', 'yas', 'kcins_kosu', 'kategori', 'pist_kosu'];

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const dbPath = argVal('--db') || path.join(__dirname, '..', 'atlar.db');
const kayitFilter = argVal('--kayit') ? Number(argVal('--kayit')) : null;

function filled(v) {
    return v != null && v !== '' && v !== '-' && v !== '—' && v !== '?';
}

function pct(n, d) {
    return d ? Math.round(1000 * n / d) / 10 : 0;
}

function auditEntity(list, fields, label) {
    let total = 0;
    const counts = Object.fromEntries(fields.map(f => [f, 0]));
    for (const item of list) {
        total++;
        for (const f of fields) {
            if (filled(item[f])) counts[f]++;
        }
    }
    console.log('\n── ' + label + ' (' + total + ' kayıt) ──');
    for (const f of fields) {
        console.log('  ' + f.padEnd(14) + counts[f] + '/' + total + '  (' + pct(counts[f], total) + '%)');
    }
    return { total, counts };
}

async function main() {
    const db = openDb(dbPath);
    let kayitlar;
    if (kayitFilter) {
        const row = dbGet(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [kayitFilter]);
        kayitlar = row ? [row] : [];
    } else {
        kayitlar = dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id DESC');
    }
    if (!kayitlar.length) {
        console.error('Kayıt bulunamadı: ' + dbPath);
        process.exit(1);
    }

    console.log('TJK meta kapsam denetimi — ' + kayitlar.length + ' kayıt');
    let allHorses = [];
    let allRaces = [];
    let allKosular = [];

    for (const k of kayitlar) {
        let veri;
        try { veri = JSON.parse(k.veri); } catch { continue; }
        for (const race of veri || []) {
            allRaces.push(race);
            for (const horse of race.horses || []) {
                allHorses.push(horse);
                for (const kosu of horse.kosular || []) allKosular.push(kosu);
            }
        }
    }

    auditEntity(allHorses, HORSE_META, 'At meta (program)');
    auditEntity(allRaces, RACE_META, 'Koşu meta (program)');
    auditEntity(allKosular, KOSU_META, 'Geçmiş koşu meta (kosular[])');

    const emptyKosular = allHorses.filter(h => !(h.kosular || []).length).length;
    console.log('\n── Özet ──');
    console.log('  At sayısı: ' + allHorses.length);
    console.log('  kosular[] boş at: ' + emptyKosular);
    console.log('  Toplam geçmiş koşu: ' + allKosular.length);
    db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
