/* 88ATSPEED - Gerçek sonuç karşılaştırma ve arşiv motoru */
const SonucEngine = {
  ARCHIVE_KEY: '88atspeed-sonuc-arsivi',
  GERCEK_PREFIX: '88atspeed-gercek-sonuc-',

  normalizeHorseName(name) {
    return String(name || '')
      .trim()
      .toUpperCase()
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\s+/g, ' ');
  },

  namesEqual(a, b) {
    const na = this.normalizeHorseName(a);
    const nb = this.normalizeHorseName(b);
    return !!(na && nb && na === nb);
  },

  /** Sıra listesinden isim → sıra haritası */
  _nameToSiraMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const n = this.normalizeHorseName(row.name);
      if (n) map.set(n, row.sira);
    }
    return map;
  },

  /** Tek koşu karşılaştırması */
  compareRace(tahminRows, gercekRows, detayMeta) {
    const tahmin = tahminRows || [];
    const gercek = gercekRows || [];
    const filledGercek = gercek.filter(r => this.normalizeHorseName(r.name));
    const filledTahmin = tahmin.filter(r => this.normalizeHorseName(r.name));

    if (!filledGercek.length) {
      return {
        hasGercek: false,
        exactMatches: 0,
        totalCompared: 0,
        exactPct: null,
        birinciDogru: null,
        top3Hits: null,
        top3Total: null,
        top3Pct: null,
        ortalamaSiraFarki: null,
        basariPuani: null,
        pozisyonlar: []
      };
    }

    const gercekBySira = new Map(gercek.map(r => [r.sira, r.name]));
    const tahminBySira = new Map(tahmin.map(r => [r.sira, r.name]));
    const gercekNameToSira = this._nameToSiraMap(gercek);
    const pozisyonlar = [];
    let exactMatches = 0;
    let siraFarkToplam = 0;
    let siraFarkSayisi = 0;

    const maxSira = Math.max(
      ...tahmin.map(r => r.sira),
      ...gercek.map(r => r.sira),
      0
    );

    for (let s = 1; s <= maxSira; s++) {
      const tName = tahminBySira.get(s) || '';
      const gName = gercekBySira.get(s) || '';
      const tNorm = this.normalizeHorseName(tName);
      const gNorm = this.normalizeHorseName(gName);
      const exact = !!(tNorm && gNorm && tNorm === gNorm);
      if (exact) exactMatches++;

      let tahminGercekSira = null;
      let gercekTahminSira = null;
      if (tNorm && gercekNameToSira.has(tNorm)) {
        tahminGercekSira = gercekNameToSira.get(tNorm);
        siraFarkToplam += Math.abs(s - tahminGercekSira);
        siraFarkSayisi++;
      }
      const gercekNameToSiraFromTahmin = this._nameToSiraMap(tahmin);
      if (gNorm && gercekNameToSiraFromTahmin.has(gNorm)) {
        gercekTahminSira = gercekNameToSiraFromTahmin.get(gNorm);
      }

      const meta = detayMeta?.[s - 1];
      pozisyonlar.push({
        sira: s,
        tahmin: tName,
        gercek: gName,
        exact,
        ruleId: meta?.ruleId || null,
        score: meta?.score ?? null,
        tahminGercekSira,
        gercekTahminSira
      });
    }

    const totalCompared = pozisyonlar.filter(p =>
      this.normalizeHorseName(p.tahmin) && this.normalizeHorseName(p.gercek)
    ).length;

    const birinciDogru = this.namesEqual(tahminBySira.get(1), gercekBySira.get(1));

    const tahminTop3 = tahmin.filter(r => r.sira <= 3).map(r => this.normalizeHorseName(r.name)).filter(Boolean);
    const gercekTop3 = gercek.filter(r => r.sira <= 3).map(r => this.normalizeHorseName(r.name)).filter(Boolean);
    const gercekTop3Set = new Set(gercekTop3);
    const top3Hits = tahminTop3.filter(n => gercekTop3Set.has(n)).length;
    const top3Total = Math.min(3, tahminTop3.length, gercekTop3.length);

    const exactPct = totalCompared ? Math.round((exactMatches / totalCompared) * 100) : 0;
    const top3Pct = top3Total ? Math.round((top3Hits / top3Total) * 100) : 0;
    const ortalamaSiraFarki = siraFarkSayisi
      ? Math.round((siraFarkToplam / siraFarkSayisi) * 10) / 10
      : null;

    // Ağırlıklı başarı: 1. sıra %40, top3 %35, tam eşleşme %25
    const birinciSkor = birinciDogru ? 100 : 0;
    const basariPuani = Math.round(
      birinciSkor * 0.4 + top3Pct * 0.35 + exactPct * 0.25
    );

    return {
      hasGercek: true,
      exactMatches,
      totalCompared,
      exactPct,
      birinciDogru,
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
      if (raceResult.birinciDogru !== null) {
        birinciToplam++;
        if (raceResult.birinciDogru) birinciDogruSayisi++;
      }
      top3HitsToplam += raceResult.top3Hits || 0;
      top3TotalToplam += raceResult.top3Total || 0;
      basariPuaniToplam += raceResult.basariPuani;
      basariPuaniSayisi++;
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
    const mergedKosular = [];

    for (const entry of archive) {
      const b = entry.basari;
      if (!b) continue;
      kosuSayisi += b.kosuSayisi || 0;
      if (b.ortalamaBasari != null) basariToplam += b.ortalamaBasari;
      mergedKosular.push(...(b.kosular || []));
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
