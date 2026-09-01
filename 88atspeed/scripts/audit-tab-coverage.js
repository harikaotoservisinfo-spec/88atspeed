#!/usr/bin/env node
/**
 * Tüm gösterge sekmeleri için kosular[] / program meta kapsam denetimi
 * UI ile aynı stats engine'leri kullanır — MAX-* neden boş raporlanır.
 *
 *   npm run audit:tab-coverage
 *   node scripts/audit-tab-coverage.js --db atlar.db --kayit 148
 *   node scripts/audit-tab-coverage.js --live-at-id 110913 --max-kosu 5
 */
const fs = require('fs');
const path = require('path');
const { ROOT, openDb, dbAll, parseCliArgs } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    ...parseCliArgs(args),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    liveAtId: argVal('--live-at-id') || null,
    maxKosu: Number(argVal('--max-kosu') || '5'),
    verbose: args.includes('--verbose') || args.includes('-v')
};

function loadStatsEngines() {
    eval(fs.readFileSync(path.join(ROOT, 'public/js/at-meta-fields.js'), 'utf8')
        + '\n; global.AtMetaFields = AtMetaFields;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/field-size-stats-engine.js'), 'utf8')
        + '\n; global.FieldSizeStatsEngine = FieldSizeStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/sehir-stats-engine.js'), 'utf8')
        + '\n; global.SehirStatsEngine = SehirStatsEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/kosu-dimension-stats-engine.js'), 'utf8')
        + '\n; global.KosuDimensionStatsEngine = KosuDimensionStatsEngine;');
}

function filled(v) {
    return v != null && v !== '' && v !== '-' && v !== '—' && v !== '?';
}

function pct(n, d) {
    return d ? Math.round(1000 * n / d) / 10 : 0;
}

function parseVeri(raw) {
    try {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(d) ? d : null;
    } catch (_) {
        return null;
    }
}

const KOSU_FIELDS = [
    { key: 'sira', tabs: ['AT SAYISI', 'ŞEHİR', 'KOŞU CİNSİ', 'TAKİ', 'PİST', 'HP', 'SİKLET'], note: 'sıra — cnt sütunları' },
    { key: 'at_sayisi', tabs: ['AT SAYISI', 'ŞEHİR', 'KOŞU CİNSİ', 'TAKİ', 'PİST', 'HP', 'SİKLET'], note: 'MAX-* sütunları' },
    { key: 'sehir', tabs: ['ŞEHİR'], note: 'şehir eşleşmesi' },
    { key: 'kcins_kosu', tabs: ['KOŞU CİNSİ'], note: 'koşu cinsi eşleşmesi' },
    { key: 'taki', tabs: ['TAKİ'], note: 'takı eşleşmesi' },
    { key: 'pist', tabs: ['PİST'], note: 'pist (alternatif: pist_kosu)' },
    { key: 'pist_kosu', tabs: ['PİST'], note: 'pist yedek alan' },
    { key: 'hp', tabs: ['HP'], note: 'handikap puanı' },
    { key: 'siklet', tabs: ['SİKLET'], note: 'sıklet eşleşmesi' }
];

const PROGRAM_FIELDS = [
    { key: 'hipodrom', scope: 'kayit', tabs: ['ŞEHİR'], note: 'hedef şehir' },
    { key: 'kcins_kosu', scope: 'race', tabs: ['KOŞU CİNSİ'], note: 'hedef koşu cinsi' },
    { key: 'pist', scope: 'race', tabs: ['PİST'], note: 'hedef pist' },
    { key: 'taki', scope: 'horse', tabs: ['TAKİ'], note: 'hedef takı' },
    { key: 'hp', scope: 'horse', tabs: ['HP'], note: 'hedef HP' },
    { key: 'siklet', scope: 'horse', tabs: ['SİKLET'], note: 'hedef sıklet' }
];

function auditKosuFields(allKosular) {
    const total = allKosular.length;
    console.log('\n── kosular[] alan doluluk (' + total + ' geçmiş koşu) ──');
    for (const f of KOSU_FIELDS) {
        let n = 0;
        for (const k of allKosular) {
            if (f.key === 'at_sayisi') {
                if (Number(k.at_sayisi) > 0) n++;
            } else if (filled(k[f.key])) {
                n++;
            }
        }
        const bar = pct(n, total) >= 80 ? '✓' : (pct(n, total) >= 20 ? '△' : '✗');
        console.log('  ' + bar + ' ' + f.key.padEnd(14) + n + '/' + total + ' (' + pct(n, total) + '%)'
            + '  → ' + f.tabs.join(', '));
    }
}

