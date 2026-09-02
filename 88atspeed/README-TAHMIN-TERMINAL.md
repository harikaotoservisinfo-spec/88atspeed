# TAHMİN puanlama — terminal test rehberi

Bu dosya, **SON TEST → TAHMİN** sütununun puanlama kurallarını terminalden ölçmek ve **yalnızca söylenen değişiklikleri** denemek içindir.

---

## Önemli kural

> **Sadece kullanıcının açıkça istediği faktör/puan değişir.**  
> Başka bonus, taban skor veya UI’a dokunulmaz. Terminal testi → sonuç raporu → onay → üretime.

---

## TAHMİN skoru nasıl oluşur?

```
TOPLAM TAHMİN = Taban (7 BAŞ+) + GÖSTERİM ödülleri
```

| Katman | Kaynak | Açıklama |
|--------|--------|----------|
| **Taban** | `DimensionTahminBoostEngine` | AS, SH, KC, TK, PS, HP, SK BAŞ+ karışımı · skor 1–100 |
| **GÖSTERİM** | `AtestSonGosterimCols.applyTahminBonuses` | Aşağıdaki faktörler · mutlak puan ekler |

Tooltip: `taban %X + gösterim ödülü %Y`

---

## GÖSTERİM faktörleri (mevcut puanlar)

| ID | Faktör | Puan | Kimde |
|----|--------|------|-------|
| `scenario48` | 48 senaryo TEST1/2/3 kırmızı | +9 … +38 | Geçmiş koşuda isabet |
| `atIsmiMavi` | AT İSMİ mavi fosfor | +5 / −5 | Her at |
| `atIdMavi` | AT ID mavi (son 3) | +7 / −3 | Her at |
| `tarihMavi` | TARİH mavi (son 2) | +5 / −3 | Her at |
| `atIdTarihCombo` | AT ID + TARİH ikisi mavi | +4 | |
| `maviTriple` | 3'lü mavi combo | +4 | |
| `maviQuad` | 4'lü mavi combo | +4 | |
| `atIsmiKenarMavi` | AT İSMİ mavi kenar | +3 | SIRA=1 |
| `atIsmiKenarKirmizi` | AT İSMİ kırmızı kenar | +3 | SIRA=1 |
| `test1Green` | TEST1 yeşil | +15 / +12 / +9… | 1 veya 2+ at |
| `test1Rank` | TEST1 en iyi 3 süre + kırmızı ekstra | +7/+5/+3 (+3) | 3 at |
| `son800Rank` | SON800-1 top-3 | +10/+7/+4 | 3 at |
| `son800DualGreen` | SON800-1+2 yeşil | +5 | Geçmiş koşu |

**Not:** TEST9 (+45) ve 8002-8001 (+5) ayrı bonus **kaldırıldı** — 48 senaryo kodunda (S1A–S3D) zaten var.

**Senaryo bonusu:** `round(maxFinal × 10)` · min +9 · maxCap +38 (varsayılan).

---

## Sunucuda deploy + test

```bash
# Mac’ten sunucuya bağlan
ssh root@168.231.109.27

# Deploy (branch adını değiştir)
bash /var/www/88atspeed/deploy/update-on-server.sh cursor/scenario48-test-b004

# Testler — /var/www/88atspeed içinde
cd /var/www/88atspeed
```

`/var/www/88atspeed` yolu **sadece sunucuda** vardır; Mac’te çalışmaz.

---

## Terminal komutları

### 1) Faktör tekil + ikili kombinasyon (★1 / ◆1-3)

Hangi faktör veya **hangi ikili** tabana en çok katkı yapıyor?

```bash
npm run test:tahmin-factors
# veya
node scripts/test-tahmin-factor-combo.js --kayit 148,154
```

Çıktı:
- **TABAN** — sadece 7 BAŞ+
- **TEK FAKTÖR** — taban + 1 faktör
- **İKİLİ** — taban + A + B (78 çift, Δ★1 sıralı)
- **GREEDY ZİNCİR** — sırayla en iyi eklenen faktör
- **TÜM FAKTÖRLER** — üretim TAHMİN (~35% ★1, ~71% ◆1-3 hedef)

Kısaltmalar: `S48` `ATİ` `ATID` `TAR` `ID+TR` `M3` `M4` `KnM` `KnK` `T1Y` `T1R` `S8R` `S8G`

---

### 2) Senaryo bonus tavan taraması (+38 … +55)

