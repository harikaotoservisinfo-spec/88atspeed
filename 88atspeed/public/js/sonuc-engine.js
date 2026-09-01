/* 88ATSPEED - Gerçek sonuç karşılaştırma ve arşiv motoru */
const SonucEngine = {
  ARCHIVE_KEY: '88atspeed-sonuc-arsivi',
  GERCEK_PREFIX: '88atspeed-gercek-sonuc-',

  _normalizeTr(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u');
  },

  /** Koşmayan / çekilen at girişi mi? */
  isKosmaz(raw) {
    const s = this._normalizeTr(raw);
    if (!s) return false;
    return /^(kosmaz|koşmaz|kosm|koşm|cekildi|çekildi|scratched|yok|diskalifiye|dq|nm)$/.test(s)
      || s === 'k osmaz'
      || /^kosmaz\b/.test(s)
      || /^koşmaz\b/.test(s);
  },

  /** Tüm sondaki (sayı) parantezlerini temizle */
  normalizeHorseName(name) {
    let s = String(name || '').trim().toUpperCase();
    let prev;
    do {
      prev = s;
      s = s.replace(/\s*\(\d+\)\s*$/, '');
    } while (s !== prev);
    return s.replace(/\s+/g, ' ');
  },

  namesEqual(a, b) {
    const na = this.normalizeHorseName(a);
    const nb = this.normalizeHorseName(b);
    return !!(na && nb && na === nb);
  },

  /**
   * Gerçek sonuç girişini ayrıştır.
   * Desteklenen formatlar:
   * - "koşmaz" → değerlendirme dışı
   * - "7" veya "(7)" → tahmin edilen atın gerçek sırası
   * - "AT ADI (no) (7)" → at adı + gerçek sıra
   * - "AT ADI" → bu sıradaki gerçek at (sıra listesi modu)
   */
  parseGercekInput(raw, rowSira, maxSira) {
    const s = String(raw || '').trim();
    if (!s) return null;

    if (this.isKosmaz(s)) {
      return { horseName: null, finishSira: null, inputMode: 'kosmaz' };
    }

    const onlyNum = s.match(/^\(?\s*(\d+)\s*\)?$/);
    if (onlyNum) {
      const finishSira = parseInt(onlyNum[1], 10);
      if (finishSira >= 1 && finishSira <= maxSira) {
        return { horseName: null, finishSira, inputMode: 'finish-only' };
      }
      return null;
    }

    const trailing = s.match(/\((\d+)\)\s*$/);
    if (!trailing) {
      return { horseName: s, finishSira: rowSira, inputMode: 'sira-list' };
    }

    const lastNum = parseInt(trailing[1], 10);
    const withoutLast = s.replace(/\s*\(\d+\)\s*$/, '').trim();
    const innerTrailing = withoutLast.match(/\((\d+)\)\s*$/);

    if (innerTrailing && lastNum >= 1 && lastNum <= maxSira) {
      const horseName = withoutLast.replace(/\s*\(\d+\)\s*$/, '').trim() || withoutLast;
      return { horseName, finishSira: lastNum, inputMode: 'horse-finish' };
    }

    return { horseName: s, finishSira: rowSira, inputMode: 'sira-list' };
  },

  /** Tahmin + gerçek satırlarından at → gerçek sıra haritası (koşmaz hariç) */
  _buildActualSiraMap(tahminRows, gercekRows, maxSira) {
    const map = new Map();
    const kosmazSet = new Set();
    const tahminBySira = new Map((tahminRows || []).map(r => [r.sira, r.name]));

    for (const row of gercekRows || []) {
      const raw = row.name;
      if (!String(raw || '').trim()) continue;

      const parsed = this.parseGercekInput(raw, row.sira, maxSira);
      if (!parsed) continue;

      if (parsed.inputMode === 'kosmaz') {
        const tahminName = tahminBySira.get(row.sira);
        const norm = this.normalizeHorseName(tahminName);
        if (norm) kosmazSet.add(norm);
        continue;
      }

      let horseName = parsed.horseName;
      if (!horseName && parsed.inputMode === 'finish-only') {
        horseName = tahminBySira.get(row.sira) || '';
      }

      const norm = this.normalizeHorseName(horseName);
      if (!norm) continue;

      if (parsed.finishSira >= 1 && parsed.finishSira <= maxSira) {
        map.set(norm, parsed.finishSira);
      }
    }

    return { map, kosmazSet };
  },

  /** Tek koşu karşılaştırması */
  compareRace(tahminRows, gercekRows, detayMeta) {
    const tahmin = tahminRows || [];
    const gercek = gercekRows || [];

    const maxSira = Math.max(
      ...tahmin.map(r => r.sira),
      ...gercek.map(r => r.sira),
      0
    );

    const { map: horseActualSira, kosmazSet } = this._buildActualSiraMap(tahmin, gercek, maxSira);
    const hasGercek = horseActualSira.size > 0 || kosmazSet.size > 0;

    if (!hasGercek) {
      return {
        hasGercek: false,
        exactMatches: 0,
        totalCompared: 0,
        kosmazSayisi: 0,
        exactPct: null,
        birinciDogru: null,
        birinciDegerlendirildi: false,
        top3Hits: null,
        top3Total: null,
        top3Pct: null,
        ortalamaSiraFarki: null,
        basariPuani: null,
        pozisyonlar: []
      };
    }

    const tahminBySira = new Map(tahmin.map(r => [r.sira, r.name]));
    const gercekBySira = new Map(gercek.map(r => [r.sira, r.name]));
    const pozisyonlar = [];
    let exactMatches = 0;
    let totalCompared = 0;
    let kosmazSayisi = 0;
    let siraFarkToplam = 0;
    let siraFarkSayisi = 0;

    for (let s = 1; s <= maxSira; s++) {
      const tName = tahminBySira.get(s) || '';
      const gName = gercekBySira.get(s) || '';
      const tNorm = this.normalizeHorseName(tName);
      const parsedG = this.parseGercekInput(gName, s, maxSira);
      const kosmaz = parsedG?.inputMode === 'kosmaz' || (tNorm && kosmazSet.has(tNorm));

      if (kosmaz) kosmazSayisi++;

      let tahminGercekSira = null;
      if (!kosmaz && tNorm && horseActualSira.has(tNorm)) {
        tahminGercekSira = horseActualSira.get(tNorm);
      }

      const degerlendirildi = !!(tNorm && !kosmaz && tahminGercekSira !== null);
      if (degerlendirildi) totalCompared++;

      const exact = degerlendirildi && tahminGercekSira === s;
      if (exact) exactMatches++;

      if (degerlendirildi) {
        siraFarkToplam += Math.abs(s - tahminGercekSira);
        siraFarkSayisi++;
      }

      const meta = detayMeta?.[s - 1];
      pozisyonlar.push({
        sira: s,
        tahmin: tName,
        gercek: gName,
        tahminGercekSira,
        kosmaz,
        degerlendirildi,
        exact,
        ruleId: meta?.ruleId || null,
        score: meta?.score ?? null
      });
    }

    const t1Norm = this.normalizeHorseName(tahminBySira.get(1));
    const t1Kosmaz = !!(t1Norm && kosmazSet.has(t1Norm));
    const birinciDegerlendirildi = !!(t1Norm && !t1Kosmaz && horseActualSira.has(t1Norm));
    const birinciDogru = birinciDegerlendirildi
      ? horseActualSira.get(t1Norm) === 1
      : null;

    let top3Hits = 0;
    let top3Total = 0;
    for (let s = 1; s <= Math.min(3, maxSira); s++) {
      const tNorm = this.normalizeHorseName(tahminBySira.get(s));
      if (!tNorm || kosmazSet.has(tNorm)) continue;
      const actual = horseActualSira.get(tNorm);
      if (actual === undefined) continue;
      top3Total++;
      if (actual <= 3) top3Hits++;
    }

    const exactPct = totalCompared ? Math.round((exactMatches / totalCompared) * 100) : 0;
    const top3Pct = top3Total ? Math.round((top3Hits / top3Total) * 100) : 0;
    const ortalamaSiraFarki = siraFarkSayisi
      ? Math.round((siraFarkToplam / siraFarkSayisi) * 10) / 10
      : null;

    const birinciSkor = birinciDogru === true ? 100 : (birinciDogru === false ? 0 : null);
    let basariPuani = null;
    if (totalCompared > 0) {
      const parts = [];
      const weights = [];
      if (birinciSkor !== null) {
        parts.push(birinciSkor);
        weights.push(0.4);
      }
      if (top3Total > 0) {
        parts.push(top3Pct);
        weights.push(0.35);
      }
      parts.push(exactPct);
      weights.push(0.25);
      const wSum = weights.reduce((a, b) => a + b, 0);
      basariPuani = Math.round(
        parts.reduce((sum, p, i) => sum + p * (weights[i] / wSum), 0)
      );
    }

    return {
      hasGercek: true,
      exactMatches,
      totalCompared,
      kosmazSayisi,
      exactPct,
      birinciDogru,
      birinciDegerlendirildi,
      top3Hits,
      top3Total,
      top3Pct,
      ortalamaSiraFarki,
      basariPuani,
      pozisyonlar
    };
  },

  computeKayitBasari(tahminler, gercekler, detay) {
    const raceIndices = new Set([
      ...Object.keys(tahminler || {}),
      ...Object.keys(gercekler || {})
    ]);

    const kosular = [];
    let toplamExact = 0;
    let toplamCompared = 0;
    let toplamKosmaz = 0;
    let birinciDogruSayisi = 0;
    let birinciToplam = 0;
    let top3HitsToplam = 0;
    let top3TotalToplam = 0;
    let basariPuaniToplam = 0;
    let basariPuaniSayisi = 0;

    for (const idx of raceIndices) {
      const raceResult = this.compareRace(
        tahminler?.[idx],
        gercekler?.[idx],
        detay?.[idx]
      );
      if (!raceResult.hasGercek) continue;

      kosular.push({ raceIndex: parseInt(idx, 10), ...raceResult });
      toplamExact += raceResult.exactMatches;
      toplamCompared += raceResult.totalCompared;
      toplamKosmaz += raceResult.kosmazSayisi || 0;
      if (raceResult.birinciDegerlendirildi) {
        birinciToplam++;
        if (raceResult.birinciDogru) birinciDogruSayisi++;
      }
      top3HitsToplam += raceResult.top3Hits || 0;
      top3TotalToplam += raceResult.top3Total || 0;
      if (raceResult.basariPuani != null) {
        basariPuaniToplam += raceResult.basariPuani;
        basariPuaniSayisi++;
      }
    }

    const exactPct = toplamCompared ? Math.round((toplamExact / toplamCompared) * 100) : null;
    const birinciPct = birinciToplam
      ? Math.round((birinciDogruSayisi / birinciToplam) * 100)
      : null;
    const top3Pct = top3TotalToplam
      ? Math.round((top3HitsToplam / top3TotalToplam) * 100)
      : null;
    const ortalamaBasari = basariPuaniSayisi
      ? Math.round(basariPuaniToplam / basariPuaniSayisi)
      : null;

    return {
      kosuSayisi: basariPuaniSayisi,
      toplamExact,
      toplamCompared,
      toplamKosmaz,
      exactPct,
      birinciDogruSayisi,
      birinciToplam,
      birinciPct,
      top3HitsToplam,
      top3TotalToplam,
      top3Pct,
      ortalamaBasari,
      kosular
    };
  },

  aggregateRuleStats(archive) {
    const stats = {};
    for (const entry of archive || []) {
      for (const kosu of entry.kosular || []) {
        for (const p of kosu.pozisyonlar || []) {
          if (p.kosmaz || !p.degerlendirildi) continue;
          if (!p.ruleId || !this.normalizeHorseName(p.tahmin)) continue;
          if (!stats[p.ruleId]) {
            stats[p.ruleId] = { total: 0, exact: 0, birinci: 0, birinciTotal: 0 };
          }
          stats[p.ruleId].total++;
          if (p.exact) stats[p.ruleId].exact++;
          if (p.sira === 1) {
            stats[p.ruleId].birinciTotal++;
            if (p.exact) stats[p.ruleId].birinci++;
          }
        }
      }
    }
    return Object.entries(stats)
      .map(([ruleId, s]) => ({
        ruleId,
        total: s.total,
        exact: s.exact,
        exactPct: s.total ? Math.round((s.exact / s.total) * 100) : 0,
        birinciTotal: s.birinciTotal,
        birinci: s.birinci,
        birinciPct: s.birinciTotal ? Math.round((s.birinci / s.birinciTotal) * 100) : 0
      }))
      .sort((a, b) => b.exactPct - a.exactPct || b.total - a.total);
  },

  gercekStorageKey(kayitId) {
    return kayitId ? this.GERCEK_PREFIX + kayitId : null;
  },

  loadGercekSonuc(kayitId) {
    const key = this.gercekStorageKey(kayitId);
    if (!key) return null;
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  },

  saveGercekSonuc(kayitId, gercekler) {
    const key = this.gercekStorageKey(kayitId);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(gercekler));
  },

  getArchive() {
    try {
      return JSON.parse(localStorage.getItem(this.ARCHIVE_KEY) || '[]');
    } catch (_) {
      return [];
    }
  },

  saveArchive(archive) {
    localStorage.setItem(this.ARCHIVE_KEY, JSON.stringify(archive));
  },

  buildArchiveEntry(kayitId, meta, tahminler, gercekler, detay) {
    const basari = this.computeKayitBasari(tahminler, gercekler, detay);
    return {
      id: 'arsiv-' + kayitId + '-' + Date.now(),
      kayitId,
      tarih: meta?.tarih || '',
      hipodrom: meta?.hipodrom || '',
      kaydedildi: new Date().toISOString(),
      tahminler,
      gercekler,
      detay,
      basari
    };
  },

  addToArchive(entry) {
    const archive = this.getArchive();
    const dupIdx = archive.findIndex(e => String(e.kayitId) === String(entry.kayitId));
    if (dupIdx >= 0) archive[dupIdx] = entry;
    else archive.unshift(entry);
    this.saveArchive(archive);
    return archive.length;
  },

  removeFromArchive(entryId) {
    const archive = this.getArchive().filter(e => e.id !== entryId);
    this.saveArchive(archive);
    return archive;
  },

  aggregateArchiveSummary(archive) {
    if (!archive?.length) {
      return { kayitSayisi: 0, kosuSayisi: 0, ortalamaBasari: null, ruleStats: [] };
    }
    let kosuSayisi = 0;
    let basariToplam = 0;

    for (const entry of archive) {
      const b = entry.basari;
      if (!b) continue;
      kosuSayisi += b.kosuSayisi || 0;
      if (b.ortalamaBasari != null) basariToplam += b.ortalamaBasari;
    }

    return {
      kayitSayisi: archive.length,
      kosuSayisi,
      ortalamaBasari: archive.length
        ? Math.round(basariToplam / archive.length)
        : null,
      ruleStats: this.aggregateRuleStats(archive)
    };
  }
};

if (typeof module !== 'undefined') module.exports = { SonucEngine };