function auditProgramMeta(allHorses, allRaces, hipodrom) {
    console.log('\n── Program / hedef meta (HEDEF sütunu) ──');
    console.log('  hipodrom (kayıt): ' + (filled(hipodrom) ? '✓ ' + hipodrom : '✗ (boş)'));
    for (const f of PROGRAM_FIELDS.filter(x => x.scope !== 'kayit')) {
        const list = f.scope === 'race' ? allRaces : allHorses;
        let n = 0;
        for (const item of list) {
            if (filled(item[f.key])) n++;
        }
        const bar = pct(n, list.length) >= 80 ? '✓' : (pct(n, list.length) >= 20 ? '△' : '✗');
        console.log('  ' + bar + ' ' + (f.scope + '.' + f.key).padEnd(18)
            + n + '/' + list.length + ' (' + pct(n, list.length) + '%)'
            + '  → ' + f.tabs.join(', '));
    }
}

function tabCalcReport(entries, hipodrom) {
    const tabs = {
        'AT SAYISI': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0 },
        'ŞEHİR': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 },
        'KOŞU CİNSİ': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 },
        'TAKİ': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 },
        'PİST': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 },
        'HP': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 },
        'SİKLET': { horses: 0, emptyKosular: 0, maxBlocked: 0, cntOk: 0, hedefMissing: 0 }
    };

    const dimKeys = Object.keys(KosuDimensionStatsEngine.DIMENSIONS);
    const samples = [];

    for (const { horse, race } of entries) {
        const kosular = horse.kosular || [];
        const horseCtx = horse;

        // AT SAYISI
        {
            const t = tabs['AT SAYISI'];
            t.horses++;
            if (!kosular.length) t.emptyKosular++;
            const st = FieldSizeStatsEngine.computeStats(kosular);
            if (st.cnt1 > 0 || st.cnt12 > 0) t.cntOk++;
            if (st.max1 == null && st.kosuSayisiSira > 0) t.maxBlocked++;
        }

        // ŞEHİR
        {
            const t = tabs['ŞEHİR'];
            t.horses++;
            if (!kosular.length) t.emptyKosular++;
            if (!filled(hipodrom)) t.hedefMissing++;
            const st = SehirStatsEngine.computeStats(kosular, hipodrom);
            if (st.cnt1 > 0 || st.cnt12 > 0) t.cntOk++;
            if (st.max1 == null && st.inCityKosuSayisi > 0) t.maxBlocked++;
        }

        for (const dimKey of dimKeys) {
            const dim = KosuDimensionStatsEngine.DIMENSIONS[dimKey];
            const label = dim.label;
            const t = tabs[label];
            t.horses++;
            if (!kosular.length) t.emptyKosular++;
            const hedef = dim.getTarget(horseCtx, race);
            if (!KosuDimensionStatsEngine.hasValue(hedef)) t.hedefMissing++;
            const st = KosuDimensionStatsEngine.computeStats(kosular, dimKey, hedef);
            if (st.cnt1 > 0 || st.cnt12 > 0) t.cntOk++;
            const maxBlocked = st.max1 == null && st.matchCount > 0
                && (st.fieldSizeMissingOnMatch > 0 || st.atSayisiMissing > 0);
            if (maxBlocked) t.maxBlocked++;

            if (cli.verbose && samples.length < 6 && (maxBlocked || !kosular.length)) {
                samples.push({
                    name: horse.name,
                    tab: label,
                    kosu: kosular.length,
                    hedef: hedef || '—',
                    match: st.matchCount,
                    max1: st.max1,
                    atSayisiMissing: st.atSayisiMissing,
                    fieldSizeMissingOnMatch: st.fieldSizeMissingOnMatch
                });
            }
        }
    }

    console.log('\n── Sekme hesaplama durumu (at bazında) ──');
    console.log('  ' + 'Sekme'.padEnd(12)
        + 'At'.padStart(5)
        + 'Boş[]'.padStart(7)
        + 'Hedef∅'.padStart(8)
        + 'cntOK'.padStart(7)
        + 'MAX∅'.padStart(7)
        + '  Durum');
    for (const [label, t] of Object.entries(tabs)) {
        let status = 'OK';
        if (t.emptyKosular > t.horses * 0.1) status = 'kosular[] eksik';
        else if (t.maxBlocked > t.horses * 0.5) status = 'MAX-* çoğunlukla at_sayisi eksik';
        else if (t.hedefMissing > t.horses * 0.3) status = 'HEDEF meta eksik';
        else if (t.maxBlocked > 0) status = 'kısmi MAX-* eksik';
        console.log('  ' + label.padEnd(12)
            + String(t.horses).padStart(5)
            + String(t.emptyKosular).padStart(7)
            + String(t.hedefMissing || 0).padStart(8)
            + String(t.cntOk).padStart(7)
            + String(t.maxBlocked).padStart(7)
            + '  ' + status);
    }

    if (samples.length) {
        console.log('\n── Örnek sorunlu atlar ──');
        for (const s of samples) {
            console.log('  ' + s.name + ' · ' + s.tab
                + ' · kosu=' + s.kosu + ' hedef=' + s.hedef
                + ' eşleş=' + s.match + ' max1=' + (s.max1 ?? '—')
                + ' at_sayisiEksik=' + s.atSayisiMissing);
        }
    }

    return tabs;
}

