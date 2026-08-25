/* İstatistik tahmin motoru — metrik grubu bazlı görsel profil */
const fs = require('fs');
const path = require('path');

global.AtSpeedUtils = require('../public/js/utils.js');
eval(fs.readFileSync(path.join(__dirname, '../public/js/formula-engine.js'), 'utf8') + '\n; global.GosterimEngine = GosterimEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-engine.js'), 'utf8') + '\n; global.IstatistikEngine = IstatistikEngine;');
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-grids-extra.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-gosterim-flags.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../public/js/istatistik-tahmin-engine.js'), 'utf8') + '\n; global.IstatistikTahminEngine = IstatistikTahminEngine;');

const IE = global.IstatistikEngine;
const TE = global.IstatistikTahminEngine;

function kosu(tarih, atDr, birinciDr, opts = {}) {
    return {
        tarih,
        mesafe: String(opts.mesafe || 1400),
        at_derece: atDr,
        birinci_derece: birinciDr,
        son800_bir: opts.son800_bir || '0.49.00',
        son800_iki: opts.son800_iki || '0.49.00',
        sehir: opts.sehir || 'İzmir',
        sira: opts.sira || '3'
    };
}

TE.resetWeights();

// Varsayılan ton önceliği: sarı 8–10, yeşil 2–4
TE.ensureDraft('son8001');
TE.ensureDraft('t9v');
if (TE.getDraftInfluence('son8001', 'visual', 'sari') !== 8) {
    console.error('FAIL: sari varsayılan 8 değil', TE.getDraftInfluence('son8001', 'visual', 'sari'));
    process.exit(1);
}
if (TE.getDraftInfluence('son8001', 'visual', 'sariMavi') !== 10) {
    console.error('FAIL: sariMavi varsayılan 10 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('son8001', 'visual', 'yesil') !== 2) {
    console.error('FAIL: yesil varsayılan 2 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('son8001', 'visual', 'maviKenar') !== 0) {
    console.error('FAIL: maviKenar varsayılan 0 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('t9v', 'visual', 'pct100') !== 0) {
    console.error('FAIL: t9v pct100 varsayılan 0 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('t9v', 'color', 'tk_sari_kirmizi') !== 9) {
    console.error('FAIL: t9v tk_sari_kirmizi varsayılan 9 değil');
    process.exit(1);
}

const sm12Sections = TE.getMetricProfileSections('sm12');
const sm12Trend = sm12Sections.find(s => s.kind === 'trend');
if (!sm12Trend || sm12Trend.profiles.length !== 4) {
    console.error('FAIL: sm12 trend 4 seçici olmalı', sm12Trend?.profiles?.map(p => p.id));
    process.exit(1);
}
if (sm12Trend.profiles.some(p => p.id === 'sariMavi')) {
    console.error('FAIL: trend satırı görsel profil göstermemeli');
    process.exit(1);
}
if (!sm12Trend.profiles.find(p => p.id === 'trendDownSon')) {
    console.error('FAIL: sm12 trendDownSon eksik');
    process.exit(1);
}

// Ş+M-12 puan ölçeği (slider +1 başına)
if (TE.getVisualPointScale('sm12', 'visual', 'sariMavi') !== 100) {
    console.error('FAIL: sm12 sariMavi ölçek 100 değil');
    process.exit(1);
}
if (TE.getVisualPointScale('sm12', 'visual', 'sari') !== 30) {
    console.error('FAIL: sm12 sari ölçek 30 değil');
    process.exit(1);
}
if (TE.getVisualPointScale('sm12', 'visual', 'yesilMavi') !== 16) {
    console.error('FAIL: sm12 yesilMavi ölçek 16 değil');
    process.exit(1);
}
if (TE.getVisualPointScale('sm12', 'visual', 'sariKirmizi') !== 70) {
    console.error('FAIL: sm12 sariKirmizi ölçek 70 değil', TE.getVisualPointScale('sm12', 'visual', 'sariKirmizi'));
    process.exit(1);
}
if (TE.getVisualPointScale('sm12', 'visual', 'yesil') !== 5) {
    console.error('FAIL: sm12 yesil ölçek 5 değil');
    process.exit(1);
}
if (TE.getVisualPointScale('smGec', 'visual', 'maviKenar') !== 12) {
    console.error('FAIL: smGec maviKenar ölçek 12 değil', TE.getVisualPointScale('smGec', 'visual', 'maviKenar'));
    process.exit(1);
}
if (TE.getVisualPointScale('smGec', 'visual', 'sariKirmizi') !== 70) {
    console.error('FAIL: smGec sariKirmizi ölçek 70 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('smGec', 'visual', 'maviKenar') !== 0) {
    console.error('FAIL: smGec slider varsayılan 0 olmalı');
    process.exit(1);
}

// smGec: mavi kenar +1 = 12 puan (16 değil)
TE.setDraftInfluence('smGec', 'visual', 'maviKenar', 1);
TE.saveDraftMetric('smGec');
TE.setSelectedMetric('smGec');
TE.setCalcMode(TE.CALC_MODE_SOLO);
const smGecMaviT = TE.computeRowTahmin(
    { smGecDepths: [{ visualProfile: 'maviKenar' }] },
    [{ id: 'smGec', label: 'Ş+M-GEÇ', depthsKey: 'smGecDepths' }]
);
if (smGecMaviT.score !== 12) {
    console.error('FAIL: smGec maviKenar +1 = 12 puan', smGecMaviT.score);
    process.exit(1);
}

if (TE.getVisualPointScale('sehirSon', 'visual', 'sariMavi') !== 100) {
    console.error('FAIL: sehirSon sariMavi ölçek 100 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('sehirSon', 'visual', 'sari') !== 0) {
    console.error('FAIL: sehirSon slider varsayılan 0 olmalı', TE.getDraftInfluence('sehirSon', 'visual', 'sari'));
    process.exit(1);
}
TE.setDraftInfluence('sehirSon', 'visual', 'sari', 1);
TE.saveDraftMetric('sehirSon');
TE.setSelectedMetric('sehirSon');
const sehirSonT = TE.computeRowTahmin(
    { sehirSonDepths: [{ pct: 20, gosterim: {} }] },
    [{ id: 'sehirSon', label: 'ŞEH-SON', depthsKey: 'sehirSonDepths' }]
);
if (sehirSonT.score !== 30) {
    console.error('FAIL: sehirSon sari +1 = 30 puan', sehirSonT.score);
    process.exit(1);
}

if (TE.getVisualPointScale('f8021', 'visual', 'sariKirmizi') !== 70) {
    console.error('FAIL: f8021 sariKirmizi ölçek 70 değil');
    process.exit(1);
}
if (TE.getDraftInfluence('f8021', 'visual', 'sariMavi') !== 0) {
    console.error('FAIL: f8021 slider varsayılan 0 olmalı');
    process.exit(1);
}
TE.setDraftInfluence('f8021', 'visual', 'sariKirmizi', 1);
TE.saveDraftMetric('f8021');
TE.setSelectedMetric('f8021');
const f8021T = TE.computeRowTahmin(
    { f8021Depths: [{ pct: 0, gosterim: { kirmiziKenar: true, yesilSatir: true } }] },
    [{ id: 'f8021', label: '8002−1', depthsKey: 'f8021Depths' }]
);
if (f8021T.score !== 70) {
    console.error('FAIL: f8021 sariKirmizi +1 = 70 puan', f8021T.score);
    process.exit(1);
}

if (TE.getDraftInfluence('sm12', 'visual', 'sariKirmizi') !== 0) {
    console.error('FAIL: sm12 slider varsayılan 0 olmalı');
    process.exit(1);
}

// sm12: sarı+kırmızı +1 > yeşil +1 (70 vs 5)
TE.setDraftInfluence('sm12', 'visual', 'sariKirmizi', 1);
TE.setDraftInfluence('sm12', 'visual', 'yesil', 1);
TE.saveDraftMetric('sm12');
TE.setSelectedMetric('sm12');
TE.setCalcMode(TE.CALC_MODE_SOLO);
const skCell = { pct: 0, gosterim: { kirmiziKenar: true, yesilSatir: true } };
const yesilCell = { pct: 50, gosterim: {} };
const skT = TE.computeRowTahmin(
    { sm12Depths: [skCell] },
    [{ id: 'sm12', label: 'Ş+M-12', depthsKey: 'sm12Depths' }]
);
const yesilT = TE.computeRowTahmin(
    { sm12Depths: [yesilCell] },
    [{ id: 'sm12', label: 'Ş+M-12', depthsKey: 'sm12Depths' }]
);
if (skT.score !== 70 || yesilT.score !== 5) {
    console.error('FAIL: sm12 ölçekli puan', skT.score, yesilT.score);
    process.exit(1);
}

// sm12 trend: aynı slider +1'de görselden %20 fazla (sarı baz 30)
TE.setDraftInfluence('sm12', 'trend', 'trendDownSon', 1);
TE.setDraftInfluence('sm12', 'visual', 'sari', 1);
TE.saveDraftMetric('sm12');
const trendBonusRow = {
    sm12Depths: [{ pct: 10 }, { pct: 60 }]
};
const trendBonusT = TE.computeRowTahmin(trendBonusRow, [{ id: 'sm12', label: 'Ş+M-12', depthsKey: 'sm12Depths' }]);
const sm12TrendTerm = trendBonusT.terms.find(x => x.metricId === 'sm12' && x.label.includes('SON ↓'));
const sm12VisualTerm = TE.computeRowTahmin(
    { sm12Depths: [{ pct: 0, gosterim: { yesilSatir: true } }] },
    [{ id: 'sm12', label: 'Ş+M-12', depthsKey: 'sm12Depths' }]
).terms.find(x => x.metricId === 'sm12' && x.label.includes('Sarı'));
if (!sm12TrendTerm || sm12TrendTerm.points < sm12VisualTerm.points) {
    console.error('FAIL: sm12 trend %20 bonus', sm12TrendTerm?.points, sm12VisualTerm?.points);
    process.exit(1);
}
if (sm12VisualTerm.points !== 30) {
    console.error('FAIL: sm12 sari +1 = 30 puan', sm12VisualTerm.points);
    process.exit(1);
}

// Metrik bazlı kayıt (taslak + kaydet)
TE.setMetricInfluence('son8001', 'visual', 'maviKenar', 25);
TE.setMetricInfluence('t8', 'visual', 'maviKenar', 5);
TE.ensureDraft('son8001');
TE.ensureDraft('t8');
TE.saveDraftMetric('son8001');
TE.saveDraftMetric('t8');
if (TE.getDraftInfluence('son8001', 'visual', 'maviKenar') !== 25) {
    console.error('FAIL: son8001 maviKenar taslak');
    process.exit(1);
}
if (TE.getMetricInfluence('son8001', 'visual', 'maviKenar') !== 25) {
    console.error('FAIL: son8001 maviKenar kayıt');
    process.exit(1);
}
if (TE.getMetricInfluence('t8', 'visual', 'maviKenar') !== 5) {
    console.error('FAIL: t8 maviKenar ayrı kayıt');
    process.exit(1);
}

const row = {
    son8001Depths: [{ visualProfile: 'maviKenar' }],
    test8Depths: [{ visualProfile: 'maviKenar' }]
};
// Solo mod: yalnızca seçili metrik
TE.setCalcMode(TE.CALC_MODE_SOLO);
TE.setSelectedMetric('son8001');
let t = TE.computeRowTahmin(row, []);
let son8001Term = t.terms.find(x => x.metricId === 'son8001');
let t8Term = t.terms.find(x => x.metricId === 't8');
if (!son8001Term || son8001Term.points !== 25) {
    console.error('FAIL: solo son8001 skor', son8001Term);
    process.exit(1);
}
if (t8Term) {
    console.error('FAIL: solo modda t8 sıfır olmalı', t8Term);
    process.exit(1);
}

// Tüm kayıtlılar modu
TE.setCalcMode(TE.CALC_MODE_ALL);
t = TE.computeRowTahmin(row, []);
son8001Term = t.terms.find(x => x.metricId === 'son8001');
t8Term = t.terms.find(x => x.metricId === 't8');
if (!son8001Term || son8001Term.points !== 25) {
    console.error('FAIL: all son8001 skor', son8001Term);
    process.exit(1);
}
if (!t8Term || t8Term.points !== 5) {
    console.error('FAIL: all t8 skor', t8Term);
    process.exit(1);
}

TE.setSelectedMetric('t8');
if (TE.getSelectedMetric() !== 't8') {
    console.error('FAIL: seçili metrik');
    process.exit(1);
}

const race = {
    mesafe: '1400',
    horses: [
        { no: 1, name: 'Alpha', kosular: [kosu('20.08.2026', '1.28.00', '1.27.00')] },
        { no: 2, name: 'Beta', kosular: [kosu('18.08.2026', '1.30.00', '1.27.00')] }
    ]
};
const pkg = IE.buildRaceIstatistikPackage(race, 'İzmir', '24.08.2026');
TE.attachRaceTahmin(pkg);
if (!pkg.rows[0]?.tahmin?.rank) {
    console.error('FAIL: tahmin rank');
    process.exit(1);
}

const catalog = TE.getMetricCatalog(pkg.extraSections);
if (!catalog.find(m => m.id === 'son8001') || !catalog.find(m => m.id === 'f802')) {
    console.error('FAIL: metrik katalog', catalog.length);
    process.exit(1);
}

TE.resetMetricInfluences('son8001');
if (TE.isMetricSaved('son8001')) {
    console.error('FAIL: son8001 sıfırlanmadı');
    process.exit(1);
}
if (!TE.isMetricSaved('t8')) {
    console.error('FAIL: t8 etkileri kalmalı');
    process.exit(1);
}

// T9V metrik özel seçiciler
const t9vSections = TE.getMetricProfileSections('t9v');
if (!t9vSections.find(s => s.kind === 'ort') || !t9vSections.find(s => s.title.includes('T9V'))) {
    console.error('FAIL: T9V katalog', t9vSections.map(s => s.title));
    process.exit(1);
}
const tkSection = t9vSections.find(s => s.kind === 'color' && s.title.includes('Ton'));
if (!tkSection || tkSection.profiles.length !== 13) {
    console.error('FAIL: T9V ton×çerçeve katalog', tkSection?.profiles?.length);
    process.exit(1);
}
if (t9vSections.find(s => s.kind === 'tone')) {
    console.error('FAIL: T9V ayrı ton seçicisi kalmamalı');
    process.exit(1);
}
const defaultSections = TE.getMetricProfileSections('son8001');
if (defaultSections[0].profiles.length !== TE.VISUAL_PROFILES.length) {
    console.error('FAIL: varsayılan görsel profil sayısı');
    process.exit(1);
}

TE.setMetricInfluence('t9v', 'visual', 'pct100', 30);
TE.ensureDraft('t9v');
TE.saveDraftMetric('t9v');
TE.setCalcMode(TE.CALC_MODE_SOLO);
TE.setSelectedMetric('t9v');
const t9vRow = {
    t9vDepths: [{ pct: 100, isBest: true, kmIsBest: true, kmPct: 100, t9IsBest: true, t9Pct: 100 }],
    kmaviDepths: [{ qualifies: true, pct: 100, isBest: true }],
    t9Depths: [{ pct: 100, isBest: true }],
    t9vOrtOzeti: { agirlikli: { pct: 100 }, ort3: { pct: 80 } }
};
const t9vT = TE.computeRowTahmin(t9vRow, [{ id: 't9v', label: 'T9V', depthsKey: 't9vDepths' }]);
const pct100Term = t9vT.terms.find(x => x.metricId === 't9v' && x.label.includes('%100'));
if (!pct100Term || pct100Term.points !== 30) {
    console.error('FAIL: T9V pct100 skor', pct100Term, t9vT.terms.filter(x => x.metricId === 't9v'));
    process.exit(1);
}

TE.setDraftInfluence('t9v', 'visual', 'kmUymuyor', 3);
TE.saveDraftMetric('t9v');
const kmUymRow = {
    t9vDepths: [null],
    kmaviDepths: [{ qualifies: false }],
    t9Depths: [{ pct: 50 }]
};
const kmUymT = TE.computeRowTahmin(kmUymRow, [{ id: 't9v', label: 'T9V', depthsKey: 't9vDepths' }]);
if (!kmUymT.terms.some(x => x.metricId === 't9v' && x.label.includes('KM uyumsuz'))) {
    console.error('FAIL: T9V kmUymuyor sinyali', kmUymT.terms);
    process.exit(1);
}

TE.setDraftInfluence('t9v', 'color', 'tk_yesil_mavi', 15);
TE.saveDraftMetric('t9v');
const colorRow = {
    t9vDepths: [{
        pct: 100,
        gosterim: { maviKenar: true, test1EnIyi: true, sehirEslesme: true },
        visualProfile: 'yesilMavi'
    }],
    kmaviDepths: [{ qualifies: true }],
    t9Depths: [{ pct: 100 }],
    t9vOrtOzeti: {}
};
const colorT = TE.computeRowTahmin(colorRow, [{ id: 't9v', label: 'T9V', depthsKey: 't9vDepths' }]);
const comboTerm = colorT.terms.find(x => x.metricId === 't9v' && x.label.includes('mavi çizgi'));
if (!comboTerm || comboTerm.points !== 15) {
    console.error('FAIL: T9V ton×çerçeve', comboTerm, colorT.terms);
    process.exit(1);
}
if (TE.classifyT9vTonKenar(colorRow.t9vDepths[0]) !== 'tk_yesil_mavi') {
    console.error('FAIL: classifyT9vTonKenar yesil+mavi');
    process.exit(1);
}
const pctOnly = TE.classifyT9vTonKenar({ pct: 10 });
if (pctOnly !== 'tk_sari_yok') {
    console.error('FAIL: classifyT9vTonKenar pct sari', pctOnly);
    process.exit(1);
}
const borderOnly = TE.classifyT9vTonKenar({
    pct: 50,
    gosterim: { maviKenar: true }
});
if (borderOnly !== 'tk_yok_mavi') {
    console.error('FAIL: classifyT9vTonKenar ton yok + mavi', borderOnly);
    process.exit(1);
}

// TUNCER tipi: sarı satır + kırmızı kenar; test1EnIyi ekranda ton değiştirmez → sariKirmizi
const tuncerCell = {
    pct: 0,
    gosterim: { kirmiziKenar: true, yesilSatir: true, test1EnIyi: true }
};
if (IE.classifyCellVisual(tuncerCell) !== 'sariKirmizi') {
    console.error('FAIL: yesilSatir+kirmizi test1EnIyi → sariKirmizi', IE.classifyCellVisual(tuncerCell));
    process.exit(1);
}
TE.setDraftInfluence('sm12', 'visual', 'sariKirmizi', 9);
TE.setSelectedMetric('sm12');
TE.setCalcMode(TE.CALC_MODE_SOLO);
TE.saveDraftMetric('sm12');
const tuncerRow = { sm12Depths: [null, tuncerCell] };
const tuncerT = TE.computeRowTahmin(tuncerRow, [{ id: 'sm12', label: 'Ş+M-12', depthsKey: 'sm12Depths' }]);
const tuncerTerm = tuncerT.terms.find(x => x.metricId === 'sm12' && x.label.includes('Sarı+kırmızı'));
if (!tuncerTerm || tuncerTerm.points !== 630) {
    console.error('FAIL: sm12 sariKirmizi TUNCER tipi 9×70=630', tuncerTerm, tuncerT.terms);
    process.exit(1);
}

console.log('Metrik bazlı TAHMİN: son8001 +' + son8001Term.points + ', t8 +' + t8Term.points);
console.log('T9V pct100 +' + pct100Term.points);

// Trend derinlik: sabit indeks + büyüklük puanı
const hits = IE.computeDepthTrendHits([
    { pct: 1 }, { pct: 22 }, { pct: 50 }
]);
if (!hits.find(h => h.id === 'trendDownSon' && h.delta === 21)) {
    console.error('FAIL: trendDownSon delta', hits);
    process.exit(1);
}
if (!hits.find(h => h.id === 'trendDown3' && h.delta === 49)) {
    console.error('FAIL: trendDown3 delta', hits);
    process.exit(1);
}
// Null SON — 1 ÖNCE/2 ÖNCE karşılaştırılmamalı
const nullSon = IE.computeDepthTrendHits([null, { pct: 50 }, { pct: 80 }]);
if (nullSon.some(h => h.id === 'trendDownSon')) {
    console.error('FAIL: null SON trendDownSon', nullSon);
    process.exit(1);
}

TE.resetWeights();
TE.setDraftInfluence('t9v', 'trend', 'trendDownSon', 25);
TE.saveDraftMetric('t9v');
TE.setCalcMode(TE.CALC_MODE_SOLO);
TE.setSelectedMetric('t9v');
const trendRow = {
    t9vDepths: [{ pct: 10 }, { pct: 60 }],
    kmaviDepths: [{ qualifies: true }, { qualifies: true }],
    t9Depths: [{ pct: 10 }, { pct: 60 }],
    t9vOrtOzeti: {}
};
const trendT = TE.computeRowTahmin(trendRow, [{ id: 't9v', label: 'T9V', depthsKey: 't9vDepths' }]);
const trendTerm = trendT.terms.find(x => x.metricId === 't9v' && x.label.includes('SON ↓'));
// delta=50, weight=25 → round(25*50/25)=50
if (!trendTerm || trendTerm.points !== 50) {
    console.error('FAIL: trend magnitude points', trendTerm, trendT.terms);
    process.exit(1);
}
const flatRow = {
    t9vDepths: [{ pct: 50 }, { pct: 50 }],
    kmaviDepths: [{ qualifies: true }, { qualifies: true }],
    t9Depths: [{ pct: 50 }, { pct: 50 }],
    t9vOrtOzeti: {}
};
const flatT = TE.computeRowTahmin(flatRow, [{ id: 't9v', label: 'T9V', depthsKey: 't9vDepths' }]);
if (flatT.terms.some(x => x.label.includes('SON ↓'))) {
    console.error('FAIL: düz trend olmamalı', flatT.terms);
    process.exit(1);
}

console.log('Trend SON↓ Δ50 → +' + trendTerm.points + ' puan');
console.log('OK');
