#!/usr/bin/env node
/**
 * Eksik kosular[] tamiri — hesaplama_kayitlari + at_verileri birleştirme, isteğe bağlı TJK fetch
 *
 *   node scripts/repair-missing-kosular.js --db atlar.db --scan
 *   node scripts/repair-missing-kosular.js --db atlar.db --at-id 114236,104060,115482 --apply
 *   node scripts/repair-missing-kosular.js --db atlar.db --kayit 133 --race 6 --horse 5,6,8 --scan-depth
 *   node scripts/repair-missing-kosular.js --db atlar.db --kayit 133 --race 6 --horse 5,6,8 --refresh --apply
 */
const http = require('http');
const path = require('path');
const {
    openDb,
    dbAll,
    dbGet,
    loadGostergeEngines,
    buildFlatEntriesFromDb
} = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    atIds: (argVal('--at-id') || '').split(',').map(s => s.trim()).filter(Boolean),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    raceNo: argVal('--race') ? Number(argVal('--race')) : null,
    horseNos: (argVal('--horse') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number),
    scan: args.includes('--scan'),
    scanDepth: args.includes('--scan-depth'),
    refresh: args.includes('--refresh'),
    apply: args.includes('--apply'),
    fetch: args.includes('--fetch'),
    noFetch: args.includes('--no-fetch'),
    fetchDelayMs: Number(argVal('--fetch-delay')) || 800,
    fetchTimeoutMs: Number(argVal('--fetch-timeout')) || 300000,
    fetchQuick: args.includes('--fetch-quick'),
    maxAllKosu: argVal('--max-all-kosu') ? Number(argVal('--max-all-kosu')) : null,
    apiBase: argVal('--api') || 'http://127.0.0.1:3023',
    verbose: args.includes('--verbose') || args.includes('-v')
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadAllKayitSources(db) {
    const out = [];
    for (const table of ['hesaplama_kayitlari', 'at_verileri']) {
        let rows;
        try {
            rows = await dbAll(db, `SELECT id, hipodrom, tarih, veri, kayit_tarihi FROM ${table} ORDER BY id`);
        } catch (_) {
            continue;
        }
        for (const row of rows) {
            out.push({ ...row, _table: table });
        }
    }
    return out;
}

function parseKayitVeri(raw) {
    try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(data) ? data : null;
    } catch (_) {
        return null;
    }
}

function collectHorsesFromKayitlar(kayitlar) {
    const horses = [];
    const indexByAtId = new Map();

    for (const kayit of kayitlar) {
        const races = parseKayitVeri(kayit.veri);
        if (!races) continue;
        for (let i = 0; i < races.length; i++) {
            const race = races[i];
            const raceNo = race.raceNo || race.race_no || (i + 1);
            for (const horse of race.horses || []) {
                const atId = horse.atId != null ? String(horse.atId) : '';
                const kosular = horse.kosular || [];
                const rec = {
                    kayitId: kayit.id,
                    table: kayit._table,
                    hipodrom: kayit.hipodrom,
                    tarih: kayit.tarih,
                    raceNo,
                    horseNo: horse.no,
                    horseName: horse.name,
                    atId,
                    kosular,
                    kosularLen: kosular.length
                };
                horses.push(rec);

                if (!atId) continue;
                const prev = indexByAtId.get(atId);
                if (!prev || kosular.length > prev.kosularLen) {
                    indexByAtId.set(atId, {
                        kosular,
                        kosularLen: kosular.length,
                        source: kayit.hipodrom + ' ' + kayit.tarih + ' kayit#' + kayit.id
                    });
                }
            }
        }
    }
    return { horses, indexByAtId };
}

function filterByContext(horses) {
    return horses.filter(h => {
        if (cli.kayitId && Number(h.kayitId) !== cli.kayitId) return false;
        if (cli.raceNo && Number(h.raceNo) !== cli.raceNo) return false;
        if (cli.horseNos.length && !cli.horseNos.includes(Number(h.horseNo))) return false;
        return true;
    });
}

