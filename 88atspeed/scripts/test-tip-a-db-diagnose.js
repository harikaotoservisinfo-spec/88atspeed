#!/usr/bin/env node
/**
 * Tip A (SON800-1 görünmez) kazananlar — ham DB depths / gosterim teşhisi
 *
 * Veri mi yok, hesaplama mı kırık?
 *
 * Kullanım:
 *   node scripts/test-tip-a-db-diagnose.js --db atlar.db --field-size 10
 *   node scripts/test-tip-a-db-diagnose.js --db atlar.db --hipodrom Bursa --tarih 24/08/2026 --race 7 --horse 4
 *   node scripts/test-tip-a-db-diagnose.js --verbose
 */
const {
    loadSimilarityEngines,
    buildFlatEntriesWithFlagsFromDb,
    buildAllRaceProfiles,
    buildTenAtHybridTypeReport,
    collectTipAWinners,
    diagnoseHorseDepthPipeline,
    DIAG_DEPTH_METRICS,
    pct,
    pad
} = require('./race-similarity-lib');
const { makeGostergeHost, openDb, dbAll } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || require('path').join(__dirname, '..', 'atlar.db'),
    fieldSize: argVal('--field-size') ? Number(argVal('--field-size')) : 10,
    hipodrom: argVal('--hipodrom') || null,
    tarih: argVal('--tarih') || null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseNo: argVal('--horse') ? Number(argVal('--horse')) : null,
    verbose: args.includes('--verbose') || args.includes('-v')
};

const OVERALL_LABELS = {
    AT_ZINCIR_BOS: 'Ham veri eksik — atın geçmiş koşularında metrik alanları yok',
    SAHA_VERI_YOK: 'Saha geneli derinlik 0 — koşuda hiç kimsenin zinciri yok',
    HESAPLAMA_ANOMALI: 'Zincir var ama depths[0] null — hesaplama anomalisi',
    KARISIK: 'Metrikler arası farklı teşhis — ayrıntılara bakın'
};

function hr(title) {
    console.log('\n══ ' + title + ' ══');
}

function sub(title) {
    console.log('\n── ' + title + ' ──');
}

function normalizeTarihLoose(s) {
    return String(s || '').replace(/\s/g, '');
}

function findRaceInKayit(kayit, raceNo) {
    let races;
    try {
        races = JSON.parse(kayit.veri);
    } catch (_) {
        return null;
    }
    if (!Array.isArray(races)) return null;
    return races.find((r, i) => (r.raceNo || (i + 1)) === raceNo) || null;
}

function findRawHorse(race, horseNo) {
    return (race?.horses || []).find(h => Number(h.no) === Number(horseNo)) || null;
}

async function loadKayitlar(db) {
    return dbAll(db, 'SELECT id, hipodrom, tarih, veri FROM hesaplama_kayitlari ORDER BY id');
}

async function resolveTargets(db, profiles) {
    if (cli.hipodrom && cli.tarih && cli.raceNo && cli.horseNo) {
        return [{
            kayitId: null,
            raceNo: cli.raceNo,
            hipodrom: cli.hipodrom,
            tarih: cli.tarih,
            horseNo: cli.horseNo,
            horseName: '?',
            label: cli.hipodrom + ' ' + cli.tarih + ' K' + cli.raceNo + ' #' + cli.horseNo,
            profile: null,
            hybrid: null
        }];
    }

    const tipA = collectTipAWinners(profiles, { fieldSize: cli.fieldSize });
    if (!tipA.length) {
        throw new Error('Tip A kazanan bulunamadı (field-size=' + cli.fieldSize + ')');
    }
    return tipA;
}

