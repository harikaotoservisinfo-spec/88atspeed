/**
 * Geçmiş koşularda hedef boyut (kcins_kosu, taki, pist, hp, siklet) istatistikleri
 * ŞEHİR DURUMU sekmesiyle aynı mantık — kosular[] TJK scrape ile gelir
 */
const KosuDimensionStatsEngine = {
    DIMENSIONS: {
        kcins_kosu: {
            label: 'KOŞU CİNSİ',
            pctLabel: 'KC%',
            matchLabel: 'KC-KOŞU',
            formLabel: 'KC-FORM',
            adjLabel: 'KC+',
            note: 'Hedef koşu cinsi (kcins_kosu) geçmiş koşularla karşılaştırılır.',
            targetFrom: 'race',
            getTarget(_horse, race) {
                return race?.kcins_kosu || '';
            },
            getKosuValue(k) {
                return k?.kcins_kosu || '';
            },
            match(a, b) {
                const x = KosuDimensionStatsEngine.normalizeText(a);
                const y = KosuDimensionStatsEngine.normalizeText(b);
                return !!y && !!x && x === y;
            },
            abbrev(v) {
                const s = String(v || '').trim();
                if (!s || s === '—') return '—';
                if (s.length <= 14) return s;
                return s.slice(0, 12) + '…';
            }
        },
        taki: {
            label: 'TAKİ',
            pctLabel: 'TK%',
            matchLabel: 'TK-KOŞU',
            formLabel: 'TK-FORM',
            adjLabel: 'TK+',
            note: 'Hedef takı (KG DB SK GKR vb.) geçmiş koşulardaki taki ile eşleşir.',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                return hm.taki && hm.taki !== '—' ? hm.taki : (horse?.taki || '');
            },
            getKosuValue(k) {
                return k?.taki || '';
            },
            match(a, b) {
                const ta = KosuDimensionStatsEngine.takiTokens(a);
                const tb = KosuDimensionStatsEngine.takiTokens(b);
                if (!tb.length || !ta.length) return false;
                return tb.every(t => ta.includes(t));
            },
            abbrev(v) {
                const s = String(v || '').trim();
                if (!s || s === '—') return '—';
                if (s.length <= 10) return s;
                return s.slice(0, 8) + '…';
            }
        },
        pist: {
            label: 'PİST',
            pctLabel: 'PİST%',
            matchLabel: 'P-KOŞU',
            formLabel: 'P-FORM',
            adjLabel: 'P+',
            note: 'Hedef pist (Kum/Çim/Sentetik) geçmiş koşulardaki pist/pist_kosu ile eşleşir.',
            targetFrom: 'race',
            getTarget(_horse, race) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.normalizePist(race?.pist) || AtMetaFields.val(race, 'pist', '');
                }
                return race?.pist || '';
            },
            getKosuValue(k) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.normalizePist(k?.pist || k?.pist_kosu)
                        || AtMetaFields.val(k, 'pist', '');
                }
                return k?.pist || k?.pist_kosu || '';
            },
            match(a, b) {
                if (typeof AtMetaFields !== 'undefined') {
                    return AtMetaFields.pistMatch(a, b);
                }
                const x = String(a || '').trim().toLocaleLowerCase('tr-TR');
                const y = String(b || '').trim().toLocaleLowerCase('tr-TR');
                return !!x && !!y && x === y;
            },
            abbrev(v) {
                const s = String(v || '').trim();
                return s && s !== '—' ? s.slice(0, 4) : '—';
            }
        },
        hp: {
            label: 'HP',
            pctLabel: 'HP%',
            matchLabel: 'HP-KOŞU',
            formLabel: 'HP-FORM',
            adjLabel: 'HP+',
            note: 'Hedef handikap puanı geçmiş koşulardaki hp ile eşleşir.',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                return hm.hp && hm.hp !== '—' ? hm.hp : (horse?.hp || '');
            },
            getKosuValue(k) {
                return k?.hp || '';
            },
            match(a, b) {
                return KosuDimensionStatsEngine.numMatch(a, b);
            },
            abbrev(v) {
                const n = KosuDimensionStatsEngine.parseNum(v);
                return n != null ? String(n) : '—';
            }
        },
        siklet: {
            label: 'SİKLET',
            pctLabel: 'SK%',
            matchLabel: 'SK-KOŞU',
            formLabel: 'SK-FORM',
            adjLabel: 'SK+',
            note: 'Hedef sıklet geçmiş koşulardaki sıklet ile eşleşir. TJK 58,5→59 kg gösterim; '
                + '±0,5 kg tolerans (59,5–60,5 arası 60 sayılır).',
            targetFrom: 'horse',
            getTarget(horse, _race) {
                const hm = typeof AtMetaFields !== 'undefined'
                    ? AtMetaFields.extractHorseMeta(horse)
                    : horse || {};
                const raw = hm.siklet && hm.siklet !== '—' ? hm.siklet : (horse?.siklet || '');
                const n = KosuDimensionStatsEngine.parseSiklet(raw);
                return n != null ? String(n) : raw;
            },
            getKosuValue(k) {
                const n = KosuDimensionStatsEngine.parseSiklet(k?.siklet);
                return n != null ? String(n) : (k?.siklet || '');
            },
            match(a, b) {
                return KosuDimensionStatsEngine.sikletMatch(a, b);
            },
            abbrev(v) {
                const n = KosuDimensionStatsEngine.parseSiklet(v);
                return n != null ? String(n) : '—';
            }
        }
    },

    normalizeText(s) {
        if (!s || s === '—' || s === '-') return '';
        return String(s).replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    },

    takiTokens(s) {
        return String(s || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(t => t.toLocaleUpperCase('tr-TR'));
    },

    parseNum(v) {
        if (v == null || v === '' || v === '-' || v === '—') return null;
        const n = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    },

    /** Ham kg — ondalık korunur (58,5 → 58.5) */
    parseSikletRaw(v) {
        if (v == null || v === '' || v === '-' || v === '—') return null;
        const s = String(v).replace(/\s+/g, ' ').trim();
        const plus = s.match(/^(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)$/);
        if (plus) {
            const base = parseFloat(plus[1].replace(',', '.'));
            const adj = parseFloat(plus[2].replace(',', '.'));
            if (!isNaN(base) && !isNaN(adj)) return base + adj;
        }
        const plain = s.match(/^(\d+(?:[.,]\d+)?)$/);
        if (plain) {
            let n = parseFloat(plain[1].replace(',', '.'));
            if (isNaN(n)) return null;
            if (Number.isInteger(n) && n >= 520 && n < 700) {
                const base = Math.floor(n / 10);
                const adj = n % 10;
                if (base >= 48 && base <= 66 && adj <= 4) return base + adj;
            }
            return n;
        }
        const first = s.match(/(\d+(?:[.,]\d+)?)/);
        if (first) {
            const n = parseFloat(first[1].replace(',', '.'));
            return isNaN(n) ? null : n;
        }
        return null;
    },

    /** TJK gösterim kg — tam sayı (58,5→59 · 59,5→60 · 60,5→61) */
    parseSiklet(v) {
        const raw = this.parseSikletRaw(v);
        return raw == null ? null : Math.round(raw);
    },

    /** ±0,5 kg — 59,5 ile 60,5 hedef 60 ile eşleşir */
    sikletMatch(a, b) {
        const ra = this.parseSikletRaw(a);
        const rb = this.parseSikletRaw(b);
        if (ra == null || rb == null) return false;
        return Math.abs(ra - rb) <= 0.5;
    },

    numMatch(a, b) {
        const na = this.parseNum(a);
        const nb = this.parseNum(b);
        if (na == null || nb == null) return false;
        return Math.abs(na - nb) < 0.01;
    },

    getDim(key) {
        return this.DIMENSIONS[key] || null;
    },

    hasValue(v) {
        if (v == null || v === '' || v === '-' || v === '—') return false;
        return true;
    },

    /** Kayıt/program tarihi — FieldSizeStatsEngine ile paylaşımlı normalizasyon */
    normalizeProgramTarih(tarih) {
        if (typeof FieldSizeStatsEngine !== 'undefined' && FieldSizeStatsEngine.normalizeProgramTarih) {
            return FieldSizeStatsEngine.normalizeProgramTarih(tarih);
        }
        if (!tarih) return '';
        return String(tarih).trim().replace(/\//g, '.');
    },

    filterKosularForCalc(kosular, programTarih) {
        if (typeof FieldSizeStatsEngine !== 'undefined' && FieldSizeStatsEngine.filterKosularForCalc) {
            return FieldSizeStatsEngine.filterKosularForCalc(kosular, programTarih);
        }
        if (!programTarih || !kosular?.length) return kosular || [];
        const programNorm = this.normalizeProgramTarih(programTarih);
        if (!programNorm) return kosular || [];
        return kosular.filter(k => this.normalizeProgramTarih(k.tarih) !== programNorm);
    },

    validRaces(kosular, dimKey) {
        const dim = this.getDim(dimKey);
        if (!dim) return [];
        return (kosular || []).filter(k => this.hasValue(dim.getKosuValue(k)));
    },

    matchedRaces(kosular, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        if (!dim || !this.hasValue(hedef)) return [];
        return this.validRaces(kosular, dimKey).filter(k => {
            const left = dimKey === 'siklet' ? (k?.siklet || '') : dim.getKosuValue(k);
            return dim.match(left, hedef);
        });
    },

    _computeStatsCore(kosular, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        const empty = {
            hedef: hedef || '—',
            kosuSayisi: 0,
            matchCount: 0,
            matchPct: null,
            max1: null, max12: null, max123: null, max1234: null,
            cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0,
            matchKosuSayisi: 0,
            gecmisMatchStr: '—',
            gecmisValStr: '—',
            missing: 0,
            atSayisiMissing: 0,
            fieldSizeMissingOnMatch: 0
        };
        if (!dim) return empty;

        const all = kosular || [];
        const races = this.validRaces(all, dimKey);
        const matched = this.matchedRaces(all, dimKey, hedef);
        const gecmisMatch = [];
        const gecmisVal = [];
        for (const k of races) {
            const rawVal = dimKey === 'siklet' ? (k?.siklet || '') : dim.getKosuValue(k);
            gecmisMatch.push(dim.match(rawVal, hedef) ? '✓' : '·');
            gecmisVal.push(dim.abbrev(rawVal));
        }
        const matchPct = races.length
            ? Math.round(100 * matched.length / races.length)
            : null;
        const placement = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine._computeStatsCore(matched)
            : {
                kosuSayisi: 0, max1: null, max12: null, max123: null, max1234: null,
                cnt1: 0, cnt12: 0, cnt123: 0, cnt1234: 0
            };
        const parseSira = typeof FieldSizeStatsEngine !== 'undefined'
            ? k => FieldSizeStatsEngine.parseSira(k.sira)
            : k => {
                const n = parseInt(String(k?.sira || '').replace(/[^\d]/g, ''), 10);
                return isNaN(n) || n < 1 ? null : n;
            };
        const matchedWithSira = matched.filter(k => parseSira(k) != null);
        const matchedWithFs = matched.filter(k => Number(k.at_sayisi) > 0 && parseSira(k) != null);
        const atSayisiMissing = races.filter(k => !(Number(k.at_sayisi) > 0)).length;
        return {
            hedef: hedef || '—',
            hedefAbbrev: dim.abbrev(hedef),
            kosuSayisi: races.length,
            matchCount: matched.length,
            matchPct,
            max1: placement.max1,
            max12: placement.max12,
            max123: placement.max123,
            max1234: placement.max1234,
            cnt1: placement.cnt1,
            cnt2: placement.cnt2 ?? 0,
            cnt3: placement.cnt3 ?? 0,
            cnt4: placement.cnt4 ?? 0,
            cnt12: placement.cnt12,
            cnt123: placement.cnt123,
            cnt1234: placement.cnt1234,
            matchKosuSayisi: placement.kosuSayisi,
            gecmisMatchStr: gecmisMatch.length ? gecmisMatch.join('→') : '—',
            gecmisValStr: gecmisVal.length ? gecmisVal.join('→') : '—',
            missing: all.length - races.length,
            atSayisiMissing,
            fieldSizeMissingOnMatch: Math.max(0, matchedWithSira.length - matchedWithFs.length)
        };
    },

    computeStats(kosular, dimKey, hedef, programTarih) {
        const dim = this.getDim(dimKey);
        const calcKosular = programTarih
            ? this.filterKosularForCalc(kosular, programTarih)
            : (kosular || []);
        if (!dim) return this._computeStatsCore(calcKosular, dimKey, hedef);

        const base = this._computeStatsCore(calcKosular, dimKey, hedef);
        const windows = {};
        const recentWindows = typeof FieldSizeStatsEngine !== 'undefined'
            ? FieldSizeStatsEngine.RECENT_WINDOWS
            : [5, 4, 3, 2, 1];
        for (const w of recentWindows) {
            const sliced = typeof FieldSizeStatsEngine !== 'undefined'
                ? FieldSizeStatsEngine.recentSlice(calcKosular, w)
                : calcKosular.slice(0, w);
            windows[w] = this._computeStatsCore(sliced, dimKey, hedef);
        }

        const formTrend = this.computeRecentFormTrend(calcKosular, dimKey, hedef);
        const dimAdj = this.computeAdjustedDimScore(base.matchPct, formTrend, calcKosular, dimKey, hedef);
        const genBlock = this._computeGeneralBlock(calcKosular, dimKey, hedef);
        const full = Object.assign(base, { windows, formTrend, dimAdj }, genBlock);
        full.basSuccess = this.computeBasSuccessScore(full);
        return full;
    },

    formatCell(v) {
        return v != null && v !== '' ? String(v) : '—';
    },

    formatPct(pct) {
        return pct != null ? '%' + pct : '—';
    },

    _placementScore(sira) {
        if (typeof SehirStatsEngine !== 'undefined') {
            return SehirStatsEngine.placementScore(sira);
        }
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        const n = FSE ? FSE.parseSira(sira) : parseInt(String(sira || '').replace(/[^\d]/g, ''), 10);
        if (n == null || n < 1 || isNaN(n)) return null;
        if (n === 1) return 100;
        if (n === 2) return 88;
        if (n === 3) return 76;
        if (n === 4) return 64;
        return Math.max(12, 64 - (n - 4) * 7);
    },

    _weightedSlope(points) {
        if (typeof SehirStatsEngine !== 'undefined') {
            return SehirStatsEngine._weightedSlope(points);
        }
        let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            sw += p.w;
            sx += p.w * p.x;
            sy += p.w * p.y;
            sxx += p.w * p.x * p.x;
            sxy += p.w * p.x * p.y;
        }
        const denom = sw * sxx - sx * sx;
        return denom ? (sw * sxy - sx * sy) / denom : null;
    },

    _raceMatchesDim(k, dimKey, hedef) {
        const dim = this.getDim(dimKey);
        if (!dim || !this.hasValue(hedef)) return false;
        const rawVal = dimKey === 'siklet' ? (k?.siklet || '') : dim.getKosuValue(k);
        return dim.match(rawVal, hedef);
    },

    _avgPlacementFromCounts(c1, c2, c3, c4, n) {
        const total = Number(n) || 0;
        if (!total) return 0;
        const pts = (Number(c1) || 0) * 100
            + (Number(c2) || 0) * 88
            + (Number(c3) || 0) * 76
            + (Number(c4) || 0) * 64;
        return Math.round(pts / total);
    },

    _effectiveFormPct(formTrend, basePct, missingMin) {
        if (formTrend?.pct != null) return formTrend.pct;
        const base = basePct != null ? basePct : 0;
        return Math.max(0, 50 - Math.round(Math.max(missingMin, base * 0.18)));
    },

    /** Son 5 koşuda hedef boyutta performans momentumu (0–100, 50=nötr). */
    computeRecentFormTrend(calcKosular, dimKey, hedef, opts) {
        const dim = this.getDim(dimKey);
        const allScope = !!(opts && opts.allScope);
        const formLabel = allScope ? 'G-FORM' : (dim?.formLabel || 'FORM');
        const empty = {
            pct: null,
            display: '—',
            delta: null,
            slope: null,
            rising: false,
            falling: false,
            tooltip: allScope
                ? 'Son 5 koşuda (tüm geçerli) en az 2 dereceli koşu gerekir'
                : 'Son 5 koşuda hedef boyutta en az 2 dereceli koşu gerekir',
            matchSamples: 0
        };
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        if (!FSE || !dim || (!allScope && !this.hasValue(hedef))) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const minSamples = (opts && opts.minSamples != null) ? opts.minSamples : 2;
        const recent = FSE.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const samples = [];
        const tipLines = allScope
            ? ['Son ' + windowSize + ' koşu · tüm geçerli ' + dim.label]
            : ['Son ' + windowSize + ' koşu · hedef: ' + dim.abbrev(hedef)];

        for (let xi = 0; xi < chronological.length; xi++) {
            const k = chronological[xi];
            const dimVal = dimKey === 'siklet' ? (k?.siklet || '') : dim.getKosuValue(k);
            if (!this.hasValue(dimVal)) continue;
            const matched = allScope || this._raceMatchesDim(k, dimKey, hedef);
            if (!allScope && !matched) {
                tipLines.push((k.tarih || '?') + ': ' + dim.abbrev(dimVal) + ' (hedef dışı)');
                continue;
            }
            const sira = FSE.parseSira(k.sira);
            const score = this._placementScore(sira);
            if (score == null) {
                tipLines.push((k.tarih || '?') + ': ' + dim.abbrev(dimVal) + ' · sıra yok');
                continue;
            }
            const w = Math.pow(xi + 1, 1.6);
            samples.push({ x: xi, y: score, w, sira, tarih: k.tarih, val: dimVal });
            tipLines.push((k.tarih || '?') + ': ' + dim.abbrev(dimVal) + ' · ' + sira + '. → puan ' + score);
        }

        if (samples.length < minSamples) {
            return Object.assign({}, empty, {
                tooltip: allScope
                    ? ('S' + windowSize + ' penceresinde ≥' + minSamples + ' dereceli koşu yok')
                    : ('S' + windowSize + ' penceresinde hedef boyutta ≥' + minSamples + ' dereceli koşu yok'),
                matchSamples: samples.length
            });
        }

        let slope = this._weightedSlope(samples);
        if (slope == null && samples.length >= 2) {
            const a = samples[samples.length - 2];
            const b = samples[samples.length - 1];
            slope = (b.y - a.y) / Math.max(1, b.x - a.x);
        }

        const last = samples[samples.length - 1];
        const prev = samples.length >= 2 ? samples[samples.length - 2] : null;
        const stepDelta = prev ? last.y - prev.y : null;

        let olderW = 0, olderS = 0, newerW = 0, newerS = 0;
        const half = Math.floor(samples.length / 2);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            if (i < half) { olderW += s.w; olderS += s.y * s.w; }
            else { newerW += s.w; newerS += s.y * s.w; }
        }
        const avgOlder = olderW ? olderS / olderW : null;
        const avgNewer = newerW ? newerS / newerW : null;
        const halfDelta = (avgOlder != null && avgNewer != null) ? avgNewer - avgOlder : null;

        const blendDelta = (slope != null ? slope * (windowSize - 1) : 0) * 0.55
            + (halfDelta != null ? halfDelta : 0) * 0.45
            + (stepDelta != null ? stepDelta : 0) * 0.25;
        const pct = Math.round(Math.min(100, Math.max(0, 50 + blendDelta * 1.15)));

        tipLines.push(formLabel + ': %' + pct + ' (50=nötr · yüksek=iyileşme)');

        return {
            pct,
            display: '%' + pct,
            delta: halfDelta != null ? Math.round(halfDelta) : null,
            slope: slope != null ? Math.round(slope * 10) / 10 : null,
            rising: pct >= 58,
            falling: pct <= 42,
            tooltip: tipLines.join('\n'),
            matchSamples: samples.length,
            samples
        };
    },

    computeRecencyPlacementBonus(calcKosular, dimKey, hedef, opts) {
        const allScope = !!(opts && opts.allScope) || (opts && opts.placeScope === 'all');
        const empty = { total: 0, parts: [], races: [] };
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        const dim = this.getDim(dimKey);
        if (!FSE || !dim || (!allScope && !this.hasValue(hedef))) return empty;

        const windowSize = (opts && opts.windowSize != null) ? opts.windowSize : 5;
        const siraPoints = { 1: 10, 2: 6, 3: 4, 4: 2 };
        const recent = FSE.recentSlice(calcKosular || [], windowSize);
        if (!recent.length) return empty;

        const chronological = [...recent].reverse();
        const n = chronological.length;
        let total = 0;
        const parts = [];
        const races = [];

        for (let i = 0; i < n; i++) {
            const k = chronological[i];
            const recency = n <= 1 ? 1 : 0.35 + 0.65 * (i / (n - 1));
            const dimVal = dimKey === 'siklet' ? (k?.siklet || '') : dim.getKosuValue(k);
            if (!allScope && !this._raceMatchesDim(k, dimKey, hedef)) {
                const pen = -Math.round(2 * recency);
                total += pen;
                parts.push({ tarih: k.tarih, sira: null, recency, delta: pen, note: 'hedef dışı' });
                races.push({ tarih: k.tarih, sira: null, recency, delta: pen });
                continue;
            }
            if (!this.hasValue(dimVal)) continue;
            const sira = FSE.parseSira(k.sira);
            if (sira == null) continue;
            let pts = siraPoints[sira] != null ? siraPoints[sira] : (sira <= 8 ? 0 : -3);
            const delta = Math.round(pts * recency * 10) / 10;
            total += delta;
            const note = dim.abbrev(dimVal) + ' ' + sira + '.';
            parts.push({ tarih: k.tarih, sira, recency, delta, note });
            races.push({ tarih: k.tarih, sira, recency, delta });
        }

        return { total: Math.round(total * 10) / 10, parts, races };
    },

    computeLastRaceMatchAdj(calcKosular, dimKey, hedef, opts) {
        const empty = {
            delta: 0, lastVal: null, lastTarih: null, inTarget: null,
            display: '—', tooltip: 'Son koşu bilgisi yok'
        };
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        const dim = this.getDim(dimKey);
        if (!FSE || !dim || !this.hasValue(hedef)) return empty;

        const bonus = (opts && opts.lastMatchBonus != null) ? opts.lastMatchBonus : 8;
        const penalty = (opts && opts.lastMatchPenalty != null) ? opts.lastMatchPenalty : -10;

        const recent = FSE.recentSlice(calcKosular || [], 1);
        const last = recent[0];
        if (!last) return empty;
        const dimVal = dimKey === 'siklet' ? (last?.siklet || '') : dim.getKosuValue(last);
        if (!this.hasValue(dimVal)) return empty;

        const inTarget = this._raceMatchesDim(last, dimKey, hedef);
        const delta = inTarget ? bonus : penalty;

        return {
            delta,
            lastVal: dimVal,
            lastTarih: last.tarih || null,
            inTarget,
            display: (delta >= 0 ? '+' : '') + delta,
            tooltip: inTarget
                ? ('Son koşu ' + (last.tarih || '?') + ' ' + dim.abbrev(dimVal)
                    + ' = hedef ' + dim.abbrev(hedef) + ' → süreklilik ödülü +' + bonus)
                : ('Son koşu ' + (last.tarih || '?') + ' ' + dim.abbrev(dimVal)
                    + ' ≠ hedef ' + dim.abbrev(hedef) + ' → değişim cezası ' + penalty)
        };
    },

    computeAdjustedDimScore(matchPct, formTrend, calcKosular, dimKey, hedef, opts) {
        const dim = this.getDim(dimKey);
        const base = matchPct != null ? matchPct : 0;
        const formScale = (opts && opts.formScale != null) ? opts.formScale : 0.35;
        const missingFormRatio = (opts && opts.missingFormRatio != null) ? opts.missingFormRatio : 0.18;
        const missingFormMin = (opts && opts.missingFormMin != null) ? opts.missingFormMin : 8;
        const maxPct = (opts && opts.maxPct != null) ? opts.maxPct : 130;
        const scoreLabel = (opts && opts.scoreLabel) || (dim?.adjLabel || 'DIM+');
        const baseLabel = (opts && opts.baseLabel) || (dim?.pctLabel || 'MATCH%');
        const formLabel = (opts && opts.formLabel) || (dim?.formLabel || 'FORM');
        const placeScope = (opts && opts.placeScope) || 'matched';
        const placeOpts = Object.assign({}, opts, {
            allScope: placeScope === 'all',
            placeScope
        });

        let formAdj = 0;
        const tipLines = [scoreLabel + ' = ' + baseLabel + ' + form + son koşu + S5 derece'];
        tipLines.push('Taban ' + baseLabel + ': %' + base);

        const formPct = formTrend?.pct;
        if (formPct == null) {
            formAdj = -Math.round(Math.max(missingFormMin, base * missingFormRatio));
            tipLines.push(formLabel + ' yok → ceza: ' + formAdj + ' puan');
        } else {
            formAdj = Math.round((formPct - 50) * formScale);
            tipLines.push(formLabel + ' %' + formPct + ' → ' + (formAdj >= 0 ? '+' : '') + formAdj);
        }

        const lastMatch = this.computeLastRaceMatchAdj(calcKosular, dimKey, hedef, opts);
        const lastMatchAdj = lastMatch.delta || 0;
        if (lastMatch.inTarget != null) {
            tipLines.push('Son koşu: ' + (lastMatchAdj >= 0 ? '+' : '') + lastMatchAdj
                + ' (' + lastMatch.tooltip + ')');
        }

        const place = this.computeRecencyPlacementBonus(calcKosular, dimKey, hedef, placeOpts);
        const placeAdj = Math.round(place.total);
        const scopeLabel = placeScope === 'all' ? 'tüm geçerli koşular' : 'hedef boyut';
        if (place.races.length) {
            tipLines.push('S5 derece (' + scopeLabel + '): ' + (placeAdj >= 0 ? '+' : '') + placeAdj);
        }

        const raw = base + formAdj + lastMatchAdj + placeAdj;
        const pct = Math.round(Math.min(maxPct, Math.max(0, raw)));

        tipLines.push('Toplam: %' + pct);

        return {
            pct,
            display: '%' + pct,
            base,
            formAdj,
            lastMatchAdj,
            lastMatch,
            placeAdj,
            totalAdj: formAdj + lastMatchAdj + placeAdj,
            boosted: pct > base + 2,
            penalized: pct < base - 2,
            tooltip: tipLines.join('\n')
        };
    },

    computeGeneralBasePct(calcKosular, dimKey) {
        const races = this.validRaces(calcKosular, dimKey);
        if (!races.length) return null;
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < races.length; i++) {
            const sira = FSE ? FSE.parseSira(races[i].sira) : null;
            const sc = this._placementScore(sira);
            if (sc != null) { sum += sc; n++; }
        }
        return n ? Math.round(sum / n) : null;
    },

    _computeGeneralBlock(calcKosular, dimKey, hedef) {
        const FSE = typeof FieldSizeStatsEngine !== 'undefined' ? FieldSizeStatsEngine : null;
        const genRaces = this.validRaces(calcKosular, dimKey);
        const genPlacement = FSE
            ? FSE._computeStatsCore(genRaces)
            : { cnt1: 0, cnt2: 0, cnt3: 0, cnt4: 0, kosuSayisi: 0 };
        const genBasePct = this.computeGeneralBasePct(calcKosular, dimKey);
        const genForm = this.computeRecentFormTrend(calcKosular, dimKey, hedef, { allScope: true });
        const genAdj = this.computeAdjustedDimScore(genBasePct, genForm, calcKosular, dimKey, hedef, {
            scoreLabel: 'GEN+',
            baseLabel: 'GEN%',
            formLabel: 'G-FORM',
            placeScope: 'all',
            missingFormMin: 6
        });
        return {
            genBasePct,
            genCnt1: genPlacement.cnt1,
            genCnt2: genPlacement.cnt2,
            genCnt3: genPlacement.cnt3,
            genCnt4: genPlacement.cnt4,
            genForm,
            genAdj
        };
    },

    computeBasSuccessScore(st) {
        const empty = {
            pct: null, display: '—', matchTrust: 0,
            matchBlock: null, genBlock: null, tooltip: 'Geçmiş koşu yok'
        };
        const total = st?.kosuSayisi || 0;
        const matched = st?.matchCount || 0;
        if (!total) return empty;

        const windowCap = Math.min(6, total);
        const matchTrust = matched === 0
            ? 0
            : Math.round(Math.min(1, 0.12 + 0.88 * (matched / windowCap)) * 1000) / 1000;

        const matchPlace = this._avgPlacementFromCounts(st.cnt1, st.cnt2, st.cnt3, st.cnt4, matched);
        const genPlace = this._avgPlacementFromCounts(
            st.genCnt1, st.genCnt2, st.genCnt3, st.genCnt4, total);

        const dimPlus = st.dimAdj?.pct ?? st.matchPct ?? 0;
        const genPlus = st.genAdj?.pct ?? st.genBasePct ?? 0;
        const matchPct = st.matchPct ?? 0;
        const genPct = st.genBasePct ?? 0;
        const dimForm = this._effectiveFormPct(st.formTrend, matchPct, 8);
        const genForm = this._effectiveFormPct(st.genForm, genPct, 6);

        const W = { plus: 0.55, place: 0.20, base: 0.10, form: 0.15 };
        const matchBlock = dimPlus * W.plus + matchPlace * W.place + matchPct * W.base + dimForm * W.form;
        const genBlock = genPlus * W.plus + genPlace * W.place + genPct * W.base + genForm * W.form;
        const raw = matchTrust * matchBlock + (1 - matchTrust) * genBlock;
        const pct = Math.round(Math.min(130, Math.max(0, raw)));

        const tipLines = [
            'BAŞ+ = hedef boyut + genel blok karışımı',
            'Boyut güveni %' + Math.round(matchTrust * 100) + ' (' + matched + '/' + windowCap + ' eşleşen, max 6)',
            'Boyut blok → ' + Math.round(matchBlock) + ' · Genel blok → ' + Math.round(genBlock),
            'Sonuç: %' + pct
        ];

        return {
            pct,
            display: '%' + pct,
            matchTrust,
            matchBlock: Math.round(matchBlock),
            genBlock: Math.round(genBlock),
            boosted: pct >= 85,
            penalized: pct <= 25,
            tooltip: tipLines.join('\n')
        };
    },

    /**
     * Son N koşu penceresinde başarı (matchPct) TÜM'e göre artıyor mu
     * @returns {{ delta, rising, display, windowPct, tumPct, artifact }}
     */
    computeWindowRise(st, windowSize, opts) {
        const minMatch = (opts && opts.minMatchCount != null) ? opts.minMatchCount : 2;
        const minDelta = (opts && opts.minDelta != null) ? opts.minDelta : 5;
        const empty = {
            delta: null, rising: false, display: '—',
            windowPct: null, tumPct: st?.matchPct ?? null, artifact: false
        };
        if (!st || st.kosuSayisi <= 0) return empty;
        const wst = st.windows?.[windowSize];
        if (!wst || wst.kosuSayisi <= 0) return empty;
        if (st.matchCount < minMatch) {
            return Object.assign({}, empty, { artifact: true, windowPct: wst.matchPct });
        }
        if (st.matchPct == null || wst.matchPct == null) return empty;
        const delta = wst.matchPct - st.matchPct;
        const rising = delta >= minDelta;
        return {
            delta,
            rising,
            display: rising ? ('+' + delta + '%') : '—',
            windowPct: wst.matchPct,
            tumPct: st.matchPct,
            artifact: false
        };
    }
};

if (typeof globalThis !== 'undefined') globalThis.KosuDimensionStatsEngine = KosuDimensionStatsEngine;
if (typeof module !== 'undefined') module.exports = { KosuDimensionStatsEngine };