function findMissing(horses, atIdFilter) {
    return horses.filter(h => {
        if (!h.atId) return false;
        if (h.kosularLen > 0) return false;
        if (atIdFilter.length && !atIdFilter.includes(h.atId)) return false;
        return true;
    });
}

function findRepairTargets(horses, atIdFilter) {
    const scoped = filterByContext(horses);
    if (cli.refresh) {
        return scoped.filter(h => h.atId && (!atIdFilter.length || atIdFilter.includes(h.atId)));
    }
    return findMissing(scoped, atIdFilter);
}

function fetchAtKosular(apiBase, atId, atAdi, opts = {}) {
    const q = new URLSearchParams({ id: atId, adi: atAdi || '' });
    if (opts.quick) q.set('allFieldSizes', '0');
    if (opts.maxAllKosu != null) q.set('maxAllKosu', String(opts.maxAllKosu));
    const url = apiBase + '/api/at-tum-veriler?' + q.toString();
    const timeoutMs = opts.timeoutMs || 300000;
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('timeout ' + Math.round(timeoutMs / 1000) + 's'));
        });
    });
}

function formatKosuPreview(kosular) {
    if (!kosular?.length) return '(boş)';
    const first = kosular[0];
    const last = kosular[kosular.length - 1];
    return kosular.length + ' koşu · ' + (last.tarih || '?') + '…' + (first.tarih || '?')
        + ' · örn: ' + (first.sehir || '?') + ' ' + (first.mesafe || '?');
}

async function runFetchPlan(plan, apiBase, delayMs) {
    hr('TJK fetch (' + apiBase + ')');
    console.log('  Not: TJK atId sayfasından çekilir — tarih/hipodrom/at eşleşmesi atId ile garanti.');
    if (cli.fetchQuick) {
        console.log('  Mod: fetch-quick — sadece son 7 koşu tam detay (~1-2 dk/at)');
    } else {
        console.log('  Mod: tam — son 7 detay + max ' + (cli.maxAllKosu || 40) + ' koşu at_sayisi (~2-4 dk/at)');
    }

    const byAtId = new Map();
    for (const p of plan) {
        if (p.donor && !cli.refresh) continue;
        if (!p.atId) continue;
        if (!byAtId.has(p.atId)) byAtId.set(p.atId, p);
    }
    const unique = [...byAtId.values()];
    console.log('  Benzersiz atId: ' + unique.length + ' (satır tekrarı atlanır)');
    console.log('  Tahmini süre: ~' + Math.ceil(unique.length * (cli.fetchQuick ? 1.5 : 3)) + ' dk\n');

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < unique.length; i++) {
        const p = unique[i];
        const tag = '[' + (i + 1) + '/' + unique.length + ']';
        process.stdout.write('  ' + tag + ' fetch ' + p.atId + ' #' + p.horseNo + ' ' + (p.horseName || '') + ' … ');
        try {
            const data = await fetchAtKosular(apiBase, p.atId, p.horseName, {
                quick: cli.fetchQuick,
                maxAllKosu: cli.maxAllKosu,
                timeoutMs: cli.fetchTimeoutMs
            });
            if (data.success && data.kosular?.length) {
                for (const row of plan) {
                    if (row.atId === p.atId) row.fetched = data.kosular;
                }
                ok++;
                console.log('✓ ' + formatKosuPreview(data.kosular)
                    + (data.atAdi ? ' · ' + data.atAdi : ''));
            } else {
                fail++;
                console.log('✗ boş' + (data.error ? ' (' + data.error + ')' : ''));
            }
        } catch (e) {
            fail++;
            console.log('✗ ' + e.message);
            console.log('    → pm2 restart 88atspeed sonra kaldığı yerden: --at-id ' + p.atId);
        }
        if (delayMs > 0 && i < unique.length - 1) await sleep(delayMs);
    }
    console.log('\n  Fetch özeti: ' + ok + ' başarılı · ' + fail + ' başarısız');
    return { ok, fail };
}