function printKosularSummary(ks) {
    console.log('  Ham kosular: toplam=' + ks.total
        + ' · tarihli=' + ks.withTarih
        + ' · programGunuHaric=' + (ks.withTarih - ks.excludedProgramDay));
    console.log('  Metrik uygun koşu: son800_bir=' + ks.withSon800Bir
        + ' · at_derece=' + ks.withAtDerece
        + ' · test1Hesap=' + ks.withTest1Inputs);
    console.log('  Zincir uzunluğu: SON800-1=' + ks.chainLengths.son8001
        + ' · TEST1=' + ks.chainLengths.test1
        + ' · T1×DR=' + ks.chainLengths.t1dr);

    if (ks.recentKosular.length) {
        console.log('  Son koşular (ham DB):');
        for (const k of ks.recentKosular) {
            const pg = k.programGunu ? ' [program]' : '';
            console.log('    ' + pad(k.tarih, 12) + pad(String(k.mesafe || '—'), 8)
                + ' sira=' + pad(String(k.sira ?? '—'), 4)
                + ' S800-1=' + pad(String(k.son800_bir), 10)
                + ' at=' + pad(String(k.at_derece), 10)
                + ' 1.=' + pad(String(k.birinci_derece), 10) + pg);
        }
    } else {
        console.log('  Son koşular: (yok)');
    }
}

function printMetricDiag(m) {
    console.log('  ' + m.label + ':');
    console.log('    saha maxDepth=' + m.raceMaxDepth
        + ' · at chainLen=' + m.chainLen
        + ' · depths[] len=' + m.depthsLen
        + ' · saha depths[0]=' + m.fieldWithDepth0 + '/' + m.fieldSize);
    console.log('    teşhis: [' + m.verdict.code + '] ' + m.verdict.label);
    console.log('    → ' + m.verdict.detail);

    if (m.chainHead) {
        const head = JSON.stringify(m.chainHead);
        console.log('    chain[0]: ' + (head.length > 120 ? head.slice(0, 117) + '...' : head));
    }

    if (m.cell0) {
        console.log('    depths[0]: pct=' + m.cell0.pct
            + ' · compared=' + m.cell0.comparedCount
            + ' · visual=' + (m.visual || '—'));
        if (m.cell0.gosterim && Object.keys(m.cell0.gosterim).length) {
            const flags = Object.entries(m.cell0.gosterim).filter(([, v]) => v).map(([k]) => k);
            if (flags.length) console.log('    gosterim (hücre): ' + flags.join(', '));
        }
    } else {
        console.log('    depths[0]: null');
    }

    if (cli.verbose && m.gosterimAfterFlags) {
        const flags = Object.entries(m.gosterimAfterFlags).filter(([, v]) => v).map(([k]) => k);
        if (flags.length) console.log('    gosterim (bayrak sonrası): ' + flags.join(', '));
    }
}

function printTargetDiag(diag, target) {
    sub(target.label + ' · genel: ' + diag.overallVerdict);
    console.log('  At: #' + diag.horseNo + ' ' + (diag.horseName || '')
        + ' · atId=' + (diag.atId ?? '—') + ' · key=' + diag.horseKey
        + ' · hedefMesafe=' + (diag.hedefMesafe ?? '—'));
    if (target.hybrid) {
        console.log('  Hibrit: Tip A · dom S1:' + (target.hybrid.domSon?.visual || '—')
            + '×' + (target.hybrid.domSon?.count ?? 0));
    }
    console.log('  Özet: ' + (OVERALL_LABELS[diag.overallVerdict] || diag.overallVerdict));

    sub('Ham DB — kosular özeti');
    printKosularSummary(diag.kosularSummary);

    sub('Metrik pipeline (ham → zincir → depths[0] → gosterim)');
    for (const m of DIAG_DEPTH_METRICS) {
        printMetricDiag(diag.metrics[m.id]);
    }

    if (cli.verbose) {
        sub('Karar ağacı');
        const ks = diag.kosularSummary;
        if (ks.total === 0) {
            console.log('  1. kosular[] boş → DB kaydında at geçmişi yok');
        } else if (ks.withSon800Bir === 0 && ks.withTest1Inputs === 0) {
            console.log('  1. kosular var ama son800_bir / test1 alanları yok → VERİ EKSİK (kaynak)');
        } else if (ks.chainLengths.son8001 === 0) {
            console.log('  1. son800_bir kayıtları var ama zincir 0 → tarih filtresi veya derece parse hatası');
            console.log('     programGunuHaric=' + (ks.withTarih - ks.excludedProgramDay)
                + ' · son800_bir=' + ks.withSon800Bir);
        } else {
            console.log('  1. Zincir dolu ama raporda — → segment imza yolunu kontrol et');
        }
    }
}