function summarizeVerdict(kosuTotal, withFs, tabs) {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  SONUÇ ÖZETİ                                             ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    const fsPct = pct(withFs, kosuTotal);
    const scrapeOk = fsPct >= 80;

    if (kosuTotal === 0) {
        console.log('  ✗ Hiç geçmiş koşu yok — GETİR ile veri çekilmemiş veya kayıt boş.');
        return;
    }

    console.log('\n  TJK scrape kodu doğru mu?');
    console.log('  → Evet — canlı TJK testi (--live-at-id) tüm meta alanlarını doldurur.');
    console.log('  → Sorun: kayıtlı kosular[] eski/eksik scrape ile kaydedilmiş.');

    console.log('\n  Kayıtlı veri:');
    console.log('  · at_sayisi doluluk: ' + withFs + '/' + kosuTotal + ' (' + fsPct + '%)');
    if (fsPct < 20) {
        console.log('  ✗ MAX-* sütunları (tüm sekmeler) neredeyse tamamen boş kalır.');
        console.log('  ✓ cnt (1./1-2/1-3) sira alanı dolu olduğu sürece çalışır.');
    } else if (fsPct < 80) {
        console.log('  △ MAX-* kısmen dolu — eksik atlar için repair gerekir.');
    } else {
        console.log('  ✓ at_sayisi yeterli — MAX-* hesaplanabilir.');
    }

    const dimTabs = ['KOŞU CİNSİ', 'TAKİ', 'PİST', 'HP', 'SİKLET'];
    console.log('\n  Sekme bazlı engel:');
    console.log('  · AT SAYISI / ŞEHİR: at_sayisi + sira');
    for (const label of dimTabs) {
        const extra = label === 'KOŞU CİNSİ' ? 'kcins_kosu'
            : label === 'TAKİ' ? 'taki'
                : label === 'PİST' ? 'pist/pist_kosu'
                    : label === 'HP' ? 'hp' : 'siklet';
        console.log('  · ' + label + ': ' + extra + ' + sira + at_sayisi (MAX-*)');
    }

    console.log('\n  Düzeltme:');
    console.log('  node scripts/repair-missing-kosular.js --db atlar.db --kayit ID --refresh --fetch --apply');
    console.log('  veya UI\'dan GETİR ile kaydı yeniden çekin.');
}

async function auditDb() {
    loadStatsEngines();
    const db = openDb(cli.dbPath);
    try {
        let rows = await dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id DESC');
        if (cli.kayitId) rows = rows.filter(r => Number(r.id) === cli.kayitId);

        console.log('╔══════════════════════════════════════════════════════════╗');
        console.log('║  Gösterge sekmeleri — TJK veri kapsam denetimi          ║');
        console.log('╚══════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Kayıt: ' + (cli.kayitId ? '#' + cli.kayitId : rows.length + ' kayıt'));

        let allKosular = [];
        let allHorses = [];
        let allRaces = [];
        const entries = [];
        let hipodrom = '';

        for (const row of rows) {
            const races = parseVeri(row.veri);
            if (!races) continue;
            if (!hipodrom) hipodrom = row.hipodrom || '';
            for (const race of races) {
                const raceNo = Number(race.raceNo) || 0;
                if (cli.raceNo && raceNo !== cli.raceNo) continue;
                allRaces.push(race);
                for (const horse of race.horses || []) {
                    allHorses.push(horse);
                    for (const k of horse.kosular || []) allKosular.push(k);
                    entries.push({ horse, race, kayitId: row.id, hipodrom: row.hipodrom });
                }
            }
        }

        const emptyKosular = allHorses.filter(h => !(h.kosular || []).length).length;
        let withFs = 0;
        for (const k of allKosular) {
            if (Number(k.at_sayisi) > 0) withFs++;
        }

        console.log('\n── Genel ──');
        console.log('  At sayısı          : ' + allHorses.length);
        console.log('  kosular[] boş at   : ' + emptyKosular);
        console.log('  Toplam geçmiş koşu : ' + allKosular.length);
        console.log('  at_sayisi dolu     : ' + withFs + ' (' + pct(withFs, allKosular.length) + '%)');

        auditKosuFields(allKosular);
        auditProgramMeta(allHorses, allRaces, hipodrom);
        const tabs = tabCalcReport(entries, hipodrom);
        summarizeVerdict(allKosular.length, withFs, tabs);
    } finally {
        db.close();
    }
}