async function patchKayit(db, kayitId, table, patchFn) {
    const row = await dbGet(db, `SELECT veri FROM ${table} WHERE id = ?`, [kayitId]);
    if (!row?.veri) return { patched: 0 };
    const races = parseKayitVeri(row.veri);
    if (!races) return { patched: 0 };
    const count = patchFn(races);
    if (count === 0) return { patched: 0 };
    if (!cli.apply) return { patched: count, dryRun: true };
    await new Promise((resolve, reject) => {
        db.run(`UPDATE ${table} SET veri = ? WHERE id = ?`, [JSON.stringify(races), kayitId], err => {
            if (err) reject(err);
            else resolve();
        });
    });
    return { patched: count, dryRun: false };
}

async function scanDepthGaps(db, horses) {
    loadGostergeEngines();
    const { flatEntries } = await buildFlatEntriesFromDb(db, {
        filterKayit: cli.kayitId,
        filterRace: cli.raceNo
    });
    const kosByKey = new Map();
    for (const h of horses) {
        kosByKey.set(String(h.kayitId) + '|' + h.raceNo + '|' + h.horseNo, h);
    }

    hr('Derinlik taraması');
    if (!flatEntries.length) {
        console.log('  Hesaplama paketi boş — kayit/race filtresini kontrol edin.');
        return;
    }
    let gapCount = 0;
    for (const e of flatEntries) {
        if (cli.horseNos.length && !cli.horseNos.includes(Number(e.row.no))) continue;
        const key = String(e.kayitId) + '|' + e.raceNo + '|' + e.row.no;
        const raw = kosByKey.get(key);
        const miss = e.row.depthsMissing || {};
        const s = e.row.son8001Depths?.[0]?.pct;
        const t = e.row.test1Depths?.[0]?.pct;
        const d = e.row.t1drDepths?.[0]?.pct;
        const hasGap = miss.anyPrimary || miss.anyCore || !global.AtSpeedUtils.hasDepthTieBreakData(e.row);
        if (hasGap) gapCount++;
        console.log('  #' + e.row.no + ' ' + (e.row.name || '') + ' atId=' + (raw?.atId || '—')
            + ' · kosular=' + (raw?.kosularLen ?? '?')
            + ' · S800=' + (s ?? '—') + ' T1=' + (t ?? '—') + ' T1DR=' + (d ?? '—')
            + (miss.anyCore ? ' · ⚠ çekirdek eksik' : (miss.anyPrimary ? ' · ⚠ birincil eksik' : '')));
    }
    console.log('\n  Derinlik boşluğu: ' + gapCount + '/' + flatEntries.length);
    if (gapCount) {
        console.log('  → TJK yenile: --refresh --apply (veya --fetch --apply)');
    }
}

