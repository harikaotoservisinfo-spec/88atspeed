/* 88ATSPEED - TAHMİNİM otomatik aktarma motoru */
const TahminEngine = {
  /** Öncelik sırası (1. sıra kuralı = hepsi) */
  CONDITION_KEYS: [
    'siraNoMavi',
    'atIsmiMavi',
    'tarihMavi',
    'sonKosuProgramSehir',
    'dahaOnceSehirMesafe',
    'sehirMesafeBirIki',
    'son800Top3',
    'test1EnIyi',
    'test123Kirmizi',
    'sonKosuYesilSatir',
    'test12Sari',
    'test9Vurgu'
  ],

  CONDITION_LABELS: {
    siraNoMavi: 'Sol SIRA mavi',
    atIsmiMavi: 'AT İSMİ mavi',
    tarihMavi: 'TARİH mavi',
    sonKosuProgramSehir: 'Son koşu program şehrinde',
    dahaOnceSehirMesafe: 'Şehir+mesafe geçmişi',
    sehirMesafeBirIki: 'Şehir+mesafede 1./2.',
    son800Top3: 'SON800-1 top 3',
    test1EnIyi: 'TEST1 en iyi',
    test123Kirmizi: 'TEST1/2/3 kırmızı',
    sonKosuYesilSatir: 'Son koşu yeşil satır',
    test12Sari: 'TEST1/2 sarı',
    test9Vurgu: 'TEST9 vurgulu'
  },

  _mesafeEslesme(mesafe, hedefMesafe) {
    const m = parseInt(String(mesafe || '').replace(/\D/g, ''), 10);
    return !isNaN(hedefMesafe) && hedefMesafe > 0 && !isNaN(m) && m === hedefMesafe;
  },

  _siraBirIki(sira) {
    const n = parseInt(String(sira || '').replace(/\D/g, ''), 10);
    return n === 1 || n === 2;
  },

  _computeBestTest1Horse(calcRace, hedefMesafe) {
    const GE = GosterimEngine;
    let bestJ = -1;
    let bestVal = Infinity;
    for (let j = 0; j < calcRace.horses.length; j++) {
      for (const atKosu of calcRace.horses[j].kosular || []) {
        const { test1 } = GE._computeTestSalise(atKosu, hedefMesafe);
        if (test1 !== null && test1 < bestVal) {
          bestVal = test1;
          bestJ = j;
        }
      }
    }
    return bestJ;
  },

  buildContext(race, options = {}) {
    const GE = GosterimEngine;
    const { calcRace, hedefMesafe, enIyiler, trends } = GE.buildEnIyilerBundle(race, options);
    return {
      calcRace,
      hedefMesafe,
      hipodromSehir: options.hipodromSehir || null,
      enIyiler,
      trends,
      bestTest1Horse: this._computeBestTest1Horse(calcRace, hedefMesafe)
    };
  },

  evaluateHorse(horseIndex, ctx) {
    const GE = GosterimEngine;
    const horse = ctx.calcRace.horses[horseIndex];
    const kosular = horse.kosular || [];
    const sonKosu = GE._sortKosularNewest(kosular)[0] || null;
    const { enIyiler, hedefMesafe, hipodromSehir, bestTest1Horse } = ctx;
    const kosuKey = (k) => GE._kosuKey(horseIndex, k);
    const sehirMesafe = (k) =>
      GE._sehirEslesme(k.sehir, hipodromSehir) && this._mesafeEslesme(k.mesafe, hedefMesafe);

    return {
      siraNoMavi: !!enIyiler.test12YakinAtlar?.has(horseIndex),
      atIsmiMavi: !!enIyiler.sifiraYakinAtlarSon7?.has(horseIndex),
      tarihMavi: !!enIyiler.sifiraYakinAtlarSon2?.has(horseIndex),
      sonKosuProgramSehir: !!(sonKosu && GE._sehirEslesme(sonKosu.sehir, hipodromSehir)),
      dahaOnceSehirMesafe: kosular.some(k => sehirMesafe(k)),
      sehirMesafeBirIki: kosular.some(k => sehirMesafe(k) && this._siraBirIki(k.sira)),
      son800Top3: kosular.some(k => enIyiler.enIyilerSon800_1?.has(kosuKey(k))),
      test1EnIyi: bestTest1Horse === horseIndex,
      test123Kirmizi: kosular.some(k => GE._computeKirmiziYazi(k, hedefMesafe)),
      sonKosuYesilSatir: !!(sonKosu && GE._isFosforYesilKosu(sonKosu, hedefMesafe)),
      test12Sari: kosular.some(k => enIyiler.enIyilerTest12Yakin?.has(kosuKey(k))),
      test9Vurgu: !!enIyiler.maviKenarTest9VurguAtlar?.has(horseIndex)
    };
  },

  _matchesRequired(cond, required) {
    return required.every(k => cond[k]);
  },

  _pickCandidate(candidates) {
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.test9Abs !== b.test9Abs) return a.test9Abs - b.test9Abs;
      const noA = parseInt(a.no, 10) || 999;
      const noB = parseInt(b.no, 10) || 999;
      return noA - noB;
    });
    return candidates[0];
  },

  buildRuleTiers() {
    const keys = this.CONDITION_KEYS;
    const tiers = [];

    tiers.push({
      id: 'K1',
      label: '1. sıra — tam eşleşme (12/12)',
      required: [...keys],
      siraOnly: 1
    });

    tiers.push({
      id: 'K1-8',
      label: '1. sıra — güçlü paket (8/12)',
      required: [
        'siraNoMavi', 'atIsmiMavi', 'tarihMavi', 'sonKosuProgramSehir',
        'dahaOnceSehirMesafe', 'test1EnIyi', 'test123Kirmizi', 'son800Top3'
      ],
      siraOnly: 1
    });

    tiers.push({
      id: 'K1-6',
      label: '1. sıra — mavi + TEST (6/12)',
      required: [
        'siraNoMavi', 'atIsmiMavi', 'tarihMavi',
        'test1EnIyi', 'test123Kirmizi', 'son800Top3'
      ],
      siraOnly: 1
    });

    for (let drop = 1; drop <= keys.length - 4; drop++) {
      tiers.push({
        id: 'K' + (drop + 1),
        label: (keys.length - drop) + '/12 koşul',
        required: keys.slice(0, keys.length - drop)
      });
    }

    tiers.push({
      id: 'K-SEHIR',
      label: 'Şehir + mesafe paketi',
      required: [
        'siraNoMavi', 'atIsmiMavi', 'tarihMavi',
        'sonKosuProgramSehir', 'dahaOnceSehirMesafe', 'sehirMesafeBirIki'
      ]
    });
    tiers.push({
      id: 'K-TEST',
      label: 'TEST paketi',
      required: ['test1EnIyi', 'test123Kirmizi', 'test12Sari', 'son800Top3']
    });
    tiers.push({
      id: 'K-VURGU3',
      label: 'Üçlü mavi vurgu',
      required: ['siraNoMavi', 'atIsmiMavi', 'tarihMavi']
    });
    tiers.push({
      id: 'K-YESIL',
      label: 'Son koşu yeşil + sarı',
      required: ['sonKosuYesilSatir', 'test12Sari', 'sonKosuProgramSehir']
    });
    tiers.push({
      id: 'K-800',
      label: 'SON800 + şehir',
      required: ['son800Top3', 'dahaOnceSehirMesafe', 'sehirMesafeBirIki']
    });
    tiers.push({
      id: 'K-KIRMIZI',
      label: 'Kırmızı TEST + TEST1 en iyi',
      required: ['test123Kirmizi', 'test1EnIyi']
    });

    return tiers;
  },

  /** Tüm kuralların katalogu (id → kural) */
  getRuleCatalog() {
    const catalog = {};
    for (const tier of this.buildRuleTiers()) {
      catalog[tier.id] = { ...tier, required: [...tier.required] };
    }
    return catalog;
  },

  getDefaultRuleOrder() {
    return this.buildRuleTiers().map(t => t.id);
  },

  /** Kayıtlı sıra + özel kurallardan aktif tier listesi */
  resolveTiers(config) {
    const catalog = this.getRuleCatalog();
    const custom = config?.customRules || {};
    const merged = { ...catalog, ...custom };
    const order = config?.order?.length ? config.order : this.getDefaultRuleOrder();
    const disabled = new Set(config?.disabled || []);
    return order
      .filter(id => !disabled.has(id))
      .map(id => merged[id])
      .filter(Boolean);
  },

  computeTahminForRace(race, options = {}) {
    const ctx = this.buildContext(race, options);
    const horseCount = ctx.calcRace.horses.length;
    const tiers = options.ruleTiers || this.buildRuleTiers();

    const profiles = ctx.calcRace.horses.map((h, j) => {
      const cond = this.evaluateHorse(j, ctx);
      const score = this.CONDITION_KEYS.filter(k => cond[k]).length;
      const t9 = ctx.trends.test7Farki[j];
      return {
        index: j,
        name: h.name || '-',
        no: h.no,
        cond,
        score,
        test9Abs: t9 === null || t9 === undefined ? Infinity : Math.abs(t9)
      };
    });

    const assigned = new Set();
    const meta = new Array(horseCount).fill(null);
    const result = new Array(horseCount).fill('');

    for (let sira = 1; sira <= horseCount; sira++) {
      let picked = null;
      let ruleId = 'SKOR';

      // 1. sırada K1 → K1-8 → K1-6 → diğer kademeler; koşmaz atlar SKOR'da kalır
      const tiersToTry = sira === 1
        ? tiers
        : tiers.filter(t => !t.siraOnly);

      for (const tier of tiersToTry) {
        const candidates = profiles.filter(p =>
          !assigned.has(p.index) && this._matchesRequired(p.cond, tier.required)
        );
        picked = this._pickCandidate(candidates);
        if (picked) {
          ruleId = tier.id;
          break;
        }
      }

      if (!picked) {
        const remaining = profiles.filter(p => !assigned.has(p.index));
        picked = this._pickCandidate(remaining);
        ruleId = picked ? 'SKOR' : null;
      }

      if (picked) {
        assigned.add(picked.index);
        result[sira - 1] = picked.name;
        meta[sira - 1] = {
          ruleId,
          score: picked.score,
          cond: picked.cond
        };
      }
    }

    return { names: result, meta, profiles };
  },

  computeAllRaces(races, options = {}) {
    const tahminler = {};
    const detay = {};
    for (let i = 0; i < races.length; i++) {
      const { names, meta } = this.computeTahminForRace(races[i], options);
      tahminler[i] = names.map((name, idx) => ({ sira: idx + 1, name: name || '' }));
      detay[i] = meta;
    }
    return { tahminler, detay };
  }
};

if (typeof module !== 'undefined') module.exports = { TahminEngine };
