/**
 * Koşu mesafe/pist meta — TJK program sayfasında mesafe ile pist artık ayrı satırlarda.
 */
const tjkScrape = require('./tjk-scrape');

function isValidRaceDistance(n) {
    return Number.isFinite(n) && n >= 800 && n <= 3500;
}

function normalizePist(pist) {
    if (!pist) return '';
    const p = String(pist).trim();
    if (/^çim|^cim|^c:/i.test(p)) return 'Çim';
    if (/^kum|^k:/i.test(p)) return 'Kum';
    if (/sentetik/i.test(p)) return 'Sentetik';
    if (/^(Çim|Kum|Sentetik)$/i.test(p)) {
        return p.charAt(0).toLocaleUpperCase('tr-TR') + p.slice(1).toLocaleLowerCase('tr-TR');
    }
    return p;
}

/** Tek satır veya kısa metin — "1200 Çim" bitişik formatı */
function parseMesafePistFromLine(line) {
    const clean = String(line || '').replace(/\s+/g, ' ').trim();
    if (!clean) return { mesafe: '', pist: '' };
    const adjacent = clean.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/i);
    if (adjacent) {
        return { mesafe: adjacent[1], pist: normalizePist(adjacent[2]) };
    }
    const parsed = tjkScrape.parseRaceHeaderLine(clean);
    return {
        mesafe: parsed.mesafe || '',
        pist: normalizePist(parsed.pist_kosu || '')
    };
}

/** TJK koşu bloğu — mesafe ve pist ayrı satırlarda (yeni sayfa düzeni) */
function extractMesafePistFromKosuBlock(blok) {
    const lines = String(blok || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const pistRe = /^(Çim|Kum|Sentetik)$/i;
    const distRe = /^(\d{3,4})$/;
    let mesafe = '';
    let pist = '';

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(distRe);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (!isValidRaceDistance(n)) continue;
        mesafe = m[1];
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (pistRe.test(lines[j])) {
                pist = normalizePist(lines[j]);
                break;
            }
        }
        break;
    }
    return { mesafe, pist };
}

function raceMetaFilled(v) {
    return v != null && v !== '' && v !== '-' && v !== '—' && v !== '?';
}

function enrichRaceMeta(race, fallbackMeta) {
    if (!race) return race;
    const out = { ...race };
    const fb = fallbackMeta || {};

    if (!raceMetaFilled(out.mesafe) && raceMetaFilled(fb.mesafe)) {
        out.mesafe = String(fb.mesafe);
    }
    if (!raceMetaFilled(out.pist) && raceMetaFilled(fb.pist)) {
        out.pist = normalizePist(fb.pist);
    }
    if (!raceMetaFilled(out.kcins_kosu) && raceMetaFilled(fb.kcins_kosu)) {
        out.kcins_kosu = fb.kcins_kosu;
    }
    if (!raceMetaFilled(out.kategori) && raceMetaFilled(fb.kategori)) {
        out.kategori = fb.kategori;
    }

    if (raceMetaFilled(out.mesafe)) return out;

    const textSources = [
        out.baslik,
        out.kcins_kosu,
        out.kategori,
        fb.baslik
    ].filter(Boolean);

    for (const text of textSources) {
        const parsed = parseMesafePistFromLine(text);
        if (parsed.mesafe) {
            out.mesafe = parsed.mesafe;
            if (!raceMetaFilled(out.pist) && parsed.pist) out.pist = parsed.pist;
            return out;
        }
    }
    return out;
}

function enrichRacesMeta(races, metaByNo) {
    return (races || []).map((race) => {
        const rn = parseInt(race.raceNo, 10);
        const fb = metaByNo?.[race.raceNo] || metaByNo?.[rn] || null;
        return enrichRaceMeta(race, fb);
    });
}

function mergeRaceMetaPreserve(oldRace, newRace) {
    if (!oldRace || !newRace) return newRace || oldRace;
    return enrichRaceMeta(newRace, {
        mesafe: oldRace.mesafe,
        pist: oldRace.pist,
        kcins_kosu: oldRace.kcins_kosu,
        kategori: oldRace.kategori,
        baslik: oldRace.baslik
    });
}

module.exports = {
    isValidRaceDistance,
    normalizePist,
    parseMesafePistFromLine,
    extractMesafePistFromKosuBlock,
    enrichRaceMeta,
    enrichRacesMeta,
    mergeRaceMetaPreserve,
    raceMetaFilled
};
