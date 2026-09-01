#!/usr/bin/env node
/**
 * Tek at — boyut sekmesi (TAKİ vb.) UI satırı ile birebir terminal doğrulama
 *
 *   node scripts/test-dimension-tab-horse.js --db atlar.db --kayit 148 --race 7 --horse PATARA
 *   node scripts/test-dimension-tab-horse.js --db atlar.db --kayit 148 --race 7 --horse PATARA --dim taki
 */
const fs = require('fs');
const path = require('path');
const { openDb, dbGet } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseName: argVal('--horse') || '',
    horseNo: argVal('--no') ? Number(argVal('--no')) : null,
    atId: argVal('--at-id') || '',
    dim: argVal('--dim') || 'taki'
};

const WINDOWS = [5, 4, 3, 2, 1];

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function pad(s, n) {
    return String(s ?? '—').slice(0, n).padEnd(n);
}

function fmt(v) {
    return v != null && v !== '' ? String(v) : '—';
}

function fmtPct(pct) {
    return pct != null ? '%' + pct : '—';
}

function loadEngines() {
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(__dirname, '..', 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

async function loadHorse() {
    const db = openDb(cli.dbPath);
    try {
        const row = await dbGet(db, 'SELECT hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [cli.kayitId]);
        if (!row?.veri) return null;
        const races = JSON.parse(row.veri);
        const target = normName(cli.horseName);
        for (const race of races) {
            if (cli.raceNo && Number(race.raceNo) !== cli.raceNo) continue;
            for (const h of race.horses || []) {
                if (cli.atId && String(h.atId) !== String(cli.atId)) continue;
                if (cli.horseNo && Number(h.no) !== cli.horseNo) continue;
                if (cli.horseName && !normName(h.name).includes(target)) continue;
                if (!cli.atId && !cli.horseNo && !cli.horseName) continue;
                return { hipodrom: row.hipodrom, tarih: row.tarih, race, horse: h };
            }
        }
        return null;
    } finally {
        db.close();
    }
}

function printStatsRow(label, st, dim) {
    console.log('\n── ' + label + ' ──');
    console.log('  HEDEF      : ' + fmt(st.hedefAbbrev || st.hedef));
    console.log('  KOŞU       : ' + st.kosuSayisi);
    console.log('  ' + dim.pctLabel + '        : ' + fmtPct(st.matchPct));
    console.log('  ' + dim.matchLabel + '   : ' + st.matchCount);
    console.log('  MAX-1      : ' + fmt(st.max1));
    console.log('  MAX-12     : ' + fmt(st.max12));
    console.log('  MAX-123    : ' + fmt(st.max123));
    console.log('  MAX-1234   : ' + fmt(st.max1234));
    console.log('  1.         : ' + st.cnt1);
    console.log('  1-2        : ' + st.cnt12);
    console.log('  1-2-3      : ' + st.cnt123);
    console.log('  1-2-3-4    : ' + st.cnt1234);
    console.log('  EŞLEŞME    : ' + fmt(st.gecmisMatchStr));
    console.log('  GEÇMİŞ     : ' + fmt(st.gecmisValStr));
}

function manualTakiCheck(kosular, hedef) {
    const dim = KosuDimensionStatsEngine.DIMENSIONS.taki;
    const hedefTok = KosuDimensionStatsEngine.takiTokens(hedef);
    console.log('\n── Manuel TAKİ eşleşme (hedef token: ' + hedefTok.join('+') + ') ──');
    console.log('  ' + pad('tarih', 12) + pad('S', 4) + pad('fs', 5) + pad('taki', 14) + 'eşleş');
    const sorted = FieldSizeStatsEngine.sortKosularNewest(kosular);
    for (const k of sorted) {
        const raw = k.taki || '';
        const tok = KosuDimensionStatsEngine.takiTokens(raw);
        const ok = dim.match(raw, hedef);
        console.log('  ' + pad(k.tarih, 12) + pad(k.sira, 4) + pad(k.at_sayisi, 5)
            + pad(raw.slice(0, 12), 14) + (ok ? '✓' : '·')
            + '  [' + tok.join(',') + ']');
    }
}

async function main() {
    if (!cli.kayitId) {
        console.error(' --kayit gerekli');
        process.exit(1);
    }
    loadEngines();
    const ctx = await loadHorse();
    if (!ctx) {
        console.error('At bulunamadı');
        process.exit(1);
    }

    const dim = KosuDimensionStatsEngine.DIMENSIONS[cli.dim];
    if (!dim) {
        console.error('Bilinmeyen dim: ' + cli.dim);
        process.exit(1);
    }

    const { horse, race, hipodrom, tarih } = ctx;
    const kosular = horse.kosular || [];
    const horseCtx = Object.assign({}, horse, { kosular });
    const hedef = dim.getTarget(horseCtx, race);
    const st = KosuDimensionStatsEngine.computeStats(kosular, cli.dim, hedef);

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ' + pad(dim.label + ' sekmesi — UI doğrulama', 62) + ' ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('Kayıt #' + cli.kayitId + ' · ' + hipodrom + ' · ' + tarih);
    console.log('K' + race.raceNo + ' · #' + horse.no + ' ' + horse.name + ' · atId=' + horse.atId);
    console.log('kosular[]: ' + kosular.length + ' koşu');

    if (cli.dim === 'taki') {
        manualTakiCheck(kosular, hedef);
    }

    printStatsRow('TÜM koşular (UI ana satır)', st, dim);

    for (const w of WINDOWS) {
        const ws = st.windows?.[w];
        if (ws) printStatsRow('S' + w + ' pencere', ws, dim);
    }

    console.log('\n── UI karşılaştırma (PATARA TAKİ beklenen) ──');
    const checks = [
        ['KOŞU', st.kosuSayisi, 7],
        ['TK-KOŞU', st.matchCount, 2],
        ['TK%', st.matchPct, 29],
        ['MAX-1234', st.max1234, 10],
        ['1.', st.cnt1, 0],
        ['1-2-3-4', st.cnt1234, 1]
    ];
    let ok = 0;
    for (const [label, got, exp] of checks) {
        const pass = got === exp;
        if (pass) ok++;
        console.log('  ' + (pass ? '✓' : '✗') + ' ' + pad(label, 10) + ' terminal=' + fmt(got) + ' · UI=' + exp);
    }
    const w5 = st.windows?.[5];
    if (w5) {
        const w5checks = [
            ['S5·KOŞU', w5.kosuSayisi, 5],
            ['S5·TK%', w5.matchPct, 40],
            ['S5·TK-KOŞU', w5.matchCount, 2],
            ['S5·MAX-1234', w5.max1234, 10]
        ];
        for (const [label, got, exp] of w5checks) {
            const pass = got === exp;
            if (pass) ok++;
            console.log('  ' + (pass ? '✓' : '✗') + ' ' + pad(label, 14) + ' terminal=' + fmt(got) + ' · UI=' + exp);
        }
    }

    console.log('\n── Sonuç ──');
    if (ok >= 6) {
        console.log('  ✓ TAKİ verisi UI ile uyumlu — scrape + hesaplama doğru');
        console.log('  MAX-1/12/123 boş: eşleşen koşularda 1./2./3. yok (PATARA en iyi 4.)');
    } else {
        console.log('  △ Bazı değerler UI\'dan farklı — kosular[] sırası veya hedef meta kontrol et');
    }
    console.log('');
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
