/**
 * 48 senaryo ödüllendirme — TEST1/2/3 kırmızı yazı (temel) × çevre × Test9 × 8002-8001 × SIRA
 * Taban çarpanlar: S1A–S3D · Zaman: SIRA 1→1.5x … 7→0.9x
 */
const Scenario48ScoringEngine = (function () {
    const BASE = {
        S1A: 2.5, S1B: 2.0, S1C: 2.0, S1D: 1.5,
        S2A: 2.2, S2B: 1.8, S2C: 1.8, S2D: 1.3,
        S3A: 1.4, S3B: 1.2, S3C: 1.2, S3D: 1.0
    };

    /** SIRA 1–7; 8+ → 0.9 */
    const TIME_MULT = [0, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9];

    function timeMultForSira(sira) {
        const n = parseInt(sira, 10);
        if (isNaN(n) || n < 1) return 1.0;
        if (n >= TIME_MULT.length) return 0.9;
        return TIME_MULT[n];
    }

    function borderType(satirClass) {
        const s = String(satirClass || '');
        if (/\bfosfor-kirmizi-kenar-satir\b/.test(s)) return 'kirmizi';
        if (/\bkoyu-mavi-kenar-satir\b/.test(s)) return 'mavi';
        return 'none';
    }

    /** TEST1 + TEST2 + TEST3 hücrelerinde görünür kirmizi-yazi */
    function allTest123KirmiziVisible(gosRow) {
        if (!gosRow?.classes || typeof GosterimEngine === 'undefined') return false;
        const cols = [
            GosterimEngine.COL.TEST1,
            GosterimEngine.COL.TEST2,
            GosterimEngine.COL.TEST3
        ];
        for (let i = 0; i < cols.length; i++) {
            const cellClass = GosterimEngine.getCellClass(cols[i], gosRow.classes);
            if (!cellClass || !/\bkirmizi-yazi\b/.test(cellClass)) return false;
        }
        return true;
    }

    function resolveScenarioCode(border, test9Yanip, fark8002Yanip) {
        const prefix = border === 'kirmizi' ? 'S1' : border === 'mavi' ? 'S2' : 'S3';
        let suffix;
        if (test9Yanip && fark8002Yanip) suffix = 'A';
        else if (test9Yanip) suffix = 'B';
        else if (fark8002Yanip) suffix = 'C';
        else suffix = 'D';
        return prefix + suffix;
    }

    /**
     * Tek GÖSTERİM satırı — TEST1/2/3 kırmızı değilse null
     * @returns {{ code, base, timeMult, final, sira, test9Yanip, f8002Yanip, border }|null}
     */
    function scoreGosRow(gosRow) {
        if (!gosRow || !allTest123KirmiziVisible(gosRow)) return null;
        const c = gosRow.classes || {};
        const border = borderType(c.satirClass);
        const test9Yanip = !!(c.test9YanipClass && String(c.test9YanipClass).trim());
        const f8002Yanip = !!(c.fark8002YanipClass && String(c.fark8002YanipClass).trim());
        const code = resolveScenarioCode(border, test9Yanip, f8002Yanip);
        const base = BASE[code] ?? 1.0;
        const siraRaw = gosRow.values?.[typeof GosterimEngine !== 'undefined' ? GosterimEngine.COL.SIRA_NO : 0];
        const sira = parseInt(siraRaw, 10);
        const timeMult = timeMultForSira(sira);
        const finalScore = base * timeMult;
        return {
            code: code,
            base: base,
            timeMult: timeMult,
            final: finalScore,
            sira: isNaN(sira) ? null : sira,
            test9Yanip: test9Yanip,
            f8002Yanip: f8002Yanip,
            border: border
        };
    }

    /**
     * Atın tüm geçmiş koşu satırlarından skor paketi
     * @param {object[]} gosRows — aynı atın buildRaceRows satırları
     */
    function aggregateHorseHits(gosRows) {
        const hits = [];
        for (let i = 0; i < (gosRows || []).length; i++) {
            const hit = scoreGosRow(gosRows[i]);
            if (hit) hits.push(hit);
        }
        if (!hits.length) {
            return {
                hits: [],
                maxFinal: 0,
                sumFinal: 0,
                bestCode: null,
                hitCount: 0
            };
        }
        let maxFinal = hits[0].final;
        let bestCode = hits[0].code;
        let sumFinal = 0;
        for (let j = 0; j < hits.length; j++) {
            sumFinal += hits[j].final;
            if (hits[j].final > maxFinal) {
                maxFinal = hits[j].final;
                bestCode = hits[j].code;
            }
        }
        return {
            hits: hits,
            maxFinal: maxFinal,
            sumFinal: sumFinal,
            bestCode: bestCode,
            hitCount: hits.length
        };
    }

    /**
     * Koşu bazında at skorları (GosterimEngine.buildRaceRows)
     */
    function scoreRace(race, options) {
        options = options || {};
        if (typeof GosterimEngine === 'undefined') return [];
        const rows = GosterimEngine.buildRaceRows(race, {
            programTarih: options.programTarih || null,
            hipodromSehir: options.hipodromSehir || '',
            raceIndex: options.raceIndex ?? 0
        });
        const byHorse = new Map();
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const hi = row.meta?.horseIndex;
            if (hi == null || hi < 0) continue;
            if (!byHorse.has(hi)) byHorse.set(hi, []);
            byHorse.get(hi).push(row);
        }
        const out = [];
        const horses = race.horses || [];
        for (let j = 0; j < horses.length; j++) {
            const agg = aggregateHorseHits(byHorse.get(j) || []);
            out.push({
                horseIndex: j,
                horse: horses[j],
                maxFinal: agg.maxFinal,
                sumFinal: agg.sumFinal,
                bestCode: agg.bestCode,
                hitCount: agg.hitCount,
                hits: agg.hits
            });
        }
        return out;
    }

    /**
     * maxFinal → TAHMİN % bonusu (S3D×0.9≈9 … S1A×1.5≈38)
     * @param {number} maxFinal
     * @returns {number}
     */
    function finalToPctBonus(maxFinal) {
        if (!maxFinal || maxFinal <= 0) return 0;
        return Math.round(maxFinal * 10);
    }

    /** Lider at (en yüksek maxFinal; eşitlikte sumFinal, at no) */
    function pickLeader(scored) {
        const ranked = (scored || []).filter(s => s.maxFinal > 0);
        if (ranked.length < 2) return ranked[0] || null;
        ranked.sort(function (a, b) {
            if (b.maxFinal !== a.maxFinal) return b.maxFinal - a.maxFinal;
            if (b.sumFinal !== a.sumFinal) return b.sumFinal - a.sumFinal;
            const na = parseInt(a.horse?.no, 10);
            const nb = parseInt(b.horse?.no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return a.horseIndex - b.horseIndex;
        });
        if (ranked[0].maxFinal === ranked[1].maxFinal
            && ranked[0].sumFinal === ranked[1].sumFinal) return null;
        return ranked[0];
    }

    return {
        BASE: BASE,
        TIME_MULT: TIME_MULT,
        timeMultForSira,
        borderType,
        allTest123KirmiziVisible,
        resolveScenarioCode,
        scoreGosRow,
        aggregateHorseHits,
        scoreRace,
        pickLeader,
        finalToPctBonus
    };
})();

if (typeof module !== 'undefined') module.exports = { Scenario48ScoringEngine };