async function main() {
    const db = openDb(cli.dbPath);
    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  Eksik kosular[] tamiri                                     ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Mod: ' + (cli.apply ? 'APPLY (yaz)' : 'DRY-RUN (sadece rapor)')
            + (cli.refresh ? ' · refresh' : ''));

        const kayitlar = await loadAllKayitSources(db);
        const { horses, indexByAtId } = collectHorsesFromKayitlar(kayitlar);

        if (cli.scanDepth) {
            await scanDepthGaps(db, horses);
            if (!cli.apply && !cli.refresh && !cli.fetch) {
                console.log('\nOK');
                return;
            }
        }

        const targets = findRepairTargets(horses, cli.atIds);

        hr('Tarama');
        console.log('  Kaynak kayıt: ' + kayitlar.length);
        console.log('  Toplam at satırı: ' + horses.length);
        console.log('  atId indeks (en uzun kosular): ' + indexByAtId.size);
        console.log('  Hedef at: ' + targets.length + (cli.refresh ? ' (refresh)' : ' (eksik kosular)'));

        if (!targets.length) {
            console.log('\n✅ Hedef at yok.'
                + (cli.refresh ? '' : ' Eksik kosular bulunamadı — --scan-depth ile derinlik bakın.'));
            return;
        }

        const plan = [];
        for (const m of targets) {
            const donor = cli.refresh ? null : indexByAtId.get(m.atId);
            plan.push({
                ...m,
                donor: donor && donor.kosularLen > 0 ? donor : null,
                fetched: null
            });
        }

        const needsFetch = cli.refresh || plan.some(p => !p.donor);
        const doFetch = cli.fetch || cli.refresh || (cli.apply && needsFetch && !cli.noFetch);
        if (doFetch && needsFetch) {
            await runFetchPlan(plan, cli.apiBase, cli.fetchDelayMs);
            for (const p of plan) {
                if (p.fetched?.length) {
                    indexByAtId.set(p.atId, {
                        kosular: p.fetched,
                        kosularLen: p.fetched.length,
                        source: 'fetch:' + p.atId
                    });
                }
            }
        } else if (needsFetch && !cli.apply) {
            console.log('\n  → Kaynak yok: --apply ile yaz (otomatik fetch) veya --fetch');
        }

        hr('Tamir planı');
        const byKayit = new Map();
        for (const p of plan) {
            const kosular = p.fetched || p.donor?.kosular;
            const source = p.fetched ? 'TJK fetch' : (p.donor ? 'indeks:' + p.donor.source : '—');
            console.log('  ' + p.hipodrom + ' ' + p.tarih + ' K' + p.raceNo + ' #' + p.horseNo
                + ' atId=' + p.atId + ' · kaynak: ' + source
                + (kosular ? ' · ' + kosular.length + ' koşu' : ' · KAYNAK YOK')
                + (cli.refresh && p.fetched ? ' · üzerine yaz' : ''));
            if (!kosular?.length) continue;
            const key = p.table + '|' + p.kayitId;
            if (!byKayit.has(key)) {
                byKayit.set(key, { table: p.table, kayitId: p.kayitId, patches: [] });
            }
            byKayit.get(key).patches.push({
                raceNo: p.raceNo,
                horseNo: p.horseNo,
                atId: p.atId,
                kosular
            });
        }

        let totalPatched = 0;
        for (const [, job] of byKayit) {
            if (cli.kayitId && job.kayitId !== cli.kayitId) continue;
            const result = await patchKayit(db, job.kayitId, job.table, races => {
                let n = 0;
                for (const patch of job.patches) {
                    const race = races.find(r => String(r.raceNo || '') === String(patch.raceNo));
                    if (!race) continue;
                    const horse = (race.horses || []).find(h => String(h.atId) === String(patch.atId)
                        || String(h.no) === String(patch.horseNo));
                    if (!horse) continue;
                    if (horse.kosular?.length && !cli.refresh) continue;
                    horse.kosular = patch.kosular;
                    n++;
                }
                return n;
            });
            totalPatched += result.patched;
            if (result.patched) {
                console.log('\n  ' + job.table + ' #' + job.kayitId + ': '
                    + result.patched + ' at ' + (result.dryRun ? '(dry-run)' : 'güncellendi'));
            }
        }

        hr('Özet');
        console.log('  Hedef: ' + targets.length);
        console.log('  Yama uygulanabilir: ' + [...byKayit.values()].reduce((s, j) => s + j.patches.length, 0));
        console.log('  Güncellenen at: ' + totalPatched + (cli.apply ? '' : ' (dry-run — --apply ile yaz)'));
        if (!cli.apply && totalPatched) {
            console.log('\n  → Yazmak için: ... --apply');
        }
        if (needsFetch && !doFetch) {
            console.log('  → TJK fetch: ... --refresh --apply veya --fetch --apply');
        }
        console.log('\nOK');
    } finally {
        db.close();
    }
}

main().catch(err => {
    console.error('HATA:', err.message || err);
    process.exit(1);
});