async function main() {
    loadSimilarityEngines();
    const db = openDb(cli.dbPath);

    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  Tip A DB teşhis — ham depths / gosterim                    ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Field: ' + cli.fieldSize + ' at');

        const { flatEntries, bitisMap } = await buildFlatEntriesWithFlagsFromDb(db, {});
        const host = makeGostergeHost(flatEntries, bitisMap);
        const profiles = buildAllRaceProfiles(flatEntries, host)
            .filter(p => p.fieldSize === cli.fieldSize && p.hasWinner);

        const hybrid = buildTenAtHybridTypeReport(profiles, { fieldSize: cli.fieldSize });
        console.log('Tip A havuzu: ' + (hybrid.types.A?.count ?? 0) + ' / ' + hybrid.total + ' koşu');

        const targets = await resolveTargets(db, profiles);
        const kayitlar = await loadKayitlar(db);

        hr('Teşhis hedefleri · ' + targets.length + ' at');

        const summaryCounts = { AT_ZINCIR_BOS: 0, SAHA_VERI_YOK: 0, HESAPLAMA_ANOMALI: 0, KARISIK: 0 };

        for (const target of targets) {
            const kayit = kayitlar.find(k => {
                if (target.kayitId != null && Number(k.id) !== Number(target.kayitId)) return false;
                if (cli.hipodrom && k.hipodrom !== cli.hipodrom) return false;
                if (cli.tarih && normalizeTarihLoose(k.tarih) !== normalizeTarihLoose(cli.tarih)) return false;
                return true;
            });
            if (!kayit) {
                console.log('\n⚠ Kayıt bulunamadı: ' + target.label);
                continue;
            }

            const race = findRaceInKayit(kayit, target.raceNo);
            if (!race) {
                console.log('\n⚠ Koşu bulunamadı: ' + target.label + ' (kayitId=' + kayit.id + ')');
                continue;
            }

            const rawHorse = findRawHorse(race, target.horseNo);
            if (!rawHorse) {
                console.log('\n⚠ At bulunamadı: ' + target.label);
                continue;
            }

            const diag = diagnoseHorseDepthPipeline(
                rawHorse,
                race,
                kayit.hipodrom,
                kayit.tarih,
                { verbose: cli.verbose }
            );
            summaryCounts[diag.overallVerdict] = (summaryCounts[diag.overallVerdict] || 0) + 1;
            printTargetDiag(diag, target);
        }

        hr('Özet');
        console.log('  AT_ZINCIR_BOS (veri eksik):     ' + (summaryCounts.AT_ZINCIR_BOS || 0));
        console.log('  SAHA_VERI_YOK:                  ' + (summaryCounts.SAHA_VERI_YOK || 0));
        console.log('  HESAPLAMA_ANOMALI:              ' + (summaryCounts.HESAPLAMA_ANOMALI || 0));
        console.log('  KARISIK:                        ' + (summaryCounts.KARISIK || 0));
        console.log('');
        console.log('── Kullanım ──');
        console.log('  node scripts/test-tip-a-db-diagnose.js --db atlar.db --field-size 10 --verbose');
        console.log('  node scripts/test-tip-a-db-diagnose.js --hipodrom Bursa --tarih 24/08/2026 --race 7 --horse 4');
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
