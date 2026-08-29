#!/usr/bin/env node
/**
 * Eksik kosular[] tamiri — hesaplama_kayitlari + at_verileri birleştirme, isteğe bağlı TJK fetch
 *
 *   node scripts/repair-missing-kosular.js --db atlar.db --scan
 *   node scripts/repair-missing-kosular.js --db atlar.db --at-id 114236,104060,115482 --apply
 *   node scripts/repair-missing-kosular.js --db atlar.db --fetch --apply   # PM2 + Puppeteer gerekir
 */
const http = require('http');
const path = require('path');
const { openDb, dbAll, dbGet } = require('./ptest-terminal-lib');

const args = process.argv.slice(2);
function argVal(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
}

const cli = {
    dbPath: argVal('--db') || path.join(__dirname, '..', 'atlar.db'),
    atIds: (argVal('--at-id') || '').split(',').map(s => s.trim()).filter(Boolean),
    kayitId: argVal('--kayit') ? Number(argVal('--kayit')) : null,
    scan: args.includes('--scan') || (!args.includes('--apply') && !argVal('--at-id')),
    apply: args.includes('--apply'),
    fetch: args.includes('--fetch'),
    apiBase: argVal('--api') || 'http://127.0.0.1:3023',
    verbose: args.includes('--verbose') || args.includes('-v')
};

function hr(t) { console.log('\n══ ' + t + ' ══'); }

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
        for (const race of races) {
            const raceNo = race.raceNo || race.race_no;
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

function findMissing(horses, atIdFilter) {
    return horses.filter(h => {
        if (!h.atId) return false;
        if (h.kosularLen > 0) return false;
        if (atIdFilter.length && !atIdFilter.includes(h.atId)) return false;
        return true;
    });
}

function fetchAtKosular(apiBase, atId, atAdi) {
    const url = apiBase + '/api/at-tum-veriler?id=' + encodeURIComponent(atId)
        + '&adi=' + encodeURIComponent(atAdi || '');
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
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

async function main() {
    const db = openDb(cli.dbPath);
    try {
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  Eksik kosular[] tamiri                                     ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('DB: ' + cli.dbPath);
        console.log('Mod: ' + (cli.apply ? 'APPLY (yaz)' : 'DRY-RUN (sadece rapor)'));

        const kayitlar = await loadAllKayitSources(db);
        const { horses, indexByAtId } = collectHorsesFromKayitlar(kayitlar);
        const missing = findMissing(horses, cli.atIds);

        hr('Tarama');
        console.log('  Kaynak kayıt: ' + kayitlar.length);
        console.log('  Toplam at satırı: ' + horses.length);
        console.log('  atId indeks (en uzun kosular): ' + indexByAtId.size);
        console.log('  Eksik kosular[]: ' + missing.length);

        if (!missing.length) {
            console.log('\n✅ Eksik kosular bulunamadı.');
            return;
        }

        const plan = [];
        for (const m of missing) {
            const donor = indexByAtId.get(m.atId);
            plan.push({
                ...m,
                donor: donor && donor.kosularLen > 0 ? donor : null,
                fetched: null
            });
        }

        if (cli.fetch) {
            hr('TJK fetch (' + cli.apiBase + ')');
            for (const p of plan) {
                if (p.donor) continue;
                try {
                    const data = await fetchAtKosular(cli.apiBase, p.atId, p.horseName);
                    if (data.success && data.kosular?.length) {
                        p.fetched = data.kosular;
                        indexByAtId.set(p.atId, {
                            kosular: data.kosular,
                            kosularLen: data.kosular.length,
                            source: 'fetch:' + p.atId
                        });
                        console.log('  ✓ fetch ' + p.atId + ' #' + p.horseNo + ' → ' + data.kosular.length + ' koşu');
                    } else {
                        console.log('  ✗ fetch ' + p.atId + ' #' + p.horseNo + ' → boş (' + (data.atAdi || '—') + ')');
                    }
                } catch (e) {
                    console.log('  ✗ fetch ' + p.atId + ' hata: ' + e.message);
                }
            }
        }

        hr('Tamir planı');
        const byKayit = new Map();
        for (const p of plan) {
            const kosular = p.fetched || p.donor?.kosular;
            const source = p.fetched ? 'TJK fetch' : (p.donor ? 'indeks:' + p.donor.source : '—');
            console.log('  ' + p.hipodrom + ' ' + p.tarih + ' K' + p.raceNo + ' #' + p.horseNo
                + ' atId=' + p.atId + ' · kaynak: ' + source
                + (kosular ? ' · ' + kosular.length + ' koşu' : ' · KAYNAK YOK'));
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
                    const race = races.find(r => String(r.raceNo) === String(patch.raceNo));
                    if (!race) continue;
                    const horse = (race.horses || []).find(h => String(h.atId) === String(patch.atId)
                        || String(h.no) === String(patch.horseNo));
                    if (!horse) continue;
                    if (horse.kosular?.length) continue;
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
        console.log('  Planlanan eksik: ' + missing.length);
        console.log('  Yama uygulanabilir: ' + [...byKayit.values()].reduce((s, j) => s + j.patches.length, 0));
        console.log('  Güncellenen at: ' + totalPatched + (cli.apply ? '' : ' (dry-run — --apply ile yaz)'));
        if (!cli.apply && totalPatched) {
            console.log('\n  → Yazmak için: ... --apply');
        }
        if (!cli.fetch && plan.some(p => !p.donor)) {
            console.log('  → TJK fetch için: ... --fetch --apply (sunucu ayakta olmalı)');
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
