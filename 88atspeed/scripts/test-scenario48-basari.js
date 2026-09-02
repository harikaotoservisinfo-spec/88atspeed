#!/usr/bin/env node
/**
 * 48 senaryo puanlama — kayıt bazlı başarı testi
 *
 *   node scripts/test-scenario48-basari.js --kayit 148,154
 *   node scripts/test-scenario48-basari.js --kayit 154 --race 3 -v
 *   node scripts/test-scenario48-basari.js --kayit 148 --db atlar.db
 */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    openDb,
    dbAll,
    rowKeyParts,
    pct,
    pad
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(ROOT, 'atlar.db'),
    kayitIds: (argVal('--kayit') || '148,154').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)),
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    verbose: args.includes('-v') || args.includes('--verbose')
};

const BLEND = { b1: 0.80, b12: 0.12, b123: 0.08 };

function loadEngines() {
    global.AtSpeedUtils = require(path.join(ROOT, 'public/js/utils.js'));
    eval(fs.readFileSync(path.join(ROOT, 'public/js/formula-engine.js'), 'utf8') + '\n; global.GosterimEngine = GosterimEngine;');
    eval(fs.readFileSync(path.join(ROOT, 'public/js/scenario48-scoring-engine.js'), 'utf8') + '\n; global.Scenario48ScoringEngine = Scenario48ScoringEngine;');
}

function hr(title) {
    console.log('\n' + '='.repeat(72));
    console.log(title);
    console.log('='.repeat(72));
}

function blendedFromBitis(b) {
    if (b == null || b < 1) return 0;
    if (b === 1) return BLEND.b1;
    if (b <= 2) return BLEND.b12;
    if (b <= 3) return BLEND.b123;
    return 0;
}

function bitisMark(b) {
    if (b == null) return '?';
    if (b === 1) return '★';
    if (b <= 3) return '◆';
    return '·';
}

async function loadBitisMap(db) {
    const sqlite3 = require('sqlite3').verbose();
    return new Promise((resolve) => {
        const db2 = new sqlite3.Database(cli.dbPath);
        db2.get('SELECT veri FROM puanlama_bitis_sonuclari WHERE id = 1', [], (err, row) => {
            db2.close();
            if (err || !row?.veri) return resolve({});
            try {
                const parsed = JSON.parse(row.veri);
                return resolve(parsed.bitis || parsed);
            } catch (_) {
                return resolve({});
            }
        });
    });
}

function resolveBitis(horse, kayitId, raceNo, bitisMap) {
    const key = rowKeyParts(kayitId, raceNo, horse.no);
    let b = bitisMap[key];
    if (b == null || b < 1) b = global.AtSpeedUtils.extractBitisFromHorseName(horse.name);
    return b != null && b >= 1 ? b : null;
}

function enrichRaceHorses(race) {
    return Object.assign({}, race, {
        horses: (race.horses || []).map(h => Object.assign({}, h, {
            kosular: h.kosular || []
        }))
    });
}

