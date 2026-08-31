#!/usr/bin/env node
/**
 * SİKLET MAX-* teşhis — kaç yarıştan geliyor, son koşu mu tüm geçmiş mi?
 *
 *   node scripts/test-siklet-max-diagnose.js --kayit 148 --race 2
 *   node scripts/test-siklet-max-diagnose.js --kayit 148 --race 2 --horse "BAY OLOF"
 *   node scripts/test-siklet-max-diagnose.js --kayit 148 --race 2 --max100
 */
const fs = require('fs');
const path = require('path');
const { openDb, dbGet, pad } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : 148,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseName: argVal('--horse') || '',
    horseNo: argVal('--no') ? Number(argVal('--no')) : null,
    max100Only: args.includes('--max100')
};

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function loadEngines() {
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function parseBitis(name) {
    const m = String(name || '').match(/\((\d+)\)\s*$/);
    return m ? Number(m[1]) : null;
}

function analyzeHorse(horse, race, fieldSize) {
    const dim = KosuDimensionStatsEngine.DIMENSIONS.siklet;
    const kosular = horse.kosular || [];
    const horseCtx = Object.assign({}, horse, { kosular });
    const hedef = dim.getTarget(horseCtx, race);
    const st = KosuDimensionStatsEngine.computeStats(kosular, 'siklet', hedef);
    const maxPct = FieldSizeStatsEngine.computeMaxSuccessPct(st, fieldSize);

    const allSorted = FieldSizeStatsEngine.sortKosularNewest(kosular);
    const valid = KosuDimensionStatsEngine.validRaces(kosular, 'siklet');
    const matched = KosuDimensionStatsEngine.matchedRaces(kosular, 'siklet', hedef);
    const parseSira = k => FieldSizeStatsEngine.parseSira(k.sira);
    const placement = FieldSizeStatsEngine._computeStatsCore(matched);
    const matchedNewest = FieldSizeStatsEngine.sortKosularNewest(matched);

    const newestK = allSorted[0] || null;
    const sameKosu = (a, b) => a && b && (a.tarih || '') === (b.tarih || '')
        && String(a.sira || '') === String(b.sira || '');

    const matchedRows = matchedNewest.map(k => {
        const sira = parseSira(k);
        const fs = Number(k.at_sayisi) || 0;
        const tags = [];
        if (sira === 1 && fs > 0) tags.push('MAX-1');
        if (sira != null && sira <= 2 && fs > 0) tags.push('MAX-12');
        if (sira != null && sira <= 3 && fs > 0) tags.push('MAX-123');
        if (sira != null && sira <= 4 && fs > 0) tags.push('MAX-1234');
        return {
            tarih: k.tarih || '?',
            sira,
            fs,
            siklet: k.siklet,
            tags,
            isNewest: sameKosu(k, newestK)
        };
    });

    const newestMatched = matchedRows.find(r => r.isNewest);
    const contributesMax = matchedRows.filter(r => r.tags.length);

    return {
        horse,
        hedef: st.hedefAbbrev,
        bitis: parseBitis(horse.name),
        fieldSize,
        st,
        maxPct,
        counts: {
            totalKosular: kosular.length,
            validSiklet: valid.length,
            matchedSk: matched.length,
            withFsAndSira: matched.filter(k => Number(k.at_sayisi) > 0 && parseSira(k) != null).length,
            maxContributors: contributesMax.length,
            placementKosu: placement.kosuSayisi,
            placementGecmis: placement.gecmisList || []
        },
        matchedRows,
        newestMatched
    };
}

function printHorseReport(r) {
    const name = String(r.horse.name || '').replace(/\(\d+\)/, '').trim();
    console.log('\n' + '═'.repeat(72));
    console.log('  #' + r.horse.no + ' ' + name + ' · hedef sıklet ' + r.hedef
        + ' · bugün BİTİŞ ' + (r.bitis ?? '?') + ' · alan ' + r.fieldSize + ' at');
    console.log('═'.repeat(72));
    console.log('  Kaynak: TÜM geçmiş kosular[] — sadece son yarış DEĞİL');
    console.log('  KOŞU=' + r.counts.validSiklet + ' (sıklet bilgili) · SK-KOŞU='
        + r.counts.matchedSk + ' (hedefe eşleşen) · MAX hesabına giren='
        + r.counts.withFsAndSira + ' (at_sayisi+derece var)');
    console.log('');
    console.log('  UI özeti: SK%=' + (r.st.matchPct != null ? r.st.matchPct : '—')
        + ' · MAX-1/12/123/1234 = '
        + [r.st.max1, r.st.max12, r.st.max123, r.st.max1234].map(v => v ?? '—').join(' / '));
    console.log('  MAX%   = ' + r.maxPct.display + ' · MAX%Ø = '
        + (r.maxPct.avg != null ? '%' + r.maxPct.avg : '—'));
    console.log('  cnt1/12/123/1234 = ' + r.st.cnt1 + '/' + r.st.cnt12 + '/'
        + r.st.cnt123 + '/' + r.st.cnt1234 + ' (eşleşen koşularda kaç kez o derece)');

    if (!r.matchedRows.length) {
        console.log('\n  ⚠ Eşleşen sıklet koşusu yok — MAX% = —');
        return;
    }

    console.log('\n  ── Eşleşen koşular (yeniden eskiye) — MAX hangi yarıştan? ──');
    console.log('  ' + pad('tarih', 12) + pad('S', 4) + pad('alan', 5)
        + pad('sıklet', 8) + pad('son?', 5) + 'MAX katkı');
    for (const row of r.matchedRows) {
        console.log('  ' + pad(row.tarih, 12) + pad(row.sira ?? '—', 4)
            + pad(row.fs || '—', 5) + pad(String(row.siklet || '—').slice(0, 6), 8)
            + pad(row.isNewest ? '★' : '·', 5)
            + (row.tags.length ? row.tags.join(',') : '—'));
    }

    if (r.counts.placementKosu !== r.counts.withFsAndSira) {
        console.log('  (engine MAX kaynağı: ' + r.counts.placementKosu + ' koşu, gecmisList doğrulandı)');
    }

    if (r.maxPct.avg === 100) {
        console.log('\n  ✓ MAX% 100%·100%·100%·100% → eşleşen koşularda 1. olduğu en geniş alan ('
            + r.st.max1 + ') ≥ bugünkü alan (' + r.fieldSize + ')');
        const wins = r.matchedRows.filter(x => x.sira === 1);
        console.log('  1. olduğu eşleşen koşu sayısı: ' + wins.length
            + (wins.length ? ' → ' + wins.map(w => w.tarih + '(S' + w.sira + '/' + w.fs + 'at)').join(', ') : ''));
    } else if (r.st.max1 != null) {
        const wins = r.matchedRows.filter(x => x.sira === 1);
        if (wins.length) {
            console.log('\n  MAX-1=' + r.st.max1 + ' ← ' + wins.map(w => w.tarih + '(S1/' + w.fs + 'at)').join(', '));
        }
    }

    if (r.newestMatched) {
        console.log('\n  Son koşu (en yeni): ' + r.newestMatched.tarih
            + ' S' + r.newestMatched.sira + ' · alan ' + r.newestMatched.fs
            + (r.newestMatched.isNewest && r.matchedRows.length > 1
                ? ' — MAX tek başına buna dayanmıyor, ' + r.matchedRows.length + ' eşleşme tarandı'
                : ''));
    } else if (r.matchedRows.length) {
        console.log('\n  Son koşu hedef sıkletle eşleşmiyor — MAX yine de diğer eşleşen '
            + r.matchedRows.length + ' koşudan geliyor');
    }
}

async function main() {
    loadEngines();
    const db = openDb(cli.dbPath);
    try {
        const row = await dbGet(db,
            'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?',
            [cli.kayitId]
        );
        if (!row?.veri) {
            console.error('Kayıt #' + cli.kayitId + ' bulunamadı');
            process.exit(1);
        }

        const races = JSON.parse(row.veri);
        const race = races.find(r => !cli.raceNo || Number(r.raceNo) === cli.raceNo);
        if (!race) {
            console.error('Koşu bulunamadı');
            process.exit(1);
        }

        const fieldSize = FieldSizeStatsEngine.raceFieldSize(race);
        let horses = (race.horses || []).slice();
        if (cli.horseName) {
            const t = normName(cli.horseName);
            horses = horses.filter(h => normName(h.name).includes(t));
        }
        if (cli.horseNo) horses = horses.filter(h => Number(h.no) === cli.horseNo);

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  SİKLET MAX teşhis — kaç yarış · son mu tüm geçmiş mi?          ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt #' + cli.kayitId + ' · ' + row.hipodrom + ' · ' + row.tarih);
        console.log('K' + race.raceNo + ' · ' + horses.length + ' at · bugünkü alan ' + fieldSize + ' at');
        console.log('');
        console.log('MAX-1/12/123/1234 = eşleşen TÜM geçmiş koşularda o dereceye ulaşılan EN GENİŞ alan');
        console.log('MAX% = her MAX ÷ bugünkü alan (%100 tavan) · MAX%Ø = dörtlünün ortalaması');

        const reports = horses.map(h => analyzeHorse(h, race, fieldSize));
        let filtered = reports;
        if (cli.max100Only) {
            filtered = reports.filter(r => r.maxPct.avg === 100);
            console.log('\n── MAX%Ø=100 filtre: ' + filtered.length + ' at ──');
        }

        for (const r of filtered) {
            printHorseReport(r);
        }

        if (cli.max100Only && filtered.length) {
            console.log('\n── Özet: MAX% 100% olan atlar ──');
            for (const r of filtered) {
                const nm = String(r.horse.name || '').replace(/\(\d+\)/, '').trim();
                console.log('  ★ #' + r.horse.no + ' ' + pad(nm, 18)
                    + ' BİT=' + (r.bitis ?? '?')
                    + ' · SK-KOŞU=' + r.counts.matchedSk
                    + ' · 1. sayısı=' + r.st.cnt1
                    + ' · MAX-1 alan=' + (r.st.max1 ?? '—'));
            }
        }

        console.log('\nOK · ' + filtered.length + ' at raporlandı');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