async function auditLiveTjk() {
    const {
        launchBrowser,
        gotoWithHeaders,
        gotoKosuSonucSayfasi,
        parseKosuDetayEval,
        countFieldSizePageEval,
        buildKosuKayit
    } = require('../lib/tjk-scrape');

    const META_COLS = ['sira', 'at_sayisi', 'sehir', 'kcins_kosu', 'taki', 'pist', 'pist_kosu', 'hp', 'siklet'];

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  Canlı TJK scrape — alan karşılaştırması                ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('atId=' + cli.liveAtId + ' · max ' + cli.maxKosu + ' koşu\n');

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        const atUrl = 'https://www.tjk.org/TR/YarisSever/Query/ConnectedPage/AtKosuBilgileri?QueryParameter_AtId=' + cli.liveAtId;
        await gotoWithHeaders(page, atUrl);

        const pageTitle = await page.evaluate(() => document.querySelector('h2.tableTitle')?.innerText?.trim() || '');
        const atIsmi = pageTitle || 'AT';

        const anaKosular = await page.evaluate(() => {
            function parseRow(row) {
                const cell = n => {
                    const el = row.querySelector('td:nth-child(' + n + ')');
                    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
                };
                const tarihCell = row.querySelector('td:first-child');
                const tarihLink = tarihCell?.querySelector('a');
                const tarihText = tarihCell?.innerText?.trim() || '';
                if (!tarihLink?.href || !/\d{2}\.\d{2}\.\d{4}/.test(tarihText)) return null;
                const pistRaw = cell(4);
                let pist = '';
                if (/^K:|kum/i.test(pistRaw)) pist = 'Kum';
                else if (/^Ç:|^C:|^S:|^çim/i.test(pistRaw)) pist = 'Çim';
                else if (/sentetik/i.test(pistRaw)) pist = 'Sentetik';
                else pist = pistRaw;
                return {
                    tarih: tarihText,
                    tarihLink: tarihLink.href,
                    sehir: cell(2),
                    mesafe: cell(3),
                    pist,
                    sira: cell(5),
                    siklet: cell(7),
                    taki: cell(8).replace(/\s+/g, ' ').trim(),
                    hp: cell(17)
                };
            }
            const tables = document.querySelectorAll('table.tablesorter');
            const kosuTablosu = tables.length >= 2 ? tables[1] : tables[0];
            if (!kosuTablosu) return [];
            const data = [];
            for (const row of kosuTablosu.querySelectorAll('tbody tr')) {
                const rec = parseRow(row);
                if (rec) data.push(rec);
            }
            return data;
        });

        console.log('At: ' + atIsmi + ' · ' + anaKosular.length + ' koşu listede\n');

        const totals = Object.fromEntries(META_COLS.map(c => [c, 0]));
        const limit = Math.min(cli.maxKosu, anaKosular.length);

        for (let i = 0; i < limit; i++) {
            const ana = anaKosular[i];
            await gotoKosuSonucSayfasi(page, ana.tarihLink, ana.sehir);
            const detay = await page.evaluate(parseKosuDetayEval(), atIsmi);
            const fieldSize = await page.evaluate(countFieldSizePageEval());
            const kayit = buildKosuKayit(ana, Object.assign({}, detay, fieldSize), {});

            console.log('Koşu ' + (i + 1) + ': ' + ana.tarih + ' · ' + ana.sehir + ' · S' + ana.sira);
            for (const col of META_COLS) {
                const v = kayit[col];
                const ok = col === 'at_sayisi' ? Number(v) > 0 : filled(v);
                if (ok) totals[col]++;
                console.log('  ' + (ok ? '✓' : '✗') + ' ' + col.padEnd(14) + (v ?? '(boş)'));
            }
            console.log('');
            await new Promise(r => setTimeout(r, 350));
        }

        console.log('Canlı TJK özet (' + limit + ' koşu):');
        for (const col of META_COLS) {
            const ok = totals[col] === limit;
            console.log('  ' + (ok ? '✓' : '△') + ' ' + col.padEnd(14) + totals[col] + '/' + limit);
        }
        console.log('\n→ Scrape kodu TJK\'dan tüm alanları çekebilir.');
        console.log('→ DB\'de eksikse kayıt eski GETİR/repair öncesi demektir.');
    } finally {
        await browser.close();
    }
}

async function main() {
    if (cli.liveAtId) {
        await auditLiveTjk();
    }
    await auditDb();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