Senaryo çarpanını artırmanın etkisi (sonuç: **+38’de kal**, üstü değiştirmedi):

```bash
npm run test:scenario48-cap
# veya
node scripts/test-scenario48-cap-sweep.js --kayit 148,154 --cap-min 38 --cap-max 55
```

---

### 3) 48 senaryo satır/isabet analizi

Senaryo kodu × bitiş (S2B, S2D vb.):

```bash
npm run test:scenario48
# veya
node scripts/test-scenario48-basari.js --kayit 148,154 -v
```

---

## Metrikler

| Metrik | Anlam |
|--------|--------|
| **★1** | TAHMİN 1. sıradaki at = birinci |
| **◆1-3** | TAHMİN 1. sıradaki at = ilk 3 |
| **2.lik (#2)** | TAHMİN 2. sıra = gerçek 2. |
| **3.lük (#3)** | TAHMİN 3. sıra = gerçek 3. |
| **Δ★1 / Δ◆3** | Tabana göre koşu sayısı farkı |
| **Blend** | Karışık başarı skoru (★1 ağırlıklı) |

Varsayılan test kayıtları: **#148 İzmir**, **#154 Bursa** (17 koşu).

---

## Bu konuşmada yapılanlar / kaldığımız yer

| Adım | Durum |
|------|--------|
| 48 senaryo → TEST123 kırmızı TAHMİN bonusu (maxFinal×10) | ✅ |
| TEST9/8002 çift sayım kaldırıldı | ✅ |
| maxFinal vs sumFinal test scripti | ✅ |
| Senaryo maxCap +38…+55 taraması | ✅ → **+38 en iyi, artış yok** |
| Faktör tekil/ikili kombinasyon testi | ✅ script hazır |
| **`npm run test:tahmin-factors` sunucu çıktısı** | ⏳ henüz paylaşılmadı |
| Kod ağırlığı (S2B↑, S2D↓) veya seçili faktör artırımı | 🔜 kullanıcı onayından sonra |

**Tam TAHMİN (tüm faktörler):** ~**35% ★1**, ~**71% ◆1-3** (148+154, 17 koşu).

---

## Yeni varyasyon denemek (sadece istenen değişiklik)

1. Kullanıcı **hangi faktörü** ve **ne kadar** değiştireceğini söyler (ör. “S48 maxCap +45”, “S8R +12/+8/+5”, “sadece S48+T1R ikilisi”).
2. Kodda **yalnız o sabit** veya test scripti parametresi güncellenir.
3. Deploy + ilgili `npm run test:…` çalıştırılır.
4. Terminal çıktısı kaydedilir; kullanıcı onaylamadan üretime alınmaz.

Faktör maskesi (test için):

```javascript
AtestSonGosterimCols.applyTahminBonuses(rows, gosByKey, race, meta, resolveKosular, {
  enabledFactors: new Set(['scenario48', 'test1Rank'])  // sadece bunlar
});
```

Senaryo tavan (test için):

```javascript
Scenario48ScoringEngine.setScenarioBonusCap(45, 38);  // max +45, taban ölçek 38
```

---

## İlgili dosyalar

| Dosya | Rol |
|-------|-----|
| `public/js/astest-son-gosterim-cols.js` | GÖSTERİM bonusları · `TAHMIN_BONUS_FACTORS` |
| `public/js/scenario48-scoring-engine.js` | 48 senaryo · `finalToPctBonus` · `setScenarioBonusCap` |
| `public/js/dimension-tahmin-boost-engine.js` | 7 BAŞ+ taban |
| `scripts/test-tahmin-factor-combo.js` | Tekil + ikili faktör testi |
| `scripts/test-scenario48-cap-sweep.js` | Senaryo maxCap taraması |
| `scripts/test-scenario48-basari.js` | Senaryo kod × bitiş |
| `deploy/update-on-server.sh` | Sunucu deploy |

**Branch / PR:** `cursor/scenario48-test-b004` · PR #69

---

## Sıradaki mantıklı denemeler (onay gerekir)

- `test:tahmin-factors` çıktısına göre **en iyi ikili**yi sabitlemek
- Senaryo **kod ağırlığı** (S2B↑, S2D↓, S1A↓)
- Tek faktör puan artırımı (ör. yalnız `son800Rank` +10→+12)
- 2./3. sıra için ayrı metrik optimizasyonu

Her deneme: **tek değişken** · terminal raporu · karşılaştırma tablosu.