async function analyzeKayit(db, kayitId, bitisMap) {
    const rows = await dbAll(db,
        'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari WHERE id = ?', [kayitId]);
    if (!rows.length) return null;

    const kayit = rows[0];
    let races;
    try {
        races = JSON.parse(kayit.veri);
    } catch (_) {
        return null;
    }
    if (!Array.isArray(races)) return null;

    const S48 = Scenario48ScoringEngine;
    const raceStats = [];
    const scenarioRows = [];
    const codeTotals = {};

    for (let ri = 0; ri < races.length; ri++) {
        const race = enrichRaceHorses(races[ri]);
        const raceNo = race.raceNo || (ri + 1);
        if (cli.raceNo && Number(raceNo) !== cli.raceNo) continue;

        const scored = S48.scoreRace(race, {
            programTarih: kayit.tarih,
            hipodromSehir: kayit.hipodrom,
            raceIndex: ri
        });

        for (let si = 0; si < scored.length; si++) {
            const s = scored[si];
            const bitis = resolveBitis(s.horse, kayitId, raceNo, bitisMap);
            for (let hi = 0; hi < s.hits.length; hi++) {
                const hit = s.hits[hi];
                scenarioRows.push({
                    kayitId: kayitId,
                    raceNo: raceNo,
                    horseNo: s.horse.no,
                    horseName: (s.horse.name || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
                    bitis: bitis,
                    code: hit.code,
                    final: hit.final,
                    sira: hit.sira
                });
                if (!codeTotals[hit.code]) {
                    codeTotals[hit.code] = { n: 0, b1: 0, b12: 0, b123: 0, sumFinal: 0 };
                }
                const ct = codeTotals[hit.code];
                ct.n++;
                ct.sumFinal += hit.final;
                if (bitis === 1) ct.b1++;
                if (bitis != null && bitis <= 2) ct.b12++;
                if (bitis != null && bitis <= 3) ct.b123++;
            }
        }

        const leader = S48.pickLeader(scored);
        const leaderBitis = leader ? resolveBitis(leader.horse, kayitId, raceNo, bitisMap) : null;
        const withHits = scored.filter(s => s.hitCount > 0).length;

        raceStats.push({
            raceNo: raceNo,
            fieldSize: (race.horses || []).length,
            withHits: withHits,
            leaderName: leader ? (leader.horse.name || '').replace(/\s*\(\d+\)\s*$/, '').trim() : '—',
            leaderCode: leader?.bestCode || '—',
            leaderMax: leader?.maxFinal ?? 0,
            leaderBitis: leaderBitis,
            leaderBlended: blendedFromBitis(leaderBitis)
        });

        if (cli.verbose && leader) {
            console.log('\n  K' + raceNo + ' lider: #' + leader.horse.no + ' ' + raceStats[raceStats.length - 1].leaderName
                + ' · ' + leader.bestCode + ' · max=' + leader.maxFinal.toFixed(2) + 'x'
                + ' · bitiş=' + (leaderBitis ?? '?'));
            if (leader.hits.length) {
                for (const h of leader.hits) {
                    console.log('    SIRA=' + (h.sira ?? '?') + ' ' + h.code + ' → ' + h.final.toFixed(2) + 'x');
                }
            }
        }
    }

    let racesWithLeader = 0, b1 = 0, b12 = 0, b123 = 0, sumBlend = 0;
    for (const rs of raceStats) {
        if (rs.leaderBitis == null) continue;
        racesWithLeader++;
        sumBlend += rs.leaderBlended;
        if (rs.leaderBitis === 1) b1++;
        if (rs.leaderBitis <= 2) b12++;
        if (rs.leaderBitis <= 3) b123++;
    }

    return {
        kayitId: kayitId,
        tarih: kayit.tarih,
        hipodrom: kayit.hipodrom,
        raceStats: raceStats,
        scenarioRows: scenarioRows,
        codeTotals: codeTotals,
        summary: {
            races: raceStats.length,
            racesWithBitis: racesWithLeader,
            b1: b1,
            b12: b12,
            b123: b123,
            avgBlend: racesWithLeader ? sumBlend / racesWithLeader : 0
        }
    };
}

function printKayitReport(report) {
    hr('Kayıt #' + report.kayitId + ' · ' + report.tarih + ' · ' + report.hipodrom);
    const s = report.summary;
    console.log('Koşu sayısı: ' + s.races + ' · bitiş bilinen: ' + s.racesWithBitis);
    console.log('48 senaryo lideri → ★1.: ' + pct(s.b1 / Math.max(1, s.racesWithBitis))
        + ' (' + s.b1 + '/' + s.racesWithBitis + ')'
        + ' · ◆1–3: ' + pct(s.b123 / Math.max(1, s.racesWithBitis))
        + ' (' + s.b123 + '/' + s.racesWithBitis + ')'
        + ' · ort. blend: ' + (s.avgBlend * 100).toFixed(1) + '%');

    console.log('\nKoşu bazında lider (maxFinal):');
    console.log(pad('Koşu', 6) + pad('Lider', 22) + pad('Senaryo', 8)
        + pad('Max', 8) + pad('Bitiş', 8) + pad('Blend', 8));
    for (const rs of report.raceStats) {
        console.log(pad('K' + rs.raceNo, 6)
            + pad(rs.leaderName.slice(0, 20), 22)
            + pad(rs.leaderCode, 8)
            + pad(rs.leaderMax ? rs.leaderMax.toFixed(2) + 'x' : '—', 8)
            + pad(rs.leaderBitis != null ? bitisMark(rs.leaderBitis) + rs.leaderBitis : '?', 8)
            + pad(rs.leaderBitis != null ? Math.round(rs.leaderBlended * 100) + '%' : '—', 8));
    }

    console.log('\nSenaryo kodu × bitiş (satır bazında — tüm geçmiş koşular):');
    console.log(pad('Kod', 6) + pad('Satır', 7) + pad('★1.', 8) + pad('◆1–3', 8)
        + pad('Ort.final', 10) + ' Taban');
    const codes = Object.keys(Scenario48ScoringEngine.BASE).sort();
    for (const code of codes) {
        const ct = report.codeTotals[code];
        if (!ct || !ct.n) {
            console.log(pad(code, 6) + pad('0', 7) + pad('—', 8) + pad('—', 8)
                + pad('—', 10) + ' ' + Scenario48ScoringEngine.BASE[code] + 'x');
            continue;
        }
        console.log(pad(code, 6) + pad(String(ct.n), 7)
            + pad(pct(ct.b1 / ct.n), 8)
            + pad(pct(ct.b123 / ct.n), 8)
            + pad((ct.sumFinal / ct.n).toFixed(2) + 'x', 10)
            + ' ' + Scenario48ScoringEngine.BASE[code] + 'x');
    }
}

async function main() {
    loadEngines();
    const db = openDb(cli.dbPath);
    const bitisMap = await loadBitisMap(db);

    hr('48 SENARYO PUANLAMA · BAŞARI TESTİ');
    console.log('DB: ' + cli.dbPath);
    console.log('Kayıtlar: ' + cli.kayitIds.join(', '));
    if (cli.raceNo) console.log('Filtre koşu: K' + cli.raceNo);

    const reports = [];
    for (const kid of cli.kayitIds) {
        const report = await analyzeKayit(db, kid, bitisMap);
        if (!report) {
            console.log('\n⚠ Kayıt #' + kid + ' bulunamadı veya veri okunamadı.');
            continue;
        }
        reports.push(report);
        printKayitReport(report);
    }

    db.close();

    if (!reports.length) {
        console.error('\nHiç kayıt işlenemedi. Sunucu DB\'sinde --kayit 148,154 olduğundan emin olun.');
        process.exit(1);
    }

    if (reports.length > 1) {
        hr('TOPLAM ÖZET');
        let tr = 0, tb1 = 0, tb123 = 0, tBlend = 0, tBitis = 0;
        for (const r of reports) {
            tr += r.summary.races;
            tb1 += r.summary.b1;
            tb123 += r.summary.b123;
            tBitis += r.summary.racesWithBitis;
            tBlend += r.summary.avgBlend * r.summary.racesWithBitis;
        }
        console.log('Kayıt: ' + reports.map(r => '#' + r.kayitId).join(', '));
        console.log('Toplam koşu: ' + tr + ' · bitiş bilinen: ' + tBitis);
        console.log('★1.: ' + pct(tb1 / Math.max(1, tBitis)) + ' (' + tb1 + '/' + tBitis + ')');
        console.log('◆1–3: ' + pct(tb123 / Math.max(1, tBitis)) + ' (' + tb123 + '/' + tBitis + ')');
        console.log('Ort. blend: ' + (tBitis ? (tBlend / tBitis * 100).toFixed(1) : '0') + '%');
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
