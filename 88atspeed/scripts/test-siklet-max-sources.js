#!/usr/bin/env node
/**
 * SİKLET MAX% kaynak sayımı — her at/koşu için MAX%·MAX-* %100’ü kaç geçmiş yarış sağladı?
 *
 * @100 = eşleşen sıklet koşularında derece uygun + at_sayisi ≥ bugünkü alan
 * (MAX-1: S1 · MAX-12: S≤2 · MAX-123: S≤3 · MAX-1234: S≤4)
 *
 *   node scripts/test-siklet-max-sources.js --db atlar.db --kayit 148
 *   node scripts/test-siklet-max-sources.js --db atlar.db --kayit 148 --max100-only
 *   node scripts/test-siklet-max-sources.js --db atlar.db --kayit 148 --race 2 -v
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
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
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseName: argVal('--horse') || '',
    max100Only: args.includes('--max100-only') || args.includes('--max100'),
    verbose: args.includes('-v') || args.includes('--verbose')
};

const BUCKETS = [
    { stKey: 'max1', cntKey: 'cnt1', label: 'MAX-1', pctIdx: 0, testSira: s => s === 1 },
    { stKey: 'max12', cntKey: 'cnt12', label: 'MAX-12', pctIdx: 1, testSira: s => s <= 2 },
    { stKey: 'max123', cntKey: 'cnt123', label: 'MAX-123', pctIdx: 2, testSira: s => s <= 3 },
    { stKey: 'max1234', cntKey: 'cnt1234', label: 'MAX-1234', pctIdx: 3, testSira: s => s <= 4 }
];

function normName(s) {
    return String(s || '').replace(/\s*\(\d+\)\s*$/, '').trim().toLocaleUpperCase('tr-TR');
}

function loadEngines() {
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function parseSira(k) {
    return FieldSizeStatsEngine.parseSira(k.sira);
}

function parseBitis(name) {
    const m = String(name || '').match(/\((\d+)\)\s*$/);
    return m ? Number(m[1]) : null;
}

function analyzeSources(matched, fieldSize, st, maxPct) {
    const out = {};
    for (const b of BUCKETS) {
        const pct = maxPct.parts[b.pctIdx]?.pct ?? 0;
        const maxVal = st[b.stKey];
        const at100 = [];
        const setMax = [];
        for (const k of matched) {
            const sira = parseSira(k);
            const fs = Number(k.at_sayisi) || 0;
            if (!fs || sira == null || !b.testSira(sira)) continue;
            const row = { tarih: k.tarih || '?', sira, fs };
            if (fs >= fieldSize) at100.push(row);
            if (maxVal != null && fs === maxVal) setMax.push(row);
        }
        out[b.label] = {
            pct,
            maxVal,
            cnt: st[b.cntKey],
            nAt100: at100.length,
            nSetMax: setMax.length,
            at100,
            setMax
        };
    }
    return out;
}

function isMaxFull100(maxPct) {
    return !!(maxPct?.parts?.length === 4 && maxPct.parts.every(p => p.pct === 100));
}

function fmtMaxRow(v) {
    return v != null && v !== '' ? String(v) : '—';
}

function printHorseBlock(r) {
    const name = String(r.name || '').replace(/\(\d+\)/, '').trim();
    const bitMark = r.bitis === 1 ? '★' : r.bitis != null && r.bitis <= 3 ? '◆' : '·';
    console.log('\n' + '─'.repeat(78));
    console.log(bitMark + ' #' + r.kayitId + ' K' + r.raceNo + ' · #' + r.no + ' ' + name
        + ' · hedef sk ' + r.hedef + ' · alan ' + r.fieldSize + ' · SK-KOŞU=' + r.matchCount
        + ' · BİT=' + (r.bitis ?? '—'));
    console.log('  MAX%   = ' + r.maxDisplay
        + ' · MAX%Ø=' + (r.maxAvg != null ? '%' + r.maxAvg : '—'));
    console.log('  MAX-1/12/123/1234 = '
        + [r.st.max1, r.st.max12, r.st.max123, r.st.max1234].map(fmtMaxRow).join(' / '));
    console.log('  cnt1/12/123/1234  = '
        + r.st.cnt1 + '/' + r.st.cnt12 + '/' + r.st.cnt123 + '/' + r.st.cnt1234
        + '  (eşleşen koşularda kaç kez o derece — MAX değil)');

    const nLine = BUCKETS.map(b => {
        const s = r.sources[b.label];
        return b.label.replace('MAX-', '') + '=' + (s.pct === 100 ? s.nAt100 : '—');
    }).join(' · ');
    console.log('  @100 yarış sayısı (%100 olan dilimler): ' + nLine);

    console.log('  ' + pad('Dilim', 10) + pad('%', 5) + pad('MAX', 5)
        + pad('@100', 6) + pad('cnt', 5) + 'MAX’i belirleyen yarış(lar)');
    for (const b of BUCKETS) {
        const s = r.sources[b.label];
        const setStr = s.setMax.length
            ? s.setMax.map(x => x.tarih + ' S' + x.sira + '/' + x.fs).join(', ')
            : '—';
        console.log('  ' + pad(b.label, 10) + pad(s.pct + '%', 5) + pad(fmtMaxRow(s.maxVal), 5)
            + pad(s.pct === 100 ? String(s.nAt100) : '—', 6) + pad(String(s.cnt), 5) + setStr);
        if (cli.verbose && s.at100.length) {
            console.log('      @100 kaynakları: '
                + s.at100.map(x => x.tarih + ' S' + x.sira + '/' + x.fs + 'at').join(' · '));
        }
    }
}

function printCompactTable(rows) {
    const hdr = pad('Kay', 5) + pad('K', 3) + pad('#', 3) + pad('At', 18)
        + pad('Alan', 5) + pad('SK-K', 5) + pad('MAX%', 22)
        + pad('@1', 4) + pad('@12', 4) + pad('@123', 5) + pad('@1234', 6)
        + pad('MAX-1', 6) + pad('BIT', 4);
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const r of rows) {
        const name = String(r.name || '').replace(/\(\d+\)/, '').trim().slice(0, 16);
        const src = r.sources;
        console.log(pad('#' + r.kayitId, 5) + pad('K' + r.raceNo, 3) + pad(r.no, 3)
            + pad(name, 18) + pad(r.fieldSize, 5) + pad(r.matchCount, 5)
            + pad(r.maxDisplay, 22)
            + pad(src['MAX-1'].pct === 100 ? src['MAX-1'].nAt100 : '—', 4)
            + pad(src['MAX-12'].pct === 100 ? src['MAX-12'].nAt100 : '—', 4)
            + pad(src['MAX-123'].pct === 100 ? src['MAX-123'].nAt100 : '—', 5)
            + pad(src['MAX-1234'].pct === 100 ? src['MAX-1234'].nAt100 : '—', 6)
            + pad(fmtMaxRow(r.st.max1), 6) + pad(r.bitis ?? '—', 4));
    }
}

function printDistribution(rows) {
    console.log('\n── @100 yarış sayısı dağılımı (tüm dilimler %100 olan atlar) ──');
    const full = rows.filter(r => r.maxFull100);
    if (!full.length) {
        console.log('  (MAX%100×4 at yok)');
        return;
    }
    for (const b of BUCKETS) {
        const counts = new Map();
        for (const r of full) {
            const n = r.sources[b.label].nAt100;
            counts.set(n, (counts.get(n) || 0) + 1);
        }
        const parts = [...counts.entries()].sort((a, b) => a[0] - b[0])
            .map(([n, c]) => n + ' yarış→' + c + ' at');
        console.log('  ' + pad(b.label, 10) + parts.join(' · '));
    }
}

async function main() {
    loadEngines();
    const db = openDb(cli.dbPath);
    try {
        let kayitlar = await dbAll(db,
            'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
        if (cli.kayitId) kayitlar = kayitlar.filter(k => Number(k.id) === cli.kayitId);
        if (!kayitlar.length) {
            console.error('Kayıt bulunamadı');
            process.exit(1);
        }

        const rows = [];
        for (const kayit of kayitlar) {
            let races;
            try { races = JSON.parse(kayit.veri); } catch (_) { continue; }
            if (!Array.isArray(races)) continue;
            for (const race of races) {
                if (cli.raceNo && Number(race.raceNo) !== cli.raceNo) continue;
                const fieldSize = FieldSizeStatsEngine.raceFieldSize(race);
                const dim = KosuDimensionStatsEngine.DIMENSIONS.siklet;
                for (const horse of race.horses || []) {
                    if (cli.horseName) {
                        const t = normName(cli.horseName);
                        if (!normName(horse.name).includes(t)) continue;
                    }
                    const kosular = horse.kosular || [];
                    const prog = kayit.tarih;
                    const calcKosular = KosuDimensionStatsEngine.filterKosularForCalc(kosular, prog);
                    const horseCtx = Object.assign({}, horse, { kosular });
                    const hedef = dim.getTarget(horseCtx, race);
                    const st = KosuDimensionStatsEngine.computeStats(kosular, 'siklet', hedef, prog);
                    const maxPct = FieldSizeStatsEngine.computeMaxSuccessPct(st, fieldSize);
                    const matched = KosuDimensionStatsEngine.matchedRaces(calcKosular, 'siklet', hedef);
                    const sources = analyzeSources(matched, fieldSize, st, maxPct);
                    const maxFull100 = isMaxFull100(maxPct);

                    if (cli.max100Only && !maxFull100) continue;

                    rows.push({
                        kayitId: kayit.id,
                        hipodrom: kayit.hipodrom,
                        tarih: kayit.tarih,
                        raceNo: race.raceNo,
                        no: horse.no,
                        name: horse.name,
                        hedef: st.hedefAbbrev,
                        fieldSize,
                        matchCount: st.matchCount,
                        bitis: parseBitis(horse.name),
                        st,
                        maxDisplay: maxPct.display,
                        maxAvg: maxPct.avg,
                        maxFull100,
                        sources
                    });
                }
            }
        }

        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  SİKLET MAX% kaynak — @100 = kaç yarış %100 sağladı?            ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log('Kayıt: ' + (cli.kayitId ? '#' + cli.kayitId : kayitlar.length + ' kayıt')
            + (cli.raceNo ? ' · K' + cli.raceNo : '')
            + (cli.max100Only ? ' · MAX%100×4 filtresi' : '')
            + ' · ' + rows.length + ' at satırı');
        console.log('');
        console.log('@100 = eşleşen sıklet geçmişinde: derece uygun + alan ≥ bugünkü alan');
        console.log('cnt  = o dereceye kaç kez ulaşıldı (küçük alanlar dahil — MAX% ile farklı)');
        console.log('MAX’i belirleyen = MAX-N sayısını oluşturan en geniş alanlı yarış(lar)');
        console.log('Program günü koşusu geçmişten hariç tutulur (29.08 ≠ lookahead).\n');

        if (cli.verbose || rows.length <= 25) {
            for (const r of rows) printHorseBlock(r);
        } else {
            printCompactTable(rows);
            console.log('\n  (-v ile ' + rows.length + ' atın detay bloğu)');
        }

        printDistribution(rows.filter(r => r.maxFull100));

        const fullRows = rows.filter(r => r.maxFull100);
        if (fullRows.length) {
            console.log('\n── MAX%100×4 özet (@100 yarış sayısı) ──');
            for (const r of fullRows) {
                const name = String(r.name || '').replace(/\(\d+\)/, '').trim().slice(0, 16);
                const s = r.sources;
                const ns = BUCKETS.map(b => s[b.label].nAt100).join('/');
                console.log('  ★ #' + r.kayitId + ' K' + r.raceNo + ' #' + pad(r.no, 2)
                    + ' ' + pad(name, 16) + ' @100=' + ns + ' · SK-KOŞU=' + r.matchCount
                    + ' · cnt=' + r.st.cnt1 + '/' + r.st.cnt12 + '/' + r.st.cnt123 + '/' + r.st.cnt1234);
            }
        }

        console.log('\nOK · ' + rows.length + ' satır · MAX%100×4=' + fullRows.length);
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
